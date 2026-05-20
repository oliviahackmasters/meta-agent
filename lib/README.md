

## Note on meta-llm.js vs meta-cognition.ts

These are two separate endpoints:
- `/api/meta-llm` — the comparison tool (OpenAI vs Claude vs Gemini etc.)
  This already works correctly — models are real.
- `/api/meta-cognition` — the smarter pipeline with web search
  This had the placeholder problem — now fixed.

The screenshot showing Claude saying "I don't have access to current information"
was the meta-llm endpoint (no web search). After this fix, meta-cognition will
pass live news to all models before they answer.
