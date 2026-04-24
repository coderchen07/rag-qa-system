import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Document } from "@langchain/core/documents";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { JSONLoader } from "@langchain/classic/document_loaders/fs/json";
import { readFile, unlink } from "node:fs/promises";
import { basename, extname } from "node:path";
import * as iconv from "iconv-lite";
import { AiService } from "../ai/ai.service";

type UploadResult = {
  fileName: string;
  appendedCount: number;
};

type UploadJobStatus = "queued" | "processing" | "done" | "failed";

type UploadJob = {
  jobId: string;
  originalName: string;
  path: string;
  batchId?: string;
  batchPartIndex?: number;
  batchPartTotal?: number;
  batchOriginalName?: string;
  status: UploadJobStatus;
  createdAt: string;
  updatedAt: string;
  result?: UploadResult;
  error?: string;
};

type UploadBatch = {
  batchId: string;
  uploadId: string;
  originalName: string;
  extension: string;
  fileTitle: string;
  expectedParts: number;
  receivedParts: number;
  chunks: Document[];
};

type TextQualityCheckResult = {
  ok: boolean;
  reason?: string;
};

type ChapterSection = {
  heading: string;
  text: string;
};

@Injectable()
export class UploadService implements OnModuleInit, OnModuleDestroy {
  private readonly chunkSize = 2600;
  private readonly chunkOverlap = 120;
  private readonly maxChunksPerUpload = 180;
  private readonly maxTextChars = 220000;
  private readonly pollIntervalMs = 800;
  private readonly allowedExts = new Set([
    ".pdf",
    ".docx",
    ".txt",
    ".csv",
    ".json",
    ".md",
  ]);
  private readonly jobQueue: string[] = [];
  private readonly jobs = new Map<string, UploadJob>();
  private readonly batches = new Map<string, UploadBatch>();
  private workerTimer?: NodeJS.Timeout;
  private isProcessing = false;

  constructor(private readonly aiService: AiService) {}

  onModuleInit(): void {
    this.workerTimer = setInterval(() => {
      void this.processNextJob();
    }, this.pollIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = undefined;
    }
  }

