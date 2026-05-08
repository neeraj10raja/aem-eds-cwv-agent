import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { detectRegressions, loadBaseline, saveBaseline } from '../perf-agent/baseline.js';

test('loadBaseline returns empty object for missing or invalid files', () => {
  assert.deepEqual(loadBaseline('/does/not/exist.json'), {});
});

test('saveBaseline writes scores keyed by URL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'perf-agent-'));
  const file = join(dir, 'performance.json');

  saveBaseline(file, [{
    url: 'https://example.com/',
    score: 99,
    lcp_ms: 1200,
    inp_ms: 80,
    cls: 0.01,
    tbt_ms: 10,
    timestamp: '2026-05-07T00:00:00.000Z',
  }]);

  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved['https://example.com/'].score, 99);
  assert.equal(saved['https://example.com/'].lcp_ms, 1200);
  assert.equal(saved['https://example.com/'].inp_ms, 80);
});

test('detectRegressions flags LCP and score drops over threshold', () => {
  const currentScores = [{
    url: 'https://example.com/',
    score: 80,
    lcp_ms: 2200,
    inp_ms: 120,
    cls: 0.02,
    opportunities: [{ title: 'Serve images faster' }],
  }];
  const baseline = {
    'https://example.com/': {
      score: 90,
      lcp_ms: 1500,
    },
  };

  const regressions = detectRegressions(currentScores, baseline, {
    lcp_good_ms: 2500,
    inp_good_ms: 200,
    cls_good: 0.1,
    lcp_increase_ms: 500,
    score_drop: 5,
  });

  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].lcp_delta_ms, 700);
  assert.equal(regressions[0].score_delta, 10);
});

test('detectRegressions ignores changes within threshold', () => {
  const regressions = detectRegressions([{
    url: 'https://example.com/',
    score: 88,
    lcp_ms: 1800,
    inp_ms: 100,
    cls: 0.01,
  }], {
    'https://example.com/': {
      score: 90,
      lcp_ms: 1500,
    },
  }, {
    lcp_good_ms: 2500,
    inp_good_ms: 200,
    cls_good: 0.1,
    lcp_increase_ms: 500,
    score_drop: 5,
  });

  assert.deepEqual(regressions, []);
});

test('detectRegressions flags absolute Core Web Vitals failures without baseline', () => {
  const regressions = detectRegressions([{
    url: 'https://example.com/',
    score: 95,
    lcp_ms: 2600,
    inp_ms: 250,
    cls: 0.2,
  }], {}, {
    lcp_good_ms: 2500,
    inp_good_ms: 200,
    cls_good: 0.1,
    lcp_increase_ms: 500,
    score_drop: 5,
  });

  assert.equal(regressions.length, 1);
  assert.deepEqual(regressions[0].reasons, [
    'LCP is above good threshold (2500ms)',
    'INP is above good threshold (200ms)',
    'CLS is above good threshold (0.1)',
  ]);
  assert.equal(regressions[0].baseline_lcp_ms, null);
});
