const API = 'https://api.github.com';
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_RETRIES = 3;

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function request(url, options = {}) {
  const {
    retries = DEFAULT_RETRIES,
    parse = 'json',
    ...fetchOptions
  } = options;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(url, fetchOptions);
      if (res.status === 204) return null;
      if (res.ok) {
        if (parse === 'text') return res.text();
        return res.json();
      }

      // eslint-disable-next-line no-await-in-loop
      const body = await res.text().catch(() => '');
      lastError = new Error(`GitHub API ${res.status} on ${url}: ${body.slice(0, 200)}`);
      if (!RETRY_STATUSES.has(res.status) || attempt === retries) throw lastError;
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw lastError;
    }

    const status = Number(lastError.message.match(/GitHub API (\d+)/)?.[1]);
    if (status && !RETRY_STATUSES.has(status)) throw lastError;

    // eslint-disable-next-line no-await-in-loop
    await wait(1000 * 2 ** attempt);
  }

  throw lastError;
}

async function ghFetch(path, token, options = {}) {
  return request(`${API}${path}`, {
    ...options,
    headers: {
      ...headers(token),
      ...(options.headers ?? {}),
    },
  });
}

async function getRecentCommits(owner, repo, sinceISO, token, maxPages = 5) {
  const allCommits = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({ since: sinceISO, per_page: '100', page: String(page) });
    // eslint-disable-next-line no-await-in-loop
    const commits = await ghFetch(`/repos/${owner}/${repo}/commits?${params}`, token);
    allCommits.push(...commits);
    if (commits.length < 100) break;
  }

  return allCommits.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split('\n')[0],
    author: c.commit.author.name,
    date: c.commit.author.date,
  }));
}

async function getCommitDiff(owner, repo, sha, token, maxBytes = 20000) {
  const diff = await ghFetch(`/repos/${owner}/${repo}/commits/${sha}`, token, {
    headers: { Accept: 'application/vnd.github.diff' },
    parse: 'text',
  }) ?? '';
  return {
    sha,
    diff: diff.slice(0, maxBytes),
    truncated: diff.length > maxBytes,
  };
}

async function getFileContent(owner, repo, path, branch, token) {
  const data = await ghFetch(`/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, token);
  return {
    content: Buffer.from(data.content, 'base64').toString('utf8'),
    sha: data.sha,
  };
}

async function getDefaultBranchSha(owner, repo, token, defaultBranch = 'main') {
  const data = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, token);
  return data.object.sha;
}

async function createBranch(owner, repo, branchName, fromSha, token) {
  await ghFetch(`/repos/${owner}/${repo}/git/refs`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
  });
}

async function upsertFile(owner, repo, branch, path, content, message, existingSha, token) {
  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch,
  };
  if (existingSha) body.sha = existingSha;
  await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, token, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

async function addLabels(owner, repo, issueNumber, labels, token) {
  if (!labels?.length) return;
  await Promise.all(labels.map(async (label) => {
    try {
      await ghFetch(`/repos/${owner}/${repo}/labels/${encodeURIComponent(label)}`, token, { retries: 0 });
    } catch {
      try {
        await ghFetch(`/repos/${owner}/${repo}/labels`, token, {
          method: 'POST',
          body: JSON.stringify({ name: label, color: 'd73a4a' }),
        });
      } catch (err) {
        if (!err.message.includes('422')) throw err;
      }
    }
  }));
  await ghFetch(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, token, {
    method: 'POST',
    body: JSON.stringify({ labels }),
  });
}

async function checkOpenPRs(owner, repo, options, token) {
  const { label, headPrefix, titlePrefix } = typeof options === 'string' ? { label: options } : options;
  const prs = await ghFetch(`/repos/${owner}/${repo}/pulls?state=open&per_page=50`, token);
  return prs.some((pr) => {
    const hasLabel = label && pr.labels?.some((l) => l.name === label);
    const hasHeadPrefix = headPrefix && pr.head?.ref?.startsWith(headPrefix);
    const hasTitlePrefix = titlePrefix && pr.title?.startsWith(titlePrefix);
    return hasLabel || hasHeadPrefix || hasTitlePrefix;
  });
}

async function checkOpenIssues(owner, repo, options, token) {
  const { label, title } = options;
  const params = new URLSearchParams({ state: 'open', per_page: '50' });
  if (label) params.set('labels', label);
  const issues = await ghFetch(`/repos/${owner}/${repo}/issues?${params}`, token);
  return issues.some((issue) => !issue.pull_request && (!title || issue.title === title));
}

async function createPR(owner, repo, options, token) {
  const {
    title, body, head, base = 'main', labels = [],
  } = options;
  const pr = await ghFetch(`/repos/${owner}/${repo}/pulls`, token, {
    method: 'POST',
    body: JSON.stringify({
      title, body, head, base,
    }),
  });
  await addLabels(owner, repo, pr.number, labels, token);
  return { url: pr.html_url, number: pr.number };
}

async function createIssue(owner, repo, options, token) {
  const { title, body, labels } = options;
  const issue = await ghFetch(`/repos/${owner}/${repo}/issues`, token, {
    method: 'POST',
    body: JSON.stringify({ title, body }),
  });
  await addLabels(owner, repo, issue.number, labels, token);
  return { url: issue.html_url, number: issue.number };
}

export {
  getRecentCommits,
  getCommitDiff,
  getFileContent,
  getDefaultBranchSha,
  createBranch,
  upsertFile,
  addLabels,
  checkOpenPRs,
  checkOpenIssues,
  createPR,
  createIssue,
};
