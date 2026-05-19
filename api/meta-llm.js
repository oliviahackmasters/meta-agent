import { GoogleGenAI } from "@google/genai";

const AVAILABLE_PROVIDERS = ["openai", "claude", "gemini", "deepseek", "infomaniak"];
const DEFAULT_PROVIDERS = ["openai"];

function wantsScenarioMatrix(text) {
  const lower = text.toLowerCase();
  return /\b(scenario|matrix|2x2|scenarios|scenario matrix|scenario planning|scenario planner)\b/.test(lower);
}

function augmentScenarioPrompt(text) {
  return `The user is requesting a scenario matrix output.\n- List the top 2-3 drivers affecting the industry.\n- Choose one driver for the X axis and one driver for the Y axis.\n- Present a 2x2 matrix as a simple table with axis labels.\n- In each of the four cells, briefly describe the scenario in 1-2 sentences.\n- Use a plain text table layout like:\n  | X\\Y | High Y | Low Y |\n  | High X | ... | ... |\n  | Low X | ... | ... |\n- Each cell should include: scenario name, characteristics, and 1-2 source-backed claims.\n- Keep it concise and structured.\n\n${text}`;
}

const tavilyErrorState = {
  errors: [],
};

function resetTavilyErrors() {
  tavilyErrorState.errors = [];
}

function recordTavilyError(err, context = "") {
  const message = err?.message || String(err);
  const status = err?.status || null;

  tavilyErrorState.errors.push({
    context,
    status,
    message,
  });
}

function hasTavilyLimitError() {
  return tavilyErrorState.errors.some((err) =>
    err.status === 432 ||
    /exceeds your plan|usage limit|rate limit|quota/i.test(err.message)
  );
}

const TAVILY_ENDPOINT = (process.env.TAVILY_ENDPOINT || "https://api.tavily.com").replace(/\/$/, "");
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_PROJECT_ID = process.env.TAVILY_PROJECT_ID;

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
  const researchPattern = /\b(research|analyse|analyze|investigate|study|deep dive|explore|benchmark|report|insights|analysis|future|trends|drivers|scenario|industry)\b/;
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
  return { query: query.substring(0, 400), searchMode };
}

const GENERAL_NEWS_DOMAIN_FILTERS = ["reuters.com", "apnews.com", "bbc.com", "nytimes.com"];

const POLITICS_DOMAIN_FILTERS = [
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "channelnewsasia.com",
  "straitstimes.com",
  "gov.sg",
  "pmo.gov.sg",
  "mfa.gov.sg",
];

const RETAIL_DOMAIN_FILTERS = [
  "retaildive.com",
  "voguebusiness.com",
  "ft.com",
  "businessoffashion.com",
];

const ECONOMY_DOMAIN_FILTERS = [
  "reuters.com",
  "ft.com",
  "bloomberg.com",
  "wsj.com",
  "imf.org",
  "worldbank.org",
];

const TECH_DOMAIN_FILTERS = [
  "techcrunch.com",
  "theverge.com",
  "wired.com",
  "mit.edu",
  "ieee.org",
  "reuters.com",
];

const BRAND_QUERIES = ["Zara", "Nike", "Amazon"];

function getTokenLimit(researchMode) {
  switch (researchMode) {
    case "research":
      return 1000; // Deep research needs more tokens
    case "search":
      return 450; // News/search moderate
    case "extract":
      return 400; // URL extraction
    default:
      return 350; // Concise answers by default
  }
}

function getTemperature(researchMode) {
  switch (researchMode) {
    case "research":
      return 0.5; // Lower temp for research consistency
    case "extract":
      return 0.3; // Very low for extraction accuracy
    default:
      return 0.7; // Default
  }
}

function detectResearchDomain(input) {
  const lower = String(input || "").toLowerCase();

  if (/\b(government|politics|political|minister|prime minister|president|parliament|cabinet|election|policy|policies|legislation|law|regulation|public sector|state|diplomacy|foreign affairs)\b/.test(lower)) {
    return "politics";
  }

  if (/\b(retail|brand|brands|shopper|consumer|ecommerce|e-commerce|fashion|beauty|grocery|luxury|store|stores|shopping|department store|department stores)\b/.test(lower)) {
    return "retail";
  }

  if (/\b(technology|ai|artificial intelligence|software|platform|cloud|cyber|semiconductor|startup|app|digital)\b/.test(lower)) {
    return "technology";
  }

  if (/\b(economy|economic|market|markets|inflation|interest rates|gdp|trade|finance|banking|investment)\b/.test(lower)) {
    return "economy";
  }

  return "general";
}

