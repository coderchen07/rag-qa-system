import { create } from "zustand";
import { ask } from "@/api/rag";

type RagState = {
  question: string;
  answer: string;
  isLoading: boolean;
  setQuestion: (q: string) => void;
  retrieve: () => Promise<void>;
};

export const useRagStore = create<RagState>((set, get) => ({
  question: "",
  answer: "",
  isLoading: false,
  setQuestion: (q: string) => set({ question: q }),
  retrieve: async () => {
    const { question } = get();
    if (!question || question.trim().length === 0) {
      return;
    }

    set({ isLoading: true });
    try {
      const answer = await ask(question);
      set({ answer });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "检索失败，请稍后重试。";
      set({ answer: message });
      alert(message);
    } finally {
      set({ isLoading: false });
    }
  },
}));

