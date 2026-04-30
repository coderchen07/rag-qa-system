import { useEffect, useMemo, useState } from "react";
import { useRagStore } from "@/store/rag";
import { submitFeedback } from "@/api/feedback";

function RAG(): JSX.Element {
  const question = useRagStore((state) => state.question);
  const answer = useRagStore((state) => state.answer);
  const evidence = useRagStore((state) => state.evidence);
  const sources = useRagStore((state) => state.sources);
  const meta = useRagStore((state) => state.meta);
  const correctionUsed = useRagStore((state) => state.correctionUsed);
  const isLoading = useRagStore((state) => state.isLoading);
  const setQuestion = useRagStore((state) => state.setQuestion);
  const retrieve = useRagStore((state) => state.retrieve);

  const [feedbackGiven, setFeedbackGiven] = useState<"like" | "dislike" | null>(null);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const isQuestionEmpty = useMemo(
    () => question.trim().length === 0,
    [question],
  );

  useEffect(() => {
    setFeedbackGiven(null);
    setShowCorrection(false);
    setCorrectionDraft("");
    setIsSubmittingFeedback(false);
    setShowSources(false);
  }, [question, answer]);

  const visibleSources = useMemo(
    () => sources.filter((item) => Number.isFinite(item.score) && item.score > 0.3),
    [sources],
  );

  const handleAsk = async (): Promise<void> => {
    if (isQuestionEmpty) {
      return;
    }
    await retrieve();
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <section className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
        <h1 className="text-2xl font-bold tracking-tight">RAG 问答</h1>
        <p className="mt-2 text-sm text-slate-400">
          输入问题后，系统将基于知识库检索上下文并生成回答。
        </p>

        <div className="mt-6 space-y-3">
          <label htmlFor="rag-question" className="text-sm font-medium">
            你的问题
          </label>
          <textarea
            id="rag-question"
            className="h-36 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
            placeholder="例如：什么是 RAG？它和普通聊天有什么区别？"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          {isQuestionEmpty ? (
            <p className="text-xs text-amber-400">请输入问题后再发起提问。</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleAsk}
          disabled={isLoading || isQuestionEmpty}
          className="mt-4 inline-flex items-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
        >
          {isLoading ? "提问中..." : "提问"}
        </button>

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-300">回答结果</h2>
          {answer ? (
            <>
              {correctionUsed ? (
                <div className="mt-2 inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-xs text-sky-200">
                  ✨ 已参考历史纠错
                </div>
              ) : null}
              <article className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm leading-7 text-slate-100">
                {answer}
              </article>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              暂无回答，先输入问题并点击提问。
            </p>
          )}

          {answer && !isLoading ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={feedbackGiven !== null || isSubmittingFeedback}
                onClick={async () => {
                  if (!question || !answer) return;
                  setIsSubmittingFeedback(true);
                  try {
                    await submitFeedback({
                      question,
                      answer,
                      context: evidence.map((e) => e.snippet),
                      rating: "like",
                    });
                    setFeedbackGiven("like");
                  } finally {
                    setIsSubmittingFeedback(false);
                  }
                }}
                className={[
                  "rounded-lg px-2 py-1 text-xs transition",
                  feedbackGiven === "like"
                    ? "bg-emerald-600/80 text-white"
                    : "bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-800/50 disabled:text-slate-400",
                ].join(" ")}
              >
                👍 有帮助
              </button>

              <button
                type="button"
                disabled={feedbackGiven !== null || isSubmittingFeedback}
                onClick={() => {
                  if (feedbackGiven !== null) return;
                  setShowCorrection(true);
                }}
                className={[
                  "rounded-lg px-2 py-1 text-xs transition",
                  feedbackGiven === "dislike"
                    ? "bg-rose-600/80 text-white"
                    : "bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-800/50 disabled:text-slate-400",
                ].join(" ")}
              >
                👎 无帮助
              </button>
            </div>
          ) : null}

          {answer && showCorrection && !isLoading ? (
            <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
              <p className="mb-2 text-xs text-rose-200">填写正确回答（可选）</p>
              <textarea
                className="h-20 w-full resize-none rounded-lg border border-rose-500/20 bg-slate-950 p-2 text-xs text-slate-100 outline-none focus:border-rose-500/60"
                value={correctionDraft}
                onChange={(e) => setCorrectionDraft(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={isSubmittingFeedback}
                  onClick={async () => {
                    if (!question || !answer) return;
                    setIsSubmittingFeedback(true);
                    try {
                      await submitFeedback({
                        question,
                        answer,
                        context: evidence.map((e) => e.snippet),
                        rating: "dislike",
                        correction: correctionDraft.trim() ? correctionDraft.trim() : undefined,
                      });
                      setFeedbackGiven("dislike");
                      setShowCorrection(false);
                      setCorrectionDraft("");
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
                    setShowCorrection(false);
                    setCorrectionDraft("");
                  }}
                  className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-800/50"
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {answer && visibleSources.length > 0 ? (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
              <button
                type="button"
                onClick={() => setShowSources((prev) => !prev)}
                className="text-xs text-slate-300 hover:text-slate-100"
              >
                📚 参考来源 {showSources ? "▲" : "▼"}
              </button>
              {showSources ? (
                <ul className="mt-2 space-y-1">
                  {visibleSources.map((item, idx) => (
                    <li
                      key={`${item.title}-${idx}`}
                      className="flex items-center justify-between text-xs text-slate-300"
                    >
                      <span className="truncate pr-3">{item.title}</span>
                      <span className="text-slate-400">{item.score.toFixed(3)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>

        {evidence.length > 0 ? (
          <section className="mt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300">证据片段</h3>
              {meta?.mode ? (
                <span className="text-xs text-slate-400">模式：{meta.mode}</span>
              ) : null}
            </div>
            <ul className="mt-2 space-y-2">
              {evidence.map((item, idx) => (
                <li
                  key={`${item.title}-${idx}`}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-3"
                >
                  <p className="text-xs text-sky-300">
                    {item.title}
                    {typeof item.chunkIndex === "number" ? ` · chunk #${item.chunkIndex}` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">
                    {item.snippet}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </main>
  );
}

export default RAG;
