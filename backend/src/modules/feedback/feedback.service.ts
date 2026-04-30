import { Injectable, NotFoundException } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { FeedbackEntity, FeedbackRating } from "./entities/feedback.entity";

type FeedbackStats = {
  total: number;
  likes: number;
  dislikes: number;
};

type FeedbackQueryFilters = {
  rating?: FeedbackRating;
  keyword?: string;
  enabled?: boolean;
};

// JSON schema on disk uses ISO strings for Date fields.
type FeedbackPersisted = Omit<FeedbackEntity, "createdAt"> & {
  createdAt: string;
};

@Injectable()
export class FeedbackService {
  private readonly feedbacksFilePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "data",
    "feedbacks.json",
  );

  private toPersisted(entity: FeedbackEntity): FeedbackPersisted {
    return {
      id: entity.id,
      question: entity.question,
      answer: entity.answer,
      context: entity.context,
      rating: entity.rating as FeedbackRating,
      correction: entity.correction,
      enabled: entity.enabled,
      createdAt: entity.createdAt.toISOString(),
    };
  }

  private toEntity(p: FeedbackPersisted): FeedbackEntity {
    return {
      id: p.id,
      question: p.question,
      answer: p.answer,
      context: Array.isArray(p.context) ? p.context.map((x) => String(x)) : [],
      rating: p.rating,
      correction: p.correction,
      enabled: p.enabled === true,
      createdAt: new Date(p.createdAt),
    };
  }

  async readAll(): Promise<FeedbackEntity[]> {
    try {
      const raw = await readFile(this.feedbacksFilePath, "utf-8");
      const parsed = JSON.parse(raw) as FeedbackPersisted[];
      const list = Array.isArray(parsed) ? parsed : [];
      return list.map((item) => this.toEntity(item));
    } catch {
      return [];
    }
  }

  async save(items: Omit<FeedbackEntity, "id" | "createdAt">[]): Promise<FeedbackEntity[]> {
    const existing = await this.readAll();
    const now = new Date();
    const created = items.map((item) => {
      const entity: FeedbackEntity = {
        id: randomUUID(),
        createdAt: now,
        question: item.question,
        answer: item.answer,
        context: item.context,
        rating: item.rating,
        correction: item.correction,
        enabled: false,
      };
      return entity;
    });
    const merged = [...existing, ...created];

    await mkdir(path.dirname(this.feedbacksFilePath), { recursive: true });
    const persisted: FeedbackPersisted[] = merged.map((e) => this.toPersisted(e));
    await writeFile(this.feedbacksFilePath, JSON.stringify(persisted, null, 2), "utf-8");
    return created;
  }

  async getStats(): Promise<FeedbackStats> {
    const all = await this.readAll();
    const likes = all.filter((f) => f.rating === "like").length;
    const dislikes = all.filter((f) => f.rating === "dislike").length;
    return { total: all.length, likes, dislikes };
  }

  async exportAll(): Promise<FeedbackEntity[]> {
    return this.readAll();
  }

  async query(filters: FeedbackQueryFilters): Promise<FeedbackEntity[]> {
    const all = await this.readAll();
    const rating = filters.rating;
    const keyword = (filters.keyword ?? "").trim().toLowerCase();
    const enabled = filters.enabled;

    return all.filter((item) => {
      if (rating && item.rating !== rating) {
        return false;
      }
      if (typeof enabled === "boolean" && item.enabled !== enabled) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const inQuestion = item.question.toLowerCase().includes(keyword);
      const inCorrection = String(item.correction ?? "")
        .toLowerCase()
        .includes(keyword);
      return inQuestion || inCorrection;
    });
  }

  async deleteById(id: string): Promise<boolean> {
    const all = await this.readAll();
    const next = all.filter((item) => item.id !== id);
    if (next.length === all.length) {
      return false;
    }

    await mkdir(path.dirname(this.feedbacksFilePath), { recursive: true });
    const persisted: FeedbackPersisted[] = next.map((e) => this.toPersisted(e));
    await writeFile(this.feedbacksFilePath, JSON.stringify(persisted, null, 2), "utf-8");
    return true;
  }

  async updateEnabled(id: string, enabled: boolean): Promise<FeedbackEntity> {
    const all = await this.readAll();
    const idx = all.findIndex((item) => item.id === id);
    if (idx < 0) {
      throw new NotFoundException("反馈记录不存在");
    }
    const target = all[idx];
    target.enabled = enabled;
    all[idx] = target;

    await mkdir(path.dirname(this.feedbacksFilePath), { recursive: true });
    const persisted: FeedbackPersisted[] = all.map((e) => this.toPersisted(e));
    await writeFile(this.feedbacksFilePath, JSON.stringify(persisted, null, 2), "utf-8");
    return target;
  }

  async getDocumentFeedbackStats(): Promise<
    Map<string, { likes: number; dislikes: number }>
  > {
    const all = await this.readAll();
    const stats = new Map<string, { likes: number; dislikes: number }>();

    for (const item of all) {
      const snippets = Array.isArray(item.context) ? item.context : [];
      if (snippets.length === 0) {
        continue;
      }
      for (const snippet of snippets) {
        const key = String(snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
        if (!key) {
          continue;
        }
        const current = stats.get(key) ?? { likes: 0, dislikes: 0 };
        if (item.rating === "like") {
          current.likes += 1;
        } else if (item.rating === "dislike") {
          current.dislikes += 1;
        }
        stats.set(key, current);
      }
    }

    return stats;
  }

  private tokenizeQuestion(text: string): Set<string> {
    const normalized = text.trim().toLowerCase();
    const cjkOnly = normalized.replace(/[^\u4e00-\u9fff]/g, "");
    const tokens: string[] = [];
    if (cjkOnly.length >= 2) {
      for (let i = 0; i + 2 <= cjkOnly.length; i += 1) {
        tokens.push(cjkOnly.slice(i, i + 2));
      }
      for (let i = 0; i + 3 <= cjkOnly.length; i += 1) {
        tokens.push(cjkOnly.slice(i, i + 3));
      }
    }
    const asciiTokens = normalized
      .split(/[\s,，。！？!?\-_/、:：;；"'()（）]+/g)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);
    return new Set([...tokens, ...asciiTokens]);
  }

  private calcJaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) {
      return 0;
    }
    let intersection = 0;
    a.forEach((token) => {
      if (b.has(token)) {
        intersection += 1;
      }
    });
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private hasStrongCjkOverlap(a: string, b: string): boolean {
    const aCjk = a.replace(/[^\u4e00-\u9fff]/g, "");
    const bCjk = b.replace(/[^\u4e00-\u9fff]/g, "");
    if (aCjk.length < 2 || bCjk.length < 2) {
      return false;
    }
    if (aCjk.includes(bCjk) || bCjk.includes(aCjk)) {
      return true;
    }
    if (aCjk.length < 4 || bCjk.length < 4) {
      return false;
    }
    const grams = new Set<string>();
    for (let i = 0; i + 4 <= aCjk.length; i += 1) {
      grams.add(aCjk.slice(i, i + 4));
    }
    for (let i = 0; i + 4 <= bCjk.length; i += 1) {
      if (grams.has(bCjk.slice(i, i + 4))) {
        return true;
      }
    }
    return false;
  }

  async findCorrection(question: string): Promise<string | null> {
    const normalizedQuestion = question.trim().toLowerCase();
    if (!normalizedQuestion) {
      return null;
    }

    const candidates = (await this.readAll())
      .filter(
        (item) =>
          item.enabled === true &&
          item.rating === "dislike" &&
          typeof item.correction === "string" &&
          item.correction.trim().length > 0,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (candidates.length === 0) {
      return null;
    }

    const sourceTokens = this.tokenizeQuestion(normalizedQuestion);
    let best:
      | {
          score: number;
          correction: string;
          createdAt: number;
        }
      | undefined;

    for (const item of candidates) {
      const targetQ = item.question.trim().toLowerCase();
      if (!targetQ) {
        continue;
      }
      let score = 0;
      if (
        targetQ.includes(normalizedQuestion) ||
        normalizedQuestion.includes(targetQ) ||
        this.hasStrongCjkOverlap(normalizedQuestion, targetQ)
      ) {
        score = 1;
      } else {
        const targetTokens = this.tokenizeQuestion(targetQ);
        score = this.calcJaccard(sourceTokens, targetTokens);
      }
      if (score <= 0.6) {
        continue;
      }
      const candidate = {
        score,
        correction: String(item.correction ?? "").trim(),
        createdAt: item.createdAt.getTime(),
      };
      if (!best) {
        best = candidate;
        continue;
      }
      if (candidate.score > best.score) {
        best = candidate;
        continue;
      }
      if (candidate.score === best.score && candidate.createdAt > best.createdAt) {
        best = candidate;
      }
    }

    return best?.correction ?? null;
  }
}

