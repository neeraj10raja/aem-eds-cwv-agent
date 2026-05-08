#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    target: null,
    agentDir: 'perf-agent',
    paths: ['/'],
    siteUrl: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') args.target = argv[++i];
    else if (arg === '--agent-dir') args.agentDir = argv[++i];
    else if (arg === '--site-url') args.siteUrl = argv[++i];
    else if (arg === '--paths') args.paths = argv[++i].split(',').map((p) => p.trim()).filter(Boolean);
    else if (!args.target) args.target = arg;
  }

  return args;
}

function ensureInsideGitRepo(target) {
  if (!existsSync(join(target, '.git'))) {
    throw new Error(`Target does not look like a git repository: ${target}`);
  }
}

function rewriteWorkflow(workflow, agentDir) {
  return workflow
    .replaceAll('perf-agent/*.js', `${agentDir}/*.js`)
    .replaceAll('node perf-agent/index.js', `node ${agentDir}/index.js`);
}

function buildConfig(paths, siteUrl) {
  const config = JSON.parse(readFileSync(join(repoRoot, 'perf-agent.config.example.json'), 'utf8'));
  config.paths = paths;
  if (siteUrl) config.site_url = siteUrl;
  else delete config.site_url;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function install(args) {
  if (!args.target) {
    throw new Error('Usage: node scripts/install.js --target /path/to/eds-repo [--site-url https://example.com] [--paths /,/blog]');
  }

  const target = resolve(args.target);
  ensureInsideGitRepo(target);

  const agentTarget = join(target, args.agentDir);
  mkdirSync(agentTarget, { recursive: true });
  cpSync(join(repoRoot, 'perf-agent'), agentTarget, { recursive: true });

  const workflowDir = join(target, '.github/workflows');
  mkdirSync(workflowDir, { recursive: true });
  const workflow = readFileSync(join(repoRoot, '.github/workflows/perf-regression.yml'), 'utf8');
  writeFileSync(join(workflowDir, 'perf-regression.yml'), rewriteWorkflow(workflow, args.agentDir));

  const baselineDir = join(target, '.github/baselines');
  mkdirSync(baselineDir, { recursive: true });
  const baselinePath = join(baselineDir, 'performance.json');
  if (!existsSync(baselinePath)) writeFileSync(baselinePath, '{}\n');

  writeFileSync(join(target, 'perf-agent.config.json'), buildConfig(args.paths, args.siteUrl));

  console.log(`Installed perf agent into ${target}`);
  console.log('');
  console.log('Next steps in GitHub:');
  console.log('1. Add repository secret PSI_API_KEY.');
  console.log('2. Enable Actions read/write workflow permissions.');
  console.log('3. Run "Performance Regression Detection" with update_baseline=true.');
  console.log('');
  console.log('Safe defaults: auto_fix_enabled=false, so it opens issues, not AI fix PRs.');
}

try {
  install(parseArgs(process.argv.slice(2)));
} catch (err) {
  console.error(`[install] ${err.message}`);
  process.exit(1);
}
