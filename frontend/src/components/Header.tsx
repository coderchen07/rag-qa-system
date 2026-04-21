import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import UploadModal from "./UploadModal";
import { useAuthStore } from "@/store/auth";

function Header(): JSX.Element {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [openUpload, setOpenUpload] = useState(false);

  const handleLogout = (): void => {
    clearAuth();
    navigate("/login", { replace: true });
  };

  return (
    <>
      <header className="border-b border-slate-800 bg-slate-950/90">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 text-slate-100">
          <div className="flex items-center gap-4 text-sm">
            <Link to="/rag" className="font-medium hover:text-sky-300">
              RAG 问答
            </Link>
            <Link to="/search" className="font-medium hover:text-sky-300">
              文档搜索
            </Link>
            <Link to="/chat" className="font-medium hover:text-sky-300">
              普通聊天
            </Link>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300">
              {user?.username}（{user?.role}）
            </span>
            {user?.role === "admin" ? (
              <button
                type="button"
                onClick={() => setOpenUpload(true)}
                className="rounded bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500"
              >
                上传文档
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded bg-slate-800 px-3 py-1.5 hover:bg-slate-700"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <UploadModal open={openUpload} onClose={() => setOpenUpload(false)} />
    </>
  );
}

export default Header;
