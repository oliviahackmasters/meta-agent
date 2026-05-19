import { routeUserQuery } from "../lib/router.js";
import { fetchSources } from "../lib/fetchSources.js";
import { buildEvidencePack } from "../lib/evidence.js";
import { updateSessionSummary, type Message } from "../lib/memory.js";
import { buildPromptContext, type UserMemory } from "../lib/contextBuilder.js";
import { runModels } from "../lib/runModels.js";
import { generateSearchQueries } from "../lib/generateSearchQueries.js";
import { needsWebResearch, webSearch } from "../lib/webSearch.js";
import {
  buildProjectMemoryContext,
  getProjectMemory,
  isProjectMemoryConfigured,
  saveProjectMemoryItem,
  summariseOutputForMemory,
  upsertProject,
} from "../lib/projectMemory.js";

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

    const projectId = req.body?.projectId?.toString?.().trim();
    const projectName = req.body?.projectName?.toString?.().trim();
    const useProjectMemory = req.body?.useProjectMemory !== false;
    const saveToProjectMemory = req.body?.saveToProjectMemory !== false;

    if (!input) {
      return res.status(400).json({ error: "Missing input" });
    }

    let projectMemoryItems = [];
    let projectMemoryContext = "";

    if (projectId && useProjectMemory && isProjectMemoryConfigured()) {
      await upsertProject(projectId, projectName);
      projectMemoryItems = await getProjectMemory(projectId);
      projectMemoryContext = buildProjectMemoryContext(projectMemoryItems);
    }

    const searchQueries = await generateSearchQueries(input, messages);
    const decision = await routeUserQuery(input, messages);

    let webSearchResult = { sources: [], searchPerformed: false, error: undefined };
    if (needsWebResearch(input)) {
      webSearchResult = await webSearch(input);
    }

    let sources = [];
    if (searchQueries.length > 0) {
      const sourcePromises = searchQueries.map(query => fetchSources(query));
      const sourceArrays = await Promise.all(sourcePromises);
      sources = sourceArrays.flat();
      const uniqueSources = sources.filter((source, index, self) =>
        index === self.findIndex(s => s.url === source.url)
      );
      sources = uniqueSources.slice(0, 20);
    }

    if (webSearchResult.sources.length > 0) {
      const allSources = [...webSearchResult.sources, ...sources];
      const uniqueSources = allSources.filter((source, index, self) =>
        index === self.findIndex(s => s.url === source.url)
      );
      sources = uniqueSources.slice(0, 25);
    }

    const evidence = buildEvidencePack(input, sources);
    const sessionSummary = await updateSessionSummary(messages);

    const memory: UserMemory = {
      preferences: [],
      toolsUsed: projectMemoryItems.map(item => item.toolName || item.tool_name || "unknown"),
      projectContext: projectMemoryContext,
    };

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

    const recentMessages = messages.slice(-10);

    const context = buildPromptContext({
      systemPrompt,
      memory,
      sessionSummary,
      recentMessages,
      evidence,
      userInput: input,
      outputFormat: decision.outputFormat,
    });

    const results = await runModels(context);

    if (projectId && saveToProjectMemory && isProjectMemoryConfigured()) {
      try {
        const combinedText = Array.isArray(results)
          ? results
              .map((result) => {
                const provider = result?.provider || "unknown";
                const answer = result?.answer || result?.text || "";
                return `Provider: ${provider}\n${answer}`;
              })
              .join("\n\n---\n\n")
          : JSON.stringify(results);

        await saveProjectMemoryItem({
          projectId,
          toolName: "meta-cognition",
          type: "chat-output",
          title: input.slice(0, 120),
          summary: summariseOutputForMemory(combinedText),
          content: combinedText,
          metadata: {
            input,
            searchQueries,
            webSearchPerformed: webSearchResult.searchPerformed,
            evidenceCount: evidence?.sources?.length || 0,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (memoryErr) {
        console.error("Failed to save project memory:", memoryErr);
      }
    }

    return res.status(200).json({
      input,
      decision,
      evidence,
      results,
      projectMemory: {
        enabled: Boolean(projectId),
        configured: isProjectMemoryConfigured(),
        projectId: projectId || null,
        memoryItemsLoaded: projectMemoryItems.length,
      },
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
