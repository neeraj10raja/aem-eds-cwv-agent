// GitHub Models uses the Azure inference endpoint with GITHUB_TOKEN as the bearer key
const MODELS_ENDPOINT = 'https://models.inference.ai.azure.com/chat/completions';
const DEFAULT_MODEL = 'gpt-4o';
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

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
- Set confidence "low" when any relevant diff is marked truncated or incomplete.
- fix.original must be an exact substring from the provided diff — do not paraphrase or reconstruct it.
- Omit the fix key entirely when confidence is "low".`;

function buildPrompt(regression, commits, diffs) {
  const lcpBefore = regression.baseline_lcp_ms != null
    ? `${regression.baseline_lcp_ms}ms`
    : 'no baseline';
  const lcpDelta = regression.lcp_delta_ms > 0
    ? ` (+${regression.lcp_delta_ms}ms)`
    : '';
  const scoreBefore = regression.baseline_score != null
    ? regression.baseline_score
    : 'no baseline';
  const scoreDelta = regression.score_delta > 0
    ? ` (-${regression.score_delta})`
    : '';
  const opsList = (regression.opportunities ?? [])
    .map((o) => `  - ${o.title} (~${o.savings_ms}ms savings)`)
    .join('\n') || '  (none reported)';

  const commitLog = commits
    .map((c, i) => {
      const diffInfo = typeof diffs[i] === 'string' ? { diff: diffs[i], truncated: false } : diffs[i];
      const truncationWarning = diffInfo?.truncated
        ? '\n\n[DIFF TRUNCATED: diagnose only with low confidence unless the cause is fully visible]\n'
        : '\n\n';
      return `### Commit ${c.sha.slice(0, 7)} by ${c.author} on ${c.date}\n"${c.message}"${truncationWarning}${diffInfo?.diff || '(no diff)'}`;
    })
    .join('\n\n---\n\n')
    .slice(0, 20000);

  return `## Regression
URL: ${regression.url}
LCP before: ${lcpBefore} → after: ${regression.current_lcp_ms}ms${lcpDelta}
Score before: ${scoreBefore} → after: ${regression.current_score}${scoreDelta}

## Top Lighthouse Opportunities
${opsList}

## Recent Code Changes (last 48h)
${commitLog || '(no commits found in lookback window)'}`;
}

function getDiffText(diffInfo) {
  return typeof diffInfo === 'string' ? diffInfo : diffInfo?.diff ?? '';
}

function fixIsGroundedInDiff(fix, diffs) {
  if (!fix?.original) return false;
  return diffs.some((diffInfo) => getDiffText(diffInfo).includes(fix.original));
}

function normalizeDiagnosis(parsed, diffs) {
  const hasTruncatedDiff = diffs.some((d) => typeof d === 'object' && d?.truncated);
  const highConfidenceWithoutGroundedFix = parsed.confidence === 'high'
    && !fixIsGroundedInDiff(parsed.fix, diffs);
  if ((hasTruncatedDiff || highConfidenceWithoutGroundedFix) && parsed.confidence === 'high') {
    return {
      diagnosis: parsed.diagnosis,
      rootCause: parsed.rootCause,
      confidence: 'low',
    };
  }
  return parsed;
}

async function diagnose(regression, commits, diffs, token, model = DEFAULT_MODEL) {
  let lastError;

  for (let attempt = 0; attempt <= 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(MODELS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildPrompt(regression, commits, diffs) },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    if (res.ok) {
      // eslint-disable-next-line no-await-in-loop
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content ?? '{}';

      try {
        return normalizeDiagnosis(JSON.parse(raw), diffs);
      } catch {
        return { diagnosis: raw.slice(0, 200), rootCause: 'unknown', confidence: 'low' };
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const text = await res.text().catch(() => '');
    lastError = new Error(`GitHub Models ${res.status}: ${text.slice(0, 200)}`);
    if (!RETRY_STATUSES.has(res.status) || attempt === 3) throw lastError;

    // eslint-disable-next-line no-await-in-loop
    await wait(5000 * 2 ** attempt);
  }

  throw lastError;
}

export {
  buildPrompt,
  diagnose,
  fixIsGroundedInDiff,
  normalizeDiagnosis,
};
