# Enterprise Integration Guide

This project is designed to fit into existing Adobe Edge Delivery Services repositories without changing how teams build, preview, or publish sites.

## Recommended Default Mode

For enterprise clients, start in monitored human-review mode:

```json
{
  "ai_diagnosis_enabled": true,
  "auto_fix_enabled": false
}
```

In this mode the agent detects Core Web Vitals regressions and opens issues with context. It does not commit AI-generated code.

After the security and governance review is complete, teams can opt in to fix PRs:

```json
{
  "auto_fix_enabled": true
}
```

## Integration Options

### 1. Copy Into Each EDS Repository

Best for pilots and individual customer projects.

Copy:

```text
perf-agent/
perf-agent.config.json
.github/workflows/perf-regression.yml
.github/baselines/performance.json
```

This works well for a single brand site, campaign site, or blog repository.

### 2. Organization Template

Best for agencies or Adobe teams that launch many Edge Delivery projects.

Add the agent to an internal starter template so every new EDS repository gets:

- the workflow
- the default config
- baseline storage
- recommended labels
- documentation

### 3. Central Reusable Workflow

Best for large enterprises with many repositories.

Host the agent centrally and expose a reusable GitHub Actions workflow. Client repositories call the shared workflow and keep only their local config and baseline. This reduces upgrade work because fixes can be rolled out centrally.

### 4. Future GitHub App

Best for broad Adobe-managed adoption.

A GitHub App could install the workflow, manage permissions, seed baselines, and keep repositories upgraded. This is the cleanest long-term experience, but it is more work than the current repo needs for a pilot.

## Enterprise Rollout Plan

1. Start with 3 to 5 representative EDS sites.
2. Run in dry-run mode for one week.
3. Seed baselines from known-good production pages.
4. Enable issue creation with `auto_fix_enabled: false`.
5. Tune monitored paths and thresholds.
6. Review generated issues with performance engineers.
7. Enable AI fix PRs only for approved repositories.

## Recommended Paths For Blog Sites

Do not monitor every blog post at first. Monitor representative URLs:

```json
{
  "paths": [
    "/",
    "/blog",
    "/blog/example-high-traffic-post",
    "/search",
    "/authors/example-author"
  ]
}
```

This keeps PageSpeed usage predictable while still catching template, block, and shared-code regressions.

## Governance Notes

- `PSI_API_KEY` is required for stable PageSpeed Insights quota.
- `GITHUB_TOKEN` is temporary and provided by GitHub Actions.
- GitHub Models receives regression data and recent diffs when `ai_diagnosis_enabled` is true.
- AI-generated code changes are opt-in.
- The agent can only edit files under `blocks/` or `scripts/`, and never `scripts/aem.js`.
- The agent never merges PRs.

## Presentation Summary

This repo is best positioned as an EDS performance quality gate:

```text
EDS repository -> GitHub Actions -> PageSpeed Insights -> baseline comparison -> issue or supervised PR
```

It supports Adobe's performance-first EDS story by helping teams catch regressions after code changes, while staying conservative enough for enterprise review.
