import {
  getFileContent, getDefaultBranchSha, createBranch, upsertFile,
} from './github-api.js';
import { fetchPSI } from './psi.js';

const PROTECTED_FILES = ['scripts/aem.js'];
const CODE_SYNC_DELAY_MS = 30_000;

async function applyAndVerify(fixData, regression, context) {
  const {
    owner, repo, token, strategy, apiKey,
  } = context;
  const { file, original, replacement } = fixData;

  if (PROTECTED_FILES.includes(file)) {
    throw new Error(`Refusing to modify protected file: ${file}`);
  }

  const { content, sha } = await getFileContent(owner, repo, file, 'main', token);

  if (!content.includes(original)) {
    return {
      success: false,
      reason: `original string not found exactly in ${file} — cannot apply fix safely`,
    };
  }

  const patched = content.replace(original, replacement);
  const date = new Date().toISOString().slice(0, 10);
  const slug = file.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30);
  const branch = `perf-fix/${date}-${slug}`;

  const baseSha = await getDefaultBranchSha(owner, repo, token);
  await createBranch(owner, repo, branch, baseSha, token);
  await upsertFile(owner, repo, branch, file, patched, `perf: fix CWV regression in ${file}`, sha, token);

  // AEM Code Sync takes ~20-30s to make the new branch available on *.aem.page
  await new Promise((r) => { setTimeout(r, CODE_SYNC_DELAY_MS); });

  const previewURL = `https://${branch}--${repo}--${owner}.aem.page${new URL(regression.url).pathname}`;

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
  const scoreImproved = previewMetrics.score >= regression.current_score;

  return {
    success: lcpImproved && scoreImproved,
    branch,
    previewURL,
    previewScore: previewMetrics.score,
    previewLCP: previewMetrics.lcp_ms,
  };
}

export { applyAndVerify };
