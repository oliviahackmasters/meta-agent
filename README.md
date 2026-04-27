# Meta-Agent: Live Web Search & Multi-Model AI

An intelligent agent that combines live web search with multiple LLM providers to deliver current, accurate, and well-sourced responses.

## Features

### 🌐 Live Web Search Integration
- **Tavily API**: Fetches real-time search results from trusted sources
- **Smart Activation**: Automatically triggers web search for:
  - **Current/News**: "today", "latest", "recent", "current", "news", "headlines", "this week"
  - **Research**: "report", "research", "market", "trend", "insight", "data", "statistics", "sources", "case studies"
  - **Retail**: "retail", "shopper", "consumer", "ecommerce", "luxury", "fashion", "beauty", "grocery", "store", "brand", "omnichannel", "loyalty", "footfall", "social commerce"

### 📊 Retail-Specific Research
When web search activates, the system runs multiple parallel searches:
1. Direct query on retail trends 2025-2026
2. Consumer behavior retail reports
3. Market analysis for retail
4. Case studies of retail brands
5. Trusted research domain filtering

**Preferred Research Domains**:
- McKinsey, Deloitte, PwC, Accenture, Bain, BCG
- Forrester, NRF, Retail Dive, Vogue Business
- Business of Fashion, Modern Retail

### 🤖 Multi-Model AI
Runs queries across multiple LLM providers simultaneously:
- OpenAI (GPT-4)
- Claude (Anthropic)
- Gemini (Google)
- DeepSeek
- Infomaniak (optional)

### 🧠 Smart Response Synthesis
- Combines insights from multiple models
- Prioritizes sources and evidence
- Removes hallucinations and invented data
- Cites sources appropriately

## Setup

### 1. Environment Variables
Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required:
```env
# Web Search
TAVILY_API_KEY=your_tavily_key_here

# At least one LLM provider
OPENAI_API_KEY=your_openai_key_here
# OR
GOOGLE_API_KEY=your_google_key_here
# OR
ANTHROPIC_API_KEY=your_anthropic_key_here
# OR
DEEPSEEK_API_KEY=your_deepseek_key_here

# Optional: News API for additional sources
NEWSAPI_KEY=your_newsapi_key_here
```

### 2. Get API Keys

- **Tavily**: https://tavily.com
- **OpenAI**: https://platform.openai.com
- **Google Gemini**: https://ai.google.dev
- **Anthropic Claude**: https://console.anthropic.com
- **DeepSeek**: https://deepseek.com
- **NewsAPI**: https://newsapi.org

### 3. Install & Deploy
```bash
npm install
# Deploy to Vercel or your preferred platform
```

## API Endpoints

### POST `/api/meta-cognition`
Main endpoint for intelligent queries with web search and multi-model synthesis.

**Request**:
```json
{
  "input": "What are the latest retail trends in 2025?",
  "messages": [
    { "role": "user", "content": "previous message" }
  ]
}
```

**Response**:
```json
{
  "input": "What are the latest retail trends in 2025?",
  "decision": "research",
  "evidence": {
    "query": "What are the latest retail trends in 2025?",
    "sources": [
      {
        "title": "2025 Retail Trends Report",
        "url": "https://...",
        "date": "2025-01-15T...",
        "summary": "Key findings from McKinsey...",
        "reliability": "high"
      }
    ]
  },
  "results": {
    "openai": { "provider": "openai", "answer": "..." },
    "claude": { "provider": "claude", "answer": "..." },
    "gemini": { "provider": "gemini", "answer": "..." }
  },
  "webSearch": {
    "performed": true,
    "resultsCount": 15,
    "error": null
  },
  "meta": {
    "timestamp": "2025-01-27T..."
  }
}
```

### POST `/api/meta-llm`
Direct multi-model querying (legacy endpoint).

**Request**:
```json
{
  "prompt": "Your question here",
  "providers": ["openai", "claude", "gemini"]
}
```

## How It Works

