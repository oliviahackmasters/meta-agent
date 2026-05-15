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
  outputFormat,
}: {
  systemPrompt: string;
  memory: UserMemory;
  sessionSummary: string;
  recentMessages: any[]; // Assume Message[]
  evidence: EvidencePack;
  userInput: string;
  outputFormat: "text" | "table" | "chart" | "scenario";
}): string {
  const parts = [];

  // 1. system prompt (HIGHEST priority)
  parts.push(systemPrompt);

  if (outputFormat === "scenario") {
    parts.push(
      [
        "The user is asking for a scenario matrix.",
        "Identify the key drivers affecting the industry.",
        "Choose two high-impact, high-uncertainty drivers as the X and Y axes.",
        "",
        "Output requirements:",
        "- First list the key drivers clearly.",
        "- Then list the chosen axes.",
        "- Then output a clean 2x2 scenario matrix.",
        "- The matrix must be a valid Markdown table.",
        "- Do not output raw HTML.",
        "- Do not wrap the table in a code block.",
        "- Do not use a long narrative.",
        "",
        "Use this exact matrix shape:",
        "",
        "|  | High [X-axis driver] | Low [X-axis driver] |",
        "|---|---|---|",
        "| High [Y-axis driver] | **Scenario 1: [Name]**<br>- [Concise description]<br>- [Implication] | **Scenario 2: [Name]**<br>- [Concise description]<br>- [Implication] |",
        "| Low [Y-axis driver] | **Scenario 3: [Name]**<br>- [Concise description]<br>- [Implication] | **Scenario 4: [Name]**<br>- [Concise description]<br>- [Implication] |",
        "",
        "After the matrix, add a short Insights section with 2-3 bullets maximum."
      ].join("\n")
    );
  }

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