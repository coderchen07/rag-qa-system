import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/auth";
import {
  deleteFeedback,
  exportAll,
  getStats,
  type FeedbackExportItem,
  updateEnabled,
} from "@/api/feedback";

function downloadJsonFile(filename: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function FeedbackAdmin(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ total: number; likes: number; dislikes: number }>({
    total: 0,
    likes: 0,
    dislikes: 0,
  });
  const [items, setItems] = useState<FeedbackExportItem[]>([]);
  const [err, setErr] = useState<string>("");
  const [ratingFilter, setRatingFilter] = useState<"" | "like" | "dislike">("");
  const [enabledFilter, setEnabledFilter] = useState<"" | "true" | "false">("");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [pendingEnabledIds, setPendingEnabledIds] = useState<Record<string, boolean>>({});

  const goodRate = useMemo(() => {
    if (stats.total === 0) return 0;
    return Math.round((stats.likes / stats.total) * 10000) / 100;
  }, [stats]);

  const loadData = async (): Promise<void> => {
    setLoading(true);
    setErr("");
    try {
      const s = await getStats();
      setStats(s);
      const all = await exportAll({
        rating: ratingFilter || undefined,
        keyword: keyword || undefined,
        enabled: enabledFilter ? enabledFilter === "true" : undefined,
      });
      setItems(all);
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void loadData();
  }, [isAdmin, ratingFilter, keyword, enabledFilter]);

  const handleExport = async (): Promise<void> => {
    setLoading(true);
    setErr("");
    try {
      const all = await exportAll();
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      downloadJsonFile(`feedbacks-${ts}.json`, all);
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "导出失败");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    const ok = window.confirm("确定删除该反馈？");
    if (!ok) return;
    setLoading(true);
    setErr("");
    try {
      await deleteFeedback(id);
      await loadData();
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "删除失败");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleEnabled = async (item: FeedbackExportItem): Promise<void> => {
    const next = !(item.enabled === true);
    setPendingEnabledIds((prev) => ({ ...prev, [item.id]: true }));
    setErr("");
    try {
      await updateEnabled(item.id, next);
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                enabled: next,
              }
            : entry,
        ),
      );
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "更新启用状态失败");
    } finally {
      setPendingEnabledIds((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  if (!user) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
        <section className="mx-auto max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
          <h1 className="text-lg font-semibold">加载中...</h1>
        </section>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
        <section className="mx-auto max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
          <h1 className="text-lg font-semibold">无权限</h1>
          <p className="mt-2 text-sm text-slate-400">只有管理员可以查看反馈管理。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <section className="mx-auto max-w-5xl rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
        <h1 className="text-2xl font-bold tracking-tight">管理员反馈管理</h1>
        <p className="mt-2 text-sm text-slate-400">用于分析回答质量与用户纠错。</p>

        <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs text-slate-400">总反馈</p>
            <p className="mt-1 text-xl font-semibold">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs text-slate-400">点赞</p>
            <p className="mt-1 text-xl font-semibold text-emerald-300">{stats.likes}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs text-slate-400">点踩</p>
            <p className="mt-1 text-xl font-semibold text-rose-300">{stats.dislikes}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs text-slate-400">好评率</p>
            <p className="mt-1 text-xl font-semibold">
              {stats.total === 0 ? "0%" : `${goodRate}%`}
            </p>
          </div>
        </section>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-300">反馈列表</h2>
          <button
            type="button"
            disabled={loading}
            onClick={handleExport}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-sky-600/60"
          >
            导出数据
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
          <select
            value={ratingFilter}
            onChange={(e) => setRatingFilter(e.target.value as "" | "like" | "dislike")}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
          >
            <option value="">全部评价</option>
            <option value="like">点赞</option>
            <option value="dislike">点踩</option>
          </select>

          <select
            value={enabledFilter}
            onChange={(e) => setEnabledFilter(e.target.value as "" | "true" | "false")}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
          >
            <option value="">全部启用状态</option>
            <option value="true">已启用</option>
            <option value="false">已禁用</option>
          </select>

          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setKeyword(keywordInput.trim());
              }
            }}
            placeholder="按问题/纠错关键词搜索"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
          <button
            type="button"
            onClick={() => setKeyword(keywordInput.trim())}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-100 hover:bg-slate-700"
          >
            搜索
          </button>
        </div>

        {err ? <p className="mt-3 text-sm text-rose-300">{err}</p> : null}

        <section className="mt-3 rounded-lg border border-slate-800 bg-slate-950">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-900/80 text-xs text-slate-300">
                <tr>
                  <th className="px-4 py-2">问题</th>
                  <th className="px-4 py-2">评价</th>
                  <th className="px-4 py-2">纠错</th>
                  <th className="px-4 py-2">时间</th>
                  <th className="px-4 py-2 text-center">启用</th>
                  <th className="px-4 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {items.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-slate-500" colSpan={6}>
                      暂无反馈数据
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr
                      key={item.id}
                      className={[
                        "align-top",
                        item.enabled === true ? "border-l-2 border-l-emerald-500/80" : "",
                      ].join(" ")}
                    >
                      <td className="px-4 py-3">
                        <p className="max-w-[320px] truncate font-medium" title={item.question}>
                          {item.question}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            item.rating === "like"
                              ? "text-emerald-300"
                              : "text-rose-300"
                          }
                        >
                          {item.rating === "like" ? "👍 like" : "👎 dislike"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-200">
                        {item.correction ? (
                          <p className="whitespace-pre-wrap break-words max-w-[520px]">
                            {item.correction}
                          </p>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={item.enabled === true}
                          disabled={Boolean(loading || pendingEnabledIds[item.id])}
                          onChange={() => {
                            void handleToggleEnabled(item);
                          }}
                          className="h-4 w-4 cursor-pointer accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => {
                            void handleDelete(item.id);
                          }}
                          className="text-sm text-rose-300 hover:text-rose-200 disabled:cursor-not-allowed disabled:text-rose-300/50"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

export default FeedbackAdmin;

