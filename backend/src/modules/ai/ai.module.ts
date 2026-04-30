import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConversationModule } from "../conversation/conversation.module";
import { FeedbackModule } from "../feedback/feedback.module";
import { ToolsModule } from "../tools/tools.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";

@Module({
  imports: [AuthModule, ToolsModule, FeedbackModule, ConversationModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
