import { describe, test, expect } from 'bun:test';
import { loadConfig } from '../../src/config/index.ts';

const requiredEnv: Record<string, string> = {
  AZURE_DEVOPS_PAT: 'test-pat-token',
  AZURE_DEVOPS_ORG: 'my-org',
  AZURE_DEVOPS_PROJECT: 'my-project',
  AZURE_DEVOPS_REPO_IDS: 'repo-1,repo-2',
  TARGET_REPO_PATH: '/tmp/target-repo',
};

describe('loadConfig', () => {
  describe('required variables', () => {
    test('throws when AZURE_DEVOPS_PAT is missing', () => {
      const env = { ...requiredEnv };
      delete env.AZURE_DEVOPS_PAT;
      expect(() => loadConfig(env)).toThrow('Invalid configuration');
    });

    test('throws when AZURE_DEVOPS_ORG is missing', () => {
      const env = { ...requiredEnv };
      delete env.AZURE_DEVOPS_ORG;
      expect(() => loadConfig(env)).toThrow('Invalid configuration');
    });

    test('throws when AZURE_DEVOPS_PROJECT is missing', () => {
      const env = { ...requiredEnv };
      delete env.AZURE_DEVOPS_PROJECT;
      expect(() => loadConfig(env)).toThrow('Invalid configuration');
    });

    test('throws when AZURE_DEVOPS_REPO_IDS is missing', () => {
      const env = { ...requiredEnv };
      delete env.AZURE_DEVOPS_REPO_IDS;
      expect(() => loadConfig(env)).toThrow('Invalid configuration');
    });

    test('throws when TARGET_REPO_PATH is missing', () => {
      const env = { ...requiredEnv };
      delete env.TARGET_REPO_PATH;
      expect(() => loadConfig(env)).toThrow('Invalid configuration');
    });

    test('throws when AZURE_DEVOPS_PAT is empty string', () => {
      const env = { ...requiredEnv, AZURE_DEVOPS_PAT: '' };
      expect(() => loadConfig(env)).toThrow('Invalid configuration');
    });
  });

  describe('derived values', () => {
    test('derives orgUrl from org name', () => {
      const config = loadConfig(requiredEnv);
      expect(config.orgUrl).toBe('https://dev.azure.com/my-org');
    });

    test('derives orgUrl for a different org name', () => {
      const env = { ...requiredEnv, AZURE_DEVOPS_ORG: 'contoso' };
      const config = loadConfig(env);
      expect(config.orgUrl).toBe('https://dev.azure.com/contoso');
    });
  });

  describe('default values', () => {
    test('pollIntervalMinutes defaults to 30', () => {
      const config = loadConfig(requiredEnv);
      expect(config.pollIntervalMinutes).toBe(30);
    });

    test('maxReviewsPerDay defaults to 10', () => {
      const config = loadConfig(requiredEnv);
      expect(config.maxReviewsPerDay).toBe(10);
    });

    test('claudeModel defaults to claude-sonnet-4-6', () => {
      const config = loadConfig(requiredEnv);
      expect(config.claudeModel).toBe('claude-sonnet-4-6');
    });

    test('reviewLabel defaults to code-review', () => {
      const config = loadConfig(requiredEnv);
      expect(config.reviewLabel).toBe('code-review');
    });

    test('stateDir defaults to .state', () => {
      const config = loadConfig(requiredEnv);
      expect(config.stateDir).toBe('.state');
    });

    test('dryRun defaults to false', () => {
      const config = loadConfig(requiredEnv);
      expect(config.dryRun).toBe(false);
    });
  });

  describe('REPO_IDS parsing', () => {
    test('parses comma-separated string into string array', () => {
      const env = { ...requiredEnv, AZURE_DEVOPS_REPO_IDS: 'repo-1,repo-2,repo-3' };
      const config = loadConfig(env);
      expect(config.repoIds).toEqual(['repo-1', 'repo-2', 'repo-3']);
    });

    test('trims whitespace from repo IDs', () => {
      const env = { ...requiredEnv, AZURE_DEVOPS_REPO_IDS: ' repo-1 , repo-2 , repo-3 ' };
      const config = loadConfig(env);
      expect(config.repoIds).toEqual(['repo-1', 'repo-2', 'repo-3']);
    });

    test('handles single repo ID', () => {
      const env = { ...requiredEnv, AZURE_DEVOPS_REPO_IDS: 'single-repo' };
      const config = loadConfig(env);
      expect(config.repoIds).toEqual(['single-repo']);
    });
  });

  describe('custom overrides', () => {
    test('overrides pollIntervalMinutes', () => {
      const env = { ...requiredEnv, POLL_INTERVAL_MINUTES: '60' };
      const config = loadConfig(env);
      expect(config.pollIntervalMinutes).toBe(60);
    });

    test('overrides maxReviewsPerDay', () => {
      const env = { ...requiredEnv, MAX_REVIEWS_PER_DAY: '25' };
      const config = loadConfig(env);
      expect(config.maxReviewsPerDay).toBe(25);
    });

    test('overrides claudeModel', () => {
      const env = { ...requiredEnv, CLAUDE_MODEL: 'claude-opus-4-6' };
      const config = loadConfig(env);
      expect(config.claudeModel).toBe('claude-opus-4-6');
    });

    test('overrides reviewLabel', () => {
      const env = { ...requiredEnv, REVIEW_LABEL: 'needs-ai-review' };
      const config = loadConfig(env);
      expect(config.reviewLabel).toBe('needs-ai-review');
    });

    test('overrides stateDir', () => {
      const env = { ...requiredEnv, STATE_DIR: '/tmp/custom-state' };
      const config = loadConfig(env);
      expect(config.stateDir).toBe('/tmp/custom-state');
    });

    test('overrides all optional vars at once', () => {
      const env = {
        ...requiredEnv,
        POLL_INTERVAL_MINUTES: '45',
        MAX_REVIEWS_PER_DAY: '20',
        CLAUDE_MODEL: 'claude-opus-4-6',
        REVIEW_LABEL: 'ai-review',
        STATE_DIR: '/var/state',
      };
      const config = loadConfig(env);

      expect(config.pollIntervalMinutes).toBe(45);
      expect(config.maxReviewsPerDay).toBe(20);
      expect(config.claudeModel).toBe('claude-opus-4-6');
      expect(config.reviewLabel).toBe('ai-review');
      expect(config.stateDir).toBe('/var/state');
    });
  });

  describe('full config shape', () => {
    test('returns all expected fields with correct values', () => {
      const config = loadConfig(requiredEnv);

      expect(config.org).toBe('my-org');
      expect(config.orgUrl).toBe('https://dev.azure.com/my-org');
      expect(config.project).toBe('my-project');
      expect(config.pat).toBe('test-pat-token');
      expect(config.repoIds).toEqual(['repo-1', 'repo-2']);
      expect(config.targetRepoPath).toBe('/tmp/target-repo');
      expect(config.maxReviewsPerDay).toBe(10);
      expect(config.pollIntervalMinutes).toBe(30);
      expect(config.claudeModel).toBe('claude-sonnet-4-6');
      expect(config.reviewLabel).toBe('code-review');
      expect(config.stateDir).toBe('.state');
      expect(config.dryRun).toBe(false);
    });
  });
});
