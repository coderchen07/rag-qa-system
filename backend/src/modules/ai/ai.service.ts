import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { ChatDeepSeek } from "@langchain/deepseek";
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";
import { Document } from "@langchain/core/documents";
import { AIMessage, BaseMessageLike, ToolMessage } from "@langchain/core/messages";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { ConversationService } from "../conversation/conversation.service";
import { ConversationRole } from "../conversation/entities/session.entity";
import { ToolsService } from "../tools/tools.service";
import { FeedbackService } from "../feedback/feedback.service";

type UploadedDocChunk = {
  uploadId: string;
  pageContent: string;
  metadata: Record<string, unknown>;
};

type UploadDocMeta = {
  uploadId: string;
  title: string;
  source: string;
  uploadedAt: string;
  chunkCount: number;
  charCount: number;
  chapterCount: number;
  chapterTitles: string[];
  globalSummary: string;
};

type RagSmartMode = "fact" | "summary" | "analysis";

type RagEvidence = {
  title: string;
  snippet: string;
  chunkIndex?: number;
};

type RagSource = {
  title: string;
  score: number;
};

type RagSmartResult = {
  answer: string;
  correctionUsed: boolean;
  sources: RagSource[];
  evidence: RagEvidence[];
  meta: {
    mode: RagSmartMode;
    contextCount: number;
  };
};

type PersistedVectorIndexV1 = {
  version: 1;
  embeddingModelPath: string;
  fingerprint: string;
  documentCount: number;
  vectors: number[][];
};

