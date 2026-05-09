import assert from 'node:assert/strict';
import test from 'node:test';

import { countOccurrences, isSafeFixTarget, toDnsSafeBranchName } from '../perf-agent/fix.js';

test('toDnsSafeBranchName creates AEM-preview-safe branch names', () => {
  const branch = toDnsSafeBranchName('blocks/Hero Banner/hero.js');

  assert.match(branch, /^perf-fix-\d{4}-\d{2}-\d{2}-blocks-hero-banner-hero-js-[a-z0-9]+$/);
  assert.equal(branch.includes('/'), false);
  assert.equal(branch, branch.toLowerCase());
});

test('toDnsSafeBranchName keeps long file names short enough for preview hosts', () => {
  const branch = toDnsSafeBranchName('blocks/some-extremely-long-block-name-that-keeps-going/index.js');

  assert.ok(branch.length < 64);
});

test('isSafeFixTarget allows only scoped block and script files', () => {
  assert.equal(isSafeFixTarget('blocks/hero/hero.js'), true);
  assert.equal(isSafeFixTarget('scripts/delayed.js'), true);
  assert.equal(isSafeFixTarget('scripts/aem.js'), false);
  assert.equal(isSafeFixTarget('.github/workflows/perf-regression.yml'), false);
  assert.equal(isSafeFixTarget('blocks/hero/../../.github/workflows/main.yml'), false);
  assert.equal(isSafeFixTarget('/blocks/hero/hero.js'), false);
});

test('countOccurrences detects duplicate AI replacement targets', () => {
  const content = `
    img.loading = 'lazy';
    picture.append(img);
    img.loading = 'lazy';
  `;

  assert.equal(countOccurrences(content, "img.loading = 'lazy';"), 2);
  assert.equal(countOccurrences(content, 'missing'), 0);
  assert.equal(countOccurrences(content, ''), 0);
});
