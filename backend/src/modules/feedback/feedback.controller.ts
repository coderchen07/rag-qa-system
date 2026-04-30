import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Patch,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { FeedbackService } from "./feedback.service";
import type { FeedbackRating } from "./entities/feedback.entity";

@Controller("feedback")
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  async submitFeedback(
    @Body()
    body: {
      question?: string;
      answer?: string;
      context?: unknown;
      rating?: string;
      correction?: string;
    },
  ) {
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";

    const contextRaw = body?.context;
    const context = Array.isArray(contextRaw) ? contextRaw.map((x) => String(x)) : [];

    const rating = typeof body?.rating === "string" ? body.rating : "";
    if (rating !== "like" && rating !== "dislike") {
      throw new BadRequestException("rating must be like or dislike");
    }

    if (!question || !answer) {
      throw new BadRequestException("question and answer are required");
    }

    await this.feedbackService.save([
      {
        question,
        answer,
        context,
        rating: rating as FeedbackRating,
        correction: typeof body?.correction === "string" ? body.correction : undefined,
        enabled: false,
      },
    ]);

    return { code: 0, message: "反馈已提交" };
  }

  @Get("stats")
  @Roles("admin")
  async getStats() {
    const stats = await this.feedbackService.getStats();
    return { code: 0, data: stats };
  }

  @Get("export")
  @Roles("admin")
  async exportAll(
    @Query("rating") rating?: string,
    @Query("keyword") keyword?: string,
    @Query("enabled") enabled?: string,
  ) {
    if (rating && rating !== "like" && rating !== "dislike") {
      throw new BadRequestException("rating must be like or dislike");
    }
    if (enabled && enabled !== "true" && enabled !== "false") {
      throw new BadRequestException("enabled must be true or false");
    }
    const all = await this.feedbackService.query({
      rating: rating as FeedbackRating | undefined,
      keyword,
      enabled: enabled ? enabled === "true" : undefined,
    });
    return { code: 0, data: all };
  }

  @Get("list")
  @Roles("admin")
  async list(
    @Query("rating") rating?: string,
    @Query("keyword") keyword?: string,
    @Query("enabled") enabled?: string,
  ) {
    return this.exportAll(rating, keyword, enabled);
  }

  @Patch(":id/enabled")
  @Roles("admin")
  async updateEnabled(@Param("id") id: string, @Body() body: { enabled?: unknown }) {
    if (typeof body?.enabled !== "boolean") {
      throw new BadRequestException("enabled must be boolean");
    }
    await this.feedbackService.updateEnabled(id, body.enabled);
    return { code: 0, message: "更新成功" };
  }

  @Delete(":id")
  @Roles("admin")
  async deleteById(@Param("id") id: string) {
    const ok = await this.feedbackService.deleteById(id);
    if (!ok) {
      throw new NotFoundException("反馈记录不存在");
    }
    return { code: 0, message: "已删除" };
  }
}

