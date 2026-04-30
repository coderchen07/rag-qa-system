import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { UserRole } from "../auth/entities/user.entity";
import { ConversationService } from "./conversation.service";
import { ConversationRole } from "./entities/session.entity";

type AuthedRequest = Request & {
  user?: { id: string; username: string; role: UserRole };
};

@Controller("conversation")
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Post()
  async createSession(
    @Req() req: AuthedRequest,
    @Body() body?: { title?: string },
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException("user id is required");
    }
    const session = await this.conversationService.create(userId, body?.title);
    return { code: 0, data: session };
  }

  @Get()
  async listSessions(@Req() req: AuthedRequest) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException("user id is required");
    }
    const list = await this.conversationService.findAllByUser(userId);
    return { code: 0, data: list };
  }

  @Get(":id")
  async getSession(@Req() req: AuthedRequest, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException("user id is required");
    }
    const session = await this.conversationService.findById(id, userId);
    if (!session) {
      throw new NotFoundException("会话不存在");
    }
    return { code: 0, data: session };
  }

  @Post(":id/message")
  async addMessage(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: { role?: string; content?: string },
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException("user id is required");
    }
    const role = body?.role;
    if (role !== "user" && role !== "assistant" && role !== "system") {
      throw new BadRequestException("role must be user, assistant or system");
    }
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) {
      throw new BadRequestException("content is required");
    }
    try {
      const session = await this.conversationService.addMessage(
        id,
        {
          role: role as ConversationRole,
          content,
          timestamp: new Date().toISOString(),
        },
        userId,
      );
      return { code: 0, data: session };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (message === "SESSION_NOT_FOUND") {
        throw new NotFoundException("会话不存在");
      }
      throw error;
    }
  }

  @Delete(":id")
  async deleteSession(@Req() req: AuthedRequest, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException("user id is required");
    }
    const ok = await this.conversationService.delete(id, userId);
    if (!ok) {
      throw new NotFoundException("会话不存在");
    }
    return { code: 0, message: "已删除" };
  }
}

