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
      inp_ms: score.inp_ms,
      cls: score.cls,
      tbt_ms: score.tbt_ms,
      updated_at: score.timestamp,
    };
  }
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function buildReasons(current, base, thresholds) {
  const reasons = [];
  const lcpDelta = base ? current.lcp_ms - base.lcp_ms : 0;
  const scoreDelta = base ? base.score - current.score : 0;

  if (base && lcpDelta > thresholds.lcp_increase_ms) {
    reasons.push(`LCP increased by ${lcpDelta}ms`);
  }
  if (base && scoreDelta > thresholds.score_drop) {
    reasons.push(`Performance score dropped by ${scoreDelta}`);
  }
  if (current.lcp_ms > thresholds.lcp_good_ms) {
    reasons.push(`LCP is above good threshold (${thresholds.lcp_good_ms}ms)`);
  }
  if (current.inp_ms > thresholds.inp_good_ms) {
    reasons.push(`INP is above good threshold (${thresholds.inp_good_ms}ms)`);
  }
  if (current.cls > thresholds.cls_good) {
    reasons.push(`CLS is above good threshold (${thresholds.cls_good})`);
  }

  return { reasons, lcpDelta, scoreDelta };
}

function detectRegressions(currentScores, baseline, thresholds) {
  const regressions = [];

  for (const current of currentScores) {
    const base = baseline[current.url];
    const { reasons, lcpDelta, scoreDelta } = buildReasons(current, base, thresholds);

    if (reasons.length > 0) {
      regressions.push({
        url: current.url,
        reasons,
        baseline_score: base?.score ?? null,
        current_score: current.score,
        score_delta: scoreDelta,
        baseline_lcp_ms: base?.lcp_ms ?? null,
        current_lcp_ms: current.lcp_ms,
        lcp_delta_ms: lcpDelta,
        current_inp_ms: current.inp_ms,
        current_cls: current.cls,
        opportunities: current.opportunities,
      });
    }
  }

  return regressions;
}

export { loadBaseline, saveBaseline, detectRegressions };
