import { GoogleGenAI } from "@google/genai";

const AVAILABLE_PROVIDERS = ["openai", "claude", "gemini", "deepseek", "infomaniak"];
const DEFAULT_PROVIDERS = ["openai"];

function isScenarioPrompt(text) {
  const lower = text.toLowerCase();
  return /\b(scenario|scenario planning|scenario planner|matrix|2x2|drivers|probability|future|potential futures)\b/.test(lower);
}

function augmentScenarioPrompt(text) {
  return `This user wants a clear scenario matrix output.\n- List the top drivers affecting the industry first.\n- Choose one driver for the X axis and one driver for the Y axis.\n- Present a 2x2 matrix as a simple table with axis labels.\n- In each of the four cells, briefly describe the crossing of the drivers in 1-2 sentences.\n- Use a plain text table layout like:\n  | X\\Y | High Y | Low Y |\n  | High X | ... | ... |\n  | Low X | ... | ... |\n- Do not use long paragraph prose, and do not produce a messy ASCII art block.\n- Keep the matrix concise, structured, and workshop-friendly.\n\n${text}`;
}

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
    let prompt = req.body?.prompt?.toString?.().trim();

    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    if (isScenarioPrompt(prompt)) {
      prompt = augmentScenarioPrompt(prompt);
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

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = `TODAY IS ${todayStr}. You must answer with today's actual date.\n\n${prompt}`;

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are answering questions on " + todayStr + ". Always use today's actual date in your responses, not your training data cutoff." },
        { role: "user", content: fullPrompt }
      ],
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

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = `TODAY IS ${todayStr}. You must answer with today's actual date.\n\n${prompt}`;

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
      system: "You are answering questions on " + todayStr + ". Always use today's actual date in your responses, not your training data cutoff.",
      messages: [{ role: "user", content: fullPrompt }],
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
    const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const fullPrompt = `TODAY IS ${todayStr}. You must answer with today's actual date, not your training data.\n\n${prompt}`;
    
    const ai = new GoogleGenAI({ apiKey: key });

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: fullPrompt,
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

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = `TODAY IS ${todayStr}. You must answer with today's actual date.\n\n${prompt}`;

  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "You are answering questions on " + todayStr + ". Always use today's actual date in your responses, not your training data cutoff." },
        { role: "user", content: fullPrompt }
      ],
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

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = `TODAY IS ${todayStr}. You must answer with today's actual date.\n\n${prompt}`;

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
        messages: [
          { role: "system", content: "You are answering questions on " + todayStr + ". Always use today's actual date in your responses, not your training data cutoff." },
          { role: "user", content: fullPrompt }
        ],
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

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const systemPrompt = `You are synthesizing responses from multiple AI models on ${todayStr}.

Key rules for synthesis:
- All models had access to LIVE EVIDENCE fetched from the internet TODAY
- Use the strongest, most sourced insights from the model outputs
- Prioritize information that references the Evidence
- Remove repetition and hallucinations
- If models conflict, explain the difference
- Do NOT invent statistics or sources
- Keep it concise and clear
- Use British English`;

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `User prompt:\n${prompt}\n\nModel outputs:\n\n${usable}`,
        },
      ],
      temperature: 0.4,
      max_completion_tokens: 400,
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