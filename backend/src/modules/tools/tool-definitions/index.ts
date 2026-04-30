import {
  weatherArgsSchema,
  weatherToolDefinition,
  weatherToolHandler,
  type ToolDefinition,
  type ToolHandler,
} from "./weather.tool";
import {
  createTicketArgsSchema,
  createTicketToolDefinition,
  createTicketToolHandler,
  sendNotificationAliasToolDefinition,
} from "./create-ticket.tool";
import { formatZodIssues } from "../tools.logger";
import type { ZodType } from "zod";

export type RegisteredTool = {
  definition: ToolDefinition;
  handler: ToolHandler;
  /** 若设为 `admin`，仅管理员 JWT 可执行（预留敏感工具权限模型）。 */
  requiredRole?: "admin";
  validateArgs: (raw: unknown) => { ok: true; value: unknown } | { ok: false; message: string };
};

function zodValidator<T>(schema: ZodType<T>): RegisteredTool["validateArgs"] {
  return (raw: unknown) => {
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      return { ok: true, value: parsed.data };
    }
    return { ok: false, message: `参数校验失败：${formatZodIssues(parsed.error)}` };
  };
}

export const registeredTools: RegisteredTool[] = [
  {
    definition: weatherToolDefinition,
    handler: weatherToolHandler,
    validateArgs: zodValidator(weatherArgsSchema),
  },
  {
    definition: createTicketToolDefinition,
    handler: createTicketToolHandler,
    validateArgs: zodValidator(createTicketArgsSchema),
  },
  {
    definition: sendNotificationAliasToolDefinition,
    handler: createTicketToolHandler,
    validateArgs: zodValidator(createTicketArgsSchema),
  },
];
