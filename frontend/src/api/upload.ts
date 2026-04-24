import { http } from "./http";
import axios from "axios";

type UploadResponse = {
  code: number;
  message?: string;
  data?: {
    jobId: string;
    status: "queued" | "processing" | "done" | "failed";
  };
};

type UploadedDocumentItem = {
  uploadId: string;
  title: string;
  source: string;
  uploadedAt: string;
  chunkCount: number;
};

type UploadedDocumentListResponse = {
  code: number;
  data?: UploadedDocumentItem[];
  message?: string;
};

type DeleteUploadedDocumentResponse = {
  code: number;
  message?: string;
};

type UploadJobResponse = {
  code: number;
  data?: {
    jobId: string;
    status: "queued" | "processing" | "done" | "failed";
    error?: string;
  };
  message?: string;
};

export async function uploadDocument(
  file: File,
  onProgress?: (percent: number) => void,
  batchMeta?: {
    batchId: string;
    partIndex: number;
    partTotal: number;
    originalFileName: string;
  },
): Promise<{ message: string; jobId: string }> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    if (batchMeta) {
      formData.append("batchId", batchMeta.batchId);
      formData.append("partIndex", String(batchMeta.partIndex));
      formData.append("partTotal", String(batchMeta.partTotal));
      formData.append("originalFileName", batchMeta.originalFileName);
    }

    const response = await http.post<UploadResponse>("/upload/document", formData, {
      onUploadProgress: (event) => {
        if (!event.total || !onProgress) {
          return;
        }
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        onProgress(percent);
      },
    });

    if (response.data?.code !== 0 || !response.data?.data?.jobId) {
      throw new Error(response.data?.message ?? "上传失败，请稍后重试。");
    }

    return {
      message: response.data.message ?? "上传成功",
      jobId: response.data.data.jobId,
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const backendMessage =
        (error.response?.data as { message?: string } | undefined)?.message ??
        error.message ??
        "上传失败，请稍后重试。";
      throw new Error(backendMessage);
    }
    throw error instanceof Error ? error : new Error("上传失败，请稍后重试。");
  }
}

export async function getUploadJob(
  jobId: string,
): Promise<{ status: "queued" | "processing" | "done" | "failed"; error?: string }> {
  const response = await http.get<UploadJobResponse>(`/upload/jobs/${encodeURIComponent(jobId)}`);
  if (response.data?.code !== 0 || !response.data?.data) {
    throw new Error(response.data?.message ?? "获取上传任务状态失败。");
  }
  return {
    status: response.data.data.status,
    error: response.data.data.error,
  };
}

export async function listUploadedDocuments(): Promise<UploadedDocumentItem[]> {
  const response = await http.get<UploadedDocumentListResponse>("/upload/documents");
  if (response.data?.code !== 0) {
    throw new Error(response.data?.message ?? "获取已上传文档列表失败。");
  }
  return Array.isArray(response.data?.data) ? response.data.data : [];
}

export async function deleteUploadedDocument(uploadId: string): Promise<string> {
  const response = await http.delete<DeleteUploadedDocumentResponse>(
    `/upload/document/${encodeURIComponent(uploadId)}`,
  );
  if (response.data?.code !== 0) {
    throw new Error(response.data?.message ?? "删除文档失败。");
  }
  return response.data.message ?? "删除成功";
}
