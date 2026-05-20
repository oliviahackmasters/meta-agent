// meta-llm.js 
import { GoogleGenAI } from "@google/genai";


const PROJECT_MEMORY_API_BASE =
  process.env.PROJECT_MEMORY_API_BASE ||
  "https://project-memory-api.olivia-9ef.workers.dev";

function summariseOutputForMemory(text, maxLength = 700) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? clean.slice(0, maxLength - 3) + "..." : clean;
}

async function buildProjectContext({
  projectId,
  toolName,
  task,
  methodologyTags = [],
  includeMethodology = true,
  maxChars = 12000,
}) {
  if (!projectId) {
    return {
      contextBlock: "",
      memoryItemsUsed: 0,
      contextItemsUsed: 0,
      methodologyItemsUsed: 0,
    };
  }

  const response = await fetch(`${PROJECT_MEMORY_API_BASE}/api/context/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      toolName,
      task,
      methodologyTags,
      includeMethodology,
      maxChars,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Project context failed: ${response.status} ${text}`);
  }

  return await response.json();
}

async function saveProjectMemory({
  projectId,
  toolName,
  type,
  title,
  summary,
  content,
  metadata,
}) {
  if (!projectId || !content) return null;

  const response = await fetch(
    `${PROJECT_MEMORY_API_BASE}/api/projects/${encodeURIComponent(projectId)}/memory`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName,
        type,
        title,
        summary,
        content,
        metadata,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Project memory save failed: ${response.status} ${text}`);
  }

  return await response.json();
}


const AVAILABLE_PROVIDERS = ["openai", "claude", "gemini", "deepseek", "infomaniak"];
const DEFAULT_PROVIDERS = ["openai"];

function wantsScenarioMatrix(text) { return /\b(scenario|matrix|2x2|scenarios|scenario matrix|scenario planning|scenario planner)\b/.test(text.toLowerCase()); }
function augmentScenarioPrompt(text) { return `The user is requesting a scenario matrix output.\n- List the top 2-3 drivers affecting the industry.\n- Choose one driver for the X axis and one driver for the Y axis.\n- Present a 2x2 matrix as a simple table with axis labels.\n- In each of the four cells, briefly describe the scenario in 1-2 sentences.\n- Keep it concise and structured.\n\n${text}`; }

function buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory = "", projectMemoryContext = "") {
  return `TODAY IS ${todayStr}. You are a research assistant with a sourcePack from Tavily.\n\n${projectMemoryContext ? `PROJECT MEMORY\nUse this as background context for the current project. Do not treat it as live evidence, and do not cite it as a source.\n\n${projectMemoryContext}\n\nEND PROJECT MEMORY\n\n` : ""}${sourcePackPrompt}\n\nOUTPUT RULES:\n- This is a new query. Use the current source pack for evidence.\n- Use project memory only for continuity and context.\n- Do not invent data, dates, statistics, or sources.\n- SCENARIO MATRIX: ${wantsScenarioMatrix ? "You may generate a 2x2 scenario matrix." : "Do NOT generate a scenario matrix unless requested."}\n- LANGUAGE: Use British English spelling.\n\n${conversationHistory ? `Conversation history:\n${conversationHistory}\n\n` : ""}User query:\n${prompt}`;
}

function buildCombinedPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, projectMemoryContext = "") {
  return `TODAY IS ${todayStr}. You are a research editor combining multiple model outputs into a final answer.\n\n${projectMemoryContext ? `PROJECT MEMORY\nUse this as background context for the current project. Do not treat it as live evidence, and do not cite it as a source.\n\n${projectMemoryContext}\n\nEND PROJECT MEMORY\n\n` : ""}${sourcePackPrompt}\n\nFINAL OUTPUT RULES:\n- Follow the user's intent.\n- Use the current source pack for evidence where sources are available.\n- Use project memory only for continuity and context.\n- Do not invent citations or use placeholder citations.\n- MATRIX: ${wantsScenarioMatrix ? "You may present a 2x2 scenario matrix." : "Do NOT generate a scenario matrix unless requested."}\n- LANGUAGE: Use British English spelling.\n\nUser query:\n${prompt}`;
}

function classifyResearchMode(input) { const lower = input.toLowerCase(); if (/https?:\/\/|www\.|\b(extract|summarize these urls|from these urls|from these links|url:|urls:)\b/.test(lower)) return "extract"; if (/\b(research|analyse|analyze|investigate|study|deep dive|explore|benchmark|report|insights|analysis|future|trends|drivers|scenario|industry)\b/.test(lower)) return "research"; if (/\b(search|find|lookup|latest|current|today|recent|news|trend|trends|prices|forecast|update)\b/.test(lower)) return "search"; return "none"; }
function formatSourcePack(sourcePack, searchMode) { const serverDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); if (!sourcePack.length) return `Server date: ${serverDate}\nSearch mode: ${searchMode}\nNo usable sources are available.`; return [`Server date: ${serverDate}`, `Search mode: ${searchMode}`, `Available sources for citation:\n`, ...sourcePack.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url || "N/A"}\nPublished: ${s.publishedDate || "unknown"}\nSnippet: ${s.snippet || "No snippet available."}`)].join("\n\n"); }
function normalizeSourceItems(items, searchMode) { if (!Array.isArray(items)) return []; const serverDate = new Date().toISOString(); return items.filter(Boolean).map((item) => ({ serverDate, searchMode, title: item.title || item.name || item.headline || "Untitled source", url: item.url || item.link || item.sourceUrl || item.source || "", publishedDate: item.publishedDate || item.published_date || item.published_at || item.date || "", snippet: item.snippet || item.summary || item.excerpt || item.content || item.text || "" })).filter((item, index, all) => item.url || index === all.findIndex((candidate) => candidate.url === item.url)); }
function mergeDeduplicateRankSources(items) { const map = new Map(); for (const item of items || []) { const url = String(item?.url || item?.link || item?.sourceUrl || item?.source || "").trim(); const title = String(item?.title || item?.name || item?.headline || "").trim(); const snippet = String(item?.snippet || item?.summary || item?.excerpt || item?.content || item?.text || "").trim(); const key = url ? url.toLowerCase() : `${title}|${snippet}`; if (!key.trim()) continue; if (!map.has(key)) map.set(key, item); } return [...map.values()]; }
function detectResearchDomain(input) { const lower = String(input || "").toLowerCase(); if (/\b(government|politics|political|minister|prime minister|president|parliament|cabinet|election|policy|law|regulation|public sector|state)\b/.test(lower)) return "politics"; if (/\b(retail|brand|shopper|consumer|ecommerce|fashion|beauty|grocery|luxury|store|shopping)\b/.test(lower)) return "retail"; return "general"; }
function generateTavilySubQueries(input, searchMode) { const q = input.substring(0, 200); const out = searchMode === "news" ? [`Latest news for ${q}`, `Recent developments for ${q}`] : [q, `Analysis of ${q}`]; if (detectResearchDomain(input) === "politics") out.push(`Government policy and parliament news for ${q}`); if (detectResearchDomain(input) === "retail") out.push(`Retail industry news for ${q}`); return [...new Set(out)].slice(0, 6); }
function parseUrls(input) { return [...new Set(input.match(/https?:\/\/[^\s]+/g) || [])]; }
function getTokenLimit(mode) { return mode === "research" ? 1000 : mode === "search" ? 450 : mode === "extract" ? 400 : 350; }
function getTemperature(mode) { return mode === "research" ? 0.5 : mode === "extract" ? 0.3 : 0.7; }
function buildTavilySearchQuery(input) { return { query: input.substring(0, 400), searchMode: /\b(latest|current|today|recent|news|update)\b/i.test(input) ? "news" : "web" }; }

const TAVILY_ENDPOINT = (process.env.TAVILY_ENDPOINT || "https://api.tavily.com").replace(/\/$/, "");
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_PROJECT_ID = process.env.TAVILY_PROJECT_ID;

async function tavilyFetch(endpoint, payload) { if (!TAVILY_API_KEY) throw new Error("Missing TAVILY_API_KEY"); const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TAVILY_API_KEY}` }; if (TAVILY_PROJECT_ID) headers["X-Project-ID"] = TAVILY_PROJECT_ID; const response = await fetch(`${TAVILY_ENDPOINT}/${endpoint}`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) }); if (!response.ok) throw new Error(`Tavily ${endpoint} error: ${response.status} ${await response.text()}`); return await response.json(); }
async function tavilySearch(query, options = {}) { return await tavilyFetch("search", { query: query.substring(0, 400), topic: "general", search_depth: "advanced", max_results: 10, auto_parameters: true, ...options }); }
async function tavilyResearch(query, options = {}) { return await tavilySearch(query, { include_answer: true, include_raw_content: false, ...options }); }
async function tavilyExtract(urls) { return await tavilyFetch("extract", { url: Array.isArray(urls) ? urls : [urls], depth: "basic" }); }
async function runTavilySearchSubQueries(input, searchMode) { const results = await Promise.all(generateTavilySubQueries(input, searchMode).map((query) => tavilySearch(query).then((r) => r?.results || r?.items || []).catch(() => []))); return results.flat(); }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages.filter((m) => m && typeof m.content === "string") : [];
    const latestUserMessage = messages.slice().reverse().find((m) => String(m.role || "").toLowerCase() === "user")?.content?.toString?.().trim();
    const rawPrompt = latestUserMessage || (typeof req.body?.prompt === "string" ? req.body.prompt.trim() : req.body?.prompt != null ? String(req.body.prompt).trim() : "");
    if (!rawPrompt) return res.status(400).json({ error: "Missing prompt or user message" });

    const projectId = req.body?.projectId?.toString?.().trim();
    const projectName = req.body?.projectName?.toString?.().trim();
    const useProjectMemory = req.body?.useProjectMemory !== false;
    const saveToProjectMemory = req.body?.saveToProjectMemory !== false;

