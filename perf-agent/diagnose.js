// GitHub Models uses the Azure inference endpoint with GITHUB_TOKEN as the bearer key
const MODELS_ENDPOINT = 'https://models.inference.ai.azure.com/chat/completions';
const MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `You are a web performance expert specialising in Adobe Edge Delivery Services (EDS) sites.
Analyse the regression data and recent code changes. Respond with valid JSON only — no markdown, no code fences.

Required shape:
{
  "diagnosis": "one sentence: what is slow and why",
  "rootCause": "commit sha + file/line, or 'unknown'",
  "confidence": "high" | "low",
  "fix": {
    "file": "path from repo root",
    "original": "exact verbatim string to replace (must be unique in the file)",
    "replacement": "corrected string"
  }
}

Rules:
- Set confidence "high" only when the fix targets a single file under blocks/ or scripts/ (never scripts/aem.js) and you are certain the exact original string appears in the diff.
- Set confidence "low" when the cause spans multiple files, touches a shared utility, or you are not certain.
- fix.original must be an exact substring from the provided diff — do not paraphrase or reconstruct it.
- Omit the fix key entirely when confidence is "low".`;

function buildPrompt(regression, commits, diffs) {
  const opsList = (regression.opportunities ?? [])
    .map((o) => `  - ${o.title} (~${o.savings_ms}ms savings)`)
    .join('\n') || '  (none reported)';

  const commitLog = commits
    .map((c, i) => `### Commit ${c.sha.slice(0, 7)} by ${c.author} on ${c.date}\n"${c.message}"\n\n${diffs[i] || '(no diff)'}`)
    .join('\n\n---\n\n')
    .slice(0, 8000);

  return `## Regression
URL: ${regression.url}
LCP before: ${regression.baseline_lcp_ms}ms → after: ${regression.current_lcp_ms}ms (+${regression.lcp_delta_ms}ms)
Score before: ${regression.baseline_score} → after: ${regression.current_score} (-${regression.score_delta})

## Top Lighthouse Opportunities
${opsList}

## Recent Code Changes (last 48h)
${commitLog || '(no commits found in lookback window)'}`;
}

async function diagnose(regression, commits, diffs, token) {
  const res = await fetch(MODELS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(regression, commits, diffs) },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub Models ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '{}';

  try {
    return JSON.parse(raw);
  } catch {
    return { diagnosis: raw.slice(0, 200), rootCause: 'unknown', confidence: 'low' };
  }
}

export { diagnose };
