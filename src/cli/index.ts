#!/usr/bin/env bun

import { loadConfig } from '../config/index.ts';
import { startWatcher, runPollCycle } from '../services/watcher.ts';
import { StateStore } from '../state/state-store.ts';
import { processPR } from '../services/processor.ts';
import * as sdk from '../sdk/azure-devops-client.ts';

const HELP = `
DevOps Code Reviewer

Usage:
  devops-code-reviewer <command>

Commands:
  watch                          Start the long-running watcher (polls every N minutes)
  run-once                       Run a single poll cycle and exit
  review-pr <repoId> <prId>      Review a single PR and post results
  test-pr <repoId> <prId>        Review a single PR (dry-run, no writes)
  reset-state                    Clear the processed PR state and exit
  help                           Show this help message

Options:
  --dry-run        Read-only mode: review but skip Azure DevOps writes

Environment variables:
  AZURE_DEVOPS_PAT            Azure DevOps personal access token (required)
  AZURE_DEVOPS_ORG            Azure DevOps organization name (required)
  AZURE_DEVOPS_PROJECT        Azure DevOps project name (required)
  AZURE_DEVOPS_REPO_IDS       Comma-separated repository IDs to monitor (required)
  TARGET_REPO_PATH            Local path to repository clone (required)
  POLL_INTERVAL_MINUTES       Polling interval (default: 30)
  MAX_REVIEWS_PER_DAY         Daily review limit (default: 10)
  CLAUDE_MODEL                Claude model to use (default: claude-sonnet-4-6)
  REVIEW_LABEL                Label that triggers review (default: code-review)
  STATE_DIR                   State directory (default: .state)
`.trim();

const command = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

switch (command) {
  case 'watch': {
    const config = loadConfig();
    config.dryRun = dryRun;
    if (dryRun) console.log('[DRY RUN] No writes will be made to Azure DevOps\n');
    await startWatcher(config);
    break;
  }

  case 'run-once': {
    const config = loadConfig();
    config.dryRun = dryRun;
    if (dryRun) console.log('[DRY RUN] No writes will be made to Azure DevOps\n');
    const stateStore = new StateStore(config.stateDir);
    const result = await runPollCycle(config, stateStore);
    console.log(`Done: ${result.reviewed} reviewed, ${result.skipped} skipped, ${result.errors} errors`);
    break;
  }

  case 'review-pr':
  case 'test-pr': {
    const repoIdArg = process.argv[3];
    const prIdArg = process.argv[4];
    if (!repoIdArg || !prIdArg || isNaN(Number(prIdArg))) {
      console.error(`Usage: devops-code-reviewer ${command} <repoId> <prId>`);
      process.exitCode = 1;
      break;
    }
    const config = loadConfig();
    config.dryRun = command === 'test-pr' || dryRun;
    if (config.dryRun) console.log('[DRY RUN] No writes will be made to Azure DevOps\n');

    const prId = Number(prIdArg);
    console.log(`Reviewing PR #${prId} in repo ${repoIdArg}...\n`);

    // Fetch labels to find the review label ID (needed for removal)
    const labels = await sdk.getPullRequestLabels(config, repoIdArg, prId);
    const reviewLabel = labels.find(
      (l) => l.name.toLowerCase() === config.reviewLabel.toLowerCase(),
    );

    // Fetch PR details from the active PRs list
    const prs = await sdk.listActivePullRequests(config, repoIdArg);
    const pr = prs.find((p) => p.pullRequestId === prId);
    if (!pr) {
      console.error(`PR #${prId} not found in repo ${repoIdArg} (or not active)`);
      process.exitCode = 1;
      break;
    }

    const result = await processPR(config, {
      pullRequest: pr,
      repoId: repoIdArg,
      labelId: reviewLabel?.id ?? '',
    });

    if (result.reviewed) {
      console.log(`\nDone: PR #${prId} reviewed successfully`);
    } else {
      console.log(`\nFailed: ${result.error}`);
      process.exitCode = 1;
    }
    break;
  }

  case 'reset-state': {
    const config = loadConfig();
    const stateStore = new StateStore(config.stateDir);
    stateStore.reset();
    console.log('State has been reset');
    break;
  }

  case 'help':
  default:
    console.log(HELP);
    break;
}
