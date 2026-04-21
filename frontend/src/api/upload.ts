import { http } from "./http";

type UploadResponse = {
  code: number;
  message?: string;
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

export async function uploadDocument(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await http.post<UploadResponse>("/upload/document", formData, {
    onUploadProgress: (event) => {
      if (!event.total || !onProgress) {
        return;
      }
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      onProgress(percent);
    },
  });

  if (response.data?.code !== 0) {
    throw new Error(response.data?.message ?? "上传失败，请稍后重试。");
  }

  return response.data.message ?? "上传成功";
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