function isRetailRelated(input) {
  return detectResearchDomain(input) === "retail";
}

function truncateQuery(query, maxLength = 400) {
  return query.length > maxLength ? query.substring(0, maxLength - 3) + "..." : query;
}

function rewriteQuery(query) {
  const domain = detectResearchDomain(query);
  const lower = String(query || "").toLowerCase();

  if (domain === "retail") {
    const rewrites = [
      `${query} retail trends report`,
      `${query} retail industry analysis 2025 2026`,
      `${query} consumer behaviour trends`,
      `${query} store strategy case studies`,
      `${query} ecommerce and omnichannel trends`,
    ];

    if (lower.includes("department store")) {
      rewrites.push(`${query} department stores outlook`);
      rewrites.push(`${query} department store closures openings data`);
    }

    if (lower.includes("future")) {
      rewrites.push(`${query} 2026 predictions`);
      rewrites.push(`${query} emerging retail trends`);
    }

    return rewrites.slice(0, 5);
  }

  if (domain === "politics") {
    return [
      `${query} latest government news`,
      `${query} cabinet changes latest`,
      `${query} parliament policy announcements latest`,
      `${query} official government statement`,
      `${query} Reuters AP BBC latest`,
    ];
  }

  if (domain === "economy") {
    return [
      `${query} latest economic news`,
      `${query} market analysis latest`,
      `${query} official statistics latest`,
      `${query} Reuters FT latest`,
      `${query} outlook 2026`,
    ];
  }

  if (domain === "technology") {
    return [
      `${query} latest technology news`,
      `${query} product update latest`,
      `${query} industry analysis latest`,
      `${query} Reuters TechCrunch latest`,
      `${query} 2026 trends`,
    ];
  }

  return [
    `${query} latest news`,
    `${query} recent developments`,
    `${query} current analysis`,
    `${query} official sources`,
    `${query} Reuters AP BBC`,
  ];
}

function generateTavilySubQueries(input, searchMode) {
  const truncatedInput = input.substring(0, 200);
  const domain = detectResearchDomain(input);

  const queries = [];

  if (searchMode === "news") {
    queries.push(truncateQuery(`Latest news for ${truncatedInput}`));
    queries.push(truncateQuery(`Recent developments for ${truncatedInput}`));
  } else {
    queries.push(truncateQuery(truncatedInput));
    queries.push(truncateQuery(`Analysis of ${truncatedInput}`));
  }

  if (domain === "politics") {
    queries.push(truncateQuery(`Government policy and cabinet updates for ${truncatedInput}`));
    queries.push(truncateQuery(`Official statements and parliament news for ${truncatedInput}`));
  }

  if (domain === "retail") {
    queries.push(truncateQuery(`Retail industry news for ${truncatedInput}`));

    for (const brand of BRAND_QUERIES) {
      queries.push(truncateQuery(`News and retail strategy for ${brand} related to ${truncatedInput}`));
    }
  }

  if (domain === "economy") {
    queries.push(truncateQuery(`Economic indicators and market analysis for ${truncatedInput}`));
    queries.push(truncateQuery(`Official economic data for ${truncatedInput}`));
  }

  if (domain === "technology") {
    queries.push(truncateQuery(`Technology industry news for ${truncatedInput}`));
    queries.push(truncateQuery(`Product and platform updates for ${truncatedInput}`));
  }

  return [...new Set(queries)].slice(0, 6);
}

function computeSourceRank(item) {
  let rank = 0;

  if (typeof item.score === "number") {
    rank += item.score;
  }

  const domain = String(item.url || item.link || item.sourceUrl || item.source || "").toLowerCase();
  if (domain.includes("reuters.com")) rank += 4;
  if (domain.includes("apnews.com") || domain.includes("bbc.com") || domain.includes("nytimes.com")) rank += 3;
  if (domain.includes("retaildive.com") || domain.includes("businessoffashion.com") || domain.includes("voguebusiness.com") || domain.includes("ft.com")) rank += 3;
  if (domain.includes("forbes.com") || domain.includes("wsj.com") || domain.includes("mckinsey.com")) rank += 1;

  const published = new Date(item.publishedDate || item.published_date || item.published_at || item.date || 0);
  if (!Number.isNaN(published.getTime())) {
    const ageDays = (Date.now() - published.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 30) rank += 2;
    else if (ageDays < 180) rank += 1;
  }

  if (item.snippet || item.summary || item.excerpt || item.content || item.text) {
    rank += 1;
  }

  return rank;
}

