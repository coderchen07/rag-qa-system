import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AiService } from "./ai.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

@Controller("ai")
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("rag")
  async rag(@Body() body: { question: string }) {
    const { question } = body;
    if (!question || question.trim().length === 0) {
      throw new BadRequestException("question is required");
    }

    const smart = await this.aiService.ragSmart(question);
    return {
      code: 0,
      // Backward compatibility for existing frontend.
      answer: smart.answer,
      // New smart payload for evidence-driven UI.
      data: smart,
    };
  }

  @Get("search")
  async search(@Query("keyword") keyword: string) {
    if (!keyword || keyword.trim().length === 0) {
      throw new BadRequestException("keyword is required");
    }

    const titles = await this.aiService.search(keyword);
    return { code: 0, data: titles };
  }

  @Get("health/deepseek")
  async deepseekHealth() {
    const result = await this.aiService.checkDeepSeekHealth();
    return { code: 0, data: result };
  }

  @Post("chat")
  async chat(@Body() chatDto: any, @Res() res: any) {
    const messages = chatDto?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new BadRequestException("messages is required");
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      await this.aiService.chat(messages, (chunk) => {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      });
      res.write("event: done\ndata: [DONE]\n\n");
      res.end();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Chat stream failed";
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      res.end();
      throw error;
    }
  }
}
