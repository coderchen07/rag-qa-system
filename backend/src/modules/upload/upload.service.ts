import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { Document } from "@langchain/core/documents";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { JSONLoader } from "@langchain/classic/document_loaders/fs/json";
import { unlink } from "node:fs/promises";
import { basename, extname } from "node:path";
import { AiService } from "../ai/ai.service";

type UploadResult = {
  fileName: string;
  appendedCount: number;
};

@Injectable()
export class UploadService {
  private readonly allowedExts = new Set([
    ".pdf",
    ".docx",
    ".txt",
    ".csv",
    ".json",
    ".md",
  ]);

  constructor(private readonly aiService: AiService) {}

  async processUpload(file: Express.Multer.File): Promise<UploadResult> {
    const normalizedOriginalName = this.normalizeOriginalName(file.originalname);
    const extension = extname(normalizedOriginalName).toLowerCase();
    const fileTitle = basename(normalizedOriginalName, extension);
    const uploadId = `upload-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    if (!this.allowedExts.has(extension)) {
      throw new BadRequestException(
        "unsupported file type, expected pdf/docx/txt/csv/json/md",
      );
    }

    const docs = await this.loadDocumentsByExt(file.path, extension);
    if (docs.length === 0) {
      throw new BadRequestException("uploaded file does not contain readable text");
    }

    await this.aiService.addDocuments(
      docs.map((doc) => {
        const pageContent = String(doc.pageContent ?? "").trim();
        return new Document({
          pageContent,
          metadata: {
            ...doc.metadata,
            source: normalizedOriginalName,
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

    await this.safeRemoveTempFile(file.path);
    return {
      fileName: normalizedOriginalName,
      appendedCount: docs.length,
    };
  }

  private normalizeOriginalName(fileName: string): string {
    if (!fileName) {
      return "uploaded-file";
    }
    try {
      // Multer/Busboy may decode UTF-8 filenames as latin1 on some clients.
      return Buffer.from(fileName, "latin1").toString("utf8");
    } catch {
      return fileName;
    }
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
    return new TextLoader(filePath).load();
  }

  private async safeRemoveTempFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error: unknown) {
      console.error("[UploadService] failed to cleanup temp file", error);
      throw new InternalServerErrorException("failed to cleanup temp file");
    }
  }
}
