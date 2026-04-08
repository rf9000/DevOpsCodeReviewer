import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { gitDiff } from '../../src/services/processor.ts';

// ---------------------------------------------------------------------------
// Helpers — create real git repos for integration-level tests
// ---------------------------------------------------------------------------

const TEST_TIMEOUT = 30_000;
let rootTmp: string;

/** Run a git command, returning stdout. Throws on non-zero exit. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exit = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  if (exit !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${exit}): ${stderr}`);
  }
  return (await new Response(proc.stdout).text()).trim();
}

/**
 * Creates a bare "upstream" repo and a local clone that acts as TARGET_REPO_PATH.
 *
 * Layout:
 *   upstream (bare)  <- simulates Azure DevOps
 *   local            <- simulates the host's TARGET_REPO_PATH clone
 *
 * The upstream gets an initial commit on `main` and a feature branch with
 * one extra commit.  The `local` clone can optionally skip fetching the
 * feature branch to simulate the "missing ref" scenario.
 */
async function createRepoFixture(opts: {
  fetchFeatureBranch?: boolean;
  featureBranch?: string;
} = {}) {
  const fetchFeature = opts.fetchFeatureBranch ?? true;
  const featureBranch = opts.featureBranch ?? 'feature/test-change';

  const upstreamPath = join(rootTmp, 'upstream.git');
  const workPath = join(rootTmp, 'work');
  const localPath = join(rootTmp, 'local');

  // --- upstream bare repo ---
  await git(rootTmp, 'init', '--bare', upstreamPath);

  // --- working clone to push commits ---
  await git(rootTmp, 'clone', upstreamPath, workPath);
  await git(workPath, 'config', 'user.email', 'test@test.com');
  await git(workPath, 'config', 'user.name', 'Test');

  // Initial commit on main
  await writeFile(join(workPath, 'file.txt'), 'initial content\n');
  await git(workPath, 'add', '.');
  await git(workPath, 'commit', '-m', 'initial commit');
  await git(workPath, 'push', 'origin', 'HEAD:refs/heads/main');

  // Feature branch with a change
  await git(workPath, 'checkout', '-b', featureBranch);
  await writeFile(join(workPath, 'file.txt'), 'modified content\n');
  await git(workPath, 'add', '.');
  await git(workPath, 'commit', '-m', 'feature change');
  await git(workPath, 'push', 'origin', `HEAD:refs/heads/${featureBranch}`);

  // --- local clone (TARGET_REPO_PATH) ---
  if (fetchFeature) {
    await git(rootTmp, 'clone', upstreamPath, localPath);
    await git(localPath, 'fetch', 'origin', '+refs/heads/*:refs/remotes/origin/*');
  } else {
    // Only fetch main — simulates a stale local clone
    await git(rootTmp, 'clone', '--single-branch', '--branch', 'main', upstreamPath, localPath);
  }

  return { upstreamPath, localPath, featureBranch };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  rootTmp = await mkdtemp(join(tmpdir(), 'git-diff-test-'));
});

afterEach(async () => {
  // On Windows, git processes may briefly hold locks.  Retry cleanup.
  for (let i = 0; i < 3; i++) {
    try {
      await rm(rootTmp, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gitDiff', () => {
  test('returns unified diff when both branches are available locally', async () => {
    const { localPath, featureBranch } = await createRepoFixture({
      fetchFeatureBranch: true,
    });

    const diff = await gitDiff(localPath, featureBranch, 'main', 'unused-pat');

    expect(diff).toContain('diff --git');
    expect(diff).toContain('-initial content');
    expect(diff).toContain('+modified content');
  }, TEST_TIMEOUT);

  test('fetches missing source branch from upstream when not in local clone', async () => {
    const { localPath, featureBranch } = await createRepoFixture({
      fetchFeatureBranch: false,
    });

    const diff = await gitDiff(localPath, featureBranch, 'main', 'unused-pat');

    expect(diff).toContain('diff --git');
    expect(diff).toContain('-initial content');
    expect(diff).toContain('+modified content');
  }, TEST_TIMEOUT);

  test('returns empty string when branches have identical content', async () => {
    const { localPath } = await createRepoFixture({
      fetchFeatureBranch: true,
    });

    const diff = await gitDiff(localPath, 'main', 'main', 'unused-pat');

    expect(diff.trim()).toBe('');
  }, TEST_TIMEOUT);

  test('handles branch names with slashes (nested paths)', async () => {
    const nestedBranch = 'user/andree.steding/73368';
    const { localPath } = await createRepoFixture({
      fetchFeatureBranch: true,
      featureBranch: nestedBranch,
    });

    const diff = await gitDiff(localPath, nestedBranch, 'main', 'unused-pat');

    expect(diff).toContain('diff --git');
    expect(diff).toContain('+modified content');
  }, TEST_TIMEOUT);

  test('handles deeply nested branch names fetched from upstream', async () => {
    const nestedBranch = 'user/andree.steding/73368';
    const { localPath } = await createRepoFixture({
      fetchFeatureBranch: false,
      featureBranch: nestedBranch,
    });

    const diff = await gitDiff(localPath, nestedBranch, 'main', 'unused-pat');

    expect(diff).toContain('diff --git');
    expect(diff).toContain('+modified content');
  }, TEST_TIMEOUT);

  test('throws when source branch does not exist anywhere', async () => {
    const { localPath } = await createRepoFixture({
      fetchFeatureBranch: true,
    });

    await expect(
      gitDiff(localPath, 'nonexistent/branch', 'main', 'unused-pat'),
    ).rejects.toThrow(/git fetch from upstream failed|git diff failed/);
  }, TEST_TIMEOUT);

  test('throws when target repo path is invalid', async () => {
    const badPath = join(rootTmp, 'does-not-exist');
    await expect(
      gitDiff(badPath, 'feature', 'main', 'unused-pat'),
    ).rejects.toThrow('git clone failed');
  }, TEST_TIMEOUT);

  test('diff output contains @@ hunk headers', async () => {
    const { localPath } = await createRepoFixture({
      fetchFeatureBranch: true,
    });

    const diff = await gitDiff(localPath, 'feature/test-change', 'main', 'unused-pat');

    expect(diff).toContain('@@');
    expect(diff).toContain('diff --git');
  }, TEST_TIMEOUT);
});
