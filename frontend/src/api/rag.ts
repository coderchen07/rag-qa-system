import axios from "axios";
import { http } from "./http";

type RagResponse = {
  code: number;
  answer: string;
  message?: string;
};

export async function ask(question: string): Promise<string> {
  if (!question || question.trim().length === 0) {
    throw new Error("请输入有效问题后再试。");
  }

  try {
    const response = await http.post<RagResponse>("/ai/rag", {
      question,
    });

    if (response.data?.code !== 0) {
      throw new Error(response.data?.message ?? "后端返回异常状态，请稍后重试。");
    }

    return response.data.answer;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const message =
        (error.response?.data as { message?: string } | undefined)?.message ??
        "请求失败，请检查后端服务是否已启动。";
      throw new Error(message);
    }

    throw new Error("请求失败，请稍后重试。");
  }
}
