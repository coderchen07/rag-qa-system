import { Module } from "@nestjs/common";
import { AiModule } from "./modules/ai/ai.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UploadModule } from "./modules/upload/upload.module";

@Module({
  imports: [AiModule, AuthModule, UploadModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
