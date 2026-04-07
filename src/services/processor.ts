import type {
  AppConfig,
  CommentThread,
  PRReviewCandidate,
  PRReviewResult,
} from '../types/index.ts';
import type { ReviewContext } from './reviewer.ts';

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { marked } from 'marked';
import * as sdk from '../sdk/azure-devops-client.ts';
import * as rev from './reviewer.ts';

// ---------------------------------------------------------------------------
// DI surface
// ---------------------------------------------------------------------------

export interface ProcessorDeps {
  reviewPullRequest: (
    config: AppConfig,
    context: ReviewContext,
    agentSourceDir: string,
  ) => Promise<string>;

  addPullRequestThread: (
    config: AppConfig,
    repoId: string,
    prId: number,
    content: string,
  ) => Promise<CommentThread>;

  removePullRequestLabel: (
    config: AppConfig,
    repoId: string,
    prId: number,
    labelId: string,
  ) => Promise<void>;

  gitDiff: (
    targetRepoPath: string,
    sourceBranch: string,
    targetBranch: string,
  ) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Git diff helper
// ---------------------------------------------------------------------------

async function gitDiff(
  targetRepoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<string> {
  // Clone into a writable temp dir so git can write FETCH_HEAD etc.
  // Uses --shared to avoid copying objects (fast, low disk usage).
  const tmpDir = await mkdtemp(join(tmpdir(), 'code-review-'));
  const clonePath = join(tmpDir, 'repo');

  try {
    const cloneProc = Bun.spawn(
      ['git', 'clone', '--shared', '--no-checkout', targetRepoPath, clonePath],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const cloneExit = await cloneProc.exited;
    if (cloneExit !== 0) {
      const stderr = await new Response(cloneProc.stderr).text();
      throw new Error(`git clone failed (exit ${cloneExit}): ${stderr}`);
    }

    const fetchProc = Bun.spawn(['git', 'fetch', 'origin'], {
      cwd: clonePath,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const fetchExit = await fetchProc.exited;
    if (fetchExit !== 0) {
      const stderr = await new Response(fetchProc.stderr).text();
      throw new Error(`git fetch failed (exit ${fetchExit}): ${stderr}`);
    }

    const diffProc = Bun.spawn(
      ['git', 'diff', `origin/${targetBranch}...origin/${sourceBranch}`, '--unified=5'],
      {
        cwd: clonePath,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const diffExit = await diffProc.exited;
    if (diffExit !== 0) {
      const stderr = await new Response(diffProc.stderr).text();
      throw new Error(`git diff failed (exit ${diffExit}): ${stderr}`);
    }

    return await new Response(diffProc.stdout).text();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Agent source directory (project root, where .claude/ and CLAUDE.md live)
// ---------------------------------------------------------------------------

const AGENT_SOURCE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// Default deps
// ---------------------------------------------------------------------------

const defaultDeps: ProcessorDeps = {
  reviewPullRequest: rev.reviewPullRequest,
  addPullRequestThread: sdk.addPullRequestThread,
  removePullRequestLabel: sdk.removePullRequestLabel,
  gitDiff,
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(message: string): void {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const ts = now.toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${message}`);
}

// ---------------------------------------------------------------------------
// Process a single PR review candidate
// ---------------------------------------------------------------------------

export async function processPR(
  config: AppConfig,
  candidate: PRReviewCandidate,
  deps: ProcessorDeps = defaultDeps,
): Promise<PRReviewResult> {
  const prKey = `${candidate.repoId}:${candidate.pullRequest.pullRequestId}`;

  const sourceBranch = candidate.pullRequest.sourceRefName.replace('refs/heads/', '');
  const targetBranch = candidate.pullRequest.targetRefName.replace('refs/heads/', '');

  log(`Processing PR #${candidate.pullRequest.pullRequestId}: "${candidate.pullRequest.title}" (${sourceBranch} → ${targetBranch})`);

  try {
    const diff = await deps.gitDiff(config.targetRepoPath, sourceBranch, targetBranch);

    if (!diff || !diff.trim()) {
      log(`  PR #${candidate.pullRequest.pullRequestId}: Empty diff — skipping review`);
      return { prKey, reviewed: false, error: 'Empty diff' };
    }

    const context: ReviewContext = {
      prTitle: candidate.pullRequest.title,
      prDescription: candidate.pullRequest.description,
      prAuthor: candidate.pullRequest.createdBy.displayName,
      sourceBranch,
      targetBranch,
      diff,
    };

    log(`  PR #${candidate.pullRequest.pullRequestId}: Starting review...`);
    const result = await deps.reviewPullRequest(config, context, AGENT_SOURCE_DIR);

    if (!result || !result.trim()) {
      log(`  PR #${candidate.pullRequest.pullRequestId}: Review returned empty result — skipping`);
      return { prKey, reviewed: false, error: 'Review returned empty result' };
    }

    // Strip any preamble before first "# Code Review:" header
    const headerIndex = result.indexOf('# Code Review:');
    const cleanedResult = headerIndex > 0 ? result.slice(headerIndex) : result;

    if (config.dryRun) {
      log(`  PR #${candidate.pullRequest.pullRequestId}: [DRY RUN] Review result:\n${cleanedResult}`);
      return { prKey, reviewed: true };
    }

    const commentHtml = await marked(cleanedResult);
    await deps.addPullRequestThread(
      config,
      candidate.repoId,
      candidate.pullRequest.pullRequestId,
      commentHtml,
    );
    log(`  PR #${candidate.pullRequest.pullRequestId}: Review posted as comment`);

    await deps.removePullRequestLabel(
      config,
      candidate.repoId,
      candidate.pullRequest.pullRequestId,
      candidate.labelId,
    );
    log(`  PR #${candidate.pullRequest.pullRequestId}: Removed review label`);

    return { prKey, reviewed: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`  PR #${candidate.pullRequest.pullRequestId}: Error — ${errorMsg}`);
    return { prKey, reviewed: false, error: errorMsg };
  }
}
