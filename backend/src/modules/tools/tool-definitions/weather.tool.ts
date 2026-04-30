import { z } from "zod";

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

export type ToolHandler = (args: unknown) => Promise<Record<string, unknown>>;

export const weatherArgsSchema = z.object({
  city: z.string().min(1, "city 不能为空"),
  date: z.string().optional(),
});

type GetWeatherArgs = {
  city: string;
  date?: string;
};

export const weatherToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get weather information for a city (mock data).",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "City name in Chinese or English, e.g. 深圳.",
        },
        date: {
          type: "string",
          description: "Optional date in YYYY-MM-DD format.",
        },
      },
      required: ["city"],
      additionalProperties: false,
    },
  },
};

export const weatherToolHandler: ToolHandler = async (
  args: unknown,
): Promise<Record<string, unknown>> => {
  const parsed = args as GetWeatherArgs;
  const city = typeof parsed?.city === "string" ? parsed.city.trim() : "";
  if (!city) {
    throw new Error("Invalid args: city is required.");
  }

  return {
    tool: "get_weather",
    city,
    date: parsed?.date ?? "today",
    condition: "sunny",
    temperature_c: 29,
    humidity_percent: 68,
    source: "mock",
  };
};
