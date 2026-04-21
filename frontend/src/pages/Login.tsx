import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "@/api/auth";
import { useAuthStore } from "@/store/auth";

function Login(): JSX.Element {
  const navigate = useNavigate();
  const token = useAuthStore((state) => state.token);
  const setAuth = useAuthStore((state) => state.setAuth);
  useEffect(() => {
    if (token) {
      navigate("/rag", { replace: true });
    }
  }, [navigate, token]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("请输入用户名和密码。");
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const result = await login(username.trim(), password.trim());
      setAuth({ token: result.token, user: result.user });
      navigate("/rag", { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "登录失败，请稍后重试。";
      setError(message);
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-lg"
      >
        <h1 className="text-2xl font-bold">登录 RAG 系统</h1>
        <p className="mt-2 text-sm text-slate-400">请输入账号与密码登录系统。</p>

        <div className="mt-5 space-y-3">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="用户名"
            className="w-full rounded border border-slate-700 bg-slate-950 p-3 text-sm outline-none focus:border-sky-500"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="密码"
            className="w-full rounded border border-slate-700 bg-slate-950 p-3 text-sm outline-none focus:border-sky-500"
          />
        </div>

        {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}

        <button
          type="submit"
          disabled={isLoading}
          className="mt-5 w-full rounded bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:bg-slate-700"
        >
          {isLoading ? "登录中..." : "登录"}
        </button>
      </form>
    </main>
  );
}

export default Login;
