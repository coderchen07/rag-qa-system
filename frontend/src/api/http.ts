import axios from "axios";
import { getAuthToken, handleUnauthorized } from "./auth-session";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export const http = axios.create({
  baseURL: API_BASE_URL,
});

http.interceptors.request.use((config) => {
  const token = getAuthToken() || localStorage.getItem("rag_auth_token") || "";
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      handleUnauthorized();
    }
    return Promise.reject(error);
  },
);
