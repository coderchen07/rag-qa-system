import { Injectable, OnModuleInit } from "@nestjs/common";
import * as crypto from "crypto";
import { registeredTools } from "./tool-definitions";
import type { ToolDefinition } from "./tool-definitions/weather.tool";
import { logToolInvocation } from "./tools.logger";
import type { UserRole } from "../auth/entities/user.entity";

type ToolHandler = (args: unknown) => Promise<Record<string, unknown>>;

type ToolRuntimeConfig = {
  handler: ToolHandler;
  validateArgs: (raw: unknown) => { ok: true; value: unknown } | { ok: false; message: string };
  requiredRole?: "admin";
};

export const TOOL_UNAUTHORIZED_MESSAGE = "工具未授权：该工具不在允许列表或未注册。";
export const TOOL_ADMIN_REQUIRED_MESSAGE =
  "工具未授权：当前账号无权执行此敏感操作（需要管理员）。";

@Injectable()
export class ToolsService implements OnModuleInit {
  /**
   * 生产白名单：仅允许执行列表内工具，防止模型幻觉调用未开放能力。
   * 新增工具时须同时：注册 handler、加入此数组、并补充参数校验。
   */
  private readonly ALLOWED_TOOLS: readonly string[] = [
    "get_weather",
    "create_ticket",
    "send_notification",
  ];

  private readonly definitionList: ToolDefinition[];
  private readonly runtimeByName = new Map<string, ToolRuntimeConfig>();
  private ticketSequence = 0;

  constructor() {
    this.definitionList = registeredTools.map((tool) => tool.definition);
    registeredTools.forEach((tool) => {
      const name = tool.definition.function.name;
      this.runtimeByName.set(name, {
        handler: tool.handler,
        validateArgs: tool.validateArgs,
        requiredRole: tool.requiredRole,
      });
    });
    this.assertWhitelistCoversRegisteredTools();
  }

  onModuleInit(): void {
    this.verifyUnknownToolIsRejected().catch(() => undefined);
  }

