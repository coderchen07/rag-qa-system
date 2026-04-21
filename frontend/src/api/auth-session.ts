import { useAuthStore } from "@/store/auth";

export function getAuthToken(): string {
  return useAuthStore.getState().token;
}

export function handleUnauthorized(): void {
  useAuthStore.getState().clearAuth();
  window.location.href = "/login";
}
