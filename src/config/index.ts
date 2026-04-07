import { z } from 'zod';
import type { AppConfig } from '../types/index.ts';

const envSchema = z.object({
  AZURE_DEVOPS_PAT: z.string().min(1, 'AZURE_DEVOPS_PAT is required'),
  AZURE_DEVOPS_ORG: z.string().min(1, 'AZURE_DEVOPS_ORG is required'),
  AZURE_DEVOPS_PROJECT: z.string().min(1, 'AZURE_DEVOPS_PROJECT is required'),
  AZURE_DEVOPS_REPO_IDS: z.string().min(1, 'AZURE_DEVOPS_REPO_IDS is required'),
  TARGET_REPO_PATH: z.string().min(1, 'TARGET_REPO_PATH is required'),
  POLL_INTERVAL_MINUTES: z.coerce.number().default(30),
  MAX_REVIEWS_PER_DAY: z.coerce.number().default(10),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),
  REVIEW_LABEL: z.string().default('code-review'),
  STATE_DIR: z.string().default('.state'),
});

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${messages}`);
  }

  const parsed = result.data;

  return {
    org: parsed.AZURE_DEVOPS_ORG,
    orgUrl: `https://dev.azure.com/${parsed.AZURE_DEVOPS_ORG}`,
    project: parsed.AZURE_DEVOPS_PROJECT,
    pat: parsed.AZURE_DEVOPS_PAT,
    repoIds: parsed.AZURE_DEVOPS_REPO_IDS.split(',').map((id) => id.trim()),
    targetRepoPath: parsed.TARGET_REPO_PATH,
    maxReviewsPerDay: parsed.MAX_REVIEWS_PER_DAY,
    pollIntervalMinutes: parsed.POLL_INTERVAL_MINUTES,
    claudeModel: parsed.CLAUDE_MODEL,
    reviewLabel: parsed.REVIEW_LABEL,
    stateDir: parsed.STATE_DIR,
    dryRun: false,
  };
}
