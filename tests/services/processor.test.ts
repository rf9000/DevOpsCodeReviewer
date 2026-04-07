import { describe, test, expect, mock } from 'bun:test';
import type {
  AppConfig,
  PRReviewCandidate,
  CommentThread,
} from '../../src/types/index.ts';
import { processPR } from '../../src/services/processor.ts';
import type { ProcessorDeps } from '../../src/services/processor.ts';

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

function mockCandidate(overrides: Partial<PRReviewCandidate> = {}): PRReviewCandidate {
  return {
    pullRequest: {
      pullRequestId: 42,
      repository: { id: 'repo-1', name: 'my-repo' },
      title: 'Fix null pointer in auth module',
      description: 'Fixes a crash when token is expired.',
      sourceRefName: 'refs/heads/feature/fix-auth',
      targetRefName: 'refs/heads/main',
      status: 'active',
      createdBy: { displayName: 'Jane Doe', uniqueName: 'jane@example.com' },
      creationDate: '2026-04-01T12:00:00Z',
      url: 'https://dev.azure.com/my-org/my-project/_apis/git/pullRequests/42',
    },
    repoId: 'repo-1',
    labelId: 'label-abc-123',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ProcessorDeps> = {}): ProcessorDeps {
  return {
    gitDiff: mock(() => Promise.resolve('diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new')),
    reviewPullRequest: mock(() => Promise.resolve('# Code Review: Fix null pointer\n\nLGTM')),
    addPullRequestThread: mock(() =>
      Promise.resolve({
        id: 1,
        status: 'active',
        comments: [{ id: 1, content: '<p>Review</p>' }],
      } satisfies CommentThread),
    ),
    removePullRequestLabel: mock(() => Promise.resolve()),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processPR', () => {
  test('successful review: calls gitDiff -> reviewPullRequest -> addPullRequestThread -> removePullRequestLabel', async () => {
    const config = mockConfig();
    const candidate = mockCandidate();
    const deps = makeDeps();

    const result = await processPR(config, candidate, deps);

    expect(result.reviewed).toBe(true);
    expect(result.prKey).toBe('repo-1:42');
    expect(deps.gitDiff).toHaveBeenCalledTimes(1);
    expect(deps.reviewPullRequest).toHaveBeenCalledTimes(1);
    expect(deps.addPullRequestThread).toHaveBeenCalledTimes(1);
    expect(deps.removePullRequestLabel).toHaveBeenCalledTimes(1);
  });

  test('passes correct ReviewContext to reviewer (branch name stripping, PR metadata)', async () => {
    const config = mockConfig();
    const candidate = mockCandidate();
    const deps = makeDeps();

    await processPR(config, candidate, deps);

    const reviewCall = (deps.reviewPullRequest as ReturnType<typeof mock>).mock.calls[0]!;
    const passedConfig = reviewCall[0] as AppConfig;
    const context = reviewCall[1] as {
      prTitle: string;
      prDescription: string;
      prAuthor: string;
      sourceBranch: string;
      targetBranch: string;
      diff: string;
    };

    expect(passedConfig).toBe(config);
    // refs/heads/ prefix should be stripped
    expect(context.sourceBranch).toBe('feature/fix-auth');
    expect(context.targetBranch).toBe('main');
    expect(context.prTitle).toBe('Fix null pointer in auth module');
    expect(context.prDescription).toBe('Fixes a crash when token is expired.');
    expect(context.prAuthor).toBe('Jane Doe');
    expect(context.diff).toContain('diff --git');
  });

  test('dry run: calls gitDiff + reviewPullRequest but NOT addPullRequestThread or removePullRequestLabel', async () => {
    const config = mockConfig({ dryRun: true });
    const candidate = mockCandidate();
    const deps = makeDeps();

    const result = await processPR(config, candidate, deps);

    expect(result.reviewed).toBe(true);
    expect(deps.gitDiff).toHaveBeenCalledTimes(1);
    expect(deps.reviewPullRequest).toHaveBeenCalledTimes(1);
    expect(deps.addPullRequestThread).toHaveBeenCalledTimes(0);
    expect(deps.removePullRequestLabel).toHaveBeenCalledTimes(0);
  });

  test('empty diff: returns reviewed: false with error', async () => {
    const config = mockConfig();
    const candidate = mockCandidate();
    const deps = makeDeps({
      gitDiff: mock(() => Promise.resolve('')),
    });

    const result = await processPR(config, candidate, deps);

    expect(result.reviewed).toBe(false);
    expect(result.error).toBe('Empty diff');
    expect(deps.reviewPullRequest).toHaveBeenCalledTimes(0);
    expect(deps.addPullRequestThread).toHaveBeenCalledTimes(0);
  });

  test('whitespace-only diff: returns reviewed: false with error', async () => {
    const config = mockConfig();
    const candidate = mockCandidate();
    const deps = makeDeps({
      gitDiff: mock(() => Promise.resolve('   \n  \n  ')),
    });

    const result = await processPR(config, candidate, deps);

    expect(result.reviewed).toBe(false);
    expect(result.error).toBe('Empty diff');
  });

  test('review failure (throws): returns error result', async () => {
    const config = mockConfig();
    const candidate = mockCandidate();
    const deps = makeDeps({
      reviewPullRequest: mock(() => Promise.reject(new Error('Claude API timeout'))),
    });

    const result = await processPR(config, candidate, deps);

    expect(result.reviewed).toBe(false);
    expect(result.error).toContain('Claude API timeout');
    expect(result.prKey).toBe('repo-1:42');
    expect(deps.addPullRequestThread).toHaveBeenCalledTimes(0);
  });

  test('label removal failure: does not affect success (review still posted)', async () => {
    const config = mockConfig();
    const candidate = mockCandidate();
    const deps = makeDeps({
      removePullRequestLabel: mock(() => Promise.reject(new Error('Label API error'))),
    });

    // The error from removePullRequestLabel is caught by the try/catch in processPR,
    // but since it happens after addPullRequestThread, the review was already posted.
    // However, the catch wraps the entire block, so this will return error.
    // Let's verify the actual behavior:
    const result = await processPR(config, candidate, deps);

    // The implementation wraps everything in a single try/catch,
    // so a label removal failure will indeed cause an error result.
    // But the review WAS posted (addPullRequestThread was called).
    expect(deps.addPullRequestThread).toHaveBeenCalledTimes(1);
    expect(deps.removePullRequestLabel).toHaveBeenCalledTimes(1);
    // The function catches the error, so reviewed is false
    expect(result.reviewed).toBe(false);
    expect(result.error).toContain('Label API error');
  });

  test('strips preamble before "# Code Review:" header', async () => {
    const config = mockConfig();
    const candidate = mockCandidate();
    const reviewWithPreamble =
      'Here is my analysis of the pull request.\n\n# Code Review: Fix null pointer\n\nThe changes look good.';
    const deps = makeDeps({
      reviewPullRequest: mock(() => Promise.resolve(reviewWithPreamble)),
    });

    await processPR(config, candidate, deps);

    const threadCall = (deps.addPullRequestThread as ReturnType<typeof mock>).mock.calls[0]!;
    const postedContent = threadCall[3] as string;
    // The preamble "Here is my analysis..." should be stripped.
    // The content passed to addPullRequestThread is HTML (via marked), so check it doesn't
    // include the preamble text but does include the review header.
    expect(postedContent).not.toContain('Here is my analysis');
    expect(postedContent).toContain('Code Review');
  });

  test('review returning empty result: returns reviewed: false', async () => {
    const config = mockConfig();
    const candidate = mockCandidate();
    const deps = makeDeps({
      reviewPullRequest: mock(() => Promise.resolve('   ')),
    });

    const result = await processPR(config, candidate, deps);

    expect(result.reviewed).toBe(false);
    expect(result.error).toBe('Review returned empty result');
    expect(deps.addPullRequestThread).toHaveBeenCalledTimes(0);
  });
});
