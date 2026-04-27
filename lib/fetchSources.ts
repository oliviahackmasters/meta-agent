export type Source = {
  title: string;
  url: string;
  date?: string;
  summary: string;
  reliability?: "high" | "medium" | "low";
};

// Domains we consider high reliability
const HIGH_RELIABILITY_DOMAINS = [
  "bbc.co.uk", "bbc.com", "reuters.com", "apnews.com", "theguardian.com",
  "ft.com", "economist.com", "bloomberg.com", "nytimes.com", "washingtonpost.com",
  "aljazeera.com", "dw.com", "france24.com", "lemonde.fr"
];

function reliabilityForUrl(url: string): "high" | "medium" | "low" {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (HIGH_RELIABILITY_DOMAINS.some(d => hostname.includes(d))) return "high";
  } catch {}
  return "medium";
}

/**
 * Fetch current news sources for a query via NewsAPI.
 * Falls back to Google News RSS if NewsAPI key is missing.
 */
export async function fetchSources(query: string): Promise<Source[]> {
  const newsApiKey = process.env.NEWSAPI_KEY;

  if (newsApiKey && newsApiKey !== "YOUR_NEWSAPI_KEY_HERE") {
    return fetchFromNewsApi(query, newsApiKey);
  }

  // Fallback: Google News RSS (no key needed)
  console.warn("[fetchSources] No NEWSAPI_KEY — falling back to Google News RSS");
  return fetchFromGoogleNews(query);
}

async function fetchFromNewsApi(query: string, apiKey: string): Promise<Source[]> {
  // Fetch articles from last 7 days for freshness
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const params = new URLSearchParams({
    q: query,
    sortBy: "publishedAt",
    language: "en",
    pageSize: "10",
    from,
    apiKey,
  });

  const url = `https://newsapi.org/v2/everything?${params}`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "HackmastersMetaAgent/1.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`NewsAPI ${response.status}: ${body}`);
    }

    const data = await response.json();

    if (data.status !== "ok") {
      throw new Error(`NewsAPI error: ${data.message || data.code}`);
    }

    const articles = Array.isArray(data.articles) ? data.articles : [];

    return articles
      .filter((a: any) => a.title && a.title !== "[Removed]" && a.url)
      .slice(0, 8)
      .map((a: any) => ({
        title: String(a.title || "").trim(),
        url: a.url,
        date: a.publishedAt,
        summary: String(a.description || a.title || "").trim().slice(0, 300),
        reliability: reliabilityForUrl(a.url),
      }));
  } catch (error) {
    console.error("[fetchSources] NewsAPI failed:", error);
    // Try Google News as fallback
    return fetchFromGoogleNews(query);
  }
}

async function fetchFromGoogleNews(query: string): Promise<Source[]> {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-GB&gl=GB&ceid=GB:en`;

  try {
    const response = await fetch(rssUrl, {
      headers: { "User-Agent": "HackmastersMetaAgent/1.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error(`Google News RSS ${response.status}`);

    const xml = await response.text();

    // Simple XML item extraction (no xml parser dependency)
    const items: Source[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
      const item = match[1];
      const title = (/<title>(.*?)<\/title>/.exec(item)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      const link  = (/<link>(.*?)<\/link>/.exec(item)?.[1] || "").trim();
      const pubDate = (/<pubDate>(.*?)<\/pubDate>/.exec(item)?.[1] || "").trim();
      const desc  = (/<description>(.*?)<\/description>/.exec(item)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();

      if (title && link) {
        items.push({
          title,
          url: link,
          date: pubDate ? new Date(pubDate).toISOString() : undefined,
          summary: desc.slice(0, 300) || title,
          reliability: reliabilityForUrl(link),
        });
      }
    }

    return items;
  } catch (error) {
    console.error("[fetchSources] Google News RSS also failed:", error);
    return [];
  }
}
