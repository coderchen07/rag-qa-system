export type ConversationRole = "user" | "assistant" | "system";

export type SessionMessage = {
  role: ConversationRole;
  content: string;
  timestamp: string;
};

export class SessionEntity {
  id!: string; // UUID
  userId!: string;
  title!: string;
  messages!: SessionMessage[];
  createdAt!: string;
  updatedAt!: string;
}

