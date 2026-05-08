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

function patchEsLintConfig(target, agentDir) {
  const candidates = ['.eslintrc.js', '.eslintrc.cjs'];
  const found = candidates.find((f) => existsSync(join(target, f)));
  if (!found) return false;

  const eslintPath = join(target, found);
  const content = readFileSync(eslintPath, 'utf8');

  if (content.includes(agentDir)) return false;

  const patched = content.replace(
    /files:\s*\[(['"`]tools\/\*\*\/\*\.js['"`])\]/,
    `files: ['tools/**/*.js', '${agentDir}/**/*.js']`,
  );

  if (patched === content) return false;

  writeFileSync(eslintPath, patched);
  return true;
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
  const templatePath = join(repoRoot, 'scripts/templates/perf-regression.yml');
  const workflow = readFileSync(templatePath, 'utf8');
  writeFileSync(join(workflowDir, 'perf-regression.yml'), rewriteWorkflow(workflow, args.agentDir));

  const baselineDir = join(target, '.github/baselines');
  mkdirSync(baselineDir, { recursive: true });
  const baselinePath = join(baselineDir, 'performance.json');
  if (!existsSync(baselinePath)) writeFileSync(baselinePath, '{}\n');

  writeFileSync(join(target, 'perf-agent.config.json'), buildConfig(args.paths, args.siteUrl));

  const eslintPatched = patchEsLintConfig(target, args.agentDir);

  console.log(`Installed perf agent into ${target}`);
  if (eslintPatched) console.log('Patched .eslintrc to add perf-agent Node.js overrides.');
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
