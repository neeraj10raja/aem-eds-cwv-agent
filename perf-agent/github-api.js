const API = 'https://api.github.com';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function ghFetch(path, token, options = {}) {
  const res = await fetch(`${API}${path}`, { ...options, headers: headers(token) });
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getRecentCommits(owner, repo, sinceISO, token) {
  const params = new URLSearchParams({ since: sinceISO, per_page: '20' });
  const commits = await ghFetch(`/repos/${owner}/${repo}/commits?${params}`, token);
  return commits.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split('\n')[0],
    author: c.commit.author.name,
    date: c.commit.author.date,
  }));
}

async function getCommitDiff(owner, repo, sha, token) {
  const res = await fetch(`${API}/repos/${owner}/${repo}/commits/${sha}`, {
    headers: { ...headers(token), Accept: 'application/vnd.github.diff' },
  });
  if (!res.ok) return '';
  const diff = await res.text();
  // Truncate to 8KB to keep AI context manageable
  return diff.slice(0, 8192);
}

async function getFileContent(owner, repo, path, branch, token) {
  const data = await ghFetch(`/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, token);
  return {
    content: Buffer.from(data.content, 'base64').toString('utf8'),
    sha: data.sha,
  };
}

async function getDefaultBranchSha(owner, repo, token) {
  const data = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/main`, token);
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

async function checkOpenPRs(owner, repo, label, token) {
  const prs = await ghFetch(`/repos/${owner}/${repo}/pulls?state=open&per_page=20`, token);
  return prs.some((pr) => pr.labels?.some((l) => l.name === label));
}

async function createPR(owner, repo, options, token) {
  const {
    title, body, head, base = 'main',
  } = options;
  const pr = await ghFetch(`/repos/${owner}/${repo}/pulls`, token, {
    method: 'POST',
    body: JSON.stringify({
      title, body, head, base,
    }),
  });
  return { url: pr.html_url, number: pr.number };
}

async function createIssue(owner, repo, options, token) {
  const { title, body, labels } = options;
  const issue = await ghFetch(`/repos/${owner}/${repo}/issues`, token, {
    method: 'POST',
    body: JSON.stringify({ title, body, labels }),
  });
  return { url: issue.html_url, number: issue.number };
}

export {
  getRecentCommits,
  getCommitDiff,
  getFileContent,
  getDefaultBranchSha,
  createBranch,
  upsertFile,
  checkOpenPRs,
  createPR,
  createIssue,
};
