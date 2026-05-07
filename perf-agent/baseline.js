import { readFileSync, writeFileSync } from 'fs';

function loadBaseline(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveBaseline(filePath, scores) {
  const data = {};
  for (const score of scores) {
    data[score.url] = {
      score: score.score,
      lcp_ms: score.lcp_ms,
      cls: score.cls,
      tbt_ms: score.tbt_ms,
      updated_at: score.timestamp,
    };
  }
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function detectRegressions(currentScores, baseline, thresholds) {
  const regressions = [];

  for (const current of currentScores) {
    const base = baseline[current.url];
    if (base) {
      const lcpDelta = current.lcp_ms - base.lcp_ms;
      const scoreDelta = base.score - current.score;

      if (lcpDelta > thresholds.lcp_increase_ms || scoreDelta > thresholds.score_drop) {
        regressions.push({
          url: current.url,
          baseline_score: base.score,
          current_score: current.score,
          score_delta: scoreDelta,
          baseline_lcp_ms: base.lcp_ms,
          current_lcp_ms: current.lcp_ms,
          lcp_delta_ms: lcpDelta,
          opportunities: current.opportunities,
        });
      }
    }
  }

  return regressions;
}

export { loadBaseline, saveBaseline, detectRegressions };
