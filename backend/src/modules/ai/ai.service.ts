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

@Injectable()
export class AiService {
  private readonly searchTopK = 3;
  private readonly searchScoreThreshold: number;
  private readonly ragTopK = 3;
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
  private llm!: ChatDeepSeek;
  private embeddings!: HuggingFaceTransformersEmbeddings;
  private vectorStore!: MemoryVectorStore;
  private postDocuments: Document[] = [];
  private uploadedDocuments: Document[] = [];

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
      return storedChunks.map(
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

  private async saveUploadedDocuments(): Promise<void> {
    const payload: UploadedDocChunk[] = this.uploadedDocuments.map((doc) => ({
      uploadId: String(doc.metadata?.uploadId ?? ""),
      pageContent: String(doc.pageContent ?? ""),
      metadata: (doc.metadata as Record<string, unknown>) ?? {},
    }));
    await mkdir(path.dirname(this.uploadedDocsFilePath), { recursive: true });
    await writeFile(this.uploadedDocsFilePath, JSON.stringify(payload, null, 2), "utf-8");
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
    return [...this.getFixedDocuments(), ...this.postDocuments, ...this.uploadedDocuments];
  }

  private ensureVectorStoreReady(): void {
    if (!this.vectorStore) {
      throw new Error("Vector store is not initialized yet. Please retry shortly.");
    }
  }

  async rag(question: string): Promise<string> {
    this.ensureVectorStoreReady();
    const lexicalDocs = this.pickLexicalRagDocs(question);
    let contextDocs: Document[] = lexicalDocs;
    if (contextDocs.length === 0) {
      const queryEmbedding = await this.embeddings.embedQuery(question);
      const similarDocs = await this.vectorStore.similaritySearchVectorWithScore(
        queryEmbedding,
        this.ragTopK,
      );
      contextDocs = similarDocs.map(([doc]) => doc);
    }

    const context = contextDocs
      .map((doc) => doc.pageContent)
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n\n");

    if (lexicalDocs.length > 0 && context.trim().length > 0) {
      return this.buildExtractiveFallbackAnswer(question, context);
    }

    const prompt = `
你必须严格基于给定上下文回答问题。
如果上下文中没有足够信息，请明确回复“无法从提供的资料中得到答案”，不要猜测或编造。

【上下文】
${context}

【问题】
${question}
`;

    const response = await this.llm.invoke([
      {
        role: "user",
        content: prompt,
      },
    ]);

    const answer = String(response.content).trim();
    if (
      context.trim().length > 0 &&
      /无法从提供的资料中得到答案|无法回答|没有足够信息/.test(answer)
    ) {
      return this.buildExtractiveFallbackAnswer(question, context);
    }
    return answer;
  }

  async search(keyword: string): Promise<string[]> {
    this.ensureVectorStoreReady();
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (normalizedKeyword.length === 0) {
      return [];
    }

    // 1) Lexical match over ALL documents first, so exact keywords won't be missed by TopK pruning.
    const allDocuments = this.getAllDocuments();
    const lexicalTitles = Array.from(
      new Set(
        allDocuments
          .filter((doc) => {
            const title = String(doc.metadata?.title ?? "").toLowerCase();
            const content = String(doc.pageContent ?? "").toLowerCase();
            return title.includes(normalizedKeyword) || content.includes(normalizedKeyword);
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
    const similarDocs = await this.vectorStore.similaritySearchVectorWithScore(
      keywordEmbedding,
      this.searchTopK,
    );

    const filteredDocs = similarDocs.filter(
      ([, score]) => Number.isFinite(score) && score >= this.searchScoreThreshold,
    );

    const docsForResponse =
      filteredDocs.length > 0
        ? filteredDocs
        : this.shouldUseTop1Fallback(normalizedKeyword)
          ? similarDocs.slice(0, 1)
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

  private shouldUseTop1Fallback(keyword: string): boolean {
    // Keep "rag" style short ASCII keywords searchable, avoid noisy fallback for Chinese phrases.
    return /^[a-z0-9_-]{1,16}$/.test(keyword);
  }

  private pickLexicalRagDocs(question: string): Document[] {
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
    return this.getAllDocuments()
      .filter((doc) => {
        const title = String(doc.metadata?.title ?? "").toLowerCase();
        const content = String(doc.pageContent ?? "").toLowerCase();
        return lexicalTerms.some((term) => title.includes(term) || content.includes(term));
      })
      .slice(0, this.ragTopK);
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
    await this.saveUploadedDocuments();
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
      if (!uploadId) {
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
    const before = this.uploadedDocuments.length;
    this.uploadedDocuments = this.uploadedDocuments.filter(
      (doc) => String(doc.metadata?.uploadId ?? "") !== uploadId,
    );
    const removed = before - this.uploadedDocuments.length;
    if (removed > 0) {
      await this.saveUploadedDocuments();
      await this.rebuildVectorStore();
    }
    return removed;
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
