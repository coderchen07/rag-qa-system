import { SessionListItem } from "@/api/conversation";

type SessionListProps = {
  sessions: SessionListItem[];
  activeSessionId: string | null;
  isLoading: boolean;
  onCreate: () => void;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
};

function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SessionList({
  sessions,
  activeSessionId,
  isLoading,
  onCreate,
  onSelect,
  onDelete,
}: SessionListProps): JSX.Element {
  return (
    <aside className="w-[280px] shrink-0 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      <button
        type="button"
        onClick={onCreate}
        className="mb-3 w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-500"
      >
        + 新建对话
      </button>

      <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
        {isLoading ? (
          <p className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
            正在加载会话...
          </p>
        ) : sessions.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-500">
            暂无会话，点击上方按钮创建。
          </p>
        ) : (
          sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                className={[
                  "group rounded-lg border p-3 transition",
                  isActive
                    ? "border-sky-500/70 bg-sky-500/10"
                    : "border-slate-800 bg-slate-950/40 hover:border-slate-700",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  className="block w-full text-left"
                >
                  <p className="truncate text-sm font-medium text-slate-100">
                    {session.title?.trim() || "未命名对话"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{formatTime(session.updatedAt)}</p>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(session.id)}
                  className="mt-2 rounded px-2 py-1 text-xs text-rose-300 opacity-0 transition hover:bg-rose-500/10 group-hover:opacity-100"
                  title="删除会话"
                >
                  删除
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

export default SessionList;
