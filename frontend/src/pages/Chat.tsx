import { useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage, ChatStreamChunk } from "@/api/chat";
import {
  SessionListItem,
  createSession,
  deleteSession,
  getApiErrorMessage,
  getSession,
  listSessions,
  sendMessage,
} from "@/api/conversation";
import { submitFeedback } from "@/api/feedback";
import SessionList from "@/components/SessionList";

function Chat(): JSX.Element {
  const TOOL_STATUS_MIN_VISIBLE_MS = 400;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSessionListLoading, setIsSessionListLoading] = useState<boolean>(true);
  const [isSessionLoading, setIsSessionLoading] = useState<boolean>(false);
  const [showSidebarOnMobile, setShowSidebarOnMobile] = useState<boolean>(false);
  const [input, setInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [toolStatus, setToolStatus] = useState<string>("");
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, "like" | "dislike">>({});
  const [correctionDraftByIndex, setCorrectionDraftByIndex] = useState<Record<number, string>>({});
  const [showCorrectionFor, setShowCorrectionFor] = useState<number | null>(null);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const toolStatusShownAtRef = useRef<number | null>(null);
  const toolStatusTimerRef = useRef<number | null>(null);
  const bufferedAssistantChunksRef = useRef<string[]>([]);
  const loadingSessionRef = useRef<string | null>(null);

  const isInputEmpty = useMemo(() => input.trim().length === 0, [input]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, toolStatus]);

  const appendAssistantChunk = (chunk: string): void => {
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
  };

  const flushBufferedAssistantChunks = (): void => {
    if (bufferedAssistantChunksRef.current.length === 0) {
      return;
    }
    const merged = bufferedAssistantChunksRef.current.join("");
    bufferedAssistantChunksRef.current = [];
    appendAssistantChunk(merged);
  };

  const clearToolStatusTimer = (): void => {
    if (toolStatusTimerRef.current !== null) {
      window.clearTimeout(toolStatusTimerRef.current);
      toolStatusTimerRef.current = null;
    }
  };

  const deriveTitleFromFirstUserMessage = (content: string): string => content.trim().slice(0, 30);

  const applySessionMessages = (sessionMessages: Array<{ role: string; content: string }>): void => {
    const nextMessages: ChatMessage[] = sessionMessages
      .filter((item) => item.role === "user" || item.role === "assistant")
      .map((item) => ({
        role: item.role as ChatMessage["role"],
        content: item.content,
      }));
    setMessages(nextMessages);
    setFeedbackGiven({});
    setCorrectionDraftByIndex({});
    setShowCorrectionFor(null);
    setToolStatus("");
    clearToolStatusTimer();
    toolStatusShownAtRef.current = null;
    bufferedAssistantChunksRef.current = [];
  };

  const sortSessionsByUpdatedAt = (list: SessionListItem[]): SessionListItem[] =>
    [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const loadSession = async (sessionId: string): Promise<void> => {
    loadingSessionRef.current = sessionId;
    setIsSessionLoading(true);
    try {
      const detail = await getSession(sessionId);
      if (loadingSessionRef.current !== sessionId) {
        return;
      }
      setActiveSessionId(sessionId);
      applySessionMessages(detail.messages);
      setSessions((prev) =>
        sortSessionsByUpdatedAt(
          prev.map((item) =>
            item.id === sessionId
              ? {
                  ...item,
                  title: detail.title,
                  updatedAt: detail.updatedAt,
                }
              : item,
          ),
        ),
      );
    } catch (error: unknown) {
      alert(getApiErrorMessage(error, "加载会话失败，请稍后重试。"));
    } finally {
      if (loadingSessionRef.current === sessionId) {
        setIsSessionLoading(false);
      }
    }
  };

  const handleCreateSession = async (): Promise<void> => {
    if (isLoading) {
      return;
    }
    try {
      const created = await createSession();
      const listItem: SessionListItem = {
        id: created.id,
        title: created.title,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
      setSessions((prev) => sortSessionsByUpdatedAt([listItem, ...prev]));
      setActiveSessionId(created.id);
      setMessages([]);
      setFeedbackGiven({});
      setCorrectionDraftByIndex({});
      setShowCorrectionFor(null);
      setShowSidebarOnMobile(false);
    } catch (error: unknown) {
      alert(getApiErrorMessage(error, "创建会话失败，请稍后重试。"));
    }
  };

  const handleSelectSession = async (sessionId: string): Promise<void> => {
    if (sessionId === activeSessionId) {
      setShowSidebarOnMobile(false);
      return;
    }
    setShowSidebarOnMobile(false);
    await loadSession(sessionId);
  };

  const handleDeleteSession = async (sessionId: string): Promise<void> => {
    if (!window.confirm("确认删除该会话吗？删除后不可恢复。")) {
      return;
    }
    try {
      await deleteSession(sessionId);
      const nextSessions = sessions.filter((item) => item.id !== sessionId);
      setSessions(nextSessions);
      if (activeSessionId !== sessionId) {
        return;
      }
      if (nextSessions.length === 0) {
        const created = await createSession();
        setSessions([
          {
            id: created.id,
            title: created.title,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          },
        ]);
        setActiveSessionId(created.id);
        setMessages([]);
      } else {
        await loadSession(nextSessions[0].id);
      }
    } catch (error: unknown) {
      alert(getApiErrorMessage(error, "删除会话失败，请稍后重试。"));
    }
  };

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async (): Promise<void> => {
      setIsSessionListLoading(true);
      try {
        const list = sortSessionsByUpdatedAt(await listSessions());
        if (cancelled) {
          return;
        }
        if (list.length === 0) {
          const created = await createSession();
          if (cancelled) {
            return;
          }
          const createdItem: SessionListItem = {
            id: created.id,
            title: created.title,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          };
          setSessions([createdItem]);
          setActiveSessionId(created.id);
          applySessionMessages(created.messages);
        } else {
          setSessions(list);
          await loadSession(list[0].id);
        }
      } catch (error: unknown) {
        alert(getApiErrorMessage(error, "加载会话列表失败，请稍后重试。"));
      } finally {
        if (!cancelled) {
          setIsSessionListLoading(false);
        }
      }
    };
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSend = async (): Promise<void> => {
    if (isInputEmpty || isLoading || !activeSessionId) {
      return;
    }

    const content = input.trim();
    const userMessage: ChatMessage = { role: "user", content };
    setInput("");
    setToolStatus("");
    toolStatusShownAtRef.current = null;
    bufferedAssistantChunksRef.current = [];
    clearToolStatusTimer();
    setMessages((prev) => [...prev, userMessage, { role: "assistant", content: "" }]);
    setIsLoading(true);

    try {
      await sendMessage(activeSessionId, content, (chunk: ChatStreamChunk) => {
        if (chunk.type === "tool-status") {
          setToolStatus(chunk.content.trim());
          toolStatusShownAtRef.current = Date.now();
          clearToolStatusTimer();
          return;
        }
        const shownAt = toolStatusShownAtRef.current;
        if (shownAt !== null) {
          const elapsed = Date.now() - shownAt;
          if (elapsed < TOOL_STATUS_MIN_VISIBLE_MS) {
            bufferedAssistantChunksRef.current.push(chunk.content);
            if (toolStatusTimerRef.current === null) {
              const remaining = TOOL_STATUS_MIN_VISIBLE_MS - elapsed;
              toolStatusTimerRef.current = window.setTimeout(() => {
                setToolStatus("");
                toolStatusShownAtRef.current = null;
                toolStatusTimerRef.current = null;
                flushBufferedAssistantChunks();
              }, remaining);
            }
            return;
          }
          setToolStatus("");
          toolStatusShownAtRef.current = null;
        }
        appendAssistantChunk(chunk.content);
      });

      setSessions((prev) =>
        sortSessionsByUpdatedAt(
          prev.map((item) => {
            if (item.id !== activeSessionId) {
              return item;
            }
            const shouldFillTitle = !item.title || item.title.trim().length === 0;
            return {
              ...item,
              title: shouldFillTitle ? deriveTitleFromFirstUserMessage(content) : item.title,
              updatedAt: new Date().toISOString(),
            };
          }),
        ),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "对话失败，请稍后重试。";
      clearToolStatusTimer();
      toolStatusShownAtRef.current = null;
      bufferedAssistantChunksRef.current = [];
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
      setToolStatus("");
      alert(message);
    } finally {
      clearToolStatusTimer();
      flushBufferedAssistantChunks();
      toolStatusShownAtRef.current = null;
      setToolStatus("");
      setIsLoading(false);
    }
  };

  const questionForAssistantIndex = (assistantIndex: number): string => {
    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        return messages[i].content;
      }
    }
    return "";
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <section className="mx-auto flex max-w-6xl gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-xl md:p-6">
        <div
          className={[
            "fixed inset-0 z-20 bg-slate-950/70 p-3 md:static md:inset-auto md:bg-transparent md:p-0",
            showSidebarOnMobile ? "block" : "hidden md:block",
          ].join(" ")}
        >
          <SessionList
            sessions={sessions}
            activeSessionId={activeSessionId}
            isLoading={isSessionListLoading}
            onCreate={handleCreateSession}
            onSelect={handleSelectSession}
            onDelete={handleDeleteSession}
          />
          <button
            type="button"
            onClick={() => setShowSidebarOnMobile(false)}
            className="mt-2 w-full rounded-lg border border-slate-700 py-2 text-xs text-slate-300 md:hidden"
          >
            关闭
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">普通聊天</h1>
              <p className="mt-1 text-sm text-slate-400">按会话保存历史，可切换多对话线程。</p>
            </div>
            <button
              type="button"
              onClick={() => setShowSidebarOnMobile(true)}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 md:hidden"
            >
              会话列表
            </button>
          </div>

          <section className="h-[420px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-4">
            {isSessionLoading ? (
              <p className="text-sm text-slate-500">正在加载会话历史...</p>
            ) : messages.length === 0 && !toolStatus ? (
              <p className="text-sm text-slate-500">发送第一条消息开始对话。</p>
            ) : (
              <ul className="space-y-3">
                {toolStatus ? (
                  <li className="mx-auto max-w-[90%] rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                    <p className="mb-1 text-xs opacity-80">系统状态</p>
                    <p className="whitespace-pre-wrap">{toolStatus}</p>
                  </li>
                ) : null}
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

                    {message.role === "assistant" ? (
                      <>
                        {isLoading && index === messages.length - 1 ? null : message.content.trim().length > 0 ? (
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              disabled={
                                isSubmittingFeedback ||
                                feedbackGiven[index] !== undefined
                              }
                              onClick={async () => {
                                if (feedbackGiven[index]) return;
                                const q = questionForAssistantIndex(index);
                                const a = message.content;
                                if (!q || !a) return;
                                setIsSubmittingFeedback(true);
                                try {
                                  await submitFeedback({
                                    question: q,
                                    answer: a,
                                    context: [],
                                    rating: "like",
                                  });
                                  setFeedbackGiven((prev) => ({
                                    ...prev,
                                    [index]: "like",
                                  }));
                                } finally {
                                  setIsSubmittingFeedback(false);
                                }
                              }}
                              className={[
                                "rounded-lg px-2 py-1 text-xs transition",
                                feedbackGiven[index] === "like"
                                  ? "bg-emerald-600/80 text-white"
                                  : "bg-slate-900/40 text-slate-200 hover:bg-slate-900/60 disabled:cursor-not-allowed disabled:text-slate-400",
                              ].join(" ")}
                            >
                              👍 有帮助
                            </button>
                            <button
                              type="button"
                              disabled={
                                isSubmittingFeedback ||
                                feedbackGiven[index] !== undefined
                              }
                              onClick={() => {
                                if (feedbackGiven[index]) return;
                                setShowCorrectionFor(index);
                              }}
                              className={[
                                "rounded-lg px-2 py-1 text-xs transition",
                                feedbackGiven[index] === "dislike"
                                  ? "bg-rose-600/80 text-white"
                                  : "bg-slate-900/40 text-slate-200 hover:bg-slate-900/60 disabled:cursor-not-allowed disabled:text-slate-400",
                              ].join(" ")}
                            >
                              👎 无帮助
                            </button>
                          </div>
                        ) : null}

                        {showCorrectionFor === index ? (
                          <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
                            <p className="mb-2 text-xs text-rose-200">填写正确回答（可选）</p>
                            <textarea
                              className="h-20 w-full resize-none rounded-lg border border-rose-500/20 bg-slate-950 p-2 text-xs text-slate-100 outline-none focus:border-rose-500/60"
                              value={correctionDraftByIndex[index] ?? ""}
                              onChange={(e) =>
                                setCorrectionDraftByIndex((prev) => ({
                                  ...prev,
                                  [index]: e.target.value,
                                }))
                              }
                            />
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                disabled={isSubmittingFeedback}
                                onClick={async () => {
                                  const q = questionForAssistantIndex(index);
                                  const a = message.content;
                                  if (!q || !a) return;
                                  const correction = (correctionDraftByIndex[index] ?? "").trim();
                                  setIsSubmittingFeedback(true);
                                  try {
                                    await submitFeedback({
                                      question: q,
                                      answer: a,
                                      context: [],
                                      rating: "dislike",
                                      correction: correction ? correction : undefined,
                                    });
                                    setFeedbackGiven((prev) => ({
                                      ...prev,
                                      [index]: "dislike",
                                    }));
                                    setShowCorrectionFor(null);
                                    setCorrectionDraftByIndex((prev) => ({
                                      ...prev,
                                      [index]: "",
                                    }));
                                  } finally {
                                    setIsSubmittingFeedback(false);
                                  }
                                }}
                                className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-rose-600/60"
                              >
                                提交纠错
                              </button>
                              <button
                                type="button"
                                disabled={isSubmittingFeedback}
                                onClick={() => {
                                  setShowCorrectionFor(null);
                                  setCorrectionDraftByIndex((prev) => ({
                                    ...prev,
                                    [index]: "",
                                  }));
                                }}
                                className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-800/50"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div ref={messagesEndRef} />
          </section>

          <div className="mt-4 flex items-end gap-3">
            <textarea
              className="h-24 flex-1 resize-none rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
              placeholder={activeSessionId ? "输入你的问题..." : "正在准备会话..."}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isLoading || isInputEmpty || !activeSessionId}
              className="inline-flex h-11 items-center rounded-lg bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
            >
              {isLoading ? "生成中..." : "发送"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default Chat;
