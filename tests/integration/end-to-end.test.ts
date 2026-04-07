import { describe, test, expect } from 'bun:test';
import { loadConfig } from '../../src/config/index.ts';
import {
  listActivePullRequests,
  getPullRequestLabels,
} from '../../src/sdk/azure-devops-client.ts';

const hasCredentials = Boolean(
  process.env.AZURE_DEVOPS_PAT &&
  process.env.AZURE_DEVOPS_ORG &&
  process.env.AZURE_DEVOPS_PROJECT &&
  process.env.AZURE_DEVOPS_REPO_IDS &&
  process.env.TARGET_REPO_PATH,
);

describe.skipIf(!hasCredentials)('Integration: Azure DevOps PR API', () => {
  test('can list active pull requests', async () => {
    const config = loadConfig();
    const repoId = config.repoIds[0]!;
    const prs = await listActivePullRequests(config, repoId);
    expect(Array.isArray(prs)).toBe(true);
    if (prs.length > 0) {
      expect(prs[0]!.pullRequestId).toBeNumber();
      expect(prs[0]!.title).toBeString();
    }
  });

  test('can get PR labels', async () => {
    const config = loadConfig();
    const repoId = config.repoIds[0]!;
    const prs = await listActivePullRequests(config, repoId);
    if (prs.length > 0) {
      const labels = await getPullRequestLabels(config, repoId, prs[0]!.pullRequestId);
      expect(Array.isArray(labels)).toBe(true);
    }
  });
});
