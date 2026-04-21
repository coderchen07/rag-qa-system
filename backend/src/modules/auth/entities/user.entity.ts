export type UserRole = "admin" | "user";

export class UserEntity {
  id!: string;
  username!: string;
  passwordHash!: string;
  role!: UserRole;
}
