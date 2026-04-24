import { useEffect, useRef, useState } from "react";
import {
  deleteUploadedDocument,
  getUploadJob,
  listUploadedDocuments,
  uploadDocument,
} from "@/api/upload";

type UploadModalProps = {
  open: boolean;
  onClose: () => void;
};

const DIRECT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const DIRECT_UPLOAD_MAX_CHARS = 160000;
const SPLIT_PART_MAX_CHARS = 70000;
const SPLIT_PART_OVERLAP_CHARS = 1000;
const SPLITTABLE_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json"]);

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
  const [uploadDetail, setUploadDetail] = useState("");
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
    setMessage("");
    setUploadDetail("");
    setProgress(0);
    void fetchDocuments();
  }, [open]);

  const handleUpload = async (): Promise<void> => {
    if (!file) {
      setMessage("请先选择文件。");
      return;
    }
    setIsUploading(true);
    setProgress(0);
    setUploadDetail("");
    setMessage("");
    try {
      const resultMessage = await uploadWithAutoSplit(file, (percent, detail) => {
        setProgress(percent);
        setUploadDetail(detail);
      });
      setMessage(resultMessage);
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await fetchDocuments();
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "上传失败，请稍后重试。";
      setMessage(text);
      setUploadDetail(`失败：${text}`);
    } finally {
      setIsUploading(false);
    }
  };

  const uploadWithAutoSplit = async (
    targetFile: File,
    onProgress: (percent: number, detail: string) => void,
  ): Promise<string> => {
    const extension = getFileExtension(targetFile.name);
    let textContent: string | null = null;
    let shouldSplit = targetFile.size > DIRECT_UPLOAD_MAX_BYTES;
    if (SPLITTABLE_EXTENSIONS.has(extension)) {
      if (extension === ".txt" && !(await isUtf8TextFile(targetFile))) {
        throw new Error(
          "检测到该 TXT 不是 UTF-8 编码。请先转为 UTF-8 后再上传，避免分片后出现乱码检索结果。",
        );
      }
      textContent = await targetFile.text();
      shouldSplit = shouldSplit || textContent.length > DIRECT_UPLOAD_MAX_CHARS;
    }

    if (!shouldSplit) {
      const { message: msg, jobId } = await uploadDocument(targetFile, (percent) => {
        onProgress(percent, "单文件上传");
      });
      onProgress(100, "后台处理中...");
      await waitUploadJobDone(jobId, (statusText) => onProgress(100, statusText));
      return msg;
    }

    if (!textContent) {
      throw new Error("当前文件类型暂不支持自动切分，请先手动拆分后上传。");
    }
    const parts = splitTextContent(targetFile.name, textContent);
    if (parts.length === 0) {
      throw new Error("文件切分失败，请检查文本内容。");
    }

    const batchId = `batch-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    for (let i = 0; i < parts.length; i += 1) {
      const partFile = parts[i];
      const partIndex = i + 1;
      const { jobId } = await uploadDocument(
        partFile,
        (partPercent) => {
          const base = i / parts.length;
          const transferStage = (partPercent / 100) * (0.45 / parts.length);
          const aggregate = Math.round((base + transferStage) * 100);
          onProgress(aggregate, `分片传输 ${partIndex}/${parts.length}`);
        },
        {
          batchId,
          partIndex,
          partTotal: parts.length,
          originalFileName: targetFile.name,
        },
      );
      await waitUploadJobDone(jobId, (statusText) => {
        const processedBase = i / parts.length;
        const processingStage = 0.55 / parts.length;
        const aggregate = Math.round((processedBase + processingStage) * 100);
        onProgress(aggregate, `分片处理 ${partIndex}/${parts.length} | ${statusText}`);
      });
      const completed = Math.round(((i + 1) / parts.length) * 100);
      onProgress(completed, `已完成 ${i + 1}/${parts.length}`);
    }
    return `上传成功（自动切分 ${parts.length} 个子文件）`;
  };

  const waitUploadJobDone = async (
    jobId: string,
    onStatus: (statusText: string) => void,
  ): Promise<void> => {
    const timeoutMs = 180000;
    const begin = Date.now();
    while (Date.now() - begin < timeoutMs) {
      const job = await getUploadJob(jobId);
      if (job.status === "done") {
        onStatus("处理完成");
        return;
      }
      if (job.status === "failed") {
        const reason = job.error?.trim() || "后台处理失败，请稍后重试。";
        throw new Error(`上传被拒绝：${reason}`);
      }
      onStatus(job.status === "processing" ? "后台处理中..." : "排队中...");
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    throw new Error("后台处理超时，请稍后查看文档列表确认结果。");
  };

  const getFileExtension = (name: string): string => {
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot).toLowerCase() : "";
  };

  const splitTextContent = (fileName: string, text: string): File[] => {
    if (!text.trim()) {
      return [];
    }
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(text.length, start + SPLIT_PART_MAX_CHARS);
      let piece = text.slice(start, end);
      if (end < text.length) {
        const lastBreak = Math.max(
          piece.lastIndexOf("\n"),
          piece.lastIndexOf("。"),
          piece.lastIndexOf("！"),
          piece.lastIndexOf("？"),
        );
        if (lastBreak > SPLIT_PART_MAX_CHARS * 0.5) {
          piece = piece.slice(0, lastBreak + 1);
        }
      }
      if (piece.trim().length === 0) {
        break;
      }
      chunks.push(piece);
      if (start + piece.length >= text.length) {
        break;
      }
      start = Math.max(0, start + piece.length - SPLIT_PART_OVERLAP_CHARS);
    }

    const ext = getFileExtension(fileName) || ".txt";
    const base = fileName.replace(/\.[^.]+$/, "");
    return chunks.map((chunk, idx) => {
      const partName = `${base}.part-${String(idx + 1).padStart(3, "0")}${ext}`;
      return new File([chunk], partName, { type: "text/plain;charset=utf-8" });
    });
  };

  const isUtf8TextFile = async (targetFile: File): Promise<boolean> => {
    try {
      const buffer = await targetFile.arrayBuffer();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      decoder.decode(buffer);
      return true;
    } catch {
      return false;
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

        {message ? (
          <div
            className={`mt-3 rounded border px-3 py-2 text-sm ${
              /失败|拒绝|错误|超时/.test(message)
                ? "border-rose-500/40 bg-rose-950/40 text-rose-200"
                : "border-emerald-500/30 bg-emerald-950/30 text-emerald-200"
            }`}
          >
            {message}
          </div>
        ) : null}

        {isUploading ? (
          <div className="mt-2 space-y-1">
            <p className="text-xs text-sky-300">
            上传进度：{progress}% {uploadDetail ? `| ${uploadDetail}` : ""}
            </p>
            <div className="h-2 w-full rounded bg-slate-800">
              <div
                className="h-2 rounded bg-sky-500 transition-all"
                style={{ width: `${Math.max(2, progress)}%` }}
              />
            </div>
          </div>
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

      </div>
    </div>
  );
}

export default UploadModal;
