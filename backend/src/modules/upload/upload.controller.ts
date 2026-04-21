import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { extname } from "node:path";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { UploadService } from "./upload.service";
import { AiService } from "../ai/ai.service";

const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".csv", ".json", ".md"]);

@Controller("upload")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly aiService: AiService,
  ) {}

  @Post("document")
  @Roles("admin")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: "uploads",
        filename: (
          _: unknown,
          file: { originalname: string },
          callback: (error: Error | null, filename: string) => void,
        ) => {
          const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          callback(null, `${suffix}${extname(file.originalname)}`);
        },
      }),
      limits: {
        fileSize: 20 * 1024 * 1024,
      },
      fileFilter: (
        _: unknown,
        file: { originalname: string },
        callback: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const extension = extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(extension)) {
          callback(
            new BadRequestException("only pdf/docx/txt/csv/json/md files are allowed"),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadDocument(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("file is required");
    }

    await this.uploadService.processUpload(file);
    return {
      code: 0,
      message: "上传成功",
    };
  }

  @Get("documents")
  @Roles("admin")
  listUploadedDocuments() {
    return {
      code: 0,
      data: this.aiService.listUploadedDocuments(),
    };
  }

  @Delete("document/:uploadId")
  @Roles("admin")
  async removeUploadedDocument(@Param("uploadId") uploadId: string) {
    if (!uploadId || uploadId.trim().length === 0) {
      throw new BadRequestException("uploadId is required");
    }
    const removed = await this.aiService.removeUploadedDocument(uploadId.trim());
    if (removed === 0) {
      throw new BadRequestException("document not found");
    }
    return {
      code: 0,
      message: "删除成功",
      data: { removedChunks: removed },
    };
  }
}
