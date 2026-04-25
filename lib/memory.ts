export type Message = {
  role: "user" | "assistant";
  content: string;
};

export async function updateSessionSummary(messages: Message[]): Promise<string> {
  // Placeholder: in real implementation, call LLM to summarize
  // For now, just return a simple summary
  const userMessages = messages.filter(m => m.role === "user").map(m => m.content);
  return `Session summary: User has asked about ${userMessages.length} topics, including ${userMessages.slice(-3).join(", ")}.`;
}