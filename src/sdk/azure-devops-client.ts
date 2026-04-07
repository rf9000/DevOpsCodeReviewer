import type {
  AppConfig,
  PullRequest,
  PullRequestLabel,
  CommentThread,
} from '../types/index.ts';

export class AzureDevOpsError extends Error {
  override readonly name = 'AzureDevOpsError';
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function adoFetch<T>(
  config: AppConfig,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${config.orgUrl}/${config.project}/_apis/${path}`;
  const authHeader =
    'Basic ' + Buffer.from(':' + config.pat).toString('base64');

  const headers: Record<string, string> = {
    Authorization: authHeader,
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new AzureDevOpsError(
      `Azure DevOps API error ${res.status}: ${body}`,
      res.status,
    );
  }

  return (await res.json()) as T;
}

const DEFAULT_RETRY_DELAYS = [1000, 2000, 4000];

export async function adoFetchWithRetry<T>(
  config: AppConfig,
  path: string,
  options?: RequestInit,
  retryDelays: number[] = DEFAULT_RETRY_DELAYS,
): Promise<T> {
  const maxAttempts = retryDelays.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await adoFetch<T>(config, path, options);
    } catch (err: unknown) {
      const isLastAttempt = attempt === maxAttempts;

      if (err instanceof AzureDevOpsError) {
        if (err.statusCode < 500) {
          throw err;
        }
        if (isLastAttempt) {
          throw err;
        }
      } else {
        if (isLastAttempt) {
          throw err;
        }
      }

      const delay = retryDelays[attempt - 1] ?? 0;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('adoFetchWithRetry: unexpected code path');
}

export async function adoFetchRaw(
  config: AppConfig,
  path: string,
  options?: RequestInit,
  retryDelays: number[] = DEFAULT_RETRY_DELAYS,
): Promise<Response> {
  const maxAttempts = retryDelays.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const url = `${config.orgUrl}/${config.project}/_apis/${path}`;
      const authHeader =
        'Basic ' + Buffer.from(':' + config.pat).toString('base64');

      const headers: Record<string, string> = {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        ...(options?.headers as Record<string, string> | undefined),
      };

      const res = await fetch(url, {
        ...options,
        headers,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new AzureDevOpsError(
          `Azure DevOps API error ${res.status}: ${body}`,
          res.status,
        );
      }

      return res;
    } catch (err: unknown) {
      const isLastAttempt = attempt === maxAttempts;

      if (err instanceof AzureDevOpsError) {
        if (err.statusCode < 500) {
          throw err;
        }
        if (isLastAttempt) {
          throw err;
        }
      } else {
        if (isLastAttempt) {
          throw err;
        }
      }

      const delay = retryDelays[attempt - 1] ?? 0;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('adoFetchRaw: unexpected code path');
}

export async function listActivePullRequests(
  config: AppConfig,
  repoId: string,
): Promise<PullRequest[]> {
  const path = `git/repositories/${repoId}/pullrequests?searchCriteria.status=active&api-version=7.0`;
  const data = await adoFetchWithRetry<{ value: PullRequest[] }>(config, path);
  return data.value;
}

export async function getPullRequestLabels(
  config: AppConfig,
  repoId: string,
  prId: number,
): Promise<PullRequestLabel[]> {
  const path = `git/repositories/${repoId}/pullrequests/${prId}/labels?api-version=7.0-preview.1`;
  const data = await adoFetchWithRetry<{ value: PullRequestLabel[] }>(
    config,
    path,
  );
  return data.value;
}

export async function removePullRequestLabel(
  config: AppConfig,
  repoId: string,
  prId: number,
  labelId: string,
): Promise<void> {
  const path = `git/repositories/${repoId}/pullrequests/${prId}/labels/${labelId}?api-version=7.0-preview.1`;
  await adoFetchRaw(config, path, { method: 'DELETE' });
}

export async function addPullRequestThread(
  config: AppConfig,
  repoId: string,
  prId: number,
  content: string,
): Promise<CommentThread> {
  const path = `git/repositories/${repoId}/pullrequests/${prId}/threads?api-version=7.0`;
  return adoFetchWithRetry<CommentThread>(config, path, {
    method: 'POST',
    body: JSON.stringify({
      comments: [{ parentCommentId: 0, content, commentType: 1 }],
      status: 'closed',
    }),
  });
}
