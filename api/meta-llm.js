// Vercel server function: /api/meta-llm
// Environment variables required:
// - OPENAI_API_KEY
// - ANTHROPIC_API_KEY
// - GEMINI_API_KEY (Google API key for Generative Language API)

import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body;
  const prompt = body?.prompt?.toString?.().trim();
  const debug = Boolean(process.env.DEBUG_META_AGENT);

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  if (debug) {
    console.log("meta-llm: incoming prompt", prompt);
    console.log("meta-llm: providers keys", {
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    });
  }

  const calls = [
    runOpenAI(prompt, debug),
    runClaude(prompt, debug),
    runGemini(prompt, debug),
  ];

  const settled = await Promise.allSettled(calls);

  const responses = settled.map((item) => {
    if (item.status === "fulfilled") return item.value;
    return { provider: item.reason?.provider || "unknown", error: item.reason?.message || item.reason || "failed" };
  });

  const fulfilled = responses.filter((r) => r?.text);
  const chosen = fulfilled[0] || null;

  return res.status(200).json({
    prompt,
    results: responses,
    chosen,
    meta: {
      timestamp: new Date().toISOString(),
      sources: responses.map((r) => r.provider || r.error),
    },
  });
}

async function runOpenAI(prompt, debug = false) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");

  if (debug) console.log("runOpenAI: calling OpenAI", { model: "gpt-4.1" });
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
      max_tokens: 500,
    }),
    next: { revalidate: 0 },
  });

  if (!r.ok) {
    const errText = await r.text();
    const error = new Error(`OpenAI error: ${r.status} ${errText}`);
    error.provider = "openai";
    throw error;
  }

  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim();

  return {
    provider: "openai",
    text: text || "",
    raw: data,
  };
}

async function runClaude(prompt, debug = false) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");

  // Anthropic v1 complete endpoint
  const anthropicUrl = "https://api.anthropic.com/v1/complete";
  const payload = {
    model: "claude-3.5", // or claude-4 if available
    prompt: `\n\nHuman: ${prompt}\n\nAssistant:`,
    max_tokens_to_sample: 500,
    temperature: 0.7,
  };

  if (debug) console.log("runClaude: calling path", anthropicUrl, "payload", payload);
  let r = await fetch(anthropicUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
    next: { revalidate: 0 },
  });

  if (r.status === 404) {
    // Fallback to chat endpoint if endpoint or model path differs.
    if (debug) console.log("runClaude: 404 fallback to chat completion");
    r = await fetch("https://api.anthropic.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "claude-3.5", // try the same model name
        messages: [{ role: "user", content: prompt }],
        max_tokens_to_sample: 500,
        temperature: 0.7,
      }),
      next: { revalidate: 0 },
    });
  }

  if (!r.ok) {
    const errText = await r.text();
    const error = new Error(`Claude error: ${r.status} ${errText}`);
    error.provider = "claude";
    throw error;
  }

  const data = await r.json();
  const text = (data?.completion || data?.output || data?.choices?.[0]?.message?.content || "").trim();

  return {
    provider: "claude",
    text: text || "",
    raw: data,
  };
}

async function runGemini(prompt, debug = false) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");

  const ai = new GoogleGenAI({ apiKey: key });

  if (debug) console.log("runGemini: calling with model gemini-1.5-flash");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: prompt,
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    return {
      provider: "gemini",
      text: text || "",
      raw: response,
    };
  } catch (error) {
    if (debug) console.log("runGemini: error", error.message);
    throw new Error(`Gemini error: ${error.message}`);
  }
}
