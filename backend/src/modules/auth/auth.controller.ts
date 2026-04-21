import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() body: { username?: string; password?: string }) {
    const username = body?.username?.trim();
    const password = body?.password?.trim();
    if (!username || !password) {
      throw new BadRequestException("username and password are required");
    }

    return this.authService.login(username, password);
  }
}
