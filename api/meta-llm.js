import { GoogleGenAI } from "@google/genai";

const AVAILABLE_PROVIDERS = ["openai", "claude", "gemini", "deepseek", "infomaniak"];
const DEFAULT_PROVIDERS = ["openai", "claude", "gemini"];

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

    const requestedProviders = Array.isArray(req.body?.providers)
      ? req.body.providers
      : DEFAULT_PROVIDERS;

    const selectedProviders = requestedProviders
      .map((p) => String(p).toLowerCase().trim())
      .filter((p) => AVAILABLE_PROVIDERS.includes(p));

    const uniqueProviders = [...new Set(selectedProviders)];

    if (!uniqueProviders.length) {
      return res.status(400).json({
        error: "No valid providers selected",
        availableProviders: AVAILABLE_PROVIDERS,
      });
    }

    const providerRunners = {
      openai: runOpenAI,
      claude: runClaude,
      gemini: runGemini,
      deepseek: runDeepSeek,
      infomaniak: runInfomaniak,
    };

    const settled = await Promise.allSettled(
      uniqueProviders.map((provider) => providerRunners[provider](prompt))
    );

    const results = settled.map((item, index) => {
      const provider = uniqueProviders[index];

      if (item.status === "fulfilled") {
        return item.value;
      }

      return {
        provider,
        error: item.reason?.message || String(item.reason),
      };
    });

    const combined = await runCombined(results, prompt);

    return res.status(200).json({
      prompt,
      selectedProviders: uniqueProviders,
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

async function runInfomaniak(prompt) {
  const token = process.env.INFOMANIAK_API_TOKEN;
  const productId = process.env.INFOMANIAK_PRODUCT_ID;
  const model = process.env.INFOMANIAK_MODEL || "qwen3";

  if (!token) {
    const err = new Error("Missing INFOMANIAK_API_TOKEN");
    err.provider = "infomaniak";
    throw err;
  }

  if (!productId) {
    const err = new Error("Missing INFOMANIAK_PRODUCT_ID");
    err.provider = "infomaniak";
    throw err;
  }

  const r = await fetch(
    `https://api.infomaniak.com/2/ai/${productId}/openai/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 500,
      }),
    }
  );

  if (!r.ok) {
    const text = await r.text();
    const err = new Error(`Infomaniak error: ${r.status} ${text}`);
    err.provider = "infomaniak";
    throw err;
  }

  const data = await r.json();

  return {
    provider: "infomaniak",
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
    "Today's date is " + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + ".",
    "Given multiple model answers to the same prompt based on web search evidence:",
    "- Write one concise combined response",
    "- Remove repetition and prioritize strongest insights",
    "- Treat web search results in the prompt context as source of truth",
    "- For retail research, synthesize consumer behavior and market trend insights",
    "- Do NOT invent statistics, report names, or sources not mentioned in the evidence",
    "- Do not mention individual providers",
    "- Acknowledge when evidence is weak or limited",
    "- Prefer clarity over length",
    "- Do not add meta commentary",
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