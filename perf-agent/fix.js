import {
  getFileContent, getDefaultBranchSha, createBranch, upsertFile,
} from './github-api.js';
import { fetchPSI } from './psi.js';

const PROTECTED_FILES = ['scripts/aem.js'];
const DEFAULT_PREVIEW_TIMEOUT_MS = 180_000;
const DEFAULT_PREVIEW_POLL_MS = 10_000;
const ALLOWED_FIX_PREFIXES = ['blocks/', 'scripts/'];

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function toDnsSafeBranchName(file) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = file
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 34);
  const suffix = Date.now().toString(36);
  return `perf-fix-${date}-${slug}-${suffix}`;
}

function isSafeFixTarget(file) {
  return ALLOWED_FIX_PREFIXES.some((prefix) => file.startsWith(prefix))
    && !file.includes('..')
    && !file.startsWith('/')
    && !PROTECTED_FILES.includes(file);
}

async function waitForPreview(
  url,
  timeoutMs = DEFAULT_PREVIEW_TIMEOUT_MS,
  pollMs = DEFAULT_PREVIEW_POLL_MS,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'preview not ready';

  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(url, { method: 'GET', cache: 'no-store' });
      if (res.ok) return true;
      lastError = `preview returned HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }

    // eslint-disable-next-line no-await-in-loop
    await wait(pollMs);
  }

  throw new Error(`Preview did not become live within ${timeoutMs}ms: ${lastError}`);
}

async function applyAndVerify(fixData, regression, context) {
  const {
    owner,
    repo,
    token,
    strategy,
    apiKey,
    defaultBranch = 'main',
    previewTimeoutMs = DEFAULT_PREVIEW_TIMEOUT_MS,
    previewPollMs = DEFAULT_PREVIEW_POLL_MS,
  } = context;
  const { file, original, replacement } = fixData;

  if (!isSafeFixTarget(file)) {
    throw new Error(`Refusing to modify out-of-scope file: ${file}`);
  }

  const { content, sha } = await getFileContent(owner, repo, file, defaultBranch, token);

  if (!content.includes(original)) {
    return {
      success: false,
      reason: `original string not found exactly in ${file} — cannot apply fix safely`,
    };
  }

  const patched = content.replace(original, replacement);
  const branch = toDnsSafeBranchName(file);

  const baseSha = await getDefaultBranchSha(owner, repo, token, defaultBranch);
  await createBranch(owner, repo, branch, baseSha, token);
  await upsertFile(owner, repo, branch, file, patched, `perf: fix CWV regression in ${file}`, sha, token);

  const previewURL = `https://${branch}--${repo}--${owner}.aem.page${new URL(regression.url).pathname}`;
  try {
    await waitForPreview(previewURL, previewTimeoutMs, previewPollMs);
  } catch (err) {
    return {
      success: false,
      branch,
      previewURL,
      reason: err.message,
    };
  }

  let previewMetrics;
  try {
    previewMetrics = await fetchPSI(previewURL, strategy, apiKey);
  } catch (err) {
    return {
      success: false,
      branch,
      previewURL,
      reason: `PSI check on preview failed: ${err.message}`,
    };
  }

  const lcpImproved = previewMetrics.lcp_ms < regression.current_lcp_ms;
  const scoreRecovered = regression.baseline_score == null
    || previewMetrics.score >= regression.baseline_score;

  return {
    success: lcpImproved && scoreRecovered,
    branch,
    previewURL,
    previewScore: previewMetrics.score,
    previewLCP: previewMetrics.lcp_ms,
  };
}

export {
  applyAndVerify,
  isSafeFixTarget,
  toDnsSafeBranchName,
  waitForPreview,
};
