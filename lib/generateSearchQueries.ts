import type { Message } from "./memory.js";

/**
 * Generate targeted search queries for a user question.
 * Uses OpenAI (already configured) instead of Gemini to avoid a second
 * API dependency for this utility function.
 * Falls back to simple keyword extraction if the API call fails.
 */
export async function generateSearchQueries(
  userQuery: string,
  messages: Message[] = []
): Promise<string[]> {
  const openAiKey = process.env.OPENAI_API_KEY;

  if (openAiKey) {
    return generateWithOpenAI(userQuery, messages, openAiKey);
  }

  // No key available — fall back to simple keyword extraction
  return simpleFallbackQueries(userQuery);
}

async function generateWithOpenAI(
  userQuery: string,
  messages: Message[],
  apiKey: string
): Promise<string[]> {
  const conversationContext = messages
    .slice(-4)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const prompt = `You are a search query generator. The user asked: "${userQuery}"

Recent conversation:
${conversationContext || "(none)"}

Generate 2-3 specific web search queries to find current, up-to-date information that would help answer this question. Focus on recent events, current data, or facts that change over time.

Return ONLY a JSON array of strings. Example: ["query one", "query two"]
If the question needs no current information (e.g. "what is 2+2"), return: []`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_completion_tokens: 150,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error(`OpenAI ${response.status}`);

    const data = await response.json();
    const text = (data?.choices?.[0]?.message?.content || "").trim();

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const queries = JSON.parse(jsonMatch[0]);
      return Array.isArray(queries)
        ? queries.filter((q: unknown) => typeof q === "string" && q.trim()).slice(0, 3)
        : [];
    }

    return simpleFallbackQueries(userQuery);
  } catch (error) {
    console.error("[generateSearchQueries] OpenAI failed:", error);
    return simpleFallbackQueries(userQuery);
  }
}

/**
 * Simple keyword-based fallback — no API required.
 * Strips common question words and returns 1-2 targeted queries.
 */
function simpleFallbackQueries(userQuery: string): string[] {
  const stopWords = new Set([
    "what", "who", "where", "when", "why", "how", "is", "are", "was", "were",
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "about", "tell", "me", "give", "show", "find", "do", "does",
    "can", "could", "would", "should", "has", "have", "had", "please", "short",
    "answer", "summary", "brief"
  ]);

  const words = userQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  if (!words.length) return [];

  const baseQuery = words.slice(0, 5).join(" ");
  const queries = [baseQuery];

  // Add a "latest news" variant if the query seems time-sensitive
  const timeSensitive = /\b(today|now|current|latest|recent|news|headline|update)\b/i.test(userQuery);
  if (timeSensitive || words.length >= 2) {
    queries.push(`latest news ${baseQuery}`);
  }

  return queries.slice(0, 3);
}
