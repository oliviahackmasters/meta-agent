export type Source = {
  title: string;
  url: string;
  date?: string;
  summary: string;
  reliability?: "high" | "medium" | "low";
};

export async function fetchSources(query: string): Promise<Source[]> {
  const API_KEY = process.env.NEWSAPI_KEY || 'YOUR_NEWSAPI_KEY_HERE'; // Replace with your NewsAPI key
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&apiKey=${API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`NewsAPI error: ${response.status}`);
    }
    const data = await response.json();

    if (data.status !== 'ok') {
      throw new Error(`NewsAPI error: ${data.message}`);
    }

    const sources: Source[] = data.articles.slice(0, 10).map((article: any) => ({
      title: article.title,
      url: article.url,
      date: article.publishedAt,
      summary: article.description || article.title,
      reliability: "medium" as const, // Default to medium, could be enhanced
    }));

    return sources;
  } catch (error) {
    console.error('Error fetching sources:', error);
    // Fallback to mock data
    return [
      {
        title: `Latest on ${query}`,
        url: "https://example.com/news1",
        date: new Date().toISOString(),
        summary: `Summary of latest information about ${query}.`,
        reliability: "medium",
      },
    ];
  }
}