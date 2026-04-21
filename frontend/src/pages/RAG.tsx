import { useMemo } from "react";
import { useRagStore } from "@/store/rag";

function RAG(): JSX.Element {
  const question = useRagStore((state) => state.question);
  const answer = useRagStore((state) => state.answer);
  const isLoading = useRagStore((state) => state.isLoading);
  const setQuestion = useRagStore((state) => state.setQuestion);
  const retrieve = useRagStore((state) => state.retrieve);

  const isQuestionEmpty = useMemo(
    () => question.trim().length === 0,
    [question],
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
            <article className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm leading-7 text-slate-100">
              {answer}
            </article>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              暂无回答，先输入问题并点击提问。
            </p>
          )}
        </section>
      </section>
    </main>
  );
}

export default RAG;