@Injectable()
export class AiService implements OnModuleInit {
  private readonly maxContextTokens = 4000;
  private readonly recentMessagesToKeep = 10;
  private readonly searchTopK = 3;
  private readonly searchScoreThreshold: number;
  private readonly ragTopK = 3;
  private readonly smartTopK = 8;
  private readonly maxContextChars = 10000;
  private readonly maxEvidenceItems = 3;
  private readonly postsFilePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "data",
    "posts-embedding.json",
  );
  private readonly uploadedDocsFilePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "data",
    "uploaded-documents.json",
  );
  private readonly deletedUploadIdsFilePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "data",
    "deleted-upload-ids.json",
  );
  private readonly uploadedMetaFilePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "data",
    "uploaded-documents-meta.json",
  );
  private readonly vectorIndexFilePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "data",
    "vector-index.json",
  );
  private readonly vectorEmbedBatchSize = 48;
  private llm!: ChatDeepSeek;
  private embeddings!: HuggingFaceTransformersEmbeddings;
  private vectorStore?: MemoryVectorStore;
  private readonly vectorStoreBootPromise: Promise<void>;
  private persistVectorIndexChain: Promise<void> = Promise.resolve();
  private postDocuments: Document[] = [];
  private uploadedDocuments: Document[] = [];
  private uploadedMetaById = new Map<string, UploadDocMeta>();
  private deletedUploadIds = new Set<string>();
  private readonly blockedUploadIds = new Set<string>(["upload-1777036272786-292594111"]);
  private readonly cjkVariantMap = new Map<string, string>([
    ["溫", "温"],
    ["彥", "彦"],
    ["見", "见"],
    ["敗", "败"],
    ["說", "说"],
    ["關", "关"],
    ["係", "系"],
    ["學", "学"],
    ["書", "书"],
    ["嗎", "吗"],
    ["裡", "里"],
    ["於", "于"],
    ["與", "与"],
    ["為", "为"],
    ["這", "这"],
    ["個", "个"],
    ["後", "后"],
    ["對", "对"],
    ["來", "来"],
    ["時", "时"],
    ["會", "会"],
    ["愛", "爱"],
    ["風", "风"],
    ["實", "实"],
    ["開", "开"],
    ["話", "话"],
    ["裡", "里"],
    ["國", "国"],
    ["劃", "划"],
  ]);

  constructor(
    private readonly toolsService: ToolsService,
    private readonly feedbackService: FeedbackService,
    private readonly conversationService: ConversationService,
  ) {
    this.searchScoreThreshold = Number(process.env.SEARCH_SCORE_THRESHOLD ?? "0.45");

    const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
    const deepseekModel = process.env.DEEPSEEK_MODEL;

    if (!deepseekApiKey || !deepseekModel) {
      throw new Error(
        "Missing required environment variables: DEEPSEEK_API_KEY, DEEPSEEK_MODEL",
      );
    }

    const llm = new ChatDeepSeek({
      model: deepseekModel,
      apiKey: deepseekApiKey,
      temperature: 0.7,
    });

    const embeddings = new HuggingFaceTransformersEmbeddings({
      model: this.getEmbeddingModelPath(),
    });
    this.llm = llm;
    this.embeddings = embeddings;

    this.vectorStoreBootPromise = (async () => {
      try {
        await this.initializeVectorStore();
      } catch (error: unknown) {
        console.error("Failed to initialize AI vector store:", error);
      }
    })();
  }

  async onModuleInit(): Promise<void> {
    try {
      const definitions = this.toolsService.getDefinitions();
      console.log(
        "[ToolsService] definitions:",
        JSON.stringify(definitions, null, 2),
      );
      const weatherMock = await this.toolsService.executeTool(
        "get_weather",
        { city: "深圳" },
        { callerRole: "admin" },
      );
      console.log("[ToolsService] execute get_weather:", weatherMock);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "tools verification failed";
      console.error("[ToolsService] verification error:", message);
    }
  }

  private async initializeVectorStore(): Promise<void> {
    this.postDocuments = await this.loadPostDocuments();
    this.uploadedDocuments = await this.loadUploadedDocuments();
    this.deletedUploadIds = await this.loadDeletedUploadIds();
    this.uploadedMetaById = await this.loadUploadedMeta();
    this.rebuildUploadedMetaFromDocuments();
    await this.saveUploadedMeta();
    await this.rebuildOrLoadVectorStore();
  }

  private getEmbeddingModelPath(): string {
    return path.join(process.cwd(), "models", "bge-small-zh-v1.5");
  }

  private buildAllDocumentsForVectorEmbedding(): Document[] {
    return [...this.getFixedDocuments(), ...this.postDocuments, ...this.uploadedDocuments];
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`)
      .join(",")}}`;
  }

  private computeVectorStoreFingerprint(documents: Document[]): string {
    const hash = createHash("sha256");
    for (const doc of documents) {
      hash.update(String(doc.pageContent ?? ""));
      hash.update("\u0000");
      hash.update(this.stableStringify((doc.metadata as Record<string, unknown>) ?? {}));
      hash.update("\u0001");
    }
    return hash.digest("hex");
  }

  private async tryLoadPersistedVectorStore(
    allDocuments: Document[],
  ): Promise<MemoryVectorStore | null> {
    if (allDocuments.length === 0) {
      return null;
    }
    try {
      const raw = await readFile(this.vectorIndexFilePath, "utf-8");
      const parsed = JSON.parse(raw) as PersistedVectorIndexV1;
      if (parsed?.version !== 1) {
        return null;
      }
      if (parsed.embeddingModelPath !== this.getEmbeddingModelPath()) {
        console.warn("[AiService] vector-index: embedding model path mismatch, rebuilding.");
        return null;
      }
      if (parsed.documentCount !== allDocuments.length) {
        return null;
      }
      if (parsed.fingerprint !== this.computeVectorStoreFingerprint(allDocuments)) {
        return null;
      }
      if (!Array.isArray(parsed.vectors) || parsed.vectors.length !== allDocuments.length) {
        return null;
      }
      for (let i = 0; i < allDocuments.length; i += 1) {
        const embedding = parsed.vectors[i];
        if (!Array.isArray(embedding) || embedding.length === 0) {
          return null;
        }
        if (embedding.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
          return null;
        }
      }
      const dim = parsed.vectors[0].length;
      if (!parsed.vectors.every((vec) => vec.length === dim)) {
        return null;
      }
      const store = await MemoryVectorStore.fromExistingIndex(this.embeddings);
      await store.addVectors(
        parsed.vectors,
        allDocuments.map(
          (doc) =>
            new Document({
              pageContent: doc.pageContent,
              metadata: { ...(doc.metadata as Record<string, unknown>) },
            }),
        ),
      );
      return store;
    } catch {
      return null;
    }
  }

  private async persistVectorIndexToDisk(): Promise<void> {
    if (!this.vectorStore) {
      return;
    }
    const allDocuments = this.buildAllDocumentsForVectorEmbedding();
    const memoryVectors = this.vectorStore.memoryVectors;
    if (memoryVectors.length !== allDocuments.length) {
      console.warn(
        `[AiService] Skip vector-index save: memoryVectors=${memoryVectors.length} vs documents=${allDocuments.length}.`,
      );
      return;
    }
    for (let i = 0; i < allDocuments.length; i += 1) {
      if (String(memoryVectors[i]?.content ?? "") !== String(allDocuments[i].pageContent ?? "")) {
        console.warn("[AiService] Skip vector-index save: document order/content drift detected.");
        return;
      }
    }
    const payload: PersistedVectorIndexV1 = {
      version: 1,
      embeddingModelPath: this.getEmbeddingModelPath(),
      fingerprint: this.computeVectorStoreFingerprint(allDocuments),
      documentCount: allDocuments.length,
      vectors: memoryVectors.map((row) => row.embedding),
    };
    await mkdir(path.dirname(this.vectorIndexFilePath), { recursive: true });
    await writeFile(this.vectorIndexFilePath, JSON.stringify(payload), "utf-8");
  }

  private schedulePersistVectorIndex(): Promise<void> {
    this.persistVectorIndexChain = this.persistVectorIndexChain
      .then(() => this.persistVectorIndexToDisk())
      .catch((error: unknown) => {
        console.error("[AiService] Failed to persist vector index:", error);
      });
    return this.persistVectorIndexChain;
  }

  private async embedDocumentsInBatches(documents: Document[]): Promise<MemoryVectorStore> {
    const store = await MemoryVectorStore.fromExistingIndex(this.embeddings);
    if (documents.length === 0) {
      return store;
    }
    for (let i = 0; i < documents.length; i += this.vectorEmbedBatchSize) {
      const batch = documents.slice(i, i + this.vectorEmbedBatchSize);
      await store.addDocuments(batch);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
    return store;
  }

  private async rebuildOrLoadVectorStore(): Promise<void> {
    const allDocuments = this.buildAllDocumentsForVectorEmbedding();
    const loaded = await this.tryLoadPersistedVectorStore(allDocuments);
    if (loaded) {
      this.vectorStore = loaded;
      console.log(
        `[AiService] Vector store loaded from disk cache (${allDocuments.length} documents).`,
      );
      return;
    }
    this.vectorStore = await this.embedDocumentsInBatches(allDocuments);
    console.log(
      `[AiService] Vector store built with batched embeddings (${allDocuments.length} documents).`,
    );
    await this.persistVectorIndexToDisk();
  }

  private getFixedDocuments(): Document[] {
    return [
      new Document({
        pageContent:
          "RAG 问答流程是先检索知识库相关片段，再把上下文交给大模型生成答案。该模式强调基于上下文回答，减少幻觉。",
        metadata: { source: "fixed", topic: "rag", title: "RAG 基础概念" },
      }),
      new Document({
        pageContent:
          "React 前端负责用户提问、展示回答结果，并支持 RAG 问答、文档搜索和普通聊天三种交互模式。",
        metadata: { source: "fixed", topic: "react", title: "React 前端职责" },
      }),
      new Document({
        pageContent:
          "NestJS 后端作为统一入口，接收前端请求并调用 AI 服务完成向量检索与大模型生成，不在控制器中堆积业务逻辑。",
        metadata: {
          source: "fixed",
          topic: "nestjs",
          title: "NestJS 后端分层",
        },
      }),
    ];
  }

  private async loadPostDocuments(): Promise<Document[]> {
    try {
      const raw = await readFile(this.postsFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      const posts = Array.isArray(parsed) ? parsed : [];
      return posts.map(
        (item, index) =>
          new Document({
            pageContent: `${item?.title ?? "Untitled"}\n${item?.content ?? ""}`,
            metadata: {
              source: "posts-embedding.json",
              index,
              id: item?.id ?? `post-${index}`,
              title: item?.title ?? `Post ${index + 1}`,
            },
          }),
      );
    } catch (error: unknown) {
      console.error("Failed to load posts-embedding.json:", error);
      return [];
    }
  }

  private async loadUploadedDocuments(): Promise<Document[]> {
    try {
      const raw = await readFile(this.uploadedDocsFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      const storedChunks = Array.isArray(parsed) ? (parsed as UploadedDocChunk[]) : [];
      const cleanedChunks = storedChunks.filter(
        (chunk) =>
          !this.blockedUploadIds.has(String(chunk.uploadId ?? chunk.metadata?.uploadId ?? "")) &&
          !this.isLikelyGarbledText(String(chunk.pageContent ?? "")) &&
          String(chunk.pageContent ?? "").trim().length > 0,
      );
      if (cleanedChunks.length !== storedChunks.length) {
        const removed = storedChunks.length - cleanedChunks.length;
        console.warn(
          `[AiService] Dropped ${removed} garbled/empty uploaded chunks during startup cleanup.`,
        );
        await mkdir(path.dirname(this.uploadedDocsFilePath), { recursive: true });
        await writeFile(this.uploadedDocsFilePath, JSON.stringify(cleanedChunks, null, 2), "utf-8");
      }
      return cleanedChunks.map(
        (chunk) =>
          new Document({
            pageContent: chunk.pageContent ?? "",
            metadata: chunk.metadata ?? {},
          }),
      );
    } catch (error: unknown) {
      return [];
    }
  }

  private isLikelyGarbledText(text: string): boolean {
    if (!text) {
      return true;
    }
    const replacementCharCount = (text.match(/\uFFFD/g) ?? []).length;
    const mojibakeCount = (text.match(/锟斤拷/g) ?? []).length;
    const suspiciousCharCount = (text.match(/[�]/g) ?? []).length;
    const sampleLength = Math.max(1, text.length);
    const noisyRatio = (replacementCharCount + suspiciousCharCount) / sampleLength;
    return mojibakeCount >= 3 || noisyRatio > 0.02;
  }

  private async saveUploadedDocuments(): Promise<void> {
    const payload: UploadedDocChunk[] = this.uploadedDocuments.map((doc) => ({
      uploadId: String(doc.metadata?.uploadId ?? ""),
      pageContent: String(doc.pageContent ?? ""),
      metadata: (doc.metadata as Record<string, unknown>) ?? {},
    }));
    await mkdir(path.dirname(this.uploadedDocsFilePath), { recursive: true });
    await writeFile(this.uploadedDocsFilePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  private async loadDeletedUploadIds(): Promise<Set<string>> {
    try {
      const raw = await readFile(this.deletedUploadIdsFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      const ids = Array.isArray(parsed) ? parsed : [];
      return new Set(ids.map((id) => String(id)));
    } catch {
      return new Set<string>();
    }
  }

  private async saveDeletedUploadIds(): Promise<void> {
    await mkdir(path.dirname(this.deletedUploadIdsFilePath), { recursive: true });
    await writeFile(
      this.deletedUploadIdsFilePath,
      JSON.stringify(Array.from(this.deletedUploadIds), null, 2),
      "utf-8",
    );
  }

  private async rebuildVectorStore(): Promise<void> {
    await this.rebuildOrLoadVectorStore();
  }

  private getAllDocuments(): Document[] {
    return [
      ...this.getFixedDocuments(),
      ...this.postDocuments,
      ...this.uploadedDocuments.filter((doc) => !this.isDeletedUploadDoc(doc)),
    ];
  }

  private isDeletedUploadDoc(doc: Document): boolean {
    const uploadId = String(doc.metadata?.uploadId ?? "");
    return uploadId.length > 0 && this.deletedUploadIds.has(uploadId);
  }

  private async getReadyVectorStore(): Promise<MemoryVectorStore> {
    await this.vectorStoreBootPromise;
    if (!this.vectorStore) {
      try {
        await this.rebuildOrLoadVectorStore();
      } catch (error: unknown) {
        console.error("[AiService] Lazy vector store rebuild failed:", error);
      }
    }
    if (!this.vectorStore) {
      throw new Error("Vector store is not initialized yet. Please retry shortly.");
    }
    return this.vectorStore;
  }

  async rag(question: string): Promise<string> {
    const result = await this.ragSmart(question);
    return result.answer;
  }

  async ragSmart(question: string): Promise<RagSmartResult> {
    const vectorStore = await this.getReadyVectorStore();
    const correctionHint = await this.feedbackService.findCorrection(question);
    const routeAnswer = this.tryAnswerByUploadMeta(question);
    if (routeAnswer) {
      return routeAnswer;
    }
    const normalizedQuestion = this.normalizeCjkText(question.trim().toLowerCase());
    const isChineseNameQuery = this.isLikelyChineseNameQuery(
      normalizedQuestion.replace(/[^\u4e00-\u9fff]/g, ""),
    );
    const ragTopKForQuery = isChineseNameQuery
      ? Math.max(this.smartTopK, 8)
      : this.smartTopK;
    const lexicalDocs = this.pickLexicalRagDocs(question, ragTopKForQuery);
    const queryEmbedding = await this.embeddings.embedQuery(question);
    const vectorDocsWithScore = await vectorStore.similaritySearchVectorWithScore(
      queryEmbedding,
      ragTopKForQuery,
    );
    const feedbackStats = await this.feedbackService.getDocumentFeedbackStats();
    const rerankedVectorDocs = vectorDocsWithScore
      .filter(([doc]) => !this.isDeletedUploadDoc(doc))
      .map(([doc, score]) => {
        const { likeCount, dislikeCount } = this.getFeedbackWeightForDoc(feedbackStats, doc);
        const adjustedScore = score + likeCount * 0.02 - dislikeCount * 0.05;
        return { doc, score, adjustedScore };
      })
      .sort((a, b) => b.adjustedScore - a.adjustedScore);
    const vectorDocs = rerankedVectorDocs.map((item) => item.doc);
    const highestAdjustedScore =
      rerankedVectorDocs.length > 0 ? rerankedVectorDocs[0].adjustedScore : 0;
    const lowRelevanceWarning = highestAdjustedScore < 0.3;

    const contextDocs: Document[] = [];
    const seen = new Set<string>();
    const pushDoc = (doc: Document): void => {
      const key = `${String(doc.metadata?.uploadId ?? "")}|${String(doc.metadata?.chunkIndex ?? "")}|${doc.pageContent.slice(0, 48)}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      contextDocs.push(doc);
    };
    lexicalDocs.forEach(pushDoc);
    vectorDocs.forEach(pushDoc);
    const cappedCandidates = contextDocs.slice(0, ragTopKForQuery);
    const finalContextDocs = this.truncateContextDocsByChars(
      cappedCandidates,
      this.maxContextChars,
    );
    if (finalContextDocs.length < cappedCandidates.length) {
      console.warn(
        `[AiService] ragSmart context truncated: ${finalContextDocs.length}/${cappedCandidates.length} docs, maxChars=${this.maxContextChars}`,
      );
    }

    const context = finalContextDocs
      .map((doc) => doc.pageContent)
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n\n");
    const contextSummary = context.slice(0, 500);
    const correctionDecision = correctionHint
      ? await this.evaluateCorrectionRelevance(question, contextSummary, correctionHint)
      : { relevant: false, reason: "no_correction" };
    if (correctionHint) {
      console.log(
        `[RAG] Correction relevance check: relevant = ${correctionDecision.relevant}, reason = "${correctionDecision.reason}"`,
      );
    }
    const acceptedCorrection = correctionHint && correctionDecision.relevant ? correctionHint : null;
    const adjustedScoreByDocKey = new Map<string, number>();
    rerankedVectorDocs.forEach((item) => {
      const key = this.getSnippetKey(String(item.doc.pageContent ?? ""));
      if (!key) {
        return;
      }
      const current = adjustedScoreByDocKey.get(key);
      if (current === undefined || item.adjustedScore > current) {
        adjustedScoreByDocKey.set(key, item.adjustedScore);
      }
    });
    const sourceSeen = new Set<string>();
    const sources: RagSource[] = [];
    finalContextDocs.forEach((doc) => {
      const key = this.getSnippetKey(String(doc.pageContent ?? ""));
      if (!key || sourceSeen.has(key)) {
        return;
      }
      sourceSeen.add(key);
      sources.push({
        title: String(doc.metadata?.title ?? doc.metadata?.source ?? "unknown"),
        score: Number(adjustedScoreByDocKey.get(key) ?? 0),
      });
    });
    const mode = this.classifyQuestionType(question);
    const evidence = finalContextDocs.slice(0, this.maxEvidenceItems).map((doc) => ({
      title: String(doc.metadata?.title ?? doc.metadata?.source ?? "unknown"),
      snippet: String(doc.pageContent ?? "").slice(0, 220),
      chunkIndex:
        typeof doc.metadata?.chunkIndex === "number" ? Number(doc.metadata.chunkIndex) : undefined,
    }));
    const evidenceWithCorrection = acceptedCorrection
      ? [
          {
            title: "user-correction",
            snippet: acceptedCorrection.slice(0, 220),
          },
          ...evidence,
        ].slice(0, this.maxEvidenceItems)
      : evidence;

    const prompt = acceptedCorrection
      ? this.buildPromptByCorrection(acceptedCorrection, question, context, lowRelevanceWarning)
      : this.buildPromptByMode(mode, question, context, lowRelevanceWarning);

    const response = await this.llm.invoke([
      {
        role: "user",
        content: prompt,
      },
    ]);
    const rawAnswer = String(response.content).trim();
    const groundingContext = acceptedCorrection ? `${acceptedCorrection}\n\n${context}` : context;
    const validatedAnswer = this.enforceEvidenceGrounding(
      rawAnswer,
      evidenceWithCorrection,
      groundingContext,
    );

    return {
      answer: validatedAnswer,
      correctionUsed: Boolean(acceptedCorrection),
      sources,
      evidence: evidenceWithCorrection,
      meta: {
        mode,
        contextCount: finalContextDocs.length,
      },
    };
  }

  private async evaluateCorrectionRelevance(
    question: string,
    contextSummary: string,
    correction: string,
  ): Promise<{ relevant: boolean; reason: string }> {
    const request = this.llm.invoke([
      {
        role: "system",
        content:
          '你是一个严格的文本相关性评估器。根据用户问题和提供的知识库上下文，判断一条历史纠错建议是否与当前问答相关且有用。请仅返回 JSON：{"relevant": true/false, "reason": "简短说明"}。',
      },
      {
        role: "user",
        content: `用户问题：${question}\n知识库上下文摘要：${contextSummary}\n历史纠错建议：${correction}`,
      },
    ]);
    try {
      const response = (await Promise.race([
        request,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("timeout")), 5000);
        }),
      ])) as AIMessage | { content?: unknown };
      const raw = String(response?.content ?? "").trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const payloadText = jsonMatch ? jsonMatch[0] : raw;
      const parsed = JSON.parse(payloadText) as {
        relevant?: unknown;
        reason?: unknown;
      };
      return {
        relevant: parsed.relevant === true,
        reason: String(parsed.reason ?? "no_reason"),
      };
    } catch {
      return {
        relevant: false,
        reason: "evaluation_failed_or_timeout",
      };
    }
  }

  async search(keyword: string): Promise<string[]> {
    const vectorStore = await this.getReadyVectorStore();
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (normalizedKeyword.length === 0) {
      return [];
    }
    const normalizedKeywordForMatch = this.normalizeCjkText(normalizedKeyword);

    // 1) Lexical match over ALL documents first, so exact keywords won't be missed by TopK pruning.
    const allDocuments = this.getAllDocuments();
    const lexicalTitles = Array.from(
      new Set(
        allDocuments
          .filter((doc) => {
            const title = this.normalizeCjkText(String(doc.metadata?.title ?? "").toLowerCase());
            const content = this.normalizeCjkText(String(doc.pageContent ?? "").toLowerCase());
            return (
              title.includes(normalizedKeywordForMatch) || content.includes(normalizedKeywordForMatch)
            );
          })
          .map((doc) => doc.metadata?.title)
          .filter((title): title is string => Boolean(title)),
      ),
    );
    if (lexicalTitles.length > 0) {
      return lexicalTitles;
    }

    // 2) Fallback to vector retrieval.
    const keywordEmbedding = await this.embeddings.embedQuery(keyword);
    const isChineseNameQuery = this.isLikelyChineseNameQuery(normalizedKeyword);
    const searchTopKForQuery = isChineseNameQuery ? Math.max(this.searchTopK, 8) : this.searchTopK;
    const scoreThresholdForQuery = isChineseNameQuery
      ? Math.min(this.searchScoreThreshold, 0.32)
      : this.searchScoreThreshold;
    const similarDocs = await vectorStore.similaritySearchVectorWithScore(
      keywordEmbedding,
      searchTopKForQuery,
    );

    const filteredDocs = similarDocs.filter(
      ([doc, score]) =>
        !this.isDeletedUploadDoc(doc) &&
        Number.isFinite(score) &&
        score >= scoreThresholdForQuery,
    );

    const docsForResponse =
      filteredDocs.length > 0
        ? filteredDocs
        : this.shouldUseTop1Fallback(normalizedKeyword, isChineseNameQuery)
          ? similarDocs.filter(([doc]) => !this.isDeletedUploadDoc(doc)).slice(0, 1)
          : [];

    const uniqueTitles = Array.from(
      new Set(
        docsForResponse
          .map(([doc]) => doc.metadata?.title)
          .filter((title): title is string => Boolean(title)),
      ),
    );

    return uniqueTitles;
  }

  private shouldUseTop1Fallback(keyword: string, isChineseNameQuery = false): boolean {
    // Keep "rag" style short ASCII keywords searchable, avoid noisy fallback for Chinese phrases.
    return /^[a-z0-9_-]{1,16}$/.test(keyword) || isChineseNameQuery;
  }

  private pickLexicalRagDocs(question: string, limit = this.ragTopK): Document[] {
    const normalizedQuestion = question.trim().toLowerCase();
    if (!normalizedQuestion) {
      return [];
    }
    const stopTerms = new Set([
      "为什么",
      "什么",
      "怎么",
      "如何",
      "需要",
      "会",
      "吗",
      "请问",
      "请",
      "是",
      "的",
      "了",
    ]);
    const isCjkToken = (token: string): boolean => /[\u4e00-\u9fff]/.test(token);
    const tokens = Array.from(
      new Set(
        normalizedQuestion
          .split(/[\s,，。！？!?\-_/、:：;；"'()（）]+/g)
          .map((token) => token.trim())
          .filter((token) => {
            if (!token || stopTerms.has(token)) {
              return false;
            }
            if (isCjkToken(token)) {
              return token.length >= 3;
            }
            return token.length >= 2;
          }),
      ),
    );
    const cjkOnly = normalizedQuestion.replace(/[^\u4e00-\u9fff]/g, "");
    const cjkNgrams: string[] = [];
    for (let n = 2; n <= 4; n += 1) {
      for (let i = 0; i + n <= cjkOnly.length; i += 1) {
        const gram = cjkOnly.slice(i, i + n);
        if (!stopTerms.has(gram)) {
          cjkNgrams.push(gram);
        }
      }
    }
    const lexicalTerms = Array.from(new Set([...tokens, ...cjkNgrams])).filter(
      (term) => term.length >= 2,
    );
    if (lexicalTerms.length === 0) {
      return [];
    }
    const normalizedTerms = lexicalTerms.map((term) => this.normalizeCjkText(term));
    const scored = this.getAllDocuments()
      .map((doc) => {
        const title = this.normalizeCjkText(String(doc.metadata?.title ?? "").toLowerCase());
        const content = this.normalizeCjkText(String(doc.pageContent ?? "").toLowerCase());
        let score = 0;
        normalizedTerms.forEach((term) => {
          if (title.includes(term)) {
            score += 3;
          }
          if (content.includes(term)) {
            score += 1;
          }
        });
        return { doc, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((item) => item.doc);
  }

  private normalizeCjkText(text: string): string {
    if (!text) {
      return "";
    }
    return Array.from(text)
      .map((char) => this.cjkVariantMap.get(char) ?? char)
      .join("");
  }

  private isLikelyChineseNameQuery(keyword: string): boolean {
    // Typical name-like input: 2-8 contiguous CJK chars, no spaces.
    return /^[\u4e00-\u9fff]{2,8}$/.test(keyword);
  }

  private getSnippetKey(text: string): string {
    return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  }

  private getFeedbackWeightForDoc(
    stats: Map<string, { likes: number; dislikes: number }>,
    doc: Document,
  ): { likeCount: number; dislikeCount: number } {
    if (stats.size === 0) {
      return { likeCount: 0, dislikeCount: 0 };
    }
    const docKey = this.getSnippetKey(String(doc.pageContent ?? ""));
    if (!docKey) {
      return { likeCount: 0, dislikeCount: 0 };
    }
    const exact = stats.get(docKey);
    if (exact) {
      return { likeCount: exact.likes, dislikeCount: exact.dislikes };
    }
    for (const [key, value] of stats.entries()) {
      if (docKey.includes(key) || key.includes(docKey)) {
        return { likeCount: value.likes, dislikeCount: value.dislikes };
      }
    }
    return { likeCount: 0, dislikeCount: 0 };
  }

  private classifyQuestionType(question: string): RagSmartMode {
    const q = question.trim().toLowerCase();
    if (/总结|概括|经历|主线/.test(q)) {
      return "summary";
    }
    if (/分析|特点|风格|评价|为什么|如何看待/.test(q)) {
      return "analysis";
    }
    return "fact";
  }

  private tryAnswerByUploadMeta(question: string): RagSmartResult | null {
    const q = this.normalizeCjkText(question.trim().toLowerCase());
    if (!q) {
      return null;
    }
    const target = this.pickTargetMeta(question);
    if (!target) {
      return null;
    }
    if (/总共.*章|多少章|章节数|总章节|总章数/.test(q)) {
      const answer = `${target.title} 共约 ${target.chapterCount} 章（按上传文档章节标题解析）。`;
      return {
        answer,
        correctionUsed: false,
        sources: [],
        evidence: [
          {
            title: target.title,
            snippet: `chapterCount=${target.chapterCount}; chapterTitles(sample)=${target.chapterTitles.slice(0, 3).join(" / ")}`,
          },
        ],
        meta: { mode: "fact", contextCount: 0 },
      };
    }
    if (/字数|总字数|多少字/.test(q)) {
      const answer = `${target.title} 当前入库文本约 ${target.charCount} 字。`;
      return {
        answer,
        correctionUsed: false,
        sources: [],
        evidence: [
          {
            title: target.title,
            snippet: `charCount=${target.charCount}; chunkCount=${target.chunkCount}`,
          },
        ],
        meta: { mode: "fact", contextCount: 0 },
      };
    }
    if (/总结全文|全文总结|概括全文|主要讲了什么|故事经历/.test(q)) {
      const answer = target.globalSummary || "无法从提供的资料中得到答案。";
      return {
        answer,
        correctionUsed: false,
        sources: [],
        evidence: [
          {
            title: target.title,
            snippet: target.chapterTitles.slice(0, 5).join(" / "),
          },
        ],
        meta: { mode: "summary", contextCount: 0 },
      };
    }
    return null;
  }

  private buildPromptByMode(
    mode: RagSmartMode,
    question: string,
    context: string,
    lowRelevanceWarning = false,
  ): string {
    const warning = lowRelevanceWarning
      ? "\n注意：知识库中未找到高度相关的文档，请谨慎回答。\n"
      : "";
    if (mode === "summary") {
      return `
你是一个“文档总结助手”。必须严格基于给定上下文回答，不得编造。
输出要求：
1) 先给出 3-5 句总结，覆盖关键信息主线；
2) 再列出 2 条“依据片段”（直接引用上下文短句或近似原文）。
如果上下文不足，请明确回复“无法从提供的资料中得到答案”。

【上下文】
${context}

【问题】
${question}
${warning}
`;
    }
    if (mode === "analysis") {
      return `
你是一个“文本分析助手”。必须严格基于给定上下文回答，不得编造。
输出要求：
1) 先给出分析结论（2-4 点）；
2) 每一点后附一条“依据片段”。
如果上下文不足，请明确回复“无法从提供的资料中得到答案”。

【上下文】
${context}

【问题】
${question}
${warning}
`;
    }
    return `
你是一个“事实问答助手”。必须严格基于给定上下文回答，不得编造。
输出要求：
1) 先给出明确答案；
2) 再给出 1-3 条“依据片段”。
如果上下文不足，请明确回复“无法从提供的资料中得到答案”。

【上下文】
${context}

【问题】
${question}
${warning}
`;
  }

  private buildPromptByCorrection(
    correction: string,
    question: string,
    context: string,
    lowRelevanceWarning = false,
  ): string {
    const warning = lowRelevanceWarning
      ? "\n注意：知识库中未找到高度相关的文档，请谨慎回答。\n"
      : "";
    return `
你是一个智能助手。用户曾对类似问题给出过不满意反馈。
【用户认可的参考答案】：${correction}
【知识库上下文】：${context}
请结合以上信息回答用户问题。优先参考“用户认可的参考答案”，如果知识库上下文与参考答案冲突，以参考答案为准。
用户问题：${question}
${warning}
`;
  }

  private truncateContextDocsByChars(docs: Document[], maxChars: number): Document[] {
    const selected: Document[] = [];
    let used = 0;
    for (const doc of docs) {
      const text = String(doc.pageContent ?? "");
      if (!text.trim()) {
        continue;
      }
      if (used + text.length > maxChars) {
        break;
      }
      selected.push(doc);
      used += text.length;
    }
    return selected;
  }

  private enforceEvidenceGrounding(
    answer: string,
    evidence: RagEvidence[],
    context: string,
  ): string {
    if (!answer) {
      return "无法从提供的资料中得到答案。";
    }
    if (/无法从提供的资料中得到答案|没有足够信息|无法回答/.test(answer)) {
      return answer;
    }
    const answerNormalized = this.normalizeCjkText(answer.toLowerCase());
    const evidenceText = evidence.map((item) => item.snippet).join("\n");
    const contextNormalized = this.normalizeCjkText(context.toLowerCase());
    const evidenceNormalized = this.normalizeCjkText(evidenceText.toLowerCase());
    const tokens = Array.from(
      new Set(
        answerNormalized
          .split(/[\s,，。！？!?\-_/、:：;；"'()（）\n]+/g)
          .map((token) => token.trim())
          .filter((token) => token.length >= 2 && !/^[0-9a-z]+$/.test(token)),
      ),
    );
    const hitCount = tokens.filter(
      (token) => evidenceNormalized.includes(token) || contextNormalized.includes(token),
    ).length;
    const requiredHits = Math.min(2, Math.max(1, Math.floor(tokens.length * 0.2)));
    if (tokens.length > 0 && hitCount < requiredHits) {
      return "无法从提供的资料中得到答案。当前候选证据与问题相关性不足，请尝试更具体的问题。";
    }
    return answer;
  }

  private pickTargetMeta(question: string): UploadDocMeta | null {
    const q = this.normalizeCjkText(question.trim().toLowerCase());
    const docs = Array.from(this.uploadedMetaById.values()).filter(
      (item) => !this.deletedUploadIds.has(item.uploadId),
    );
    if (docs.length === 0) {
      return null;
    }
    const scored = docs.map((item) => {
      const title = this.normalizeCjkText(item.title.toLowerCase());
      const source = this.normalizeCjkText(item.source.toLowerCase());
      let score = 0;
      if (title && q.includes(title)) {
        score += 6;
      }
      if (source && q.includes(source)) {
        score += 4;
      }
      item.chapterTitles.forEach((chapter) => {
        const c = this.normalizeCjkText(chapter.toLowerCase());
        if (c && q.includes(c)) {
          score += 2;
        }
      });
      return { item, score };
    });
    scored.sort((a, b) => b.score - a.score);
    if (scored[0]?.score && scored[0].score > 0) {
      return scored[0].item;
    }
    return docs.length === 1 ? docs[0] : null;
  }

  private buildExtractiveFallbackAnswer(question: string, context: string): string {
    const normalizedQuestion = question.trim().toLowerCase();
    const tokens = Array.from(
      new Set(
        normalizedQuestion
          .split(/[\s,，。！？!?\-_/、:：;；"'()（）]+/g)
          .map((token) => token.trim())
          .filter((token) => token.length >= 2),
      ),
    );
    const lines = context
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const matchedLines = lines.filter((line) => {
      const lower = line.toLowerCase();
      return tokens.some((token) => lower.includes(token));
    });
    const selected = matchedLines.length > 0 ? matchedLines.slice(0, 3) : lines.slice(0, 3);
    return selected.join(" ");
  }

  async addDocuments(documents: Document[]): Promise<void> {
    await this.getReadyVectorStore();
    const sanitizedDocuments = documents.map((doc, index) => {
      const uploadId =
        typeof doc.metadata?.uploadId === "string" && doc.metadata.uploadId.trim().length > 0
          ? doc.metadata.uploadId
          : `upload-${Date.now()}-${index}`;
      return new Document({
        pageContent: String(doc.pageContent ?? ""),
        metadata: {
          ...doc.metadata,
          uploadId,
        },
      });
    });
    this.uploadedDocuments.push(...sanitizedDocuments);
    sanitizedDocuments.forEach((doc) => {
      const uploadId = String(doc.metadata?.uploadId ?? "");
      if (uploadId) {
        this.deletedUploadIds.delete(uploadId);
      }
    });
    await this.saveUploadedDocuments();
    this.rebuildUploadedMetaFromDocuments();
    await this.saveUploadedMeta();
    await this.saveDeletedUploadIds();
    if (this.vectorStore) {
      // Incremental append avoids expensive full rebuild on every upload part.
      await this.vectorStore.addDocuments(sanitizedDocuments);
      console.log(
        `[AiService] Incrementally appended ${sanitizedDocuments.length} documents. Total uploaded chunks: ${this.uploadedDocuments.length}.`,
      );
      await this.schedulePersistVectorIndex();
      return;
    }
    await this.rebuildVectorStore();
  }

  listUploadedDocuments(): Array<{
    uploadId: string;
    title: string;
    source: string;
    uploadedAt: string;
    chunkCount: number;
  }> {
    const grouped = new Map<
      string,
      { title: string; source: string; uploadedAt: string; chunkCount: number }
    >();
    for (const doc of this.uploadedDocuments) {
      const uploadId = String(doc.metadata?.uploadId ?? "");
      if (!uploadId || this.deletedUploadIds.has(uploadId)) {
        continue;
      }
      const current = grouped.get(uploadId);
      if (!current) {
        grouped.set(uploadId, {
          title: String(doc.metadata?.title ?? uploadId),
          source: String(doc.metadata?.source ?? ""),
          uploadedAt: String(doc.metadata?.uploadedAt ?? ""),
          chunkCount: 1,
        });
      } else {
        current.chunkCount += 1;
      }
    }
    return Array.from(grouped.entries()).map(([uploadId, value]) => ({
      uploadId,
      ...value,
    }));
  }

  async removeUploadedDocument(uploadId: string): Promise<number> {
    const targetCount = this.uploadedDocuments.filter(
      (doc) => String(doc.metadata?.uploadId ?? "") === uploadId,
    ).length;
    if (targetCount === 0) {
      return 0;
    }
    this.deletedUploadIds.add(uploadId);
    await this.saveDeletedUploadIds();
    return targetCount;
  }

  private async loadUploadedMeta(): Promise<Map<string, UploadDocMeta>> {
    try {
      const raw = await readFile(this.uploadedMetaFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [];
      const map = new Map<string, UploadDocMeta>();
      list.forEach((item) => {
        if (!item?.uploadId) {
          return;
        }
        map.set(String(item.uploadId), {
          uploadId: String(item.uploadId),
          title: String(item.title ?? item.uploadId),
          source: String(item.source ?? ""),
          uploadedAt: String(item.uploadedAt ?? ""),
          chunkCount: Number(item.chunkCount ?? 0),
          charCount: Number(item.charCount ?? 0),
          chapterCount: Number(item.chapterCount ?? 0),
          chapterTitles: Array.isArray(item.chapterTitles)
            ? item.chapterTitles.map((v: unknown) => String(v))
            : [],
          globalSummary: String(item.globalSummary ?? ""),
        });
      });
      return map;
    } catch {
      return new Map<string, UploadDocMeta>();
    }
  }

  private async saveUploadedMeta(): Promise<void> {
    const payload = Array.from(this.uploadedMetaById.values());
    await mkdir(path.dirname(this.uploadedMetaFilePath), { recursive: true });
    await writeFile(this.uploadedMetaFilePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  private rebuildUploadedMetaFromDocuments(): void {
    const grouped = new Map<string, Document[]>();
    for (const doc of this.uploadedDocuments) {
      const uploadId = String(doc.metadata?.uploadId ?? "");
      if (!uploadId) {
        continue;
      }
      const bucket = grouped.get(uploadId) ?? [];
      bucket.push(doc);
      grouped.set(uploadId, bucket);
    }
    const rebuilt = new Map<string, UploadDocMeta>();
    grouped.forEach((docs, uploadId) => {
      const first = docs[0];
      const chapterTitles = Array.from(
        new Set(
          docs
            .map((doc) => String(doc.metadata?.chapterTitle ?? "").trim())
            .filter((title) => title.length > 0 && title !== "未命名章节"),
        ),
      );
      const charCount = docs.reduce((sum, doc) => sum + String(doc.pageContent ?? "").length, 0);
      const title = String(first.metadata?.title ?? uploadId);
      const source = String(first.metadata?.source ?? "");
      const uploadedAt = String(first.metadata?.uploadedAt ?? "");
      rebuilt.set(uploadId, {
        uploadId,
        title,
        source,
        uploadedAt,
        chunkCount: docs.length,
        charCount,
        chapterCount: chapterTitles.length,
        chapterTitles,
        globalSummary: this.buildGlobalSummary(title, chapterTitles, docs),
      });
    });
    this.uploadedMetaById = rebuilt;
  }

  private buildGlobalSummary(title: string, chapterTitles: string[], docs: Document[]): string {
    const chapterLead = chapterTitles.length > 0 ? chapterTitles.slice(0, 8).join("；") : "无明确章节";
    const snippets = docs
      .slice(0, 6)
      .map((doc) => String(doc.pageContent ?? "").replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0)
      .map((line) => line.slice(0, 80));
    const body = snippets.slice(0, 3).join("；");
    return `${title} 的章节结构包括：${chapterLead}。内容主线可概括为：${body || "暂无可用摘要片段"}。`;
  }

  private async processToolCalls(
    toolCalls: any[],
    callerRole?: string,
  ): Promise<ToolMessage[]> {
    const results: ToolMessage[] = [];
    for (const raw of toolCalls) {
      const tc = raw as {
        id?: string;
        name?: string;
        args?: Record<string, unknown> | string;
      };
      const name = String(tc.name ?? "").trim();
      const id =
        typeof tc.id === "string" && tc.id.length > 0
          ? tc.id
          : `call_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
      if (!name) {
        results.push(
          new ToolMessage({
            content: JSON.stringify({ error: "empty_tool_name" }),
            tool_call_id: id,
            name: "unknown",
            status: "error",
          }),
        );
        continue;
      }
      let args: unknown = tc.args;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args) as unknown;
        } catch {
          args = {};
        }
      }
      try {
        const content = await this.toolsService.executeTool(name, args, {
          callerRole,
        });
        results.push(
          new ToolMessage({
            content,
            tool_call_id: id,
            name,
          }),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "tool_failed";
        results.push(
          new ToolMessage({
            content: JSON.stringify({ error: message, tool: name }),
            tool_call_id: id,
            name,
            status: "error",
          }),
        );
      }
    }
    return results;
  }

  private getLatestUserMessageText(messages: BaseMessageLike[]): string {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i] as { role?: unknown; content?: unknown };
      if (String(msg.role ?? "").trim() !== "user") {
        continue;
      }
      return String(msg.content ?? "").trim();
    }
    return "";
  }

  private hasTicketIntent(text: string): boolean {
    if (!text) {
      return false;
    }
    return /创建.*工单|工单|发飞书|发送.*飞书|飞书群|通知运维组|值班提醒|ticket/i.test(text);
  }

  private isTicketToolName(name: string): boolean {
    return name === "create_ticket" || name === "send_notification";
  }

  private detectPriorityFromText(text: string): "普通" | "紧急" | "严重" {
    const normalized = text.toLowerCase();
    if (/p0|sev0|严重|critical/.test(normalized)) {
      return "严重";
    }
    if (/p1|紧急|urgent/.test(normalized)) {
      return "紧急";
    }
    return "普通";
  }

  private detectPriorityLabel(text: string): string {
    const mapped = this.detectPriorityFromText(text);
    if (mapped === "紧急") {
      return "P1（紧急）";
    }
    if (mapped === "严重") {
      return "P0（严重）";
    }
    return "普通";
  }

  private buildForcedTicketArgs(latestUserText: string): {
    title: string;
    description: string;
    priority: "普通" | "紧急" | "严重";
  } {
    const compact = latestUserText.replace(/\s+/g, " ").trim();
    const titleSource =
      compact.match(/创建(?:一张|一个)?工单[:：]?\s*(.+)/)?.[1]?.trim() ??
      compact.match(/通知(?:运维组)?[:：]?\s*(.+)/)?.[1]?.trim() ??
      compact;
    const title = titleSource.length > 0 ? titleSource.slice(0, 80) : "自动创建工单";
    return {
      title,
      description: `由聊天意图守卫自动触发的工单。\n原始需求：${compact || "（空）"}`,
      priority: this.detectPriorityFromText(compact),
    };
  }

  private buildTicketArgsFromAssistantOutput(
    assistantOutput: string,
    latestUserText: string,
  ): { title: string; description: string; priority: "普通" | "紧急" | "严重" } {
    const text = assistantOutput.replace(/\r\n/g, "\n").trim();
    const subjectFromTable =
      text.match(/\|\s*\*\*工单主题\*\*\s*\|\s*(.+?)\s*\|/)?.[1]?.trim() ??
      text.match(/\|\s*\*\*工单标题\*\*\s*\|\s*(.+?)\s*\|/)?.[1]?.trim();
    const subjectFromHeading =
      text.match(/(?:工单主题|工单标题)[:：]\s*(.+)/)?.[1]?.trim() ??
      text.match(/##\s*📋\s*(.+)/)?.[1]?.trim();
    const fallbackTitleSource =
      subjectFromTable ||
      subjectFromHeading ||
      latestUserText.match(/创建(?:一张|一个)?工单[:：]?\s*(.+)/)?.[1]?.trim() ||
      latestUserText.trim();
    const title = (fallbackTitleSource || "自动创建工单").slice(0, 80);
    const priority = this.detectPriorityFromText(`${latestUserText}\n${text}`);
    const priorityLabel = this.detectPriorityLabel(`${latestUserText}\n${text}`);
    const descriptionBody = this.normalizeTicketDescriptionBody(text, latestUserText);
    return {
      title,
      description: `${descriptionBody}\n\n优先级：${priorityLabel}\n提交人：AI 助手`,
      priority,
    };
  }

  private normalizeTicketDescriptionBody(assistantOutput: string, latestUserText: string): string {
    const base = assistantOutput.replace(/\r\n/g, "\n");
    const sectionMatch = base.match(/###\s*📝\s*工单内容([\s\S]*)/);
    const sectionCandidate = sectionMatch ? sectionMatch[1] : base;
    const beforeFollowUp = sectionCandidate.split(/需要我做以下调整吗[？?]?/)[0] ?? sectionCandidate;
    const noToolStatus = beforeFollowUp
      .replace(/^🔧.*$/gm, "")
      .replace(/^✅.*$/gm, "")
      .replace(/^同步标记.*$/gm, "")
      .replace(/^优先级判定.*$/gm, "");
    const noTable = noToolStatus
      .split("\n")
      .filter((line) => !line.trim().startsWith("|"))
      .join("\n");
    const plain = noTable
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/^---+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (plain.length > 0) {
      return plain.slice(0, 1200);
    }
    const fallback = latestUserText.replace(/\s+/g, " ").trim();
    return `工单内容：${fallback || "（无）"}`;
  }

  private parseToolJson(content: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private buildTicketToolSummaryPrompt(toolMessages: ToolMessage[]): string | null {
    for (const message of toolMessages) {
      const name = String((message as { name?: unknown }).name ?? "").trim();
      if (!this.isTicketToolName(name)) {
        continue;
      }
      const payload = this.parseToolJson(String(message.content ?? ""));
      if (!payload || String(payload.status ?? "").toLowerCase() !== "success") {
        continue;
      }
      return [
        "你已成功通过工具创建工单。请根据工具返回的详细信息生成完整工单摘要回复。",
        "输出应包含：工单编号、标题、优先级、问题描述、执行要求（3-5条）。",
        "若工具返回字段不足，不要编造编号或时间，可基于用户需求补充合理执行要求。",
        "最后请礼貌询问用户是否需要补充负责人、时间节点或通知范围。",
      ].join("\n");
    }
    return null;
  }

  private async forceCreateTicketTool(
    latestUserText: string,
    callerRole?: string,
  ): Promise<{ ok: true; content: string } | { ok: false; message: string }> {
    const forcedArgs = this.buildForcedTicketArgs(latestUserText);
    try {
      const content = await this.toolsService.executeTool("create_ticket", forcedArgs, {
        callerRole,
      });
      const parsed = this.parseToolJson(content);
      const status = String(parsed?.status ?? "").toLowerCase();
      if (status === "error") {
        return {
          ok: false,
          message: `已识别到“创建工单/通知”意图，但自动调用 create_ticket 失败：${String(parsed?.message ?? "unknown_error")}`,
        };
      }
      return { ok: true, content };
    } catch (error: unknown) {
      return {
        ok: false,
        message: `已识别到“创建工单/通知”意图，但自动调用 create_ticket 失败：${error instanceof Error ? error.message : "tool_failed"}`,
      };
    }
  }

  private async syncTicketByAssistantOutput(
    latestUserText: string,
    assistantOutput: string,
    callerRole?: string,
  ): Promise<{ ok: true; content: string } | { ok: false; message: string }> {
    const args = this.buildTicketArgsFromAssistantOutput(assistantOutput, latestUserText);
    try {
      const content = await this.toolsService.executeTool("create_ticket", args, {
        callerRole,
      });
      const parsed = this.parseToolJson(content);
      const status = String(parsed?.status ?? "").toLowerCase();
      if (status === "error") {
        return {
          ok: false,
          message: `已识别到“创建工单/通知”意图，但基于最终回复同步发送 create_ticket 失败：${String(parsed?.message ?? "unknown_error")}`,
        };
      }
      return { ok: true, content };
    } catch (error: unknown) {
      return {
        ok: false,
        message: `已识别到“创建工单/通知”意图，但基于最终回复同步发送 create_ticket 失败：${error instanceof Error ? error.message : "tool_failed"}`,
      };
    }
  }

  private estimateTokens(messages: BaseMessageLike[]): number {
    let total = 0;
    for (const message of messages) {
      const role = String((message as { role?: unknown })?.role ?? "");
      const content = String((message as { content?: unknown })?.content ?? "");
      let cjkChars = 0;
      let otherChars = 0;
      for (const ch of content) {
        if (/[\u3400-\u9fff]/.test(ch)) {
          cjkChars += 1;
        } else {
          otherChars += 1;
        }
      }
      total += cjkChars + Math.ceil(otherChars / 4) + Math.ceil(role.length / 4) + 2;
    }
    return total;
  }

  private async compressMessagesForContext(messages: BaseMessageLike[]): Promise<BaseMessageLike[]> {
    const totalTokens = this.estimateTokens(messages);
    if (totalTokens <= this.maxContextTokens || messages.length <= this.recentMessagesToKeep) {
      return messages;
    }

    const splitIndex = Math.max(0, messages.length - this.recentMessagesToKeep);
    const earlyMessages = messages.slice(0, splitIndex);
    const recentMessages = messages.slice(splitIndex);
    const earlySummaryInput = this.conversationService.summarizeMessages(
      earlyMessages as Array<{ role?: unknown; content?: unknown }>,
    );
    if (!earlySummaryInput) {
      return recentMessages;
    }

    const summaryResponse = await this.llm.invoke([
      {
        role: "system",
        content:
          "你是对话摘要助手。请将历史对话压缩成短摘要，保留用户目标、关键事实、已确定结论、未解决问题。不要杜撰。",
      },
      {
        role: "user",
        content: `请用不超过220字总结以下历史对话：\n${earlySummaryInput}`,
      },
    ]);
    const summaryText = String(summaryResponse.content ?? "").trim();
    const summaryMessage: BaseMessageLike = {
      role: "system",
      content:
        summaryText.length > 0
          ? `历史对话摘要：${summaryText}`
          : "历史对话摘要：此前进行了多轮沟通，请结合近期消息继续回答。",
    };
    const compressedMessages: BaseMessageLike[] = [summaryMessage, ...recentMessages];
    const compressedTokens = this.estimateTokens(compressedMessages);
    console.log(
      `[AiService] Context compressed: ${messages.length} -> ${compressedMessages.length} messages, ${totalTokens} -> ${compressedTokens} tokens.`,
    );
    return compressedMessages;
  }

  async chat(
    messages: BaseMessageLike[],
    onChunk: (chunk: string) => void,
    options?: { callerRole?: string },
  ): Promise<void> {
    const contextMessages = await this.compressMessagesForContext(messages);
    const tools = this.toolsService.getDefinitions() as never[];
    const first = await this.llm.invoke(contextMessages, { tools });

    const toolCalls =
      AIMessage.isInstance(first) && Array.isArray(first.tool_calls) && first.tool_calls.length > 0
        ? first.tool_calls
        : null;

    if (toolCalls) {
      const names = toolCalls
        .map((tc) => String(tc.name ?? "").trim())
        .filter((n) => n.length > 0);
      const label = names.length > 0 ? names.join("、") : "unknown";
      onChunk(`🔧 正在调用工具：${label}\n\n`);
      const toolMessages = await this.processToolCalls(toolCalls, options?.callerRole);
      const followUp: BaseMessageLike[] = [...contextMessages, first, ...toolMessages];
      const ticketPrompt = this.buildTicketToolSummaryPrompt(toolMessages);
      if (ticketPrompt) {
        followUp.push({
          role: "system",
          content: ticketPrompt,
        });
      }
      const final = await this.llm.invoke(followUp);
      const text = String(final.content ?? "");
      for (const char of text) {
        onChunk(char);
      }
      return;
    }

    const stream = await this.llm.stream(contextMessages);
    for await (const chunk of stream) {
      const content = chunk.content;
      if (typeof content === "string" && content.length > 0) {
        onChunk(content);
      }
    }
  }

  async chatBySession(
    sessionId: string,
    userId: string,
    content: string,
    onChunk: (chunk: string) => void,
    options?: { callerRole?: string },
  ): Promise<void> {
    const text = content.trim();
    if (!text) {
      throw new BadRequestException("message content is required");
    }

    try {
      await this.conversationService.addMessage(
        sessionId,
        {
          role: "user" satisfies ConversationRole,
          content: text,
          timestamp: new Date().toISOString(),
        },
        userId,
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
        throw new NotFoundException("会话不存在");
      }
      throw error;
    }

    const session = await this.conversationService.findById(sessionId, userId);
    if (!session) {
      throw new NotFoundException("会话不存在");
    }

    const history: BaseMessageLike[] = session.messages.map((item) => ({
      role: item.role,
      content: item.content,
    }));

    let assistantFull = "";
    await this.chat(
      history,
      (chunk) => {
        assistantFull += chunk;
        onChunk(chunk);
      },
      options,
    );

    await this.conversationService.addMessage(
      sessionId,
      {
        role: "assistant" satisfies ConversationRole,
        content: assistantFull.trim(),
        timestamp: new Date().toISOString(),
      },
      userId,
    );
  }

  async checkDeepSeekHealth(): Promise<{ ok: boolean; model: string; sample: string }> {
    const response = await this.llm.invoke([
      {
        role: "user",
        content: "请只回复 OK",
      },
    ]);

    const text = String(response.content ?? "").trim();
    return {
      ok: text.length > 0,
      model: process.env.DEEPSEEK_MODEL ?? "unknown",
      sample: text,
    };
  }
}
