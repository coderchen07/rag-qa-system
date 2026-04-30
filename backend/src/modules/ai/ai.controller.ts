import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AiService } from "./ai.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { UserRole } from "../auth/entities/user.entity";

type AuthedRequest = Request & {
  user?: { id: string; username: string; role: UserRole };
};

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
      correctionUsed: smart.correctionUsed,
      sources: smart.sources,
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

  /**
   * SSE chat: same URL as before. Chunks are `{ content: string }`.
   * When the model uses tools, an early chunk may be the literal
   * `🔧 正在调用工具：…` hint before the final answer stream (per-character after tool results).
   */
  @Post("chat")
  async chat(@Body() chatDto: any, @Res() res: any, @Req() req: AuthedRequest) {
    const messages = chatDto?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new BadRequestException("messages is required");
    }
    for (const item of messages) {
      if (!item || typeof item !== "object") {
        throw new BadRequestException("each message must be an object");
      }
      if (typeof item.role !== "string" || typeof item.content !== "string") {
        throw new BadRequestException("each message must have string role and string content");
      }
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.status(200);

    try {
      await this.aiService.chat(
        messages,
        (chunk) => {
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        },
        { callerRole: req.user?.role },
      );
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

  @Post("chat/session")
  async chatBySession(@Body() body: any, @Res() res: any, @Req() req: AuthedRequest) {
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    const messageContent =
      typeof body?.message?.content === "string" ? body.message.content.trim() : "";
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException("user id is required");
    }
    if (!sessionId) {
      throw new BadRequestException("sessionId is required");
    }
    if (!messageContent) {
      throw new BadRequestException("message.content is required");
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.status(200);

    try {
      await this.aiService.chatBySession(
        sessionId,
        userId,
        messageContent,
        (chunk) => {
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        },
        { callerRole: req.user?.role },
      );
      res.write("event: done\ndata: [DONE]\n\n");
      res.end();
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        res.status(error.getStatus());
      } else {
        res.status(500);
      }
      const message = error instanceof Error ? error.message : "Chat stream failed";
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      res.end();
      return;
    }
  }
}
