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
    pat: string,
  ) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Git diff helper
// ---------------------------------------------------------------------------

export async function gitDiff(
  targetRepoPath: string,
  sourceBranch: string,
  targetBranch: string,
  pat: string,
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

    // The clone's origin is the local repo, whose Azure DevOps branches
    // live under refs/remotes/origin/*. Map them into our origin/* refs.
    const fetchProc = Bun.spawn(
      ['git', 'fetch', 'origin', '+refs/remotes/origin/*:refs/remotes/origin/*'],
      { cwd: clonePath, stdout: 'pipe', stderr: 'pipe' },
    );
    const fetchExit = await fetchProc.exited;
    if (fetchExit !== 0) {
      const stderr = await new Response(fetchProc.stderr).text();
      throw new Error(`git fetch failed (exit ${fetchExit}): ${stderr}`);
    }

    // Check whether the source/target refs actually exist.  The local repo
    // may not have fetched these branches from Azure DevOps yet (e.g. new
    // feature branches).  When missing, resolve the upstream URL from the
    // local repo's config and fetch the specific branches with PAT auth.
    const refExists = async (ref: string) => {
      const p = Bun.spawn(['git', 'rev-parse', '--verify', '--quiet', ref], {
        cwd: clonePath, stdout: 'pipe', stderr: 'pipe',
      });
      return (await p.exited) === 0;
    };

    const sourceRef = `origin/${sourceBranch}`;
    const targetRef = `origin/${targetBranch}`;

    if (!(await refExists(sourceRef)) || !(await refExists(targetRef))) {
      // Discover the real Azure DevOps remote URL from the local repo
      const urlProc = Bun.spawn(
        ['git', 'config', '--get', 'remote.origin.url'],
        { cwd: targetRepoPath, stdout: 'pipe', stderr: 'pipe' },
      );
      if ((await urlProc.exited) !== 0) {
        throw new Error('Cannot determine upstream remote URL from target repo');
      }
      const upstreamUrl = (await new Response(urlProc.stdout).text()).trim();

      const refspecs: string[] = [];
      if (!(await refExists(sourceRef)))
        refspecs.push(`+refs/heads/${sourceBranch}:refs/remotes/origin/${sourceBranch}`);
      if (!(await refExists(targetRef)))
        refspecs.push(`+refs/heads/${targetBranch}:refs/remotes/origin/${targetBranch}`);

      const authHeader = `Authorization: Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
      const upstreamFetch = Bun.spawn(
        ['git', '-c', `http.extraHeader=${authHeader}`, 'fetch', upstreamUrl, ...refspecs],
        { cwd: clonePath, stdout: 'pipe', stderr: 'pipe' },
      );
      const upstreamExit = await upstreamFetch.exited;
      if (upstreamExit !== 0) {
        const stderr = await new Response(upstreamFetch.stderr).text();
        throw new Error(`git fetch from upstream failed (exit ${upstreamExit}): ${stderr}`);
      }
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
    const diff = await deps.gitDiff(config.targetRepoPath, sourceBranch, targetBranch, config.pat);

    if (!diff || !diff.trim()) {
      log(`  PR #${candidate.pullRequest.pullRequestId}: Empty diff — skipping review`);
      return { prKey, reviewed: false, error: 'Empty diff' };
    }

    const context: ReviewContext = {
      prId: candidate.pullRequest.pullRequestId,
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
