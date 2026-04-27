import type { Source } from "./fetchSources.js";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// Current/news trigger keywords
const CURRENT_KEYWORDS = ["today", "latest", "recent", "current", "news", "headlines", "this week"];

// Research trigger keywords
const RESEARCH_KEYWORDS = ["report", "research", "market", "trend", "insight", "data", "statistics", "sources", "case studies"];

// Retail-specific trigger keywords
const RETAIL_KEYWORDS = [
  "retail",
  "shopper",
  "consumer",
  "ecommerce",
  "luxury",
  "fashion",
  "beauty",
  "grocery",
  "store",
  "brand",
  "omnichannel",
  "loyalty",
  "footfall",
  "social commerce",
];

// Preferred retail research domains
const PREFERRED_DOMAINS = [
  "mckinsey.com",
  "deloitte.com",
  "pwc.com",
  "accenture.com",
  "bain.com",
  "bcg.com",
  "forrester.com",
  "nrf.com",
  "retaildive.com",
  "voguebusiness.com",
  "businessoffashion.com",
  "modernretail.co",
];

/**
 * Determines if web research is needed based on user input keywords
 */
export function needsWebResearch(input: string): boolean {
  const lowerInput = input.toLowerCase();

  // Check for current/news terms
  if (CURRENT_KEYWORDS.some((keyword) => lowerInput.includes(keyword))) {
    return true;
  }

  // Check for research terms
  if (RESEARCH_KEYWORDS.some((keyword) => lowerInput.includes(keyword))) {
    return true;
  }

  // Check for retail terms
  if (RETAIL_KEYWORDS.some((keyword) => lowerInput.includes(keyword))) {
    return true;
  }

  return false;
}

/**
 * Runs a Tavily web search query
 */
async function tavilySearch(query: string): Promise<Source[]> {
  if (!TAVILY_API_KEY) {
    console.warn("TAVILY_API_KEY not set, web search unavailable");
    return [];
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        max_results: 5,
        include_images: false,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      console.error(`Tavily API error: ${response.status}`);
      return [];
    }

    const data = await response.json();

    if (!data.results) {
      return [];
    }

    const sources: Source[] = data.results.map((result: any) => ({
      title: result.title,
      url: result.url,
      date: new Date().toISOString(),
      summary: result.content || result.title,
      reliability: "high" as const,
    }));

    return sources;
  } catch (error) {
    console.error("Tavily search failed:", error);
    return [];
  }
}

/**
 * Performs comprehensive web search with multiple query patterns for retail research
 */
export async function webSearch(query: string): Promise<{
  sources: Source[];
  searchPerformed: boolean;
  error?: string;
}> {
  if (!TAVILY_API_KEY) {
    return {
      sources: [],
      searchPerformed: false,
      error: "TAVILY_API_KEY not configured",
    };
  }

  try {
    // Run multiple searches in parallel with different query patterns
    const searches = await Promise.all([
      // 1. Direct query
      tavilySearch(query),
      // 2. Query + retail trends report
      tavilySearch(`${query} retail trends report 2025 2026`),
      // 3. Query + consumer behavior
      tavilySearch(`${query} consumer behaviour retail report`),
      // 4. Query + market analysis
      tavilySearch(`${query} market analysis retail`),
      // 5. Query + case studies + preferred domains
      tavilySearch(
        `${query} case studies retail brands ${PREFERRED_DOMAINS.slice(0, 3).join(" OR ")}`
      ),
    ]);

    // Flatten all results and remove duplicates based on URL
    const allSources = searches.flat();
    const uniqueSources = allSources.filter((source, index, self) =>
      index === self.findIndex((s) => s.url === source.url)
    );

    // Prioritize sources from preferred domains
    const prioritized = uniqueSources.sort((a, b) => {
      const aPreferred = PREFERRED_DOMAINS.some((domain) => a.url.includes(domain)) ? 1 : 0;
      const bPreferred = PREFERRED_DOMAINS.some((domain) => b.url.includes(domain)) ? 1 : 0;
      return bPreferred - aPreferred;
    });

    return {
      sources: prioritized.slice(0, 20), // Limit total sources
      searchPerformed: true,
    };
  } catch (error) {
    console.error("Web search failed:", error);
    return {
      sources: [],
      searchPerformed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
