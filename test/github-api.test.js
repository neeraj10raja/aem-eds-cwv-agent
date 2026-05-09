import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addLabels,
  checkOpenIssues,
  checkOpenPRs,
  getRecentCommits,
  getCommitDiff,
} from '../perf-agent/github-api.js';

test('getCommitDiff retries transient failures and returns truncation metadata', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 502,
        text: async () => 'bad gateway',
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '0123456789',
    };
  };

  try {
    const result = await getCommitDiff('owner', 'repo', 'sha', 'token', 5);

    assert.equal(calls, 2);
    assert.equal(result.diff, '01234');
    assert.equal(result.truncated, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getRecentCommits paginates through active repositories', async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];
  const makeCommit = (sha) => ({
    sha,
    commit: {
      message: `Commit ${sha}\n\nDetails`,
      author: {
        name: 'Test User',
        date: '2026-05-08T00:00:00Z',
      },
    },
  });

  global.fetch = async (url) => {
    requestedUrls.push(url);
    const page = new URL(url).searchParams.get('page');
    const commits = page === '1'
      ? Array.from({ length: 100 }, (_, i) => makeCommit(`sha-${i}`))
      : [makeCommit('sha-100')];
    return {
      ok: true,
      status: 200,
      json: async () => commits,
    };
  };

  try {
    const commits = await getRecentCommits('owner', 'repo', '2026-05-07T00:00:00Z', 'token');

    assert.equal(commits.length, 101);
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[0], /per_page=100/);
    assert.match(requestedUrls[1], /page=2/);
    assert.equal(commits[0].message, 'Commit sha-0');
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkOpenIssues ignores pull requests and matches issue title', async () => {
  const originalFetch = global.fetch;
  let requestedUrl;

  global.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => [
        { title: 'same title', pull_request: {} },
        { title: 'same title' },
      ],
    };
  };

  try {
    const found = await checkOpenIssues('owner', 'repo', {
      label: 'perf-regression-needs-human',
      title: 'same title',
    }, 'token');

    assert.equal(found, true);
    assert.match(requestedUrl, /labels=perf-regression-needs-human/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkOpenPRs can dedupe by title prefix', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => [
      { title: 'perf: CWV regression on /products (fix verified)', head: { ref: 'perf-fix-a' } },
    ],
  });

  try {
    const found = await checkOpenPRs('owner', 'repo', {
      titlePrefix: 'perf: CWV regression on /products',
    }, 'token');

    assert.equal(found, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getCommitDiff handles empty 204 responses', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    status: 204,
  });

  try {
    const result = await getCommitDiff('owner', 'repo', 'sha', 'token', 5);

    assert.equal(result.diff, '');
    assert.equal(result.truncated, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('addLabels ignores label creation races', async () => {
  const originalFetch = global.fetch;
  const urls = [];

  global.fetch = async (url, options = {}) => {
    urls.push(url);
    if (url.includes('/labels/perf-regression') && options.method !== 'POST') {
      return {
        ok: false,
        status: 404,
        text: async () => 'not found',
      };
    }
    if (url === 'https://api.github.com/repos/owner/repo/labels' && options.method === 'POST') {
      return {
        ok: false,
        status: 422,
        text: async () => 'already exists',
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    };
  };

  try {
    await addLabels('owner', 'repo', 1, ['perf-regression'], 'token');

    assert.ok(urls.some((url) => url.endsWith('/issues/1/labels')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('getCommitDiff does not retry non-retryable failures', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 404,
      text: async () => 'not found',
    };
  };

  try {
    await assert.rejects(
      getCommitDiff('owner', 'repo', 'sha', 'token', 5),
      /GitHub API 404/,
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
