import { http } from "./http";
import { AuthUser } from "@/store/auth";

type LoginResponse = {
  access_token: string;
};

export async function login(username: string, password: string): Promise<{
  token: string;
  user: AuthUser;
}> {
  const response = await http.post<LoginResponse>("/auth/login", {
    username,
    password,
  });

  const token = response.data?.access_token;
  if (!token) {
    throw new Error("登录失败，请稍后重试。");
  }

  const role: AuthUser["role"] = username.trim() === "admin" ? "admin" : "user";
  return {
    token,
    user: {
      id: username.trim(),
      username: username.trim(),
      role,
    },
  };
}
