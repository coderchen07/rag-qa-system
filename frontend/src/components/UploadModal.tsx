import { useEffect, useRef, useState } from "react";
import {
  deleteUploadedDocument,
  listUploadedDocuments,
  uploadDocument,
} from "@/api/upload";

type UploadModalProps = {
  open: boolean;
  onClose: () => void;
};

function UploadModal({ open, onClose }: UploadModalProps): JSX.Element | null {
  const [documents, setDocuments] = useState<
    Array<{
      uploadId: string;
      title: string;
      source: string;
      uploadedAt: string;
      chunkCount: number;
    }>
  >([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  const fetchDocuments = async (): Promise<void> => {
    setIsLoadingDocuments(true);
    try {
      const list = await listUploadedDocuments();
      setDocuments(list);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "加载已上传文档失败。";
      setMessage(text);
    } finally {
      setIsLoadingDocuments(false);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    void fetchDocuments();
  }, [open]);

  const handleUpload = async (): Promise<void> => {
    if (!file) {
      setMessage("请先选择文件。");
      return;
    }
    setIsUploading(true);
    setProgress(0);
    setMessage("");
    try {
      const resultMessage = await uploadDocument(file, setProgress);
      setMessage(resultMessage);
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await fetchDocuments();
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "上传失败，请稍后重试。";
      setMessage(text);
      alert(text);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (uploadId: string): Promise<void> => {
    setDeletingId(uploadId);
    setMessage("");
    try {
      const text = await deleteUploadedDocument(uploadId);
      setMessage(text);
      await fetchDocuments();
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "删除失败，请稍后重试。";
      setMessage(text);
      alert(text);
    } finally {
      setDeletingId("");
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">上传知识文档</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-slate-800 px-2 py-1 text-sm hover:bg-slate-700"
          >
            关闭
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.csv,.json,.md"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm"
        />

        <p className="mt-2 text-xs text-slate-400">
          支持 .pdf/.docx/.txt/.csv/.json/.md，单文件最大 20MB。
        </p>

        {isUploading ? (
          <p className="mt-2 text-xs text-sky-300">上传进度：{progress}%</p>
        ) : null}

        <button
          type="button"
          onClick={handleUpload}
          disabled={isUploading}
          className="mt-4 rounded bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700"
        >
          {isUploading ? "上传中..." : "开始上传"}
        </button>

        <section className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">已上传文档管理</h3>
            <button
              type="button"
              onClick={() => void fetchDocuments()}
              disabled={isLoadingDocuments}
              className="rounded bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700 disabled:opacity-60"
            >
              刷新
            </button>
          </div>

          {isLoadingDocuments ? (
            <p className="text-xs text-slate-400">加载中...</p>
          ) : documents.length === 0 ? (
            <p className="text-xs text-slate-400">暂无已上传文档。</p>
          ) : (
            <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {documents.map((item) => (
                <li
                  key={item.uploadId}
                  className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title || item.uploadId}</p>
                    <p className="truncate text-xs text-slate-400">
                      来源: {item.source || "-"} | 分块: {item.chunkCount}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(item.uploadId)}
                    disabled={deletingId === item.uploadId}
                    className="ml-3 rounded bg-rose-600 px-2 py-1 text-xs text-white hover:bg-rose-500 disabled:bg-slate-700"
                  >
                    {deletingId === item.uploadId ? "删除中..." : "删除"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {message ? <p className="mt-3 text-sm text-slate-200">{message}</p> : null}
      </div>
    </div>
  );
}

export default UploadModal;
