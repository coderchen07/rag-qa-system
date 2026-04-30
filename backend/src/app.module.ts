import { Module } from "@nestjs/common";
import { AiModule } from "./modules/ai/ai.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UploadModule } from "./modules/upload/upload.module";
import { ToolsModule } from "./modules/tools/tools.module";
import { FeedbackModule } from "./modules/feedback/feedback.module";
import { ConversationModule } from "./modules/conversation/conversation.module";

@Module({
  imports: [
    AiModule,
    AuthModule,
    UploadModule,
    ToolsModule,
    FeedbackModule,
    ConversationModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