  enqueueUpload(
    file: Express.Multer.File,
    batch?: {
      batchId?: string;
      partIndex?: number;
      partTotal?: number;
      originalFileName?: string;
    },
  ): { jobId: string; status: UploadJobStatus } {
    const jobId = `job-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const now = new Date().toISOString();
    const job: UploadJob = {
      jobId,
      originalName: file.originalname,
      path: file.path,
      batchId: batch?.batchId,
      batchPartIndex: batch?.partIndex,
      batchPartTotal: batch?.partTotal,
      batchOriginalName: batch?.originalFileName,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(jobId, job);
    this.jobQueue.push(jobId);
    return { jobId, status: job.status };
  }

  getJob(jobId: string): UploadJob | undefined {
    return this.jobs.get(jobId);
  }

  private async processNextJob(): Promise<void> {
    if (this.isProcessing || this.jobQueue.length === 0) {
      return;
    }
    const jobId = this.jobQueue.shift();
    if (!jobId) {
      return;
    }
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    this.isProcessing = true;
    job.status = "processing";
    job.updatedAt = new Date().toISOString();

    try {
      const result = await this.processUploadPath(job);
      job.status = "done";
      job.result = result;
      job.updatedAt = new Date().toISOString();
    } catch (error: unknown) {
      job.status = "failed";
      job.error = this.extractReadableError(error);
      job.updatedAt = new Date().toISOString();
      await this.safeRemoveTempFile(job.path);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processUploadPath(job: UploadJob): Promise<UploadResult> {
    const filePath = job.path;
    const originalName = job.originalName;
    const normalizedOriginalName = this.normalizeOriginalName(originalName);
    const effectiveOriginalName = this.normalizeOriginalName(
      job.batchOriginalName && job.batchOriginalName.trim().length > 0
        ? job.batchOriginalName
        : normalizedOriginalName,
    );
    const extension = extname(effectiveOriginalName).toLowerCase();
    const fileTitle = basename(effectiveOriginalName, extension);
    if (!this.allowedExts.has(extension)) {
      throw new BadRequestException(
        "unsupported file type, expected pdf/docx/txt/csv/json/md",
      );
    }

    const docs = await this.loadDocumentsByExt(filePath, extension);
    const chunkedDocs = this.chunkDocuments(docs);
    if (chunkedDocs.length > this.maxChunksPerUpload) {
      throw new BadRequestException(
        `document is too large after chunking (${chunkedDocs.length} chunks). Please split file or reduce content size.`,
      );
    }
    if (chunkedDocs.length === 0) {
      throw new BadRequestException("uploaded file does not contain readable text");
    }

    const isBatchPart =
      Boolean(job.batchId) &&
      Number.isInteger(job.batchPartIndex) &&
      Number.isInteger(job.batchPartTotal) &&
      Number(job.batchPartTotal) > 1;

    if (!isBatchPart) {
      const singleQuality = this.checkTextQuality(chunkedDocs, effectiveOriginalName);
      if (!singleQuality.ok) {
        throw new BadRequestException(singleQuality.reason ?? "text quality check failed");
      }
      const uploadId = `upload-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      await this.aiService.addDocuments(
        chunkedDocs.map((doc) => {
          const pageContent = String(doc.pageContent ?? "").trim();
          return new Document({
            pageContent,
            metadata: {
              ...doc.metadata,
              source: effectiveOriginalName,
              title:
                typeof doc.metadata?.title === "string" && doc.metadata.title.trim().length > 0
                  ? doc.metadata.title
                  : fileTitle,
              uploadId,
              uploadedAt: new Date().toISOString(),
            },
          });
        }),
      );
      await this.safeRemoveTempFile(filePath);
      return {
        fileName: effectiveOriginalName,
        appendedCount: chunkedDocs.length,
      };
    }

    const batchId = String(job.batchId);
    const batchPartTotal = Number(job.batchPartTotal);
    const uploadBatch = this.getOrCreateBatch(batchId, {
      originalName: effectiveOriginalName,
      extension,
      fileTitle,
      expectedParts: batchPartTotal,
    });
    if (uploadBatch.expectedParts !== batchPartTotal) {
      throw new BadRequestException("upload batch part total mismatch");
    }

    const normalizedPartDocs = chunkedDocs.map((doc) => {
      const pageContent = String(doc.pageContent ?? "").trim();
      return new Document({
        pageContent,
        metadata: {
          ...doc.metadata,
          source: uploadBatch.originalName,
          title:
            typeof doc.metadata?.title === "string" && doc.metadata.title.trim().length > 0
              ? doc.metadata.title
              : uploadBatch.fileTitle,
          uploadId: uploadBatch.uploadId,
          uploadedAt: new Date().toISOString(),
        },
      });
    });
    uploadBatch.chunks.push(...normalizedPartDocs);
    uploadBatch.receivedParts += 1;

    await this.safeRemoveTempFile(filePath);
    if (uploadBatch.receivedParts < uploadBatch.expectedParts) {
      return {
        fileName: uploadBatch.originalName,
        appendedCount: normalizedPartDocs.length,
      };
    }

