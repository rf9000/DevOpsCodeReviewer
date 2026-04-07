/** Application configuration loaded from environment variables. */
export interface AppConfig {
  org: string;
  orgUrl: string;
  project: string;
  pat: string;
  repoIds: string[];
  targetRepoPath: string;
  maxReviewsPerDay: number;
  pollIntervalMinutes: number;
  claudeModel: string;
  reviewLabel: string;
  stateDir: string;
  dryRun: boolean;
}

/** Azure DevOps Pull Request. */
export interface PullRequest {
  pullRequestId: number;
  repository: { id: string; name: string };
  title: string;
  description: string;
  sourceRefName: string;
  targetRefName: string;
  status: string;
  createdBy: { displayName: string; uniqueName: string };
  creationDate: string;
  url: string;
}

/** PR Label from the Labels API. */
export interface PullRequestLabel {
  id: string;
  name: string;
  active: boolean;
}

/** PR comment thread. */
export interface CommentThread {
  id: number;
  status: string;
  comments: Array<{ id: number; content: string }>;
}

/** Persisted state tracking which PRs have been reviewed. */
export interface ProcessedState {
  processedPrKeys: string[];
  lastRunAt: string;
  dailyReviewCount: number;
  dailyCountDate: string;
}

/** A PR identified for review. */
export interface PRReviewCandidate {
  pullRequest: PullRequest;
  repoId: string;
  labelId: string;
}

/** Result summary after processing a single PR. */
export interface PRReviewResult {
  prKey: string;
  reviewed: boolean;
  error?: string;
}
