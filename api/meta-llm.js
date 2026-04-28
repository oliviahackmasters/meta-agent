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

const TAVILY_ENDPOINT = "https://api.tavily.com/v1";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const RETAIL_SEARCH_CONFIG = [
  {
    labels: ["retail"],
    expansion: "retail trends, omnichannel customer experience, store performance, loyalty programs",
    domains: ["nrf.com", "retaildive.com", "chainstoreage.com", "forbes.com", "wsj.com"],
  },
  {
    labels: ["consumer"],
    expansion: "consumer behaviour, purchasing patterns, shopper needs, household spending",
    domains: ["consumerreports.org", "forbes.com", "mckinsey.com", "nielsen.com"],
  },
  {
    labels: ["shopper"],
    expansion: "shopper behaviour, in-store vs online journeys, basket size, conversion rates",
    domains: ["shoppertrak.com", "retaildive.com", "forbes.com"],
  },
  {
    labels: ["luxury"],
    expansion: "luxury retail trends, high-end brand strategy, premium customer experience",
    domains: ["businessoffashion.com", "vogue.com", "luxurydaily.com", "forbes.com"],
  },
  {
    labels: ["fashion"],
    expansion: "fashion retail performance, apparel trends, runway-to-retail conversion, sustainability",
    domains: ["businessoffashion.com", "vogue.com", "wwd.com"],
  },
  {
    labels: ["beauty"],
    expansion: "beauty industry trends, cosmetics innovation, retail beauty channels",
    domains: ["allure.com", "vogue.com", "beautypackaging.com", "glossy.co"],
  },
  {
    labels: ["grocery"],
    expansion: "grocery retail, food shopping trends, fresh categories, omnichannel grocery",
    domains: ["instacart.com", "grocerydive.com", "supermarketnews.com"],
  },
  {
    labels: ["ecommerce", "e-commerce"],
    expansion: "ecommerce growth, marketplace trends, online retail platforms, digital commerce",
    domains: ["techcrunch.com", "reuters.com", "forbes.com", "wsj.com"],
  },
  {
    labels: ["stores"],
    expansion: "store operations, in-store experience, omnichannel store strategy",
    domains: ["retaildive.com", "chainstoreage.com", "nrf.com"],
  },
  {
    labels: ["brands"],
    expansion: "brand positioning, customer loyalty, digital brand experience",
    domains: ["forbes.com", "adweek.com", "brandweek.com", "marketingdive.com"],
  },
];

function classifyResearchMode(input) {
  const lower = input.toLowerCase();
  const extractPattern = /https?:\/\/|www\.|\b(extract|summarize these urls|from these urls|from these links|url:|urls:)\b/;
  const researchPattern = /\b(research|analyse|analyze|investigate|study|deep dive|explore|benchmark|report|insights|analysis)\b/;
  const searchPattern = /\b(search|find|lookup|latest|current|today|recent|news|trend|trends|prices|forecast|update)\b/;

  if (extractPattern.test(lower)) return "extract";
  if (researchPattern.test(lower)) return "research";
  if (searchPattern.test(lower)) return "search";
  return "none";
}

function buildTavilySearchQuery(input) {
  const lower = input.toLowerCase();
  const searchMode = /\b(latest|current|today|recent|news|update)\b/.test(lower) ? "news" : "web";
  const matches = RETAIL_SEARCH_CONFIG.filter((topic) =>
    topic.labels.some((label) => lower.includes(label))
  );
  const expansions = [...new Set(matches.flatMap((topic) => topic.expansion.split(",").map((item) => item.trim())))].join("; ");
  const domains = [...new Set(matches.flatMap((topic) => topic.domains))];
  const domainHint = domains.length ? `\nPreferred sources: ${domains.join(", ")}.` : "";

  const query = `Research query: ${input}${expansions ? `\nFocus on: ${expansions}.` : ""}${domainHint}`;
  return { query, searchMode };
}

function parseUrls(input) {
  const urlPattern = /https?:\/\/[^\s]+/g;
  const matches = input.match(urlPattern) || [];
  return [...new Set(matches)];
}

function normalizeSourceItems(items, searchMode) {
  if (!Array.isArray(items)) return [];
  const serverDate = new Date().toISOString();

  return items
    .filter(Boolean)
    .map((item) => ({
      serverDate,
      searchMode,
      title: item.title || item.name || item.headline || "Untitled source",
      url: item.url || item.link || item.sourceUrl || item.source || "",
      publishedDate: item.publishedDate || item.published_date || item.published_at || item.date || "",
      snippet: item.snippet || item.summary || item.excerpt || item.content || item.text || "",
    }))
    .filter((item, index, all) => item.url || index === all.findIndex((candidate) => candidate.url === item.url));
}

function formatSourcePack(sourcePack, searchMode) {
  const serverDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  if (!sourcePack.length) {
    return `Server date: ${serverDate}\nSearch mode: ${searchMode}\nNo sources were returned from Tavily.`;
  }

  return [
    `Server date: ${serverDate}`,
    `Search mode: ${searchMode}`,
    ...sourcePack.map((source, index) =>
      [`Source ${index + 1}:`, `Title: ${source.title}`, `URL: ${source.url || "N/A"}`, `Published: ${source.publishedDate || "unknown"}`, `Snippet: ${source.snippet || "No snippet available."}`].join("\n")
    ),
  ].join("\n\n");
}

