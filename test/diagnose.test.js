import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPrompt, diagnose, normalizeDiagnosis } from '../perf-agent/diagnose.js';

test('buildPrompt marks truncated diffs so the model knows to be conservative', () => {
  const prompt = buildPrompt({
    url: 'https://example.com/',
    baseline_lcp_ms: 1000,
    current_lcp_ms: 2000,
    lcp_delta_ms: 1000,
    baseline_score: 95,
    current_score: 80,
    score_delta: 15,
    opportunities: [],
  }, [{
    sha: 'abc123456',
    author: 'Test User',
    date: '2026-05-07T00:00:00Z',
    message: 'Update hero block',
  }], [{
    diff: 'diff --git a/blocks/hero/hero.js b/blocks/hero/hero.js',
    truncated: true,
  }]);

  assert.match(prompt, /DIFF TRUNCATED/);
});

test('buildPrompt renders missing baseline as no baseline', () => {
  const prompt = buildPrompt({
    url: 'https://example.com/',
    baseline_lcp_ms: null,
    current_lcp_ms: 2600,
    lcp_delta_ms: 0,
    baseline_score: null,
    current_score: 75,
    score_delta: 0,
    opportunities: [],
  }, [], []);

  assert.match(prompt, /LCP before: no baseline/);
  assert.match(prompt, /Score before: no baseline/);
  assert.doesNotMatch(prompt, /nullms/);
});

test('diagnose requests enough tokens for larger JSON fixes', async () => {
  const originalFetch = global.fetch;
  let requestBody;

  global.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              diagnosis: 'No fix.',
              rootCause: 'unknown',
              confidence: 'low',
            }),
          },
        }],
      }),
    };
  };

  try {
    await diagnose({
      url: 'https://example.com/',
      baseline_lcp_ms: null,
      current_lcp_ms: 2600,
      lcp_delta_ms: 0,
      baseline_score: null,
      current_score: 75,
      score_delta: 0,
      opportunities: [],
    }, [], [], 'token');

    assert.equal(requestBody.max_tokens, 2048);
  } finally {
    global.fetch = originalFetch;
  }
});

test('normalizeDiagnosis downgrades high confidence when any diff was truncated', () => {
  const result = normalizeDiagnosis({
    diagnosis: 'Hero image is lazy loaded.',
    rootCause: 'abc1234 blocks/hero/hero.js',
    confidence: 'high',
    fix: {
      file: 'blocks/hero/hero.js',
      original: 'img.loading = "lazy"',
      replacement: 'img.loading = "eager"',
    },
  }, [{ diff: 'partial diff', truncated: true }]);

  assert.equal(result.confidence, 'low');
  assert.equal(result.fix, undefined);
});

test('normalizeDiagnosis preserves high confidence when diffs are complete', () => {
  const result = normalizeDiagnosis({
    diagnosis: 'Hero image is lazy loaded.',
    rootCause: 'abc1234 blocks/hero/hero.js',
    confidence: 'high',
    fix: {
      file: 'blocks/hero/hero.js',
      original: 'img.loading = "lazy"',
      replacement: 'img.loading = "eager"',
    },
  }, [{ diff: 'complete diff', truncated: false }]);

  assert.equal(result.confidence, 'high');
  assert.equal(result.fix.file, 'blocks/hero/hero.js');
});

test('diagnose retries transient GitHub Models failures', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      };
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              diagnosis: 'Hero image is too large.',
              rootCause: 'abc123 blocks/hero/hero.js',
              confidence: 'low',
            }),
          },
        }],
      }),
    };
  };

  try {
    const result = await diagnose({
      url: 'https://example.com/',
      baseline_lcp_ms: 1000,
      current_lcp_ms: 2000,
      lcp_delta_ms: 1000,
      baseline_score: 95,
      current_score: 80,
      score_delta: 15,
      opportunities: [],
    }, [], [], 'token');

    assert.equal(calls, 2);
    assert.equal(result.confidence, 'low');
  } finally {
    global.fetch = originalFetch;
  }
});
