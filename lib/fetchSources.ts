export type Source = {
  title: string;
  url: string;
  date?: string;
  summary: string;
  reliability?: "high" | "medium" | "low";
};

export async function fetchSources(query: string): Promise<Source[]> {
  // Placeholder implementation
  // In a real implementation, fetch from RSS feeds or web search API

  // For now, return mock sources based on query
  const mockSources: Source[] = [
    {
      title: `Latest on ${query}`,
      url: "https://example.com/news1",
      date: new Date().toISOString(),
      summary: `Summary of latest information about ${query}.`,
      reliability: "medium",
    },
    {
      title: `Update on ${query}`,
      url: "https://example.com/news2",
      date: new Date().toISOString(),
      summary: `Another perspective on ${query}.`,
      reliability: "high",
    },
  ];

  // Limit to top 5-10
  return mockSources.slice(0, 5);
}