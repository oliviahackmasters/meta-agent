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

  // 1. system prompt (HIGHEST priority)
  parts.push(systemPrompt);

  // 2. LIVE EVIDENCE SECTION (must be clear and early)
  if (evidence.sources && evidence.sources.length > 0) {
    const evidenceStr = evidence.sources
      .map((s, i) => `[${i + 1}] "${s.title}"\n    URL: ${s.url}\n    Source: ${s.summary}`)
      .join("\n\n");
    parts.push(`=== LIVE EVIDENCE FROM INTERNET TODAY ===\nUse this Evidence as your PRIMARY SOURCE for current information:\n\n${evidenceStr}\n=== END EVIDENCE ===`);
  } else {
    parts.push("=== LIVE EVIDENCE FROM INTERNET TODAY ===\nNo current sources found.\n=== END EVIDENCE ===");
  }

  // 3. Current user query
  parts.push(`USER QUESTION: ${userInput}`);

  // 4. Recent messages (context)
  if (recentMessages && recentMessages.length > 0) {
    const recentStr = recentMessages.map(m => `${m.role}: ${m.content}`).join("\n");
    parts.push(`Recent conversation:\n${recentStr}`);
  }

  // 5. Other context (lower priority)
  if (memory.preferences.length > 0) {
    parts.push(`User preferences: ${memory.preferences.join(", ")}`);
  }
  if (memory.toolsUsed.length > 0) {
    parts.push(`Tools used: ${memory.toolsUsed.join(", ")}`);
  }
  if (memory.projectContext) {
    parts.push(`Project context: ${memory.projectContext}`);
  }

  return parts.join("\n\n");
}