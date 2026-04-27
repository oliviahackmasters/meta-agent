import { routeUserQuery } from "../lib/router.js";
import { fetchSources } from "../lib/fetchSources.js";
import { buildEvidencePack } from "../lib/evidence.js";
import { updateSessionSummary, type Message } from "../lib/memory.js";
import { buildPromptContext, type UserMemory } from "../lib/contextBuilder.js";
import { runModels } from "../lib/runModels.js";
import { generateSearchQueries } from "../lib/generateSearchQueries.js";
import { needsWebResearch, webSearch } from "../lib/webSearch.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const input = req.body?.input?.toString?.().trim();
    const messages: Message[] = req.body?.messages || [];

    if (!input) {
      return res.status(400).json({ error: "Missing input" });
    }

    // Phase 1: Generate search queries using LLM
    const searchQueries = await generateSearchQueries(input, messages);

    // Phase 2: Route (keep for other decisions)
    const decision = await routeUserQuery(input, messages);

    // Phase 3: Check if web research is needed
    let webSearchResult = { sources: [], searchPerformed: false, error: undefined };
    if (needsWebResearch(input)) {
      webSearchResult = await webSearch(input);
    }

    // Fetch sources for each search query
    let sources = [];
    if (searchQueries.length > 0) {
      const sourcePromises = searchQueries.map(query => fetchSources(query));
      const sourceArrays = await Promise.all(sourcePromises);
      sources = sourceArrays.flat();
      // Remove duplicates based on URL
      const uniqueSources = sources.filter((source, index, self) =>
        index === self.findIndex(s => s.url === source.url)
      );
      sources = uniqueSources.slice(0, 20); // Limit total sources
    }

    // Merge web search results with traditional sources
    if (webSearchResult.sources.length > 0) {
      const allSources = [...webSearchResult.sources, ...sources];
      const uniqueSources = allSources.filter((source, index, self) =>
        index === self.findIndex(s => s.url === source.url)
      );
      sources = uniqueSources.slice(0, 25); // Allow a few more sources with web search
    }

    // Build evidence pack
    const evidence = buildEvidencePack(input, sources);

    // Update session summary
    const sessionSummary = await updateSessionSummary(messages);

    // Mock memory for now
    const memory: UserMemory = {
      preferences: [],
      toolsUsed: [],
      projectContext: "",
    };

    // Build context
    const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const todayISO = new Date().toISOString().split('T')[0];
    
    const systemPrompt = `TODAY IS ${todayStr} (${todayISO}) - NOT EARLIER.

Your task: Answer the user's question using LIVE EVIDENCE fetched from the internet TODAY.

CRITICAL: You have access to Evidence sources below. Use them as your PRIMARY source, especially for:
- Current events, news, headlines
- Today's prices, data, statistics
- Market trends, consumer behavior
- Latest reports and research

Your training data is from 2024 or earlier. This Evidence section is from TODAY and takes ABSOLUTE PRIORITY.

Do not invent statistics or sources. If evidence is limited, say so.`;
    const recentMessages = messages.slice(-10); // Short-term memory

    const context = buildPromptContext({
      systemPrompt,
      memory,
      sessionSummary,
      recentMessages,
      evidence,
      userInput: input,
      outputFormat: decision.outputFormat,
    });

    // Run models
    const results = await runModels(context);

    return res.status(200).json({
      input,
      decision,
      evidence,
      results,
      webSearch: {
        performed: webSearchResult.searchPerformed,
        resultsCount: webSearchResult.sources.length,
        error: webSearchResult.error,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("meta-cognition handler failed:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message || String(err),
    });
  }
}