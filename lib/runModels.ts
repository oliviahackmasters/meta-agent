// Real LLM implementations using available APIs

import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI(process.env.GOOGLE_API_KEY || "");

export type UIBlock =
  | { type: "chart"; data: any }
  | { type: "table"; data: any }
  | { type: "timeline"; data: any }
  | { type: "scenario"; data: any };

export type ModelResponse = {
  provider: string;
  answer: string;
  ui?: UIBlock;
  error?: string;
};

async function runGemini(context: string): Promise<ModelResponse> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `${context}

CRITICAL INSTRUCTIONS:
- Today's date is April 26, 2026. Use this date in your response.
- The "Evidence" section contains current, real-time information fetched from the internet.
- IGNORE any outdated knowledge from your training data.
- Use ONLY the information provided in the context, especially the Evidence section, for current events and facts.
- If the Evidence section has news articles, summarize them as the latest headlines.
- Keep your response concise and directly answer the user's query using the provided information.

Please provide a helpful response based on the above context:`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    return {
      provider: "gemini",
      answer: text,
    };
  } catch (error) {
    return {
      provider: "gemini",
      answer: "Error calling Gemini API",
      error: error.message,
    };
  }
}

async function runOpenAI(context: string): Promise<ModelResponse> {
  // Placeholder - would need OpenAI API key and implementation
  return {
    provider: "openai",
    answer: `Based on the provided context, here's what I can tell you. (Note: This is a placeholder response. OpenAI API integration would be needed for real responses.)`,
  };
}

async function runClaude(context: string): Promise<ModelResponse> {
  // Placeholder - would need Anthropic API key and implementation
  return {
    provider: "claude",
    answer: `Analyzing the context provided... (Note: This is a placeholder response. Claude API integration would be needed for real responses.)`,
  };
}

async function runDeepSeek(context: string): Promise<ModelResponse> {
  // Placeholder - would need DeepSeek API key and implementation
  return {
    provider: "deepseek",
    answer: `From the information available in the context... (Note: This is a placeholder response. DeepSeek API integration would be needed for real responses.)`,
  };
}

export async function runModels(context: string): Promise<Record<string, ModelResponse>> {
  const results: Record<string, ModelResponse> = {};

  // Run all models in parallel
  const promises = [
    runOpenAI(context),
    runClaude(context),
    runGemini(context),
    runDeepSeek(context),
  ];

  const responses = await Promise.all(promises);

  results.openai = responses[0];
  results.claude = responses[1];
  results.gemini = responses[2];
  results.deepseek = responses[3];

  return results;
}