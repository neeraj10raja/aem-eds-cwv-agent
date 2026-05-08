import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchPSI } from '../perf-agent/psi.js';

function psiPayload() {
  return {
    lighthouseResult: {
      categories: {
        performance: { score: 0.9 },
      },
      audits: {
        'largest-contentful-paint': { numericValue: 1200 },
        'cumulative-layout-shift': { numericValue: 0.02 },
        'total-blocking-time': { numericValue: 10 },
        'first-contentful-paint': { numericValue: 900 },
        'interaction-to-next-paint': { numericValue: 100 },
      },
    },
  };
}

test('fetchPSI retries transient failures', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 503,
      };
    }
    return {
      ok: true,
      json: async () => psiPayload(),
    };
  };

  try {
    const result = await fetchPSI('https://example.com/', 'mobile', 'key');

    assert.equal(calls, 2);
    assert.equal(result.score, 90);
    assert.equal(result.lcp_ms, 1200);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchPSI does not retry non-retryable failures', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 403,
    };
  };

  try {
    await assert.rejects(
      fetchPSI('https://example.com/', 'mobile', 'bad-key'),
      /PSI 403/,
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
