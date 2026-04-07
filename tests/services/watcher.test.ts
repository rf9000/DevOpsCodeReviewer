import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  AppConfig,
  PullRequest,
  PullRequestLabel,
  PRReviewCandidate,
  PRReviewResult,
} from '../../src/types/index.ts';
import { runPollCycle } from '../../src/services/watcher.ts';
import type { WatcherDeps } from '../../src/services/watcher.ts';
import { StateStore } from '../../src/state/state-store.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    org: 'my-org',
    orgUrl: 'https://dev.azure.com/my-org',
    project: 'my-project',
    pat: 'test-pat-token',
    repoIds: ['repo-1'],
    targetRepoPath: '/tmp/target-repo',
    maxReviewsPerDay: 10,
    pollIntervalMinutes: 5,
    claudeModel: 'claude-sonnet-4-6',
    reviewLabel: 'ai-review',
    stateDir: '.state',
    dryRun: false,
    ...overrides,
  };
}

function mockPR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    pullRequestId: 42,
    repository: { id: 'repo-1', name: 'my-repo' },
    title: 'Fix auth bug',
    description: 'Fixes a crash.',
    sourceRefName: 'refs/heads/feature/fix',
    targetRefName: 'refs/heads/main',
    status: 'active',
    createdBy: { displayName: 'Jane Doe', uniqueName: 'jane@example.com' },
    creationDate: '2026-04-01T12:00:00Z',
    url: 'https://dev.azure.com/my-org/my-project/_apis/git/pullRequests/42',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<WatcherDeps> = {}): WatcherDeps {
  return {
    listActivePullRequests: mock(() => Promise.resolve([] as PullRequest[])),
    getPullRequestLabels: mock(() => Promise.resolve([] as PullRequestLabel[])),
    processPR: mock(() =>
      Promise.resolve({ prKey: '', reviewed: true } as PRReviewResult),
    ),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runPollCycle', () => {
  let tmpDir: string;
  let stateStore: StateStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'watcher-test-'));
    stateStore = new StateStore(tmpDir);
    // Mark as not first run by saving once
    stateStore.save();
    // Re-create so isFirstRun is false (lastRunAt is now set)
    stateStore = new StateStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('no labeled PRs: returns zeros', async () => {
    const config = mockConfig();
    const deps = makeDeps();

    const result = await runPollCycle(config, stateStore, deps);

    expect(result).toEqual({ reviewed: 0, skipped: 0, errors: 0 });
    expect(deps.listActivePullRequests).toHaveBeenCalledTimes(1);
    expect(deps.processPR).toHaveBeenCalledTimes(0);
  });

  test('labeled PR triggers processing and marks as processed', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 101 });

    const deps = makeDeps({
      listActivePullRequests: mock(() => Promise.resolve([pr])),
      getPullRequestLabels: mock(() =>
        Promise.resolve([
          { id: 'lbl-1', name: 'ai-review', active: true },
        ] as PullRequestLabel[]),
      ),
      processPR: mock(() =>
        Promise.resolve({ prKey: 'repo-1/101', reviewed: true }),
      ),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result.reviewed).toBe(1);
    expect(result.errors).toBe(0);
    expect(deps.processPR).toHaveBeenCalledTimes(1);

    // Verify the candidate passed to processPR
    const processCall = (deps.processPR as ReturnType<typeof mock>).mock.calls[0]!;
    const candidate = processCall[1] as PRReviewCandidate;
    expect(candidate.pullRequest.pullRequestId).toBe(101);
    expect(candidate.repoId).toBe('repo-1');
    expect(candidate.labelId).toBe('lbl-1');
  });

  test('already-processed PR is skipped', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 200 });

    // Mark as processed using the key format from findLabeledPRs: "repoId:prId"
    stateStore.markProcessed('repo-1:200');
    stateStore.save();

    const deps = makeDeps({
      listActivePullRequests: mock(() => Promise.resolve([pr])),
      getPullRequestLabels: mock(() =>
        Promise.resolve([
          { id: 'lbl-1', name: 'ai-review', active: true },
        ] as PullRequestLabel[]),
      ),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result.reviewed).toBe(0);
    expect(deps.processPR).toHaveBeenCalledTimes(0);
  });

  test('daily limit stops processing', async () => {
    const config = mockConfig({ maxReviewsPerDay: 1 });
    const pr1 = mockPR({ pullRequestId: 301 });
    const pr2 = mockPR({ pullRequestId: 302 });

    const deps = makeDeps({
      listActivePullRequests: mock(() => Promise.resolve([pr1, pr2])),
      getPullRequestLabels: mock(() =>
        Promise.resolve([
          { id: 'lbl-1', name: 'ai-review', active: true },
        ] as PullRequestLabel[]),
      ),
      processPR: mock((cfg: AppConfig, candidate: PRReviewCandidate) =>
        Promise.resolve({
          prKey: `${candidate.repoId}/${candidate.pullRequest.pullRequestId}`,
          reviewed: true,
        }),
      ),
    });

    // Exhaust the daily limit by reviewing the first PR
    const result = await runPollCycle(config, stateStore, deps);

    // First PR reviewed, second skipped due to daily limit
    expect(result.reviewed).toBe(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(deps.processPR).toHaveBeenCalledTimes(1);
  });

  test('first-run seeding: seeds existing PRs as processed, returns skipped count', async () => {
    // Create a fresh store that has never been saved (isFirstRun = true)
    const freshDir = mkdtempSync(join(tmpdir(), 'watcher-first-run-'));
    const freshStore = new StateStore(freshDir);

    const config = mockConfig();
    const pr1 = mockPR({ pullRequestId: 501 });
    const pr2 = mockPR({ pullRequestId: 502 });

    const deps = makeDeps({
      listActivePullRequests: mock(() => Promise.resolve([pr1, pr2])),
      getPullRequestLabels: mock(() =>
        Promise.resolve([
          { id: 'lbl-1', name: 'ai-review', active: true },
        ] as PullRequestLabel[]),
      ),
    });

    const result = await runPollCycle(config, freshStore, deps);

    expect(result.reviewed).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.errors).toBe(0);
    // processPR should NOT have been called — seeding only
    expect(deps.processPR).toHaveBeenCalledTimes(0);
    // The PRs are now marked as processed in the state
    expect(freshStore.isProcessed('repo-1:501')).toBe(true);
    expect(freshStore.isProcessed('repo-1:502')).toBe(true);

    rmSync(freshDir, { recursive: true, force: true });
  });

  test('processing failure counted as error', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 600 });

    const deps = makeDeps({
      listActivePullRequests: mock(() => Promise.resolve([pr])),
      getPullRequestLabels: mock(() =>
        Promise.resolve([
          { id: 'lbl-1', name: 'ai-review', active: true },
        ] as PullRequestLabel[]),
      ),
      processPR: mock(() =>
        Promise.reject(new Error('Fatal processing error')),
      ),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result.errors).toBe(1);
    expect(result.reviewed).toBe(0);
  });

  test('processPR returning reviewed: false counted as error', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 650 });

    const deps = makeDeps({
      listActivePullRequests: mock(() => Promise.resolve([pr])),
      getPullRequestLabels: mock(() =>
        Promise.resolve([
          { id: 'lbl-1', name: 'ai-review', active: true },
        ] as PullRequestLabel[]),
      ),
      processPR: mock(() =>
        Promise.resolve({ prKey: 'repo-1/650', reviewed: false, error: 'Empty diff' }),
      ),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result.errors).toBe(1);
    expect(result.reviewed).toBe(0);
  });

  test('multiple repos are scanned', async () => {
    const config = mockConfig({ repoIds: ['repo-A', 'repo-B'] });
    const prA = mockPR({ pullRequestId: 701, repository: { id: 'repo-A', name: 'RepoA' } });
    const prB = mockPR({ pullRequestId: 702, repository: { id: 'repo-B', name: 'RepoB' } });

    const deps = makeDeps({
      listActivePullRequests: mock((cfg: AppConfig, repoId: string) => {
        if (repoId === 'repo-A') return Promise.resolve([prA]);
        if (repoId === 'repo-B') return Promise.resolve([prB]);
        return Promise.resolve([]);
      }),
      getPullRequestLabels: mock(() =>
        Promise.resolve([
          { id: 'lbl-1', name: 'ai-review', active: true },
        ] as PullRequestLabel[]),
      ),
      processPR: mock((cfg: AppConfig, candidate: PRReviewCandidate) =>
        Promise.resolve({
          prKey: `${candidate.repoId}/${candidate.pullRequest.pullRequestId}`,
          reviewed: true,
        }),
      ),
    });

    const result = await runPollCycle(config, stateStore, deps);

    expect(result.reviewed).toBe(2);
    expect(deps.listActivePullRequests).toHaveBeenCalledTimes(2);
    expect(deps.processPR).toHaveBeenCalledTimes(2);
  });

  test('state is saved after cycle', async () => {
    const config = mockConfig();
    const pr = mockPR({ pullRequestId: 801 });

    const deps = makeDeps({
      listActivePullRequests: mock(() => Promise.resolve([pr])),
      getPullRequestLabels: mock(() =>
        Promise.resolve([
          { id: 'lbl-1', name: 'ai-review', active: true },
        ] as PullRequestLabel[]),
      ),
      processPR: mock(() =>
        Promise.resolve({ prKey: 'repo-1/801', reviewed: true }),
      ),
    });

    await runPollCycle(config, stateStore, deps);

    // Reload state from disk to verify persistence
    const reloadedStore = new StateStore(tmpDir);
    expect(reloadedStore.isFirstRun).toBe(false);
  });
});
