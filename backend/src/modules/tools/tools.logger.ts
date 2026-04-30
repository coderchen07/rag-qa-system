import type { ZodError } from "zod";

export function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

export type ToolInvocationLog = {
  ts: string;
  tool: string;
  args: unknown;
  resultSummary?: string;
  durationMs: number;
  status: "success" | "error";
  errorMessage?: string;
};

function stringifyArgs(value: unknown, maxChars: number): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) {
      return text;
    }
    return `${text.slice(0, maxChars)}...(truncated)`;
  } catch {
    return "[unserializable args]";
  }
}

export function logToolInvocation(entry: ToolInvocationLog): void {
  const payload = {
    ...entry,
    argsPreview: stringifyArgs(entry.args, 1200),
    resultSummary: entry.resultSummary,
  };
  delete (payload as { args?: unknown }).args;
  console.log(`[ToolInvocation] ${JSON.stringify(payload)}`);
}
