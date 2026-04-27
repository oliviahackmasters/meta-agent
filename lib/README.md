# Meta Cognition — Fix & Upgrade Notes

## What Was Wrong

### 1. `lib/runModels.ts` — OpenAI and Claude were PLACEHOLDERS (🔴 Critical)
The `runOpenAI()` and `runClaude()` functions in the meta-cognition pipeline
returned hardcoded fake text:
```
"This is a placeholder response. OpenAI API integration would be needed..."
"This is a placeholder response. Claude API integration would be needed..."
```
This is why the meta-cognition tool showed stale/wrong answers even though
the API keys were set. The models were never actually called.

`runDeepSeek()` was also a placeholder.

**Fix:** All three are now real implementations mirroring the working code
already in `api/meta-llm.js`. Gemini is upgraded from `gemini-1.5-flash`
to `gemini-2.0-flash` for better handling of recent events.

### 2. `lib/generateSearchQueries.ts` — depended on `GOOGLE_API_KEY` only
The search query generator used Gemini exclusively. If `GOOGLE_API_KEY`
was missing, no queries were generated at all — meaning NewsAPI was never
called and no live data reached the models.

**Fix:** Now uses OpenAI (already configured) to generate queries, with a
simple keyword fallback if all APIs fail.

### 3. `lib/fetchSources.ts` — NewsAPI call was incomplete
- No `language` filter (returned non-English articles)
- No `from` date filter (could return old articles)
- No `pageSize` set explicitly
- No fallback if NewsAPI fails

**Fix:** Added `language=en`, `from` (last 7 days), `pageSize=10`, proper
error handling, reliability scoring by domain, and a Google News RSS fallback
if NewsAPI is unavailable.

---

## Files to Replace

```
lib/fetchSources.ts        ← replace with fixes/lib/fetchSources.ts
lib/generateSearchQueries.ts ← replace with fixes/lib/generateSearchQueries.ts
lib/runModels.ts           ← replace with fixes/lib/runModels.ts
```

No other files need changes. `api/meta-cognition.ts` is fine as-is.

---

## Required Vercel Env Vars

```
# Already working (meta-llm.js uses these correctly)
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_API_KEY=...          ← also used as GEMINI_API_KEY fallback
GEMINI_API_KEY=...
DEEPSEEK_API_KEY=...
INFOMANIAK_API_TOKEN=...
INFOMANIAK_PRODUCT_ID=...
INFOMANIAK_MODEL=...

# NewsAPI — add this (free at newsapi.org)
NEWSAPI_KEY=...             ← Olivia has already added this ✅
```

The "Needs Attention" flags in the Vercel dashboard screenshot are likely
because some keys are expired or empty — check each one.

---

## How the Live Search Pipeline Now Works

```
User query
    ↓
generateSearchQueries()   ← OpenAI generates 2-3 targeted search terms
    ↓
fetchSources()            ← NewsAPI fetches last 7 days of relevant articles
    ↓                        (Google News RSS fallback if NewsAPI fails)
buildEvidencePack()       ← wraps articles into structured evidence
    ↓
buildPromptContext()      ← injects evidence + date + conversation into prompt
    ↓
runModels()               ← sends to OpenAI + Claude + Gemini + DeepSeek in parallel
    ↓                        (all models now REAL, not placeholders)
Combined response
```

This means when someone asks "what are today's UK headlines?" all four models
now receive actual current articles and can answer correctly.

---

## Note on meta-llm.js vs meta-cognition.ts

These are two separate endpoints:
- `/api/meta-llm` — the comparison tool (OpenAI vs Claude vs Gemini etc.)
  This already works correctly — models are real.
- `/api/meta-cognition` — the smarter pipeline with web search
  This had the placeholder problem — now fixed.

The screenshot showing Claude saying "I don't have access to current information"
was the meta-llm endpoint (no web search). After this fix, meta-cognition will
pass live news to all models before they answer.
