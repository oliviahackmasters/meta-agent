// Vercel server function: /api/meta-llm
// Environment variables required:
// - OPENAI_API_KEY
// - ANTHROPIC_API_KEY
// - GEMINI_API_KEY (Google API key for Generative Language API)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body;
  const prompt = body?.prompt?.toString?.().trim();

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const calls = [
    runOpenAI(prompt),
    runClaude(prompt),
    runGemini(prompt),
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

async function runOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");

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

async function runClaude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");

  const r = await fetch("https://api.anthropic.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "claude-3.5",
      messages: [{ role: "user", content: prompt }],
      max_tokens_to_sample: 500,
      temperature: 0.7,
    }),
    next: { revalidate: 0 },
  });

  if (!r.ok) {
    const errText = await r.text();
    const error = new Error(`Claude error: ${r.status} ${errText}`);
    error.provider = "claude";
    throw error;
  }

  const data = await r.json();
  const text = data?.completion?.trim() || data?.output?.trim();

  return {
    provider: "claude",
    text: text || "",
    raw: data,
  };
}

async function runGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");

  const model = "models/text-bison-001";
  const url = `https://generativelanguage.googleapis.com/v1beta2/${model}:generate?key=${key}`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: {
        text: prompt,
      },
      temperature: 0.7,
      maxOutputTokens: 500,
    }),
    next: { revalidate: 0 },
  });

  if (!r.ok) {
    const errText = await r.text();
    const error = new Error(`Gemini error: ${r.status} ${errText}`);
    error.provider = "gemini";
    throw error;
  }

  const data = await r.json();
  const text = data?.candidates?.[0]?.output?.trim();

  return {
    provider: "gemini",
    text: text || "",
    raw: data,
  };
}
