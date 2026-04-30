import { z } from "zod";
import type { ToolDefinition, ToolHandler } from "./weather.tool";

export const createTicketArgsSchema = z.object({
  title: z.string().min(1, "title 不能为空"),
  description: z.string().min(1, "description 不能为空"),
  priority: z.enum(["普通", "紧急", "严重"]).optional(),
  requirements: z.string().optional(),
});

type CreateTicketArgs = {
  title: string;
  description: string;
  priority?: "普通" | "紧急" | "严重";
  requirements?: string;
};

export const createTicketToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_ticket",
    description:
      "Create a ticket and send it to team group chat via webhook (recommended tool).",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Notification title.",
        },
        description: {
          type: "string",
          description: "Notification body and details.",
        },
        priority: {
          type: "string",
          enum: ["普通", "紧急", "严重"],
          description: "Optional priority. Default is 普通.",
        },
        requirements: {
          type: "string",
          description:
            "执行要求列表，每条要求换行，例如：1. 排查上传队列\\n2. 检查文件处理服务\\n3. 重试卡住的任务",
        },
      },
      required: ["title", "description"],
      additionalProperties: false,
    },
  },
};

export const sendNotificationAliasToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "send_notification",
    description:
      "Legacy alias of create_ticket. Send a team notification to group chat via webhook.",
    parameters: createTicketToolDefinition.function.parameters,
  },
};

export const createTicketToolHandler: ToolHandler = async (
  args: unknown,
): Promise<Record<string, unknown>> => {
  const parsed = args as CreateTicketArgs;
  const title = typeof parsed?.title === "string" ? parsed.title.trim() : "";
  const description =
    typeof parsed?.description === "string" ? parsed.description.trim() : "";
  if (!title || !description) {
    throw new Error("Invalid args: title and description are required.");
  }

  return {
    tool: "create_ticket",
    title,
    description,
    priority: parsed?.priority ?? "普通",
    requirements: typeof parsed?.requirements === "string" ? parsed.requirements.trim() : undefined,
  };
};
