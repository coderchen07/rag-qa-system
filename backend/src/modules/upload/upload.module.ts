import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { AuthModule } from "../auth/auth.module";
import { UploadController } from "./upload.controller";
import { UploadService } from "./upload.service";

@Module({
  imports: [AiModule, AuthModule],
  controllers: [UploadController],
  providers: [UploadService],
})
export class UploadModule {}
