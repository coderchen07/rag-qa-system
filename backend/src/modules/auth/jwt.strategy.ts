import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthService } from "./auth.service";
import { UserEntity, UserRole } from "./entities/user.entity";

type JwtPayload = {
  sub: string;
  username: string;
  role: UserRole;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? "temp-secret-change-me",
    });
  }

  validate(payload: JwtPayload): Omit<UserEntity, "passwordHash"> {
    const user = this.authService.getUserById(payload.sub);
    if (!user) {
      throw new UnauthorizedException("用户不存在");
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role,
    };
  }
}
