import type { Message } from "./memory.js";

export type RouterDecision = {
  needsWeb: boolean;
  needsChart: boolean;
  needsMemory: boolean;
  taskType: string;
  outputFormat: "text" | "table" | "chart" | "scenario";
};

export async function routeUserQuery(input: string, messages: Message[] = []): Promise<RouterDecision> {
  const lowerInput = input.toLowerCase();

  const needsWeb = /\b(latest|current|today|recent|news|update)\b/.test(lowerInput);

  const needsChart = /\b(trend|compare|probability|distribution|timeline|matrix|scenario|2x2)\b/.test(lowerInput);

  const needsMemory = messages.length > 1; // If multi-turn

  let taskType = "general";
  if (needsWeb) taskType = "information_retrieval";
  if (needsChart) taskType = "analysis";

  let outputFormat: "text" | "table" | "chart" | "scenario" = "text";
  if (needsChart) {
    if (lowerInput.includes("probability") || lowerInput.includes("scenario") || lowerInput.includes("matrix") || lowerInput.includes("2x2")) {
      outputFormat = "scenario";
    } else if (lowerInput.includes("compare")) {
      outputFormat = "table";
    } else {
      outputFormat = "chart";
    }
  }

  return {
    needsWeb,
    needsChart,
    needsMemory,
    taskType,
    outputFormat,
  };
}