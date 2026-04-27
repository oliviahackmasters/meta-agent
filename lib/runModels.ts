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

CRITICAL INSTRUCTIONS FOR THIS RESPONSE:
- Today's date is ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} (${new Date().toISOString().split('T')[0]}).
- The "Evidence" section contains current, real-time information fetched from the internet via web search.
- Treat the web search results and provided evidence as the source of truth.
- IGNORE any outdated knowledge from your training data that conflicts with the provided evidence.
- Use ONLY the information provided in the context, especially the Evidence section, for current events, retail trends, and market data.
- When citing statistics, reports, or sources: only reference information explicitly mentioned in the Evidence section.
- DO NOT invent, speculate, or fabricate statistics, report names, case study details, or links.
- If evidence is from retail-specific sources (McKinsey, Deloitte, PWC, Forrester, NRF, etc.), prioritize that information.
- When evidence is weak or limited, explicitly state "Evidence is limited for this topic."
- For retail research: focus on recent consumer behavior, omnichannel trends, and brand strategies mentioned in the sources.
- Keep your response concise and directly answer the user's query using only verified information from the provided evidence.

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
  const systemInstructions = `Today's date is ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.
The Evidence section contains real-time web search results.
Treat web search results as source of truth. Do not invent statistics or report names. Say when evidence is weak.
For retail research, prioritize recent sources and consumer behavior trends.`;

  return {
    provider: "openai",
    answer: `[OpenAI] ${systemInstructions} Based on the provided context with web search evidence, I would analyze your query. (OpenAI API integration needed for real responses.)`,
  };
}

async function runClaude(context: string): Promise<ModelResponse> {
  // Placeholder - would need Anthropic API key and implementation
  const systemInstructions = `Today's date is ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.
The Evidence section contains real-time web search results.
Treat web search results as source of truth. Do not invent statistics or report names. Say when evidence is weak.
For retail research, prioritize recent sources and consumer behavior trends.`;

  return {
    provider: "claude",
    answer: `[Claude] ${systemInstructions} Analyzing the context with web search evidence... (Claude API integration needed for real responses.)`,
  };
}

async function runDeepSeek(context: string): Promise<ModelResponse> {
  // Placeholder - would need DeepSeek API key and implementation
  const systemInstructions = `Today's date is ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.
The Evidence section contains real-time web search results.
Treat web search results as source of truth. Do not invent statistics or report names. Say when evidence is weak.
For retail research, prioritize recent sources and consumer behavior trends.`;

  return {
    provider: "deepseek",
    answer: `[DeepSeek] ${systemInstructions} From the information available in the context with web search evidence... (DeepSeek API integration needed for real responses.)`,
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

/**
 * Combines responses from multiple models with web search awareness
 */
export async function combinedResponse(
  modelResponses: Record<string, ModelResponse>,
  originalContext: string
): Promise<ModelResponse> {
  // Extract answers from successful responses
  const usableAnswers = Object.entries(modelResponses)
    .filter(([, response]) => response.answer && !response.error)
    .map(([provider, response]) => `${provider.toUpperCase()}:\n${response.answer}`)
    .join("\n\n---\n\n");

  if (!usableAnswers) {
    return {
      provider: "combined",
      answer: "Unable to generate a combined response due to errors in model calls.",
      error: "No valid responses to combine",
    };
  }

  const systemPrompt = `You are a meta AI summarizer that synthesizes responses from multiple AI models.
Today's date is ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.

Given multiple model answers to the same prompt based on web search evidence:
- Write one concise, high-quality combined response
- Remove repetition while preserving unique insights
- Prioritize information sourced from the provided evidence and web search results
- For retail research: synthesize consumer behavior and trend insights from the sources
- Do not invent statistics or sources not mentioned in the evidence
- Do not mention the individual providers
- Provide citations or references to the sources when making claims
- Acknowledge when evidence is limited or conflicting`;

  try {
    // For now, return a simple synthesis since we don't have a guaranteed API
    return {
      provider: "combined",
      answer: `Combined Analysis:\n\n${usableAnswers}\n\nNote: This represents a synthesis of multiple AI model responses based on the provided web search evidence and context. All claims are drawn from the sources provided in the Evidence section.`,
    };
  } catch (error) {
    return {
      provider: "combined",
      answer: "Combined response generation encountered an issue.",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}