### 1. Query Analysis
- System detects if web search is needed using keyword matching
- Triggers multiple parallel Tavily searches for retail research
- Merges results with traditional news sources

### 2. Evidence Building
- Fetches 20-25 top-ranked sources
- Removes duplicates based on URL
- Prioritizes high-reliability sources

### 3. Context Construction
- Injects today's actual date
- Includes all search results and evidence
- Builds comprehensive prompt context

### 4. Model Execution
- Runs queries across all configured LLM providers
- Each model receives:
  - Today's date
  - Full web search results
  - Instructions to treat evidence as source of truth
  - Warnings against hallucination
- Models run in parallel for speed

### 5. Response Synthesis
- Combines outputs intelligently
- Removes repetition
- Prioritizes recent, sourced information
- Synthesizes insights across models

## Key Instructions to Models

Models receive the following system instructions:

```
- Today's date is [current date]
- The Evidence section contains real-time web search results
- Treat web search results as source of truth
- IGNORE outdated training data that conflicts with evidence
- DO NOT invent statistics, report names, or links
- If evidence is weak or limited, explicitly state this
- For retail research, prioritize recent sources and consumer behavior
- Say when sources are from trusted research domains
```

## Error Handling

If web search fails:
- System continues gracefully with fallback sources
- Returns error information in response
- Models still receive best available evidence
- Response indicates search failure to user

## Examples

### Example 1: Current News Query
**Input**: "What are today's retail headlines?"

**System**: Detects "today" and "headlines" → triggers Tavily web search
**Output**: Real-time headlines from top retail news sources

### Example 2: Market Research
**Input**: "Research report on Q1 2025 consumer spending trends"

**System**: Detects "research" and "report" → runs multiple Tavily searches with retail patterns
**Output**: Synthesized insights from McKinsey, Deloitte, and other trusted sources

### Example 3: Hybrid Query
**Input**: "Latest luxury fashion retail trends with case studies"

**System**: Detects "latest", "retail", and "case studies" → comprehensive search
**Output**: Multi-sourced analysis from fashion-focused retailers and research firms

## Architecture

```
api/
├── meta-cognition.ts    # Main orchestration + web search
└── meta-llm.js          # Direct LLM calling

lib/
├── webSearch.ts         # Tavily API integration
├── runModels.ts         # Model execution with web search instructions
├── contextBuilder.ts    # Prompt context assembly
├── evidence.ts          # Evidence pack structure
├── fetchSources.ts      # News/source fetching
├── router.ts            # Query routing
├── memory.ts            # Session memory
└── generateSearchQueries.ts
```

## Best Practices

1. **Always include TAVILY_API_KEY** for full functionality
2. **Configure at least 2-3 LLM providers** for robustness
3. **Monitor API costs** - multiple providers and searches add up
4. **Use meaningful queries** - web search works best with specific terms
5. **Expect latency** - multiple parallel API calls take time (~3-5 seconds)
6. **Review sources** - Always verify critical information with original sources

## Troubleshooting

**Web search not triggering**: Check if your query contains trigger keywords. Check `TAVILY_API_KEY` is set.

**Models returning generic responses**: Ensure evidence/sources are populated. Check that system instructions are included in prompts.

**API errors**: Verify all required API keys are set and valid. Check rate limits on your API accounts.

**Slow responses**: Web search + parallel LLM calls are slower than single model. This is expected. Consider caching for repeated queries.

## Cost Considerations

Monthly cost estimate (based on 1000 queries):
- Tavily (5 searches per query): ~$10-20
- OpenAI (3 calls + 1 combine): ~$3-5
- Claude, Gemini, DeepSeek: ~$5-10 each
- NewsAPI: ~$0-5

**Total**: ~$25-50/month for modest usage

## Future Enhancements

- [ ] Caching layer for repeated queries
- [ ] Real-time fact checking
- [ ] Citation formatting (APA, MLA, Chicago)
- [ ] Long-form report generation
- [ ] Multi-language support
- [ ] Custom domain filtering
- [ ] Export to PDF/Word
