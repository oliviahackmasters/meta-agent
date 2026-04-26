import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI(process.env.GOOGLE_API_KEY || "");

export async function generateSearchQueries(userQuery: string, messages: any[] = []): Promise<string[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const conversationContext = messages.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');

  const prompt = `Analyze this user query and determine what information needs to be searched on the internet to provide a comprehensive answer.

User Query: "${userQuery}"

Recent Conversation:
${conversationContext}

Based on the query, generate 2-4 specific search queries that would help gather relevant, up-to-date information. Focus on current events, facts, data, or information that might change over time.

Return only a JSON array of search query strings. For example:
["search query 1", "search query 2", "search query 3"]

Make the queries specific and actionable. If the query doesn't need current information, return an empty array.`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Extract JSON from the response
    const jsonMatch = text.match(/\[.*\]/s);
    if (jsonMatch) {
      const queries = JSON.parse(jsonMatch[0]);
      return Array.isArray(queries) ? queries.slice(0, 4) : [];
    }

    return [];
  } catch (error) {
    console.error("Error generating search queries:", error);
    return [];
  }
}