function mergeDeduplicateRankSources(items) {
  const map = new Map();

  for (const item of items || []) {
    if (!item) continue;

    const url = String(item.url || item.link || item.sourceUrl || item.source || "").trim();
    const title = String(item.title || item.name || item.headline || "").trim();
    const snippet = String(item.snippet || item.summary || item.excerpt || item.content || item.text || "").trim();
    const key = url ? url.toLowerCase() : `${title}|${snippet}`;
    if (!key.trim()) continue;

    const rank = computeSourceRank(item);
    const existing = map.get(key);

    if (!existing || rank > existing.rank) {
      map.set(key, { item, rank });
    } else if (existing && !existing.item.snippet && item.snippet) {
      map.set(key, { item: { ...existing.item, snippet: item.snippet }, rank: existing.rank });
    }
  }

  return [...map.values()]
    .sort((a, b) => b.rank - a.rank)
    .map((entry) => entry.item);
}

async function runTavilySearchSubQueries(input, searchMode) {
  const subQueries = generateTavilySubQueries(input, searchMode);
  const domain = detectResearchDomain(input);

  let preferred_sources;

  if (domain === "politics") {
    preferred_sources = POLITICS_DOMAIN_FILTERS;
  } else if (domain === "retail") {
    preferred_sources = RETAIL_DOMAIN_FILTERS;
  } else if (domain === "economy") {
    preferred_sources = ECONOMY_DOMAIN_FILTERS;
  } else if (domain === "technology") {
    preferred_sources = TECH_DOMAIN_FILTERS;
  } else if (searchMode === "news") {
    preferred_sources = GENERAL_NEWS_DOMAIN_FILTERS;
  }

  const baseOptions = {
    max_results: 10,
    search_depth: "advanced",
  };

  if (preferred_sources?.length) {
    baseOptions.preferred_sources = preferred_sources;
  }

  const responses = await Promise.all(
    subQueries.map((query) =>
      tavilySearch(query, baseOptions)
        .then((res) => res?.results || res?.items || [])
        .catch((err) => {
          recordTavilyError(err, query);
          console.warn("Tavily subquery failed", query, err?.message || err);
          return [];
        })
    )
  );

  return responses.flat();
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
  return `Server date: ${serverDate}
Search mode: ${searchMode}
SOURCE PACK STATUS: EMPTY

No usable sources are available.

Rules:
- Do not provide a source-backed answer.
- Do not invent citations.
- Do not use placeholder citations.
- Do not use "(Source: [N] Title, URL)".
- If answering at all, state that no usable sources were retrieved.
- General background may only be included under the heading "General context, not source-backed".`;
}

  return [
    `Server date: ${serverDate}`,
    `Search mode: ${searchMode}`,
    `Available sources for citation:\n`,
    ...sourcePack.map((source, index) =>
      [`[${index + 1}] ${source.title}\nURL: ${source.url || "N/A"}\nPublished: ${source.publishedDate || "unknown"}\nSnippet: ${source.snippet || "No snippet available."}`].join("")
    ),
  ].join("\n\n");
}

function buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory = "") {
  return `TODAY IS ${todayStr}. You are a research assistant with a sourcePack from Tavily.

${sourcePackPrompt}

OUTPUT RULES:
- This is a new query. Use only the current source pack for evidence. Do not rely on previous source packs or previous sourced claims unless the user explicitly asks to continue from them.
- CITATION: Use inline citation format ONLY. When citing a source, include the exact source number, title and URL from the source pack, for example: (Source: [1] Actual Source Title, https://example.com). Do NOT use placeholder citations such as (Source: [N] Title, URL).
- CLAIMS: Every factual claim must be backed by a source from the sourcePack. If unsupported, omit it or label it as conjecture.
- FORMAT: Provide a structured answer with themes/insights. Do not force frameworks.
- SCENARIO MATRIX: ${wantsScenarioMatrix ? "You may generate a 2x2 scenario matrix with drivers, axis labels, and source-backed claims in each cell." : "Do NOT generate a scenario matrix. Provide thematic analysis only with key insights, drivers, and challenges."}
- WEAK SOURCES: If sources are limited, keep answers concise and qualified. Explicitly state uncertainty. Do NOT expand into elaborate frameworks.
- NO INVENTION: Do not invent data, dates, statistics, or sources.
- EMPTY SOURCE PACK: If the source pack status is EMPTY, do not answer the user's current/latest question. Say that no usable sources were retrieved and that a source-backed answer cannot be generated.
- DIRECTIONAL ONLY: If no strong sources exist, you may provide high-level directional analysis clearly labeled as "General industry knowledge (not source-backed)" without specific claims.
- STRUCTURE: Use clear headings, numbered points, and source citations inline.
- LANGUAGE: Use British English spelling.

${conversationHistory ? `Conversation history:\n${conversationHistory}\n\n` : ""}
User query:
${prompt}`;
}

function buildCombinedPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix) {
  return `TODAY IS ${todayStr}. You are a research editor combining multiple model outputs into a final answer.

${sourcePackPrompt}

FINAL OUTPUT RULES:
- This is a new query. Use only the current source pack for evidence. Do not rely on previous source packs or previous sourced claims unless the user explicitly asks to continue from them.
- INSUFFICIENT EVIDENCE: If the source pack is empty, return only: "No usable sources were retrieved, so I cannot provide a source-backed answer."
- FOLLOW INTENT: Do not introduce structures (e.g., scenario matrix) unless explicitly requested.
- CITATION ONLY: All claims must be source-backed with inline citations using the exact source number, title and URL from the source pack. Never use placeholder citations such as (Source: [N] Title, URL). Remove unsourced claims.
- CONFLICTS: If models disagree, prioritise source-backed claims. Flag disagreements with reasoning.
- MATRIX: ${wantsScenarioMatrix ? "You may present a 2x2 scenario matrix with source-backed claims in each cell." : "Do NOT generate a scenario matrix unless requested. Provide thematic analysis instead."}
- WEAK SOURCES: If sources are thin, keep answers concise and qualified. Clearly state uncertainty. Do not pad with generic frameworks.
- DIRECTIONAL: For strategic questions with no strong sources, provide only high-level directional analysis labeled "General industry knowledge (not source-backed)" with no specific claims.
- STRUCTURE: Use headings, numbered points, and clear formatting. Summarise strongest findings first.
- LANGUAGE: Use British English spelling.

User query:
${prompt}`;
}