function buildModelPrompt(prompt, sourcePackPrompt, todayStr) {
  return `TODAY IS ${todayStr}. You are a research assistant and you have been given a sourcePack from Tavily. Use it as evidence for every claim.

${sourcePackPrompt}

INSTRUCTIONS:
- Answer using only the sourcePack and the user prompt.
- Remove unsupported claims.
- Resolve contradictions by choosing the most recent, source-backed claim.
- Prioritise recent, source-backed evidence.
- Cite sources as [1], [2], etc., and include URLs when referenced.
- Flag weak evidence or insufficient support.
- Do not invent data, dates, or sources.
- Use British English spelling.

User query:
${prompt}`;
}

function buildCombinedPrompt(prompt, sourcePackPrompt, todayStr) {
  return `TODAY IS ${todayStr}. You are a research editor combining multiple model outputs with a shared sourcePack.

${sourcePackPrompt}

EDITOR INSTRUCTIONS:
- Remove unsupported claims from model outputs.
- Resolve contradictions using the most recent source-backed evidence.
- Prioritise recent and well-supported claims.
- Cite or link sources wherever possible.
- Flag weak evidence and note where sources are insufficient.
- Keep the answer concise, clear, and research-forward.
- Summarise the strongest findings at the top.
- Use British English spelling.

User query:
${prompt}`;
}

async function tavilyFetch(endpoint, payload) {
  if (!TAVILY_API_KEY) {
    throw new Error("Missing TAVILY_API_KEY");
  }

  const response = await fetch(`${TAVILY_ENDPOINT}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TAVILY_API_KEY}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tavily ${endpoint} error: ${response.status} ${text}`);
  }

  return await response.json();
}

async function tavilySearch(query) {
  return await tavilyFetch("search", { query });
}

async function tavilyResearch(query) {
  return await tavilyFetch("research", { query });
}

async function tavilyExtract(urls) {
  return await tavilyFetch("extract", { urls });
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

    const researchMode = classifyResearchMode(prompt);
    const { query: tavilyQuery, searchMode } = buildTavilySearchQuery(prompt);
    let tavilyData = null;
    let sourceItems = [];

    if (researchMode === "search") {
      tavilyData = await tavilySearch(tavilyQuery);
      sourceItems = tavilyData?.results || tavilyData?.items || [];
    } else if (researchMode === "research") {
      const [searchResult, researchResult] = await Promise.all([
        tavilySearch(tavilyQuery),
        tavilyResearch(tavilyQuery),
      ]);
      const searchItems = searchResult?.results || searchResult?.items || [];
      const researchItems = researchResult?.results || researchResult?.items || [];
      sourceItems = [...searchItems, ...researchItems];
      if (researchResult?.summary) {
        sourceItems.unshift({
          title: "Tavily research summary",
          url: "",
          publishedDate: "",
          snippet: researchResult.summary,
        });
      }
    } else if (researchMode === "extract") {
      const urls = parseUrls(prompt);
      if (!urls.length) {
        return res.status(400).json({
          error: "Extract mode requires one or more URLs in the user prompt.",
        });
      }
      tavilyData = await tavilyExtract(urls);
      sourceItems = tavilyData?.extracts || tavilyData?.results || tavilyData?.items || [];
    }

    const sourcePack = normalizeSourceItems(sourceItems, researchMode === "none" ? "none" : searchMode);
    const sourcePackPrompt = formatSourcePack(sourcePack, researchMode === "none" ? "none" : searchMode);

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
      openai: (p) => runOpenAI(p, sourcePackPrompt),
      claude: (p) => runClaude(p, sourcePackPrompt),
      gemini: (p) => runGemini(p, sourcePackPrompt),
      deepseek: (p) => runDeepSeek(p, sourcePackPrompt),
      infomaniak: (p) => runInfomaniak(p, sourcePackPrompt),
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

    const combined = await runCombined(results, prompt, sourcePackPrompt);

    return res.status(200).json({
      prompt,
      researchMode,
      searchMode,
      tavilyQuery,
      selectedProviders: uniqueProviders,
      results,
      combined,
      sourcePack,
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

async function runOpenAI(prompt, sourcePackPrompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error("Missing OPENAI_API_KEY");
    err.provider = "openai";
    throw err;
  }

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr);

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

async function runClaude(prompt, sourcePackPrompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error("Missing ANTHROPIC_API_KEY");
    err.provider = "claude";
    throw err;
  }

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr);

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

async function runGemini(prompt, sourcePackPrompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    const err = new Error("Missing GEMINI_API_KEY");
    err.provider = "gemini";
    throw err;
  }

  try {
    const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr);
    
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

async function runDeepSeek(prompt, sourcePackPrompt) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    const err = new Error("Missing DEEPSEEK_API_KEY");
    err.provider = "deepseek";
    throw err;
  }

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr);

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

async function runInfomaniak(prompt, sourcePackPrompt) {
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
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr);

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

async function runCombined(results, prompt, sourcePackPrompt) {
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
  const systemPrompt = buildCombinedPrompt(prompt, sourcePackPrompt, todayStr);

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