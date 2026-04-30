import axios from "axios";
import { http } from "./http";
import { getAuthToken, handleUnauthorized } from "./auth-session";
import type { ChatStreamChunk } from "./chat";

export type SessionListItem = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
};

export type SessionDetail = {
  id: string;
  userId: string;
  title: string;
  messages: SessionMessage[];
  createdAt: string;
  updatedAt: string;
};

type ApiResponse<T> = {
  code: number;
  data: T;
  message?: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export async function createSession(): Promise<SessionDetail> {
  const response = await http.post<ApiResponse<SessionDetail>>("/conversation", {});
  return response.data.data;
}

export async function listSessions(): Promise<SessionListItem[]> {
  const response = await http.get<ApiResponse<SessionListItem[]>>("/conversation");
  return response.data.data ?? [];
}

export async function getSession(id: string): Promise<SessionDetail> {
  const response = await http.get<ApiResponse<SessionDetail>>(`/conversation/${id}`);
  return response.data.data;
}

export async function deleteSession(id: string): Promise<void> {
  await http.delete(`/conversation/${id}`);
}

export async function sendMessage(
  sessionId: string,
  content: string,
  onChunk: (chunk: ChatStreamChunk) => void,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/ai/chat/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken() || localStorage.getItem("rag_auth_token") || ""}`,
    },
    body: JSON.stringify({
      sessionId,
      message: { content },
    }),
  });

  if (response.status === 401) {
    handleUnauthorized();
    throw new Error("登录状态已失效，请重新登录。");
  }

  if (!response.ok) {
    throw new Error(`聊天请求失败（${response.status}）`);
  }

  if (!response.body) {
    throw new Error("聊天流为空，请稍后重试。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventBlock of events) {
      const lines = eventBlock
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const eventNameLine = lines.find((line) => line.startsWith("event:"));
      const dataLine = lines.find((line) => line.startsWith("data:"));
      const eventName = eventNameLine?.replace("event:", "").trim();
      const data = dataLine?.replace("data:", "").trim();

      if (!data) {
        continue;
      }

      if (eventName === "done" || data === "[DONE]") {
        return;
      }

      if (eventName === "error") {
        try {
          const payload = JSON.parse(data) as { message?: string };
          throw new Error(payload.message ?? "聊天流返回异常。");
        } catch (error: unknown) {
          if (error instanceof Error) {
            throw error;
          }
          throw new Error("聊天流返回异常。");
        }
      }

      try {
        const payload = JSON.parse(data) as { content?: string };
        if (!payload.content) {
          continue;
        }
        if (payload.content.startsWith("🔧")) {
          onChunk({ type: "tool-status", content: payload.content });
        } else {
          onChunk({ type: "content", content: payload.content });
        }
      } catch {
        // Ignore malformed event payloads to keep streaming robust.
      }
    }
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as { message?: string } | undefined)?.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
