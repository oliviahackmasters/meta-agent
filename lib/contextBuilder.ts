import type { EvidencePack } from "./evidence.js";

export type UserMemory = {
  preferences: string[];
  toolsUsed: string[];
  projectContext: string;
};

export function buildPromptContext({
  systemPrompt,
  memory,
  sessionSummary,
  recentMessages,
  evidence,
  userInput,
}: {
  systemPrompt: string;
  memory: UserMemory;
  sessionSummary: string;
  recentMessages: any[]; // Assume Message[]
  evidence: EvidencePack;
  userInput: string;
}): string {
  const parts = [];

  // 1. system prompt
  parts.push(systemPrompt);

  // 2. developer/tool instructions
  parts.push("You are a helpful AI assistant. Provide structured responses with JSON when appropriate.");

  // 3. long-term memory
  parts.push(`User preferences: ${memory.preferences.join(", ")}`);
  parts.push(`Tools used: ${memory.toolsUsed.join(", ")}`);
  parts.push(`Project context: ${memory.projectContext}`);

  // 4. session summary
  parts.push(`Session summary: ${sessionSummary}`);

  // 5. recent messages
  const recentStr = recentMessages.map(m => `${m.role}: ${m.content}`).join("\n");
  parts.push(`Recent conversation:\n${recentStr}`);

  // 6. evidence pack
  const evidenceStr = evidence.sources.map(s => `- ${s.title}: ${s.summary} (${s.url})`).join("\n");
  parts.push(`Evidence:\n${evidenceStr}`);

  // 7. current user input
  parts.push(`Current query: ${userInput}`);

  return parts.join("\n\n");
}