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
      runGemini(prompt)
      // runDeepSeek(prompt),
    ]);

    const results = settled.map((item) => {
      if (item.status === "fulfilled") return item.value;
      return {
        provider: item.reason?.provider || "unknown",
        error: item.reason?.message || String(item.reason),
      };
    });

    const combined = await runCombined(results, prompt);

    return res.status(200).json({
      prompt,
      results,
      combined,
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
      model: "gpt-5-4",
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
      model: "claude-sonnet-4-5",
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
      model: "gemini-2.5-flash",
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

async function runDeepSeek(prompt) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    const err = new Error("Missing DEEPSEEK_API_KEY");
    err.provider = "deepseek";
    throw err;
  }

  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
      stream: false,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    const err = new Error(`DeepSeek error: ${r.status} ${text}`);
    err.provider = "deepseek";
    throw err;
  }

  const data = await r.json();

  return {
    provider: "deepseek",
    text: data?.choices?.[0]?.message?.content?.trim() || "",
  };
}

async function runCombined(results, prompt) {
  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    return {
      provider: "combined",
      error: "Missing OPENAI_API_KEY",
    };
  }

  const usable = results
    .filter((r) => r.text && !r.error)
    .map((r) => `${r.provider.toUpperCase()}:\n${r.text}`)
    .join("\n\n---\n\n");

  if (!usable) {
    return {
      provider: "combined",
      error: "No valid responses to combine",
    };
  }

  const systemPrompt = [
    "You are a meta AI summarizer.",
    "Given multiple model answers to the same prompt, write one concise combined response.",
    "Remove repetition.",
    "Keep the strongest useful insights.",
    "Prefer clarity over length.",
    "Do not mention providers.",
    "Do not add meta commentary.",
  ].join(" ");

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `User prompt:\n${prompt}\n\nModel outputs:\n\n${usable}`,
        },
      ],
      temperature: 0.4,
      max_completion_tokens: 300,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    return {
      provider: "combined",
      error: `Combine error: ${r.status} ${text}`,
    };
  }

  const data = await r.json();

  return {
    provider: "combined",
    text: data?.choices?.[0]?.message?.content?.trim() || "",
  };
}