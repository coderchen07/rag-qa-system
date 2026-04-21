import { create } from "zustand";

export type AuthRole = "admin" | "user";

export type AuthUser = {
  id: string;
  username: string;
  role: AuthRole;
};

type AuthState = {
  token: string;
  user: AuthUser | null;
  setAuth: (payload: { token: string; user: AuthUser }) => void;
  clearAuth: () => void;
  restoreAuth: () => void;
};

const TOKEN_KEY = "rag_auth_token";
const USER_KEY = "rag_auth_user";

export const useAuthStore = create<AuthState>((set) => ({
  token: "",
  user: null,
  setAuth: ({ token, user }) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },
  clearAuth: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: "", user: null });
  },
  restoreAuth: () => {
    const token = localStorage.getItem(TOKEN_KEY) ?? "";
    const rawUser = localStorage.getItem(USER_KEY);
    if (!token || !rawUser) {
      set({ token: "", user: null });
      return;
    }

    try {
      const user = JSON.parse(rawUser) as AuthUser;
      if (!user?.id || !user?.username || !user?.role) {
        throw new Error("invalid user payload");
      }
      set({ token, user });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      set({ token: "", user: null });
    }
  },
}));
