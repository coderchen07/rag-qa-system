import { create } from "zustand";
import { ask, type RagEvidence, type RagMeta } from "@/api/rag";

type RagState = {
  question: string;
  answer: string;
  evidence: RagEvidence[];
  meta?: RagMeta;
  isLoading: boolean;
  setQuestion: (q: string) => void;
  retrieve: () => Promise<void>;
};

export const useRagStore = create<RagState>((set, get) => ({
  question: "",
  answer: "",
  evidence: [],
  meta: undefined,
  isLoading: false,
  setQuestion: (q: string) => set({ question: q }),
  retrieve: async () => {
    const { question } = get();
    if (!question || question.trim().length === 0) {
      return;
    }

    set({ isLoading: true });
    try {
      const result = await ask(question);
      set({ answer: result.answer, evidence: result.evidence, meta: result.meta });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "检索失败，请稍后重试。";
      set({ answer: message, evidence: [], meta: undefined });
      alert(message);
    } finally {
      set({ isLoading: false });
    }
  },
}));

