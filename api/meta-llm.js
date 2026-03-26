import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const prompt = req.body?.prompt?.toString?.().trim();

    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const settled = await Promise.allSettled([
      runOpenAI(prompt),
      runClaude(prompt),
      runGemini(prompt),
    ]);

    const results = settled.map((item) => {
      if (item.status === "fulfilled") return item.value;
      return {
        provider: item.reason?.provider || "unknown",
        error: item.reason?.message || String(item.reason),
      };
    });

    return res.status(200).json({
      prompt,
      results,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("meta-llm handler failed:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message || String(err),
    });
  }
}

async function runOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error("Missing OPENAI_API_KEY");
    err.provider = "openai";
    throw err;
  }

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_completion_tokens: 500,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    const err = new Error(`OpenAI error: ${r.status} ${text}`);
    err.provider = "openai";
    throw err;
  }

  const data = await r.json();
  return {
    provider: "openai",
    text: data?.choices?.[0]?.message?.content?.trim() || "",
  };
}

async function runClaude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error("Missing ANTHROPIC_API_KEY");
    err.provider = "claude";
    throw err;
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    const err = new Error(`Claude error: ${r.status} ${text}`);
    err.provider = "claude";
    throw err;
  }

  const data = await r.json();
  return {
    provider: "claude",
    text: data?.content?.[0]?.text?.trim() || "",
  };
}

async function runGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    const err = new Error("Missing GEMINI_API_KEY");
    err.provider = "gemini";
    throw err;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: key });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    return {
      provider: "gemini",
      text: response?.text?.trim?.() || "",
    };
  } catch (e) {
    const err = new Error(`Gemini error: ${e.message || String(e)}`);
    err.provider = "gemini";
    throw err;
  }
}