let projectContext = {
  contextBlock: "",
  memoryItemsUsed: 0,
  contextItemsUsed: 0,
  methodologyItemsUsed: 0,
};
let projectMemoryContext = "";
let memorySaved = false;
let memorySaveError = null;
let projectContextError = null;

if (projectId && useProjectMemory) {
  try {
    projectContext = await buildProjectContext({
      projectId,
      toolName: "meta-llm",
      task: rawPrompt,
      methodologyTags: ["meta-cognition", "comparison", "scenario-planning", "drivers"],
      includeMethodology: true,
      maxChars: 12000,
    });

    projectMemoryContext = projectContext.contextBlock || "";
  } catch (err) {
    projectContextError = err?.message || String(err);
    console.error("Failed to load project context:", err);
  }
}

    const conversationHistory = messages.length ? messages.map((m) => `${m.role}: ${m.content}`).join("\n") : "";
    const userPrompt = rawPrompt;
    const shouldGenerateMatrix = wantsScenarioMatrix(userPrompt);
    const prompt = shouldGenerateMatrix ? augmentScenarioPrompt(userPrompt) : userPrompt;
    const researchMode = classifyResearchMode(userPrompt);
    const { query: tavilyQuery, searchMode } = buildTavilySearchQuery(userPrompt);
    let tavilyData = null;
    let sourceItems = [];

    if (researchMode === "search") sourceItems = await runTavilySearchSubQueries(tavilyQuery, searchMode);
    else if (researchMode === "research") {
      const [searchItems, researchResult] = await Promise.all([runTavilySearchSubQueries(tavilyQuery, searchMode), tavilyResearch(tavilyQuery).catch(() => null)]);
      sourceItems = [...searchItems, ...(researchResult?.results || researchResult?.items || [])];
      if (researchResult?.summary) sourceItems.unshift({ title: "Tavily research summary", url: "", publishedDate: "", snippet: researchResult.summary });
    } else if (researchMode === "extract") {
      const urls = parseUrls(userPrompt);
      if (!urls.length) return res.status(400).json({ error: "Extract mode requires one or more URLs in the user prompt." });
      tavilyData = await tavilyExtract(urls);
      sourceItems = tavilyData?.extracts || tavilyData?.results || tavilyData?.items || [];
    }

    const hasSources = sourceItems.length > 0;
    const sourcePack = normalizeSourceItems(mergeDeduplicateRankSources(sourceItems), researchMode === "none" ? "none" : searchMode);
    const sourcePackPrompt = formatSourcePack(sourcePack, researchMode === "none" ? "none" : searchMode);

    const requestedProviders = Array.isArray(req.body?.providers) ? req.body.providers : DEFAULT_PROVIDERS;
    const uniqueProviders = [...new Set(requestedProviders.map((p) => String(p).toLowerCase().trim()).filter((p) => AVAILABLE_PROVIDERS.includes(p)))];
    if (!uniqueProviders.length) return res.status(400).json({ error: "No valid providers selected", availableProviders: AVAILABLE_PROVIDERS });

    const providerRunners = {
      openai: (p) => runOpenAI(p, sourcePackPrompt, shouldGenerateMatrix, researchMode, conversationHistory, projectMemoryContext),
      claude: (p) => runClaude(p, sourcePackPrompt, shouldGenerateMatrix, researchMode, conversationHistory, projectMemoryContext),
      gemini: (p) => runGemini(p, sourcePackPrompt, shouldGenerateMatrix, researchMode, conversationHistory, projectMemoryContext),
      deepseek: (p) => runDeepSeek(p, sourcePackPrompt, shouldGenerateMatrix, researchMode, conversationHistory, projectMemoryContext),
      infomaniak: (p) => runInfomaniak(p, sourcePackPrompt, shouldGenerateMatrix, researchMode, conversationHistory, projectMemoryContext),
    };

    const settled = await Promise.allSettled(uniqueProviders.map((provider) => providerRunners[provider](prompt)));
    const results = settled.map((item, index) => item.status === "fulfilled" ? item.value : { provider: uniqueProviders[index], error: item.reason?.message || String(item.reason) });
    const combined = await runCombined(results, userPrompt, sourcePackPrompt, shouldGenerateMatrix, researchMode, projectMemoryContext);

