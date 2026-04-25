import { routeUserQuery } from "../lib/router.js";
import { fetchSources } from "../lib/fetchSources.js";
import { buildEvidencePack } from "../lib/evidence.js";
import { updateSessionSummary, type Message } from "../lib/memory.js";
import { buildPromptContext, type UserMemory } from "../lib/contextBuilder.js";
import { runModels } from "../lib/runModels.js";

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

    // Phase 1: Route
    const decision = await routeUserQuery(input, messages);

    // Fetch sources if needed
    let sources = [];
    if (decision.needsWeb) {
      sources = await fetchSources(input);
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
    const systemPrompt = "You are a helpful AI assistant.";
    const recentMessages = messages.slice(-10); // Short-term memory

    const context = buildPromptContext({
      systemPrompt,
      memory,
      sessionSummary,
      recentMessages,
      evidence,
      userInput: input,
    });

    // Run models
    const results = await runModels(context);

    return res.status(200).json({
      input,
      decision,
      evidence,
      results,
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