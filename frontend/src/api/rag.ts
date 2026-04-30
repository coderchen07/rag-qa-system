import axios from "axios";
import { http } from "./http";

export type RagEvidence = {
  title: string;
  snippet: string;
  chunkIndex?: number;
};

export type RagMeta = {
  mode?: "fact" | "summary" | "analysis";
  contextCount?: number;
};

export type RagSource = {
  title: string;
  score: number;
};

type RagResponse = {
  code: number;
  answer: string;
  correctionUsed?: boolean;
  sources?: RagSource[];
  data?: {
    answer?: string;
    evidence?: RagEvidence[];
    meta?: RagMeta;
    correctionUsed?: boolean;
    sources?: RagSource[];
  };
  message?: string;
};

export async function ask(
  question: string,
): Promise<{
  answer: string;
  evidence: RagEvidence[];
  sources: RagSource[];
  meta?: RagMeta;
  correctionUsed: boolean;
}> {
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

    const smartData = response.data?.data;
    const answer =
      (typeof smartData?.answer === "string" ? smartData.answer : response.data.answer) ?? "";
    const evidence = Array.isArray(smartData?.evidence) ? smartData.evidence : [];
    const sources = Array.isArray(smartData?.sources)
      ? smartData.sources
      : Array.isArray(response.data?.sources)
        ? response.data.sources
        : [];
    const meta = smartData?.meta;
    const correctionUsed = Boolean(
      smartData?.correctionUsed ?? response.data?.correctionUsed ?? false,
    );
    return { answer, evidence, sources, meta, correctionUsed };
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
