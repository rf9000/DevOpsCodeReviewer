import { query } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { stageAgentWorkspace } from '../sdk/agent-workspace.ts';
import type { AppConfig } from '../types/index.ts';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Bash safety — block destructive commands
// ---------------------------------------------------------------------------

const DENIED_BASH_PATTERNS = [
  /\bgit\s+(push|commit|merge|rebase|reset|checkout|branch\s+-[dD]|stash\s+drop|clean|tag\s+-d)/,
  /\brm\s+(-rf?|--recursive)/,
  /\brmdir\b/,
  /\bdel\b/,
  /\bmkdir\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\b(chmod|chown)\b/,
  /\bnpm\s+(publish|install|uninstall)/,
  /\bbun\s+(add|remove|install|publish)/,
  /\bcurl\s.*(-X\s*(POST|PUT|PATCH|DELETE)|--data|--request\s*(POST|PUT|PATCH|DELETE))/,
  /\baz\s+devops/,
  /\bgh\s+(pr|issue)\s+(create|close|merge|delete|comment)/,
  />\s*[^\s]/, // redirect output to file
  /\btee\b/,
  /\bsed\s+-i/,
  /\bawk\b.*>/, // awk with output redirect
];

export async function canUseTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<PermissionResult> {
  if (toolName === 'Bash') {
    const command = String(input.command ?? '');
    for (const pattern of DENIED_BASH_PATTERNS) {
      if (pattern.test(command)) {
        return {
          behavior: 'deny',
          message: `Blocked destructive bash command: ${command}`,
        };
      }
    }
  }
  return { behavior: 'allow' };
}

// ---------------------------------------------------------------------------
// Review context & detection
// ---------------------------------------------------------------------------

export interface ReviewContext {
  prTitle: string;
  prDescription: string;
  prAuthor: string;
  sourceBranch: string;
  targetBranch: string;
  diff: string;
}

const REVIEW_HEADERS = ['# Code Review:'];

export function looksLikeReview(text: string): boolean {
  return REVIEW_HEADERS.some((h) => text.includes(h));
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildUserPrompt(context: ReviewContext): string {
  const lines: string[] = [
    '## Pull Request Review',
    '',
    `**Title:** ${context.prTitle}`,
    `**Author:** ${context.prAuthor}`,
    `**Source:** ${context.sourceBranch} → ${context.targetBranch}`,
  ];

  if (context.prDescription) {
    lines.push(`**Description:** ${context.prDescription}`);
  }

  lines.push(
    '',
    '## Instructions',
    '',
    'You MUST invoke the `code-review` skill to review this pull request.',
    'The skill expects REVIEW_DIFF and BRANCH_NAME variables.',
    '',
    'Set these before invoking:',
    `- REVIEW_DIFF: The unified diff provided below`,
    `- BRANCH_NAME: ${context.sourceBranch}`,
    '',
    'Invoke the skill now using the Skill tool with skill name "code-review".',
    '',
    '## REVIEW_DIFF',
    '',
    '```diff',
    context.diff,
    '```',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractAssistantText(message: { message: { content: unknown[] } }): string {
  return message.message.content
    .filter((b): b is { type: 'text'; text: string } => (b as { type: string }).type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Main review function
// ---------------------------------------------------------------------------

export async function reviewPullRequest(
  config: AppConfig,
  context: ReviewContext,
  agentSourceDir: string,
): Promise<string> {
  // Stage into a writable temp dir (target repo may be read-only)
  const stagingDir = await mkdtemp(join(tmpdir(), 'agent-workspace-'));
  const staged = await stageAgentWorkspace(agentSourceDir, stagingDir);

  try {
    const userPrompt = buildUserPrompt(context);

    let result: string | undefined;
    let resultSubtype: string | undefined;
    const assistantTexts: string[] = [];
    let turnCount = 0;

    for await (const message of query({
      prompt: userPrompt,
      options: {
        model: config.claudeModel,
        maxTurns: 50,
        allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'Agent', 'Skill', 'LSP'],
        disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        canUseTool,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
        },
        settingSources: ['project'],
        cwd: stagingDir,
      },
    })) {
      if (message.type === 'assistant') {
        turnCount++;
        const text = extractAssistantText(message);
        if (text.trim()) {
          assistantTexts.push(text);
        }
      }
      if (message.type === 'result') {
        resultSubtype = message.subtype;
        if (message.subtype === 'success') {
          result = message.result;
        } else if (message.subtype === 'error_max_turns') {
          console.error(`  Agent hit max turns (${turnCount}). Last assistant texts may contain a partial review.`);
        } else {
          console.error(`  Agent ended with result subtype: ${message.subtype}`);
        }
      }
    }

    // If no success result, try to salvage a review from assistant messages
    if (result === undefined) {
      for (let i = assistantTexts.length - 1; i >= 0; i--) {
        const candidate = assistantTexts[i]!;
        if (looksLikeReview(candidate)) {
          console.error(`  No success result (subtype=${resultSubtype ?? 'none'}, turns=${turnCount}), but found review in assistant message ${i + 1}/${assistantTexts.length}`);
          return candidate.trim();
        }
      }
      throw new Error(
        `No review result received from Claude Agent SDK (subtype=${resultSubtype ?? 'none'}, turns=${turnCount}, assistantMessages=${assistantTexts.length})`,
      );
    }

    // If the final result doesn't look like a review, search earlier assistant
    // messages for one that does (the agent may have output the review mid-conversation
    // and then ended with meta-commentary about a background task).
    if (!looksLikeReview(result)) {
      for (let i = assistantTexts.length - 1; i >= 0; i--) {
        const candidate = assistantTexts[i]!;
        if (looksLikeReview(candidate)) {
          return candidate.trim();
        }
      }
    }

    return result.trim();
  } finally {
    await staged.cleanup();
    await rm(stagingDir, { recursive: true, force: true });
  }
}
