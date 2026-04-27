/**
 * lib/runModels.ts  (fixed)
 *
 * Changes from original:
 * - runOpenAI() and runClaude() were placeholders — now real implementations
 *   mirroring the working code in api/meta-llm.js
 * - runDeepSeek() also wired up properly
 * - All models receive the full context (including live evidence)
 * - Gemini upgraded from gemini-1.5-flash to gemini-2.0-flash for better recency
 */

import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || "" });

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

const SYSTEM_INSTRUCTION = `YOU MUST READ THIS CAREFULLY:

TODAY IS: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

The user has provided you with LIVE EVIDENCE fetched from the internet TODAY. This evidence is your source of truth.

CRITICAL RULES:
1. Your training data ends in early 2024. TODAY IS 2026. Events, statistics, and news in the Evidence section are CURRENT and take absolute priority.
2. You MUST use the Evidence section to answer questions about current events, prices, trends, statistics, or anything recent.
3. If asked about today/current/latest/recent/news/trends, check the Evidence section FIRST before any training data.
4. DO NOT make up or invent statistics, report names, dates, or sources. Use ONLY what is in the Evidence.
5. When evidence contradicts your training data, the Evidence WINS.
6. Say "I don't have current information on this" rather than guess.
7. Keep answers concise, clear, well-structured.
8. Use British English spelling.`;

async function runOpenAI(context: string): Promise<ModelResponse> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { provider: "openai", answer: "", error: "Missing OPENAI_API_KEY" };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: context },
        ],
        temperature: 0.5,
        max_completion_tokens: 600,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI ${response.status}: ${text}`);
    }

    const data = await response.json();
    return {
      provider: "openai",
      answer: data?.choices?.[0]?.message?.content?.trim() || "",
    };
  } catch (error: any) {
    return { provider: "openai", answer: "", error: error.message };
  }
}

async function runClaude(context: string): Promise<ModelResponse> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { provider: "claude", answer: "", error: "Missing ANTHROPIC_API_KEY" };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 600,
        system: SYSTEM_INSTRUCTION,
        messages: [{ role: "user", content: context }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Claude ${response.status}: ${text}`);
    }

    const data = await response.json();
    return {
      provider: "claude",
      answer: data?.content?.[0]?.text?.trim() || "",
    };
  } catch (error: any) {
    return { provider: "claude", answer: "", error: error.message };
  }
}

async function runGemini(context: string): Promise<ModelResponse> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    return { provider: "gemini", answer: "", error: "Missing GOOGLE_API_KEY" };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        { role: "user", parts: [{ text: SYSTEM_INSTRUCTION + "\n\n" + context }] },
      ],
    });

    return {
      provider: "gemini",
      answer: response?.text?.trim?.() || "",
    };
  } catch (error: any) {
    return { provider: "gemini", answer: "", error: error.message };
  }
}

async function runDeepSeek(context: string): Promise<ModelResponse> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    return { provider: "deepseek", answer: "", error: "Missing DEEPSEEK_API_KEY" };
  }

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: context },
        ],
        temperature: 0.5,
        max_tokens: 600,
        stream: false,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek ${response.status}: ${text}`);
    }

    const data = await response.json();
    return {
      provider: "deepseek",
      answer: data?.choices?.[0]?.message?.content?.trim() || "",
    };
  } catch (error: any) {
    return { provider: "deepseek", answer: "", error: error.message };
  }
}

export async function runModels(context: string): Promise<Record<string, ModelResponse>> {
  const [openai, claude, gemini, deepseek] = await Promise.all([
    runOpenAI(context),
    runClaude(context),
    runGemini(context),
    runDeepSeek(context),
  ]);

  return { openai, claude, gemini, deepseek };
}