async function tavilyFetch(endpoint, payload) {
  if (!TAVILY_API_KEY) {
    throw new Error("Missing TAVILY_API_KEY");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TAVILY_API_KEY}`,
  };
  if (TAVILY_PROJECT_ID) {
    headers["X-Project-ID"] = TAVILY_PROJECT_ID;
  }

  async function attemptFetch(url) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const text = await response.text();
      const err = new Error(`Tavily ${endpoint} error: ${response.status} ${text}`);
      err.status = response.status;
      err.url = url;
      throw err;
    }

    return await response.json();
  }

  const primaryUrl = `${TAVILY_ENDPOINT}/${endpoint}`;
  try {
    return await attemptFetch(primaryUrl);
  } catch (err) {
    if (err.status === 404) {
      const fallbackUrl = `${TAVILY_ENDPOINT}/v1/${endpoint}`;
      return await attemptFetch(fallbackUrl);
    }
    throw err;
  }
}

async function tavilySearch(query, options = {}) {
  return await tavilyFetch("search", {
    query: truncateQuery(query),
    topic: "general",
    search_depth: "advanced",
    max_results: 10,
    auto_parameters: true,
    ...options,
  });
}

async function tavilyResearch(query, options = {}) {
  return await tavilyFetch("search", {
    query: truncateQuery(query),
    topic: "general",
    search_depth: "advanced",
    max_results: 10,
    auto_parameters: true,
    include_answer: true,
    include_raw_content: false,
    ...options,
  });
}

async function tavilyExtract(urls) {
  return await tavilyFetch("extract", {
    url: Array.isArray(urls) ? urls : [urls],
    depth: "basic",
  });
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
    resetTavilyErrors();
    const messages = Array.isArray(req.body?.messages)
      ? req.body.messages.filter((m) => m && typeof m.content === "string")
      : [];

    const latestUserMessage = messages
      .slice()
      .reverse()
      .find((m) => String(m.role || "").toLowerCase() === "user")
      ?.content?.toString?.().trim();

const rawPrompt =
  latestUserMessage ||
  (typeof req.body?.prompt === "string"
    ? req.body.prompt.trim()
    : req.body?.prompt != null
      ? String(req.body.prompt).trim()
      : "");

if (!rawPrompt) {
  return res.status(400).json({ error: "Missing prompt or user message" });
}

const conversationHistory = messages.length
  ? messages.map((m) => `${m.role}: ${m.content}`).join("\n")
  : "";

const userPrompt = rawPrompt;
const shouldGenerateMatrix = wantsScenarioMatrix(userPrompt);
const prompt = shouldGenerateMatrix
  ? augmentScenarioPrompt(userPrompt)
  : userPrompt;
      

    const researchMode = classifyResearchMode(userPrompt);
    const { query: tavilyQuery, searchMode } = buildTavilySearchQuery(userPrompt);
    let tavilyData = null;
    let sourceItems = [];

    if (researchMode === "search") {
      sourceItems = await runTavilySearchSubQueries(tavilyQuery, searchMode);
      // Fallback: if no results, try rewritten queries
      if (sourceItems.length === 0) {
        const rewrittenQueries = rewriteQuery(userPrompt);
        for (const rewritten of rewrittenQueries) {
          const fallbackItems = await runTavilySearchSubQueries(rewritten, searchMode);
          sourceItems = [...sourceItems, ...fallbackItems];
          if (sourceItems.length > 0) break; // Stop after first successful fallback
        }
      }
    } else if (researchMode === "research") {
      const [searchItems, researchResult] = await Promise.all([
        runTavilySearchSubQueries(tavilyQuery, searchMode),
        tavilyResearch(tavilyQuery).catch((err) => {
          console.warn("Tavily research failed", err?.message || err);
          return null;
        }),
      ]);
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
      // Fallback for research mode
      if (sourceItems.length === 0) {
        const rewrittenQueries = rewriteQuery(userPrompt);
        for (const rewritten of rewrittenQueries) {
          const [fallbackSearch, fallbackResearch] = await Promise.all([
            runTavilySearchSubQueries(rewritten, searchMode),
            tavilyResearch(rewritten).catch((err) => {
              console.warn("Tavily fallback research failed", err?.message || err);
              return null;
            }),
          ]);
          const fallbackResearchItems = fallbackResearch?.results || fallbackResearch?.items || [];
          sourceItems = [...sourceItems, ...fallbackSearch, ...fallbackResearchItems];
          if (fallbackResearch?.summary) {
            sourceItems.unshift({
              title: "Tavily research summary",
              url: "",
              publishedDate: "",
              snippet: fallbackResearch.summary,
            });
          }
          if (sourceItems.length > 0) break;
        }
      }
    } else if (researchMode === "extract") {
      const urls = parseUrls(userPrompt);
      if (!urls.length) {
        return res.status(400).json({
          error: "Extract mode requires one or more URLs in the user prompt.",
        });
      }
      tavilyData = await tavilyExtract(urls);
      sourceItems = tavilyData?.extracts || tavilyData?.results || tavilyData?.items || [];
    }

    // If still no sources after fallbacks, set status
    const hasSources = sourceItems.length > 0;

    const mergedSources = mergeDeduplicateRankSources(sourceItems);
    const sourcePack = normalizeSourceItems(mergedSources, researchMode === "none" ? "none" : searchMode);
    const sourcePackPrompt = formatSourcePack(sourcePack, researchMode === "none" ? "none" : searchMode);

    const searchWasRequested = researchMode === "search" || researchMode === "research" || researchMode === "extract";
const sourcePackEmpty = sourcePack.length === 0;
const tavilyLimitHit = hasTavilyLimitError();

if (searchWasRequested && sourcePackEmpty && tavilyLimitHit) {
  return res.status(200).json({
    latestUserMessage: userPrompt,
    messages,
    prompt,
    researchMode,
    searchMode,
    tavilyQuery,
    selectedProviders: [],
    results: [],
    combined: {
      provider: "combined",
      text: "Live search failed because the Tavily usage limit has been exceeded. No usable sources were retrieved, so I cannot provide a source-backed current answer. Upgrade the Tavily plan, wait for quota reset, or configure a fallback search provider.",
    },
    sourcePack: [],
    status: "search_limit_exceeded",
    meta: {
      timestamp: new Date().toISOString(),
      hasSources: false,
      tavilyErrors: tavilyErrorState.errors,
    },
  });
}

if (searchWasRequested && sourcePackEmpty) {
  return res.status(200).json({
    latestUserMessage: userPrompt,
    messages,
    prompt,
    researchMode,
    searchMode,
    tavilyQuery,
    selectedProviders: [],
    results: [],
    combined: {
      provider: "combined",
      text: "No usable sources were retrieved for this query, so I cannot provide a source-backed current answer. Try a more specific query or configure additional search/source providers.",
    },
    sourcePack: [],
    status: "no_sources",
    meta: {
      timestamp: new Date().toISOString(),
      hasSources: false,
      tavilyErrors: tavilyErrorState.errors,
    },
  });
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

    console.log({
      latestUserMessage: userPrompt,
      sourcePackLength: sourcePack.length,
      messageCount: messages.length,
      researchMode,
      searchMode,
    });

    const providerRunners = {
      openai: (p) => runOpenAI(p, sourcePackPrompt, shouldGenerateMatrix, researchMode, conversationHistory),
      claude: (p) => runClaude(p, sourcePackPrompt, shouldGenerateMatrix, researchMode, conversationHistory),
      gemini: (p) => runGemini(p, sourcePackPrompt, shouldGenerateMatrix, researchMode, conversationHistory),
      deepseek: (p) => runDeepSeek(p, sourcePackPrompt, shouldGenerateMatrix, researchMode, conversationHistory),
      infomaniak: (p) => runInfomaniak(p, sourcePackPrompt, shouldGenerateMatrix, researchMode, conversationHistory),
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

    const combined = await runCombined(results, userPrompt, sourcePackPrompt, shouldGenerateMatrix, researchMode);

    return res.status(200).json({
      latestUserMessage: userPrompt,
      messages,
      prompt,
      researchMode,
      searchMode,
      tavilyQuery,
      selectedProviders: uniqueProviders,
      results,
      combined,
      sourcePack,
      status: hasSources ? "success" : "no_sources",
      meta: {
        timestamp: new Date().toISOString(),
        hasSources,
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

async function runOpenAI(prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode, conversationHistory) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error("Missing OPENAI_API_KEY");
    err.provider = "openai";
    throw err;
  }

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory);
  const maxTokens = getTokenLimit(researchMode);
  const temperature = getTemperature(researchMode);

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
      temperature: temperature,
      max_completion_tokens: maxTokens,
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

async function runClaude(prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode, conversationHistory) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error("Missing ANTHROPIC_API_KEY");
    err.provider = "claude";
    throw err;
  }

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory);
  const maxTokens = getTokenLimit(researchMode);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
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

async function runGemini(prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode, conversationHistory) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    const err = new Error("Missing GEMINI_API_KEY");
    err.provider = "gemini";
    throw err;
  }

  try {
    const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory);
    const maxTokens = getTokenLimit(researchMode);
    
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

async function runDeepSeek(prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode, conversationHistory) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    const err = new Error("Missing DEEPSEEK_API_KEY");
    err.provider = "deepseek";
    throw err;
  }

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory);
  const maxTokens = getTokenLimit(researchMode);
  const temperature = getTemperature(researchMode);

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
      temperature: temperature,
      max_tokens: maxTokens,
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

async function runInfomaniak(prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode, conversationHistory) {
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
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory);
  const maxTokens = getTokenLimit(researchMode);
  const temperature = getTemperature(researchMode);

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
        temperature: temperature,
        max_tokens: maxTokens,
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

async function runCombined(results, prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode) {
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
  const systemPrompt = buildCombinedPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix);
  const maxTokens = Math.max(500, getTokenLimit(researchMode) * 1.2); // Combiner gets 20% more to synthesize
  const temperature = 0.4; // Lower temp for combining

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
      temperature: temperature,
      max_completion_tokens: Math.floor(maxTokens),
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