if (projectId && saveToProjectMemory) {
  try {
    const combinedText = combined?.text || combined?.error || "";
    const providerText = results
      .map((r) => `Provider: ${r.provider}\n${r.text || r.error || ""}`)
      .join("\n\n---\n\n");

    await saveProjectMemory({
      projectId,
      toolName: "meta-llm",
      type: "chat-output",
      title: userPrompt.slice(0, 120),
      summary: summariseOutputForMemory(combinedText || providerText),
      content: [
        `USER PROMPT:\n${userPrompt}`,
        `COMBINED RESPONSE:\n${combinedText}`,
        `PROVIDER OUTPUTS:\n${providerText}`,
      ].join("\n\n"),
      metadata: {
        providers: uniqueProviders,
        researchMode,
        searchMode,
        sourceCount: sourcePack.length,
        timestamp: new Date().toISOString(),
      },
    });

    memorySaved = true;
  } catch (err) {
    memorySaveError = err?.message || String(err);
    console.error("Failed to save meta-llm project memory:", err);
  }
}

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
      projectMemory: {
        enabled: Boolean(projectId),
        configured: Boolean(PROJECT_MEMORY_API_BASE),
        projectId: projectId || null,
        memoryItemsLoaded: projectContext.memoryItemsUsed || 0,
        contextItemsLoaded: projectContext.contextItemsUsed || 0,
        methodologyItemsLoaded: projectContext.methodologyItemsUsed || 0,
        saved: memorySaved,
        contextError: projectContextError,
        saveError: memorySaveError,
      },      
      meta: { timestamp: new Date().toISOString(), hasSources },
    });
  } catch (err) {
    console.error("meta-llm handler failed:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message || String(err) });
  }
}

