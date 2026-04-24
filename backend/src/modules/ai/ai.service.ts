import { Injectable } from "@nestjs/common";
import { ChatDeepSeek } from "@langchain/deepseek";
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";
import { Document } from "@langchain/core/documents";
import { BaseMessageLike } from "@langchain/core/messages";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

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

type RagSmartResult = {
  answer: string;
  evidence: RagEvidence[];
  meta: {
    mode: RagSmartMode;
    contextCount: number;
  };
};

@Injectable()
export class AiService {
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
  private llm!: ChatDeepSeek;
  private embeddings!: HuggingFaceTransformersEmbeddings;
  private vectorStore!: MemoryVectorStore;
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

  constructor() {
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
      model: path.join(process.cwd(), "models", "bge-small-zh-v1.5"),
    });
    this.llm = llm;
    this.embeddings = embeddings;

    void this.initializeVectorStore().catch((error: unknown) => {
      console.error("Failed to initialize AI vector store:", error);
    });
  }

  private async initializeVectorStore(): Promise<void> {
    this.postDocuments = await this.loadPostDocuments();
    this.uploadedDocuments = await this.loadUploadedDocuments();
    this.deletedUploadIds = await this.loadDeletedUploadIds();
    this.uploadedMetaById = await this.loadUploadedMeta();
    this.rebuildUploadedMetaFromDocuments();
    await this.saveUploadedMeta();
    await this.rebuildVectorStore();
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
    const allDocuments = [
      ...this.getFixedDocuments(),
      ...this.postDocuments,
      ...this.uploadedDocuments,
    ];
    this.vectorStore = await MemoryVectorStore.fromDocuments(allDocuments, this.embeddings);
    console.log(`[AiService] Vector store initialized with ${allDocuments.length} documents.`);
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

  private ensureVectorStoreReady(): void {
    if (!this.vectorStore) {
      throw new Error("Vector store is not initialized yet. Please retry shortly.");
    }
  }

  async rag(question: string): Promise<string> {
    const result = await this.ragSmart(question);
    return result.answer;
  }

  async ragSmart(question: string): Promise<RagSmartResult> {
    this.ensureVectorStoreReady();
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
    const vectorDocs = (
      await this.vectorStore.similaritySearchVectorWithScore(queryEmbedding, ragTopKForQuery)
    )
      .map(([doc]) => doc)
      .filter((doc) => !this.isDeletedUploadDoc(doc));

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
    const mode = this.classifyQuestionType(question);
    const evidence = finalContextDocs.slice(0, this.maxEvidenceItems).map((doc) => ({
      title: String(doc.metadata?.title ?? doc.metadata?.source ?? "unknown"),
      snippet: String(doc.pageContent ?? "").slice(0, 220),
      chunkIndex:
        typeof doc.metadata?.chunkIndex === "number" ? Number(doc.metadata.chunkIndex) : undefined,
    }));

    const prompt = this.buildPromptByMode(mode, question, context);

    const response = await this.llm.invoke([
      {
        role: "user",
        content: prompt,
      },
    ]);
    const rawAnswer = String(response.content).trim();
    const validatedAnswer = this.enforceEvidenceGrounding(rawAnswer, evidence, context);

    return {
      answer: validatedAnswer,
      evidence,
      meta: {
        mode,
        contextCount: finalContextDocs.length,
      },
    };
  }

  async search(keyword: string): Promise<string[]> {
    this.ensureVectorStoreReady();
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
    const similarDocs = await this.vectorStore.similaritySearchVectorWithScore(
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

  private buildPromptByMode(mode: RagSmartMode, question: string, context: string): string {
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

  async chat(
    messages: BaseMessageLike[],
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    const stream = await this.llm.stream(messages);
    for await (const chunk of stream) {
      const content = chunk.content;
      if (typeof content === "string" && content.length > 0) {
        onChunk(content);
      }
    }
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
