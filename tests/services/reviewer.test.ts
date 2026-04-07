import { describe, test, expect } from 'bun:test';
import {
  buildUserPrompt,
  canUseTool,
  looksLikeReview,
} from '../../src/services/reviewer.ts';
import type { ReviewContext } from '../../src/services/reviewer.ts';

function mockContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    prId: 42,
    prTitle: 'Fix null pointer in auth module',
    prDescription: 'Fixes a crash when the user token is expired.',
    prAuthor: 'Jane Doe',
    sourceBranch: 'feature/fix-auth',
    targetBranch: 'main',
    diff: '--- a/auth.ts\n+++ b/auth.ts\n@@ -10,3 +10,5 @@\n- const token = null;\n+ const token = getToken();',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildUserPrompt
// ---------------------------------------------------------------------------

describe('buildUserPrompt', () => {
  test('includes PR title', () => {
    const ctx = mockContext();
    const prompt = buildUserPrompt(ctx, 'REVIEW_DIFF_42.diff');
    expect(prompt).toContain('**Title:** Fix null pointer in auth module');
  });

  test('includes PR author', () => {
    const ctx = mockContext();
    const prompt = buildUserPrompt(ctx, 'REVIEW_DIFF_42.diff');
    expect(prompt).toContain('**Author:** Jane Doe');
  });

  test('includes source and target branches', () => {
    const ctx = mockContext();
    const prompt = buildUserPrompt(ctx, 'REVIEW_DIFF_42.diff');
    expect(prompt).toContain('**Source:** feature/fix-auth → main');
  });

  test('references diff file instead of embedding content', () => {
    const ctx = mockContext();
    const prompt = buildUserPrompt(ctx, 'REVIEW_DIFF_42.diff');
    expect(prompt).toContain('REVIEW_DIFF_42.diff');
    expect(prompt).not.toContain('```diff');
    expect(prompt).not.toContain('--- a/auth.ts');
  });

  test('includes instructions to invoke skill', () => {
    const ctx = mockContext();
    const prompt = buildUserPrompt(ctx, 'REVIEW_DIFF_42.diff');
    expect(prompt).toContain('code-review');
    expect(prompt).toContain('Skill');
    expect(prompt).toContain('REVIEW_DIFF');
    expect(prompt).toContain('BRANCH_NAME');
  });

  test('includes description when provided', () => {
    const ctx = mockContext({ prDescription: 'Important security fix' });
    const prompt = buildUserPrompt(ctx, 'REVIEW_DIFF_42.diff');
    expect(prompt).toContain('**Description:** Important security fix');
  });

  test('omits description when empty', () => {
    const ctx = mockContext({ prDescription: '' });
    const prompt = buildUserPrompt(ctx, 'REVIEW_DIFF_42.diff');
    expect(prompt).not.toContain('**Description:**');
  });
});

// ---------------------------------------------------------------------------
// canUseTool
// ---------------------------------------------------------------------------

describe('canUseTool', () => {
  test('allows Read tool', async () => {
    const result = await canUseTool('Read', { file_path: '/tmp/foo.ts' });
    expect(result.behavior).toBe('allow');
  });

  test('allows harmless bash: git diff', async () => {
    const result = await canUseTool('Bash', { command: 'git diff HEAD~1' });
    expect(result.behavior).toBe('allow');
  });

  test('allows harmless bash: git log', async () => {
    const result = await canUseTool('Bash', { command: 'git log --oneline -10' });
    expect(result.behavior).toBe('allow');
  });

  test('allows harmless bash: git status', async () => {
    const result = await canUseTool('Bash', { command: 'git status' });
    expect(result.behavior).toBe('allow');
  });

  test('allows harmless bash: git show', async () => {
    const result = await canUseTool('Bash', { command: 'git show HEAD' });
    expect(result.behavior).toBe('allow');
  });

  test('allows harmless bash: ls', async () => {
    const result = await canUseTool('Bash', { command: 'ls -la src/' });
    expect(result.behavior).toBe('allow');
  });

  test('denies git push', async () => {
    const result = await canUseTool('Bash', { command: 'git push origin main' });
    expect(result.behavior).toBe('deny');
  });

  test('denies rm -rf', async () => {
    const result = await canUseTool('Bash', { command: 'rm -rf /tmp/project' });
    expect(result.behavior).toBe('deny');
  });

  test('denies npm install', async () => {
    const result = await canUseTool('Bash', { command: 'npm install lodash' });
    expect(result.behavior).toBe('deny');
  });

  test('denies bun add', async () => {
    const result = await canUseTool('Bash', { command: 'bun add zod' });
    expect(result.behavior).toBe('deny');
  });

  test('denies git commit', async () => {
    const result = await canUseTool('Bash', { command: 'git commit -m "foo"' });
    expect(result.behavior).toBe('deny');
  });

  test('denies git merge', async () => {
    const result = await canUseTool('Bash', { command: 'git merge feature' });
    expect(result.behavior).toBe('deny');
  });

  test('denies redirect >', async () => {
    const result = await canUseTool('Bash', { command: 'echo "hello" > file.txt' });
    expect(result.behavior).toBe('deny');
  });

  test('denies sed -i', async () => {
    const result = await canUseTool('Bash', { command: 'sed -i "s/foo/bar/" file.ts' });
    expect(result.behavior).toBe('deny');
  });

  test('denies git reset', async () => {
    const result = await canUseTool('Bash', { command: 'git reset --hard HEAD~1' });
    expect(result.behavior).toBe('deny');
  });

  test('denies git checkout', async () => {
    const result = await canUseTool('Bash', { command: 'git checkout main' });
    expect(result.behavior).toBe('deny');
  });

  test('denies git rebase', async () => {
    const result = await canUseTool('Bash', { command: 'git rebase main' });
    expect(result.behavior).toBe('deny');
  });

  test('allows non-Bash tools unconditionally', async () => {
    const result = await canUseTool('Grep', { pattern: 'TODO', path: '/tmp' });
    expect(result.behavior).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// looksLikeReview
// ---------------------------------------------------------------------------

describe('looksLikeReview', () => {
  test('returns true for text containing "# Code Review:"', () => {
    const text = 'Some preamble\n\n# Code Review: Fix auth module\n\nLooks good.';
    expect(looksLikeReview(text)).toBe(true);
  });

  test('returns true when header is at the start', () => {
    const text = '# Code Review: PR title\n\nReview body here.';
    expect(looksLikeReview(text)).toBe(true);
  });

  test('returns false for text without the header', () => {
    const text = 'This is a regular message with no review header.';
    expect(looksLikeReview(text)).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(looksLikeReview('')).toBe(false);
  });

  test('returns false for similar but non-matching headers', () => {
    // "# Code review:" (lowercase r) does not match "# Code Review:"
    expect(looksLikeReview('# Code review:')).toBe(false);
    expect(looksLikeReview('Code Review:')).toBe(false);
    expect(looksLikeReview('## Code review summary')).toBe(false);
  });
});