  /** 启动自检：未注册工具名应被拒绝且不抛未捕获异常。 */
  private async verifyUnknownToolIsRejected(): Promise<void> {
    try {
      await this.executeTool("__nonexistent_tool_for_sanity__", {}, { callerRole: "admin" });
      console.warn("[ToolsService] sanity check failed: unknown tool should have been rejected");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("工具未授权")) {
        console.log(`[ToolsService] sanity: unknown tool rejected as expected (${message})`);
      } else {
        console.warn("[ToolsService] sanity: unexpected error for unknown tool:", message);
      }
    }
  }

  private assertWhitelistCoversRegisteredTools(): void {
    for (const name of this.ALLOWED_TOOLS) {
      if (!this.runtimeByName.has(name)) {
        console.warn(
          `[ToolsService] ALLOWED_TOOLS contains "${name}" but no registered handler — tool calls will fail.`,
        );
      }
    }
    for (const tool of registeredTools) {
      const name = tool.definition.function.name;
      if (!this.ALLOWED_TOOLS.includes(name)) {
        console.warn(
          `[ToolsService] Registered tool "${name}" is not in ALLOWED_TOOLS — it cannot be executed.`,
        );
      }
    }
  }

  getDefinitions(): ToolDefinition[] {
    return this.definitionList;
  }

  private assertCallerRoleForTool(
    toolName: string,
    requiredRole: "admin" | undefined,
    callerRole: UserRole | string | undefined,
  ): void {
    if (requiredRole !== "admin") {
      return;
    }
    if (callerRole === "admin") {
      return;
    }
    logToolInvocation({
      ts: new Date().toISOString(),
      tool: toolName,
      args: {},
      durationMs: 0,
      status: "error",
      errorMessage: TOOL_ADMIN_REQUIRED_MESSAGE,
    });
    throw new Error(TOOL_ADMIN_REQUIRED_MESSAGE);
  }

  private summarizeResult(result: Record<string, unknown>): string {
    try {
      const text = JSON.stringify(result);
      return text.length > 800 ? `${text.slice(0, 800)}...(truncated)` : text;
    } catch {
      return "[unserializable result]";
    }
  }

  private buildTicketId(now = new Date()): string {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    this.ticketSequence = (this.ticketSequence % 999) + 1;
    const seq = String(this.ticketSequence).padStart(3, "0");
    return `WO-${yyyy}${mm}${dd}-${seq}`;
  }

  private formatTicketCreatedAt(now = new Date()): string {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `${yyyy}年${mm}月${dd}日 ${hh}:${mi}:${ss}`;
  }

  private normalizeTicketPriority(priority: string): string {
    if (priority === "严重") {
      return "P0";
    }
    if (priority === "紧急") {
      return "P1";
    }
    return "P2";
  }

  private toPriorityDisplay(priority: string): string {
    if (priority.includes("P0")) {
      return "P0（严重）";
    }
    if (priority.includes("P1")) {
      return "P1（紧急）";
    }
    if (priority.includes("P2")) {
      return "P2（普通）";
    }
    if (priority === "严重") {
      return "P0（严重）";
    }
    if (priority === "紧急") {
      return "P1（紧急）";
    }
    return "P2（普通）";
  }

  private getDefaultRequirements(): string {
    return "请相关负责人尽快处理";
  }

  private async sendNotification(args: {
    title: string;
    description: string;
    priority: string;
    requirements?: string;
  }): Promise<string> {
    const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    const signKey = process.env.FEISHU_SIGN_KEY;

    if (!webhookUrl || !signKey) {
      return JSON.stringify({
        status: "error",
        message: "Webhook 或飞书签名密钥未配置，请联系管理员",
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const stringToSign = `${timestamp}\n${signKey}`;
    const hmac = crypto.createHmac("sha256", stringToSign);
    hmac.update("");
    const sign = hmac.digest("base64");
    const now = new Date();
    const ticketId = this.buildTicketId(now);
    const createdAt = this.formatTicketCreatedAt(now);
    const priorityCode = this.normalizeTicketPriority(args.priority);
    const priority = this.toPriorityDisplay(priorityCode);
    const requirements =
      typeof args.requirements === "string" && args.requirements.trim().length > 0
        ? args.requirements.trim()
        : this.getDefaultRequirements();

    const message = {
      timestamp: String(timestamp),
      sign,
      msg_type: "interactive",
      card: {
        header: {
          title: { tag: "plain_text", content: `📋 ${args.title}` },
          template:
            args.priority === "紧急" ? "red" : args.priority === "严重" ? "red" : "blue",
        },
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content:
                `**工单编号：** ${ticketId}\n` +
                `**优先级：** ${priority}\n` +
                `**创建时间：** ${createdAt}\n` +
                `**问题描述：**\n${args.description}\n\n` +
                `**执行要求：**\n${requirements}\n\n` +
                `**提交人：** AI 助手`,
            },
          },
        ],
      },
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (response.ok) {
      return JSON.stringify({
        status: "success",
        message: "通知已发送至团队群聊",
        ticketId,
        title: args.title,
        priority,
        description: args.description,
        createdAt,
        requirements,
      });
    }
    const err = await response.json().catch(() => ({}));
    return JSON.stringify({
      status: "error",
      message: `通知发送失败: ${String((err as { msg?: unknown })?.msg ?? response.status)}`,
    });
  }

  async executeTool(
    name: string,
    args: unknown,
    context?: { callerRole?: UserRole | string },
  ): Promise<string> {
    const started = Date.now();
    const ts = new Date().toISOString();
    const callerRole = context?.callerRole;

    if (!this.ALLOWED_TOOLS.includes(name)) {
      logToolInvocation({
        ts,
        tool: name,
        args,
        durationMs: Date.now() - started,
        status: "error",
        errorMessage: TOOL_UNAUTHORIZED_MESSAGE,
      });
      throw new Error(TOOL_UNAUTHORIZED_MESSAGE);
    }

    const runtime = this.runtimeByName.get(name);
    if (!runtime) {
      logToolInvocation({
        ts,
        tool: name,
        args,
        durationMs: Date.now() - started,
        status: "error",
        errorMessage: TOOL_UNAUTHORIZED_MESSAGE,
      });
      throw new Error(TOOL_UNAUTHORIZED_MESSAGE);
    }

    this.assertCallerRoleForTool(name, runtime.requiredRole, callerRole);

    const validated = runtime.validateArgs(args);
    if (!validated.ok) {
      logToolInvocation({
        ts,
        tool: name,
        args,
        durationMs: Date.now() - started,
        status: "error",
        errorMessage: validated.message,
      });
      throw new Error(validated.message);
    }

    try {
      const result = await (
        name === "send_notification" || name === "create_ticket"
          ? (() => {
              const raw = validated.value as {
                title: string;
                description: string;
                priority?: string;
                requirements?: string;
              };
              return this.sendNotification({
                title: raw.title,
                description: raw.description,
                priority: raw.priority ?? "普通",
                requirements: raw.requirements,
              }).then((text) => {
                try {
                  return JSON.parse(text) as Record<string, unknown>;
                } catch {
                  return { status: "error", message: text };
                }
              });
            })()
          : runtime.handler(validated.value)
      );
      const summary = this.summarizeResult(result);
      logToolInvocation({
        ts,
        tool: name,
        args,
        resultSummary: summary,
        durationMs: Date.now() - started,
        status: "success",
      });
      return JSON.stringify(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "tool_execution_failed";
      logToolInvocation({
        ts,
        tool: name,
        args,
        durationMs: Date.now() - started,
        status: "error",
        errorMessage: message,
      });
      throw error instanceof Error ? error : new Error(message);
    }
  }
}
