import axios from "axios";
import { http } from "./http";

type SearchResponse = {
  code: number;
  data: string[];
  message?: string;
};

export async function searchTitles(keyword: string): Promise<string[]> {
  if (!keyword || keyword.trim().length === 0) {
    throw new Error("请输入关键词后再搜索。");
  }

  try {
    const response = await http.get<SearchResponse>("/ai/search", {
      params: { keyword },
    });

    if (response.data?.code !== 0) {
      throw new Error(response.data?.message ?? "搜索接口返回异常状态。");
    }

    return Array.isArray(response.data.data) ? response.data.data : [];
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const message =
        (error.response?.data as { message?: string } | undefined)?.message ??
        "搜索失败，请检查后端服务是否可用。";
      throw new Error(message);
    }

    throw new Error("搜索失败，请稍后重试。");
  }
}