    const batchQuality = this.checkTextQuality(uploadBatch.chunks, uploadBatch.originalName);
    if (!batchQuality.ok) {
      this.batches.delete(batchId);
      throw new BadRequestException(batchQuality.reason ?? "text quality check failed");
    }
    await this.aiService.addDocuments(uploadBatch.chunks);
    const appendedCount = uploadBatch.chunks.length;
    this.batches.delete(batchId);
    return {
      fileName: uploadBatch.originalName,
      appendedCount,
    };
  }

  private getOrCreateBatch(
    batchId: string,
    init: {
      originalName: string;
      extension: string;
      fileTitle: string;
      expectedParts: number;
    },
  ): UploadBatch {
    const existing = this.batches.get(batchId);
    if (existing) {
      return existing;
    }
    const created: UploadBatch = {
      batchId,
      uploadId: `upload-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      originalName: init.originalName,
      extension: init.extension,
      fileTitle: init.fileTitle,
      expectedParts: init.expectedParts,
      receivedParts: 0,
      chunks: [],
    };
    this.batches.set(batchId, created);
    return created;
  }

  private checkTextQuality(docs: Document[], fileName: string): TextQualityCheckResult {
    const fullText = docs
      .map((doc) => String(doc.pageContent ?? ""))
      .join("\n")
      .trim();
    if (!fullText) {
      return {
        ok: false,
        reason: "文档内容为空，无法入库。",
      };
    }

    const replacementCount = (fullText.match(/\uFFFD/g) ?? []).length;
    const mojibakeCount = (fullText.match(/锟斤拷/g) ?? []).length;
    const nonWhitespaceChars = fullText.replace(/\s/g, "").length || 1;
    const replacementRatio = replacementCount / nonWhitespaceChars;
    const mojibakeRatio = mojibakeCount / nonWhitespaceChars;

    if (replacementCount > 0 || mojibakeCount >= 3 || replacementRatio > 0.0005 || mojibakeRatio > 0.001) {
      return {
        ok: false,
        reason:
          "检测到文本疑似乱码（包含 �/锟斤拷），已拒绝入库。请先将源文件转为 UTF-8 编码后再上传。",
      };
    }

    const cjkChars = (fullText.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const latinChars = (fullText.match(/[A-Za-z]/g) ?? []).length;
    const likelyChineseDoc = /[\u4e00-\u9fff]/.test(fileName) || cjkChars >= 120;
    if (likelyChineseDoc) {
      const cjkRatio = cjkChars / nonWhitespaceChars;
      if (cjkRatio < 0.08 && latinChars < cjkChars) {
        return {
          ok: false,
          reason:
            "检测到中文文档有效汉字比例异常，疑似编码损坏，已拒绝入库。建议用编辑器另存为 UTF-8（无 BOM）后重试。",
        };
      }
    }

    return { ok: true };
  }

  private normalizeOriginalName(fileName: string): string {
    if (!fileName) {
      return "uploaded-file";
    }
    if (!this.looksLikeMojibakeFileName(fileName)) {
      return fileName;
    }
    try {
      // Some clients decode UTF-8 filename as latin1. Only attempt recovery for suspicious names.
      const recovered = Buffer.from(fileName, "latin1").toString("utf8");
      if (this.looksLikeMojibakeFileName(recovered)) {
        return fileName;
      }
      return recovered;
    } catch {
      return fileName;
    }
  }

  private looksLikeMojibakeFileName(fileName: string): boolean {
    if (!fileName) {
      return false;
    }
    const replacementChars = (fileName.match(/[�]/g) ?? []).length;
    const mojibakeMarkers = (fileName.match(/[ÃÂÆÐÑØæçèéêëìíîïðñòóôõöø]/g) ?? []).length;
    const ctrlChars = (fileName.match(/[\u0000-\u001F]/g) ?? []).length;
    return replacementChars > 0 || ctrlChars > 0 || mojibakeMarkers >= 2;
  }

  private async loadDocumentsByExt(
    filePath: string,
    extension: string,
  ): Promise<Document[]> {
    if (extension === ".pdf") {
      return new PDFLoader(filePath).load();
    }
    if (extension === ".docx") {
      return new DocxLoader(filePath).load();
    }
    if (extension === ".csv") {
      return new CSVLoader(filePath).load();
    }
    if (extension === ".json") {
      return new JSONLoader(filePath, ["/content", "/text"]).load();
    }
    if (extension === ".txt" || extension === ".md") {
      return this.loadPlainTextDocuments(filePath);
    }
    return new TextLoader(filePath).load();
  }

  private async loadPlainTextDocuments(filePath: string): Promise<Document[]> {
    const rawBuffer = await readFile(filePath);
    const utf8 = rawBuffer.toString("utf8");
    const decoded = this.hasBrokenUtf8(utf8) ? iconv.decode(rawBuffer, "gb18030") : utf8;
    if (decoded.length > this.maxTextChars) {
      throw new BadRequestException(
        `text content is too large (${decoded.length} chars). Please split into smaller files.`,
      );
    }
    return [new Document({ pageContent: decoded, metadata: {} })];
  }

  private hasBrokenUtf8(text: string): boolean {
    const replacementCharCount = (text.match(/\uFFFD/g) ?? []).length;
    return replacementCharCount > 5;
  }

  private chunkDocuments(documents: Document[]): Document[] {
    const chunks: Document[] = [];
    for (const doc of documents) {
      const raw = String(doc.pageContent ?? "").trim();
      if (!raw) {
        continue;
      }
      const sectioned = this.splitByChapters(raw);
      const flattenedSegments: Array<{ segment: string; chapterIndex: number; chapterTitle: string }> =
        [];
      sectioned.forEach((section, sectionIndex) => {
        const sectionSegments = this.splitText(section.text, this.chunkSize, this.chunkOverlap);
        sectionSegments.forEach((segment) => {
          flattenedSegments.push({
            segment,
            chapterIndex: sectionIndex,
            chapterTitle: section.heading,
          });
        });
      });
      flattenedSegments.forEach((item, index) => {
        chunks.push(
          new Document({
            pageContent: item.segment,
            metadata: {
              ...doc.metadata,
              chunkIndex: index,
              chunkCount: flattenedSegments.length,
              chapterIndex: item.chapterIndex,
              chapterTitle: item.chapterTitle,
            },
          }),
        );
      });
    }
    return chunks;
  }

  private splitByChapters(text: string): ChapterSection[] {
    const lines = text.split(/\r?\n/);
    const headingPattern =
      /^\s*(第[0-9一二三四五六七八九十百千零两]+[章节卷部篇回幕]|chapter\s*\d+|卷\s*\d+|===+|---+)\s*/i;
    const sections: ChapterSection[] = [];
    let current: string[] = [];
    let currentHeading = "未命名章节";

    for (const line of lines) {
      const trimmed = line.trim();
      const isHeading = headingPattern.test(trimmed);
      if (isHeading && current.length > 0) {
        sections.push({
          heading: currentHeading,
          text: current.join("\n").trim(),
        });
        current = [line];
        currentHeading = trimmed || currentHeading;
      } else {
        current.push(line);
        if (isHeading) {
          currentHeading = trimmed || currentHeading;
        }
      }
    }

    if (current.length > 0) {
      sections.push({
        heading: currentHeading,
        text: current.join("\n").trim(),
      });
    }

    const normalized = sections.filter((item) => item.text.length > 0);
    return normalized.length > 0
      ? normalized
      : [{ heading: "未命名章节", text }];
  }

  private splitText(text: string, size: number, overlap: number): string[] {
    if (text.length <= size) {
      return [text];
    }
    const result: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(text.length, start + size);
      result.push(text.slice(start, end));
      if (end >= text.length) {
        break;
      }
      start = Math.max(0, end - overlap);
    }
    return result;
  }

  private async safeRemoveTempFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error: unknown) {
      console.error("[UploadService] failed to cleanup temp file", error);
      throw new InternalServerErrorException("failed to cleanup temp file");
    }
  }

  private extractReadableError(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === "string" && response.trim().length > 0) {
        return response;
      }
      if (
        typeof response === "object" &&
        response !== null &&
        "message" in response
      ) {
        const msg = (response as { message?: unknown }).message;
        if (Array.isArray(msg)) {
          return msg.map((item) => String(item)).join("; ");
        }
        if (typeof msg === "string" && msg.trim().length > 0) {
          return msg;
        }
      }
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "后台处理失败，请稍后重试。";
  }
}
