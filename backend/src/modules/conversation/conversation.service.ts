import { ForbiddenException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { SessionEntity, SessionMessage } from "./entities/session.entity";

export type SessionListItem = Pick<
  SessionEntity,
  "id" | "title" | "createdAt" | "updatedAt"
>;

type MessageLike = {
  role?: unknown;
  content?: unknown;
};

@Injectable()
export class ConversationService {
  private readonly sessionsFilePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "data",
    "sessions.json",
  );

  private async readAllRaw(): Promise<SessionEntity[]> {
    try {
      const raw = await readFile(this.sessionsFilePath, "utf-8");
      const parsed = JSON.parse(raw) as SessionEntity[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeAllRaw(items: SessionEntity[]): Promise<void> {
    await mkdir(path.dirname(this.sessionsFilePath), { recursive: true });
    await writeFile(this.sessionsFilePath, JSON.stringify(items, null, 2), "utf-8");
  }

  async create(userId: string, title?: string): Promise<SessionEntity> {
    const all = await this.readAllRaw();
    const now = new Date().toISOString();
    const session: SessionEntity = {
      id: randomUUID(),
      userId,
      title: typeof title === "string" ? title.trim() : "",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    all.push(session);
    await this.writeAllRaw(all);
    return session;
  }

  async findAllByUser(userId: string): Promise<SessionListItem[]> {
    const all = await this.readAllRaw();
    return all
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((item) => ({
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }

  async findById(id: string, userId?: string): Promise<SessionEntity | null> {
    const all = await this.readAllRaw();
    const target = all.find((item) => item.id === id) ?? null;
    if (!target) {
      return null;
    }
    if (userId && target.userId !== userId) {
      throw new ForbiddenException("无权访问该会话");
    }
    return target;
  }

  private deriveTitleFromFirstUserMessage(messages: SessionMessage[]): string {
    const firstUser = messages.find((item) => item.role === "user" && item.content.trim().length > 0);
    if (!firstUser) {
      return "";
    }
    return firstUser.content.trim().slice(0, 30);
  }

  async addMessage(id: string, message: SessionMessage, userId?: string): Promise<SessionEntity> {
    const all = await this.readAllRaw();
    const idx = all.findIndex((item) => item.id === id);
    if (idx < 0) {
      throw new Error("SESSION_NOT_FOUND");
    }
    const target = all[idx];
    if (userId && target.userId !== userId) {
      throw new ForbiddenException("无权修改该会话");
    }

    target.messages.push(message);
    if (!target.title || target.title.trim().length === 0) {
      target.title = this.deriveTitleFromFirstUserMessage(target.messages);
    }
    target.updatedAt = new Date().toISOString();
    all[idx] = target;
    await this.writeAllRaw(all);
    return target;
  }

  async delete(id: string, userId?: string): Promise<boolean> {
    const all = await this.readAllRaw();
    const target = all.find((item) => item.id === id);
    if (!target) {
      return false;
    }
    if (userId && target.userId !== userId) {
      throw new ForbiddenException("无权删除该会话");
    }
    const next = all.filter((item) => item.id !== id);
    await this.writeAllRaw(next);
    return true;
  }

  summarizeMessages(messages: MessageLike[]): string {
    const normalized = messages
      .map((item) => {
        const role = String(item.role ?? "unknown").trim() || "unknown";
        const content = String(item.content ?? "").replace(/\s+/g, " ").trim();
        if (!content) {
          return "";
        }
        const clipped = content.length > 240 ? `${content.slice(0, 240)}...` : content;
        return `${role}: ${clipped}`;
      })
      .filter((line) => line.length > 0);
    return normalized.join("\n");
  }
}

