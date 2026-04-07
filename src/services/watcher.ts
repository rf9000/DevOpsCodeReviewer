import type {
  AppConfig,
  PullRequest,
  PullRequestLabel,
  PRReviewCandidate,
  PRReviewResult,
} from '../types/index.ts';
import { StateStore } from '../state/state-store.ts';
import * as sdk from '../sdk/azure-devops-client.ts';
import * as proc from './processor.ts';

export interface WatcherDeps {
  listActivePullRequests: (
    config: AppConfig,
    repoId: string,
  ) => Promise<PullRequest[]>;

  getPullRequestLabels: (
    config: AppConfig,
    repoId: string,
    prId: number,
  ) => Promise<PullRequestLabel[]>;

  processPR: (
    config: AppConfig,
    candidate: PRReviewCandidate,
  ) => Promise<PRReviewResult>;
}

const defaultDeps: WatcherDeps = {
  listActivePullRequests: sdk.listActivePullRequests,
  getPullRequestLabels: sdk.getPullRequestLabels,
  processPR: proc.processPR,
};

function log(message: string): void {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const ts = now.toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

async function findLabeledPRs(
  config: AppConfig,
  stateStore: StateStore,
  deps: WatcherDeps,
): Promise<PRReviewCandidate[]> {
  const candidates: PRReviewCandidate[] = [];

  for (const repoId of config.repoIds) {
    const prs = await deps.listActivePullRequests(config, repoId);

    for (const pr of prs) {
      const labels = await deps.getPullRequestLabels(config, repoId, pr.pullRequestId);
      const match = labels.find(
        (l) => l.name.toLowerCase() === config.reviewLabel.toLowerCase(),
      );
      if (match) {
        candidates.push({
          pullRequest: pr,
          repoId,
          labelId: match.id,
        });
      }
    }
  }

  return candidates;
}

export async function runPollCycle(
  config: AppConfig,
  stateStore: StateStore,
  deps: WatcherDeps = defaultDeps,
): Promise<{ reviewed: number; skipped: number; errors: number }> {
  // 1. On first run, seed existing labeled PRs as already processed
  if (stateStore.isFirstRun) {
    log('First run detected — seeding existing labeled PRs as already processed...');
    const existing = await findLabeledPRs(config, stateStore, deps);
    for (const candidate of existing) {
      const prKey = `${candidate.repoId}:${candidate.pullRequest.pullRequestId}`;
      stateStore.markProcessed(prKey);
    }
    stateStore.save();
    log(`Seeded ${existing.length} existing PRs. Future runs will only process new PRs.`);
    return { reviewed: 0, skipped: existing.length, errors: 0 };
  }

  // 2. Find labeled PRs across all repos
  const candidates = await findLabeledPRs(config, stateStore, deps);

  // 3. Filter out already-processed PRs
  const newCandidates = candidates.filter((c) => {
    const prKey = `${c.repoId}:${c.pullRequest.pullRequestId}`;
    return !stateStore.isProcessed(prKey);
  });

  log(
    `Found ${candidates.length} candidates, ${candidates.length - newCandidates.length} already processed`,
  );

  let reviewed = 0;
  let skipped = 0;
  let errors = 0;

  for (const candidate of newCandidates) {
    // 4. Check daily limit
    if (!stateStore.canReviewToday(config.maxReviewsPerDay)) {
      log(
        `Daily review limit reached (${config.maxReviewsPerDay}). Skipping remaining PRs.`,
      );
      skipped += newCandidates.length - (reviewed + errors);
      break;
    }

    const prKey = `${candidate.repoId}:${candidate.pullRequest.pullRequestId}`;

    try {
      const result = await deps.processPR(config, candidate);

      if (result.reviewed) {
        stateStore.markProcessed(prKey);
        stateStore.incrementDailyCount();
        reviewed++;
      } else {
        log(`PR ${prKey}: Review failed — ${result.error ?? 'unknown reason'}`);
        errors++;
      }
    } catch (err) {
      log(`PR ${prKey}: Fatal error — ${err}`);
      errors++;
    }
  }

  // 5. Collect all known PR keys for pruning
  const allKnownKeys = candidates.map(
    (c) => `${c.repoId}:${c.pullRequest.pullRequestId}`,
  );
  stateStore.pruneProcessed(allKnownKeys);
  stateStore.save();

  return { reviewed, skipped, errors };
}

function sleep(ms: number, signal: { aborted: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const checkInterval = 1000;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += checkInterval;
      if (signal.aborted || elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, checkInterval);
  });
}

export async function startWatcher(
  config: AppConfig,
  deps: WatcherDeps = defaultDeps,
): Promise<void> {
  const stateStore = new StateStore(config.stateDir);
  const signal = { aborted: false };

  const shutdown = () => {
    log('Shutting down...');
    signal.aborted = true;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log(`Starting watcher — polling every ${config.pollIntervalMinutes} minutes`);
  log(`Watching ${config.repoIds.length} repos`);
  log(`${stateStore.processedCount} PRs already processed`);
  log(`Max ${config.maxReviewsPerDay} reviews per day`);

  while (!signal.aborted) {
    try {
      const result = await runPollCycle(config, stateStore, deps);
      log(
        `Cycle complete: ${result.reviewed} reviewed, ${result.skipped} skipped, ${result.errors} errors`,
      );
    } catch (err) {
      log(`Cycle failed: ${err}`);
    }

    if (!signal.aborted) {
      log(`Sleeping ${config.pollIntervalMinutes} minutes...`);
      await sleep(config.pollIntervalMinutes * 60 * 1000, signal);
    }
  }

  log('Watcher stopped');
}
