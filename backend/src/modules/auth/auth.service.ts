import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { UserEntity, UserRole } from "./entities/user.entity";

type LoginResult = {
  access_token: string;
};

@Injectable()
export class AuthService {
  private readonly users: UserEntity[] = [];
  private usersInitialized = false;

  constructor(private readonly jwtService: JwtService) {}

  login(username: string, password: string): LoginResult {
    this.ensureSeedUsers();
    const user = this.users.find((item) => item.username === username);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      throw new UnauthorizedException("Invalid username or password");
    }

    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };
    const accessToken = this.jwtService.sign(payload);
    return {
      access_token: accessToken,
    };
  }

  getUserById(id: string): UserEntity | undefined {
    this.ensureSeedUsers();
    return this.users.find((user) => user.id === id);
  }

  private ensureSeedUsers(): void {
    if (this.usersInitialized) {
      return;
    }

    const saltRounds = 10;
    this.users.push(
      {
        id: "1",
        username: "admin",
        passwordHash: bcrypt.hashSync("admin123", saltRounds),
        role: "admin",
      },
      {
        id: "2",
        username: "user",
        passwordHash: bcrypt.hashSync("user123", saltRounds),
        role: "user",
      },
    );
    this.usersInitialized = true;
  }
}