async function runOpenAI(prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode, conversationHistory, projectMemoryContext = "") {
  const key = process.env.OPENAI_API_KEY; if (!key) throw Object.assign(new Error("Missing OPENAI_API_KEY"), { provider: "openai" });
  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory, projectMemoryContext);
  const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: "You are answering questions on " + todayStr + "." }, { role: "user", content: fullPrompt }], temperature: getTemperature(researchMode), max_completion_tokens: getTokenLimit(researchMode) }) });
  if (!r.ok) throw Object.assign(new Error(`OpenAI error: ${r.status} ${await r.text()}`), { provider: "openai" });
  const data = await r.json(); return { provider: "openai", text: data?.choices?.[0]?.message?.content?.trim() || "" };
}

async function runClaude(prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode, conversationHistory, projectMemoryContext = "") {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw Object.assign(new Error("Missing ANTHROPIC_API_KEY"), { provider: "claude" });
  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory, projectMemoryContext);
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: getTokenLimit(researchMode), system: "You are answering questions on " + todayStr + ".", messages: [{ role: "user", content: fullPrompt }] }) });
  if (!r.ok) throw Object.assign(new Error(`Claude error: ${r.status} ${await r.text()}`), { provider: "claude" });
  const data = await r.json(); return { provider: "claude", text: data?.content?.[0]?.text?.trim() || "" };
}

