import { getAuthToken, handleUnauthorized } from "./auth-session";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export async function streamChat(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken() || localStorage.getItem("rag_auth_token") || ""}`,
    },
    body: JSON.stringify({ messages }),
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
        if (payload.content) {
          onChunk(payload.content);
        }
      } catch {
        // Ignore malformed event payloads to keep streaming robust.
      }
    }
  }
}
