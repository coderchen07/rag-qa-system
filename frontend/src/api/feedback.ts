import axios from "axios";
import { http } from "./http";

export type SubmitFeedbackPayload = {
  question: string;
  answer: string;
  context?: string[];
  rating: "like" | "dislike";
  correction?: string;
};

export async function submitFeedback(
  data: SubmitFeedbackPayload,
): Promise<void> {
  try {
    const response = await http.post<{
      code: number;
      message: string;
    }>("/feedback", data);

    if (response.data?.code !== 0) {
      throw new Error(response.data?.message ?? "提交反馈失败");
    }
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const message =
        (error.response?.data as { message?: string } | undefined)?.message ??
        "请求失败，请稍后重试。";
      throw new Error(message);
    }
    throw new Error("请求失败，请稍后重试。");
  }
}

export async function getStats(): Promise<{
  total: number;
  likes: number;
  dislikes: number;
}> {
  const response = await http.get<{
    code: number;
    data: { total: number; likes: number; dislikes: number };
    message?: string;
  }>("/feedback/stats");

  if (response.data?.code !== 0) {
    throw new Error(response.data?.message ?? "获取反馈统计失败");
  }

  return response.data.data;
}

export type FeedbackExportItem = {
  id: string;
  question: string;
  answer: string;
  context: string[];
  rating: "like" | "dislike";
  enabled?: boolean;
  correction?: string;
  createdAt: string;
};

export async function exportAll(filters?: {
  rating?: "like" | "dislike";
  keyword?: string;
  enabled?: boolean;
}): Promise<FeedbackExportItem[]> {
  const response = await http.get<{
    code: number;
    data: FeedbackExportItem[];
    message?: string;
  }>("/feedback/export", {
    params: {
      rating: filters?.rating,
      keyword: filters?.keyword,
      enabled:
        typeof filters?.enabled === "boolean" ? String(filters.enabled) : undefined,
    },
  });

  if (response.data?.code !== 0) {
    throw new Error(response.data?.message ?? "导出反馈失败");
  }

  return response.data.data;
}

export async function deleteFeedback(id: string): Promise<void> {
  const response = await http.delete<{
    code: number;
    message?: string;
  }>(`/feedback/${encodeURIComponent(id)}`);

  if (response.data?.code !== 0) {
    throw new Error(response.data?.message ?? "删除反馈失败");
  }
}

export async function updateEnabled(id: string, enabled: boolean): Promise<void> {
  const response = await http.patch<{
    code: number;
    message?: string;
  }>(`/feedback/${encodeURIComponent(id)}/enabled`, { enabled });

  if (response.data?.code !== 0) {
    throw new Error(response.data?.message ?? "更新启用状态失败");
  }
}