async function runGemini(prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode, conversationHistory, projectMemoryContext = "") {
  const key = process.env.GEMINI_API_KEY; if (!key) throw Object.assign(new Error("Missing GEMINI_API_KEY"), { provider: "gemini" });
  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const ai = new GoogleGenAI({ apiKey: key });
  const response = await ai.models.generateContent({ model: "gemini-2.0-flash", contents: buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory, projectMemoryContext) });
  return { provider: "gemini", text: response?.text?.trim?.() || "" };
}

async function runDeepSeek(prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode, conversationHistory, projectMemoryContext = "") {
  const key = process.env.DEEPSEEK_API_KEY; if (!key) throw Object.assign(new Error("Missing DEEPSEEK_API_KEY"), { provider: "deepseek" });
  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory, projectMemoryContext);
  const r = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "system", content: "You are answering questions on " + todayStr + "." }, { role: "user", content: fullPrompt }], temperature: getTemperature(researchMode), max_tokens: getTokenLimit(researchMode), stream: false }) });
  if (!r.ok) throw Object.assign(new Error(`DeepSeek error: ${r.status} ${await r.text()}`), { provider: "deepseek" });
  const data = await r.json(); return { provider: "deepseek", text: data?.choices?.[0]?.message?.content?.trim() || "" };
}

async function runInfomaniak(prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode, conversationHistory, projectMemoryContext = "") {
  const token = process.env.INFOMANIAK_API_TOKEN; const productId = process.env.INFOMANIAK_PRODUCT_ID; const model = process.env.INFOMANIAK_MODEL || "qwen3";
  if (!token) throw Object.assign(new Error("Missing INFOMANIAK_API_TOKEN"), { provider: "infomaniak" });
  if (!productId) throw Object.assign(new Error("Missing INFOMANIAK_PRODUCT_ID"), { provider: "infomaniak" });
  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fullPrompt = buildModelPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, conversationHistory, projectMemoryContext);
  const r = await fetch(`https://api.infomaniak.com/2/ai/${productId}/openai/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ model, messages: [{ role: "system", content: "You are answering questions on " + todayStr + "." }, { role: "user", content: fullPrompt }], temperature: getTemperature(researchMode), max_tokens: getTokenLimit(researchMode) }) });
  if (!r.ok) throw Object.assign(new Error(`Infomaniak error: ${r.status} ${await r.text()}`), { provider: "infomaniak" });
  const data = await r.json(); return { provider: "infomaniak", text: data?.choices?.[0]?.message?.content?.trim() || "" };
}

async function runCombined(results, prompt, sourcePackPrompt, wantsScenarioMatrix, researchMode, projectMemoryContext = "") {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { provider: "combined", error: "Missing OPENAI_API_KEY" };
  const usable = results.filter((r) => r.text && !r.error).map((r) => `${r.provider.toUpperCase()}:\n${r.text}`).join("\n\n---\n\n");
  if (!usable) return { provider: "combined", error: "No valid responses to combine" };
  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const systemPrompt = buildCombinedPrompt(prompt, sourcePackPrompt, todayStr, wantsScenarioMatrix, projectMemoryContext);
  const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `User prompt:\n${prompt}\n\nModel outputs:\n\n${usable}` }], temperature: 0.4, max_completion_tokens: Math.floor(Math.max(500, getTokenLimit(researchMode) * 1.2)) }) });
  if (!r.ok) return { provider: "combined", error: `Combine error: ${r.status} ${await r.text()}` };
  const data = await r.json(); return { provider: "combined", text: data?.choices?.[0]?.message?.content?.trim() || "" };
}
