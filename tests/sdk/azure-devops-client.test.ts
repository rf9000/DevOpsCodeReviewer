import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { AppConfig } from '../../src/types/index.ts';
import {
  AzureDevOpsError,
  adoFetch,
  adoFetchWithRetry,
  adoFetchRaw,
  listActivePullRequests,
  getPullRequestLabels,
  removePullRequestLabel,
  addPullRequestThread,
} from '../../src/sdk/azure-devops-client.ts';

let originalFetch: typeof globalThis.fetch;

function setMockFetch(response: { status: number; body: unknown }) {
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
}

function setSequentialMockFetch(
  responses: Array<{ status: number; body: unknown }>,
) {
  let index = 0;
  (globalThis as any).fetch = async () => {
    const r = responses[index++]!;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function mockConfig(): AppConfig {
  return {
    org: 'my-org',
    orgUrl: 'https://dev.azure.com/my-org',
    project: 'my-project',
    pat: 'test-pat-token',
    repoIds: ['repo-1', 'repo-2'],
    targetRepoPath: '/tmp/target-repo',
    maxReviewsPerDay: 10,
    pollIntervalMinutes: 30,
    claudeModel: 'claude-sonnet-4-6',
    reviewLabel: 'code-review',
    stateDir: '.state',
    dryRun: false,
  };
}

// Save and restore the original fetch for each test
beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('adoFetch', () => {
  test('constructs the correct URL from config', async () => {
    let capturedUrl = '';
    (globalThis as any).fetch = async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const config = mockConfig();
    await adoFetch(config, 'git/repositories');

    expect(capturedUrl).toBe(
      'https://dev.azure.com/my-org/my-project/_apis/git/repositories',
    );
  });

  test('sends correct Basic auth header with base64-encoded PAT', async () => {
    let capturedHeaders: Record<string, string> = {};
    (globalThis as any).fetch = async (input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const config = mockConfig();
    await adoFetch(config, 'test/path');

    const expectedAuth =
      'Basic ' + Buffer.from(':test-pat-token').toString('base64');
    expect(capturedHeaders['Authorization']).toBe(expectedAuth);
    expect(capturedHeaders['Content-Type']).toBe('application/json');
  });

  test('returns parsed JSON body on success', async () => {
    setMockFetch({ status: 200, body: { value: [1, 2, 3] } });
    const config = mockConfig();

    const result = await adoFetch<{ value: number[] }>(config, 'test');
    expect(result).toEqual({ value: [1, 2, 3] });
  });

  test('throws AzureDevOpsError on non-ok response', async () => {
    setMockFetch({ status: 404, body: { message: 'Not Found' } });
    const config = mockConfig();

    try {
      await adoFetch(config, 'missing/resource');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      const adoErr = err as AzureDevOpsError;
      expect(adoErr.statusCode).toBe(404);
      expect(adoErr.name).toBe('AzureDevOpsError');
      expect(adoErr.message).toContain('404');
    }
  });

  test('throws AzureDevOpsError on 500 response', async () => {
    setMockFetch({ status: 500, body: { message: 'Server Error' } });
    const config = mockConfig();

    try {
      await adoFetch(config, 'broken/endpoint');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      expect((err as AzureDevOpsError).statusCode).toBe(500);
    }
  });
});

describe('adoFetchWithRetry', () => {
  test('retries on 5xx and eventually succeeds', async () => {
    let callCount = 0;
    setSequentialMockFetch([
      { status: 500, body: { error: 'Internal Server Error' } },
      { status: 502, body: { error: 'Bad Gateway' } },
      { status: 200, body: { ok: true } },
    ]);

    const config = mockConfig();
    const result = await adoFetchWithRetry<{ ok: boolean }>(
      config,
      'test/path',
      undefined,
      [0, 0, 0], // zero delays for fast tests
    );

    expect(result).toEqual({ ok: true });
  });

  test('does NOT retry on 4xx errors', async () => {
    let callCount = 0;
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ error: 'Bad Request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const config = mockConfig();

    try {
      await adoFetchWithRetry(config, 'test/path', undefined, [0, 0, 0]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      expect((err as AzureDevOpsError).statusCode).toBe(400);
    }

    // Should have been called exactly once (no retries for 4xx)
    expect(callCount).toBe(1);
  });

  test('does NOT retry on 404', async () => {
    let callCount = 0;
    (globalThis as any).fetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const config = mockConfig();

    try {
      await adoFetchWithRetry(config, 'test/path', undefined, [0, 0, 0]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      expect((err as AzureDevOpsError).statusCode).toBe(404);
    }

    expect(callCount).toBe(1);
  });

  test('throws after exhausting all retries on 500', async () => {
    setSequentialMockFetch([
      { status: 500, body: { error: 'fail' } },
      { status: 500, body: { error: 'fail' } },
      { status: 500, body: { error: 'fail' } },
      { status: 500, body: { error: 'fail' } },
    ]);

    const config = mockConfig();

    try {
      await adoFetchWithRetry(config, 'test/path', undefined, [0, 0, 0]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      expect((err as AzureDevOpsError).statusCode).toBe(500);
    }
  });

  test('respects retry delays', async () => {
    const timestamps: number[] = [];
    setSequentialMockFetch([
      { status: 500, body: { error: 'fail' } },
      { status: 200, body: { ok: true } },
    ]);

    // Wrap fetch to track call timing
    const wrappedFetch = globalThis.fetch;
    (globalThis as any).fetch = async (...args: Parameters<typeof fetch>) => {
      timestamps.push(Date.now());
      return wrappedFetch(...args);
    };

    const config = mockConfig();
    await adoFetchWithRetry(config, 'test/path', undefined, [50]);

    expect(timestamps.length).toBe(2);
    const elapsed = timestamps[1]! - timestamps[0]!;
    // The delay should be at least 40ms (allowing some margin)
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

describe('adoFetchRaw', () => {
  test('returns a Response object on success', async () => {
    setMockFetch({ status: 200, body: { data: 'raw-response' } });
    const config = mockConfig();

    const response = await adoFetchRaw(config, 'test/path', undefined, [0]);

    expect(response).toBeInstanceOf(Response);
    expect(response.ok).toBe(true);
    const json = (await response.json()) as { data: string };
    expect(json.data).toBe('raw-response');
  });

  test('retries on 5xx errors', async () => {
    let callCount = 0;
    const responses = [
      { status: 503, body: { error: 'Service Unavailable' } },
      { status: 200, body: { ok: true } },
    ];
    let index = 0;
    (globalThis as any).fetch = async () => {
      callCount++;
      const r = responses[index++]!;
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const config = mockConfig();
    const response = await adoFetchRaw(config, 'test/path', undefined, [0, 0]);

    expect(response.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  test('does NOT retry on 4xx errors', async () => {
    let callCount = 0;
    (globalThis as any).fetch = async () => {
      callCount++;
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const config = mockConfig();

    try {
      await adoFetchRaw(config, 'test/path', undefined, [0, 0]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      expect((err as AzureDevOpsError).statusCode).toBe(403);
    }

    expect(callCount).toBe(1);
  });

  test('throws after exhausting retries on 500', async () => {
    setSequentialMockFetch([
      { status: 500, body: { error: 'fail' } },
      { status: 500, body: { error: 'fail' } },
      { status: 500, body: { error: 'fail' } },
    ]);

    const config = mockConfig();

    try {
      await adoFetchRaw(config, 'test/path', undefined, [0, 0]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AzureDevOpsError);
      expect((err as AzureDevOpsError).statusCode).toBe(500);
    }
  });
});

describe('listActivePullRequests', () => {
  test('calls the correct URL with active status filter', async () => {
    let capturedUrl = '';
    (globalThis as any).fetch = async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return new Response(
        JSON.stringify({ value: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const config = mockConfig();
    await listActivePullRequests(config, 'repo-abc');

    expect(capturedUrl).toContain('git/repositories/repo-abc/pullrequests');
    expect(capturedUrl).toContain('searchCriteria.status=active');
    expect(capturedUrl).toContain('api-version=7.0');
  });

  test('returns the value array from the response', async () => {
    const prs = [
      { pullRequestId: 1, title: 'PR 1' },
      { pullRequestId: 2, title: 'PR 2' },
    ];
    setMockFetch({ status: 200, body: { value: prs } });

    const config = mockConfig();
    const result = await listActivePullRequests(config, 'repo-abc');

    expect(result.length).toBe(2);
    expect(result[0]!.pullRequestId).toBe(1);
    expect(result[1]!.pullRequestId).toBe(2);
  });

  test('returns empty array when no PRs exist', async () => {
    setMockFetch({ status: 200, body: { value: [] } });

    const config = mockConfig();
    const result = await listActivePullRequests(config, 'repo-abc');

    expect(result).toEqual([]);
  });
});

describe('getPullRequestLabels', () => {
  test('calls the correct URL with preview API version', async () => {
    let capturedUrl = '';
    (globalThis as any).fetch = async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return new Response(
        JSON.stringify({ value: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const config = mockConfig();
    await getPullRequestLabels(config, 'repo-abc', 42);

    expect(capturedUrl).toContain(
      'git/repositories/repo-abc/pullrequests/42/labels',
    );
    expect(capturedUrl).toContain('api-version=7.0-preview.1');
  });

  test('returns the value array of labels', async () => {
    const labels = [
      { id: 'lbl-1', name: 'code-review', active: true },
      { id: 'lbl-2', name: 'bug', active: true },
    ];
    setMockFetch({ status: 200, body: { value: labels } });

    const config = mockConfig();
    const result = await getPullRequestLabels(config, 'repo-abc', 42);

    expect(result).toEqual(labels);
  });
});

describe('removePullRequestLabel', () => {
  test('uses DELETE method', async () => {
    let capturedMethod = '';
    let capturedUrl = '';
    (globalThis as any).fetch = async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      capturedMethod = init?.method ?? 'GET';
      return new Response(null, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const config = mockConfig();
    await removePullRequestLabel(config, 'repo-abc', 42, 'label-id-123');

    expect(capturedMethod).toBe('DELETE');
    expect(capturedUrl).toContain(
      'git/repositories/repo-abc/pullrequests/42/labels/label-id-123',
    );
    expect(capturedUrl).toContain('api-version=7.0-preview.1');
  });
});

describe('addPullRequestThread', () => {
  test('sends POST with correct body shape', async () => {
    let capturedMethod = '';
    let capturedBody = '';
    let capturedUrl = '';
    (globalThis as any).fetch = async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      capturedMethod = init?.method ?? 'GET';
      capturedBody = (init?.body as string) ?? '';
      return new Response(
        JSON.stringify({
          id: 1,
          status: 'closed',
          comments: [{ id: 1, content: 'Review comment' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const config = mockConfig();
    const result = await addPullRequestThread(
      config,
      'repo-abc',
      42,
      'Review comment',
    );

    expect(capturedMethod).toBe('POST');
    expect(capturedUrl).toContain(
      'git/repositories/repo-abc/pullrequests/42/threads',
    );
    expect(capturedUrl).toContain('api-version=7.0');

    const body = JSON.parse(capturedBody) as {
      comments: Array<{
        parentCommentId: number;
        content: string;
        commentType: number;
      }>;
      status: string;
    };

    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]!.parentCommentId).toBe(0);
    expect(body.comments[0]!.content).toBe('Review comment');
    expect(body.comments[0]!.commentType).toBe(1);
    expect(body.status).toBe('closed');
  });

  test('returns the created CommentThread', async () => {
    const thread = {
      id: 99,
      status: 'closed',
      comments: [{ id: 1, content: 'AI review feedback' }],
    };
    setMockFetch({ status: 200, body: thread });

    const config = mockConfig();
    const result = await addPullRequestThread(
      config,
      'repo-abc',
      42,
      'AI review feedback',
    );

    expect(result.id).toBe(99);
    expect(result.status).toBe('closed');
    expect(result.comments[0]!.content).toBe('AI review feedback');
  });
});
