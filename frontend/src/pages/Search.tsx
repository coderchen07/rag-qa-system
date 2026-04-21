import { useState } from "react";
import { searchTitles } from "@/api/search";

function Search(): JSX.Element {
  const [keyword, setKeyword] = useState<string>("");
  const [results, setResults] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const isKeywordEmpty = keyword.trim().length === 0;

  const handleSearch = async (): Promise<void> => {
    if (isKeywordEmpty) {
      setError("请输入关键词后再搜索。");
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const titles = await searchTitles(keyword);
      setResults(titles);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "搜索失败，请稍后重试。";
      setResults([]);
      setError(message);
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <section className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
        <h1 className="text-2xl font-bold tracking-tight">文档语义搜索</h1>

        <p className="mt-2 text-sm text-slate-400">
          输入关键词，检索知识库中最相关的文档标题。
        </p>

        <div className="mt-6 space-y-3">
          <label htmlFor="search-keyword" className="text-sm font-medium">
            搜索关键词
          </label>
          <input
            id="search-keyword"
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="例如：RAG"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
          />
        </div>

        <button
          type="button"
          onClick={handleSearch}
          disabled={isLoading || isKeywordEmpty}
          className="mt-4 inline-flex items-center rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
        >
          {isLoading ? "搜索中..." : "搜索"}
        </button>

        {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-300">检索结果</h2>
          {results.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {results.map((title) => (
                <li
                  key={title}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm"
                >
                  {title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              未找到相关文档，请尝试更具体的关键词。
            </p>
          )}
        </section>
      </section>
    </main>
  );
}

export default Search;
