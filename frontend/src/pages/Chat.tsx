import { useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage, streamChat } from "@/api/chat";

function Chat(): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const isInputEmpty = useMemo(() => input.trim().length === 0, [input]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = async (): Promise<void> => {
    if (isInputEmpty || isLoading) {
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const history = [...messages, userMessage];
    setInput("");
    setMessages([...history, { role: "assistant", content: "" }]);
    setIsLoading(true);

    try {
      await streamChat(history, (chunk) => {
        setMessages((prev) => {
          if (prev.length === 0) {
            return [{ role: "assistant", content: chunk }];
          }
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          const last = updated[lastIndex];
          if (last.role === "assistant") {
            updated[lastIndex] = {
              ...last,
              content: `${last.content}${chunk}`,
            };
          } else {
            updated.push({ role: "assistant", content: chunk });
          }
          return updated;
        });
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "对话失败，请稍后重试。";
      setMessages((prev) => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
          updated[lastIndex] = { role: "assistant", content: message };
        } else {
          updated.push({ role: "assistant", content: message });
        }
        return updated;
      });
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <section className="mx-auto max-w-4xl rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
        <h1 className="text-2xl font-bold tracking-tight">普通聊天</h1>

        <p className="mt-2 text-sm text-slate-400">
          该页面直接与大模型对话，不依赖知识库检索。
        </p>

        <section className="mt-6 h-[420px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500">发送第一条消息开始对话。</p>
          ) : (
            <ul className="space-y-3">
              {messages.map((message, index) => (
                <li
                  key={`${message.role}-${index}`}
                  className={`max-w-[85%] rounded-lg p-3 text-sm leading-6 ${
                    message.role === "user"
                      ? "ml-auto bg-sky-600/80 text-white"
                      : "mr-auto bg-slate-800 text-slate-100"
                  }`}
                >
                  <p className="mb-1 text-xs opacity-70">
                    {message.role === "user" ? "你" : "助手"}
                  </p>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </li>
              ))}
            </ul>
          )}
          <div ref={messagesEndRef} />
        </section>

        <div className="mt-4 flex items-end gap-3">
          <textarea
            className="h-24 flex-1 resize-none rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
            placeholder="输入你的问题..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={isLoading || isInputEmpty}
            className="inline-flex h-11 items-center rounded-lg bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
          >
            {isLoading ? "生成中..." : "发送"}
          </button>
        </div>
      </section>
    </main>
  );
}

export default Chat;
