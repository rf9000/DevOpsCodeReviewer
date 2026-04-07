import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StateStore } from '../../src/state/state-store.ts';

let tempDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'state-store-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
  tempDirs = [];
});

describe('StateStore', () => {
  describe('persistence roundtrip', () => {
    it('save then reload in a new instance preserves processed items', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      store.markProcessed('repo/pr-101');
      store.markProcessed('repo/pr-202');
      store.markProcessed('repo/pr-303');
      store.save();

      const store2 = new StateStore(dir);

      expect(store2.isProcessed('repo/pr-101')).toBe(true);
      expect(store2.isProcessed('repo/pr-202')).toBe(true);
      expect(store2.isProcessed('repo/pr-303')).toBe(true);
      expect(store2.processedCount).toBe(3);
    });

    it('persists dailyReviewCount and dailyCountDate across reloads', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      store.incrementDailyCount();
      store.incrementDailyCount();
      store.save();

      const store2 = new StateStore(dir);
      // After reload, canReviewToday should reflect the persisted count
      // With max=2, it should be at limit
      expect(store2.canReviewToday(2)).toBe(false);
      expect(store2.canReviewToday(3)).toBe(true);
    });
  });

  describe('empty state on missing file', () => {
    it('starts empty when the state file does not exist', () => {
      const dir = makeTmpDir();
      const subDir = join(dir, 'nonexistent', 'nested');
      const store = new StateStore(subDir);

      expect(store.processedCount).toBe(0);
      expect(store.isProcessed('any-key')).toBe(false);
      expect(store.isFirstRun).toBe(true);
    });
  });

  describe('corrupted JSON', () => {
    it('starts fresh when the state file contains corrupt JSON', () => {
      const dir = makeTmpDir();
      const filePath = join(dir, 'processed-prs.json');
      writeFileSync(filePath, '{{not valid json!!!', 'utf-8');

      const store = new StateStore(dir);

      expect(store.processedCount).toBe(0);
      expect(store.isProcessed('any-key')).toBe(false);
      expect(store.isFirstRun).toBe(true);
    });

    it('starts fresh when the state file has valid JSON but wrong shape', () => {
      const dir = makeTmpDir();
      const filePath = join(dir, 'processed-prs.json');
      writeFileSync(filePath, JSON.stringify({ unrelated: true }), 'utf-8');

      const store = new StateStore(dir);

      expect(store.processedCount).toBe(0);
      expect(store.isFirstRun).toBe(true);
    });
  });

  describe('isProcessed / markProcessed', () => {
    it('returns true for processed keys and false for unprocessed keys', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      store.markProcessed('repo-a/pr-1');

      expect(store.isProcessed('repo-a/pr-1')).toBe(true);
      expect(store.isProcessed('repo-a/pr-2')).toBe(false);
      expect(store.isProcessed('repo-b/pr-999')).toBe(false);
    });

    it('does not duplicate when marking the same key twice', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      store.markProcessed('repo/pr-42');
      store.markProcessed('repo/pr-42');

      expect(store.processedCount).toBe(1);
    });

    it('handles many items efficiently (O(1) Set lookup)', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      for (let i = 0; i < 1000; i++) {
        store.markProcessed(`repo/pr-${i}`);
      }

      expect(store.processedCount).toBe(1000);
      expect(store.isProcessed('repo/pr-0')).toBe(true);
      expect(store.isProcessed('repo/pr-999')).toBe(true);
      expect(store.isProcessed('repo/pr-1000')).toBe(false);
    });
  });

  describe('canReviewToday / incrementDailyCount', () => {
    it('allows reviews up to the max limit', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      expect(store.canReviewToday(3)).toBe(true);

      store.incrementDailyCount();
      expect(store.canReviewToday(3)).toBe(true);

      store.incrementDailyCount();
      expect(store.canReviewToday(3)).toBe(true);

      store.incrementDailyCount();
      expect(store.canReviewToday(3)).toBe(false);
    });

    it('resets count when the date changes', () => {
      const dir = makeTmpDir();

      // Write state with yesterday's date and count at limit
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayISO = yesterday.toISOString().slice(0, 10);

      const filePath = join(dir, 'processed-prs.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          processedPrKeys: [],
          lastRunAt: '',
          dailyReviewCount: 100,
          dailyCountDate: yesterdayISO,
        }),
        'utf-8',
      );

      const store = new StateStore(dir);

      // Should reset because the stored date is yesterday
      expect(store.canReviewToday(1)).toBe(true);
    });

    it('incrementDailyCount resets count for a new day', () => {
      const dir = makeTmpDir();

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayISO = yesterday.toISOString().slice(0, 10);

      const filePath = join(dir, 'processed-prs.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          processedPrKeys: [],
          lastRunAt: '',
          dailyReviewCount: 50,
          dailyCountDate: yesterdayISO,
        }),
        'utf-8',
      );

      const store = new StateStore(dir);
      store.incrementDailyCount();

      // After increment on a new day, count should be 1 (reset to 0 then incremented)
      expect(store.canReviewToday(1)).toBe(false);
      expect(store.canReviewToday(2)).toBe(true);
    });
  });

  describe('pruneProcessed', () => {
    it('removes keys not in the current set', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      store.markProcessed('repo/pr-1');
      store.markProcessed('repo/pr-2');
      store.markProcessed('repo/pr-3');
      store.markProcessed('repo/pr-4');

      store.pruneProcessed(['repo/pr-2', 'repo/pr-4']);

      expect(store.processedCount).toBe(2);
      expect(store.isProcessed('repo/pr-1')).toBe(false);
      expect(store.isProcessed('repo/pr-2')).toBe(true);
      expect(store.isProcessed('repo/pr-3')).toBe(false);
      expect(store.isProcessed('repo/pr-4')).toBe(true);
    });

    it('results in empty state when no keys match', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      store.markProcessed('repo/pr-1');
      store.markProcessed('repo/pr-2');

      store.pruneProcessed(['repo/pr-99']);

      expect(store.processedCount).toBe(0);
      expect(store.isProcessed('repo/pr-1')).toBe(false);
      expect(store.isProcessed('repo/pr-2')).toBe(false);
    });

    it('keeps all keys when all are in the current set', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      store.markProcessed('repo/pr-1');
      store.markProcessed('repo/pr-2');

      store.pruneProcessed(['repo/pr-1', 'repo/pr-2', 'repo/pr-3']);

      expect(store.processedCount).toBe(2);
      expect(store.isProcessed('repo/pr-1')).toBe(true);
      expect(store.isProcessed('repo/pr-2')).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears all state and persists the empty state', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      store.markProcessed('repo/pr-10');
      store.markProcessed('repo/pr-20');
      store.incrementDailyCount();
      store.save();

      store.reset();

      expect(store.processedCount).toBe(0);
      expect(store.isProcessed('repo/pr-10')).toBe(false);
      expect(store.isProcessed('repo/pr-20')).toBe(false);

      // Verify persistence — new instance should also be empty
      const store2 = new StateStore(dir);
      expect(store2.processedCount).toBe(0);
      expect(store2.isFirstRun).toBe(false); // reset calls save(), which sets lastRunAt
    });
  });

  describe('isFirstRun', () => {
    it('is true when no lastRunAt exists (fresh state)', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      expect(store.isFirstRun).toBe(true);
    });

    it('is false after save has been called', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);
      store.save();

      const store2 = new StateStore(dir);
      expect(store2.isFirstRun).toBe(false);
    });
  });

  describe('processedCount', () => {
    it('returns 0 for a fresh store', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      expect(store.processedCount).toBe(0);
    });

    it('returns the correct count as items are added', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      expect(store.processedCount).toBe(0);

      store.markProcessed('repo/pr-1');
      expect(store.processedCount).toBe(1);

      store.markProcessed('repo/pr-2');
      expect(store.processedCount).toBe(2);

      store.markProcessed('repo/pr-3');
      expect(store.processedCount).toBe(3);
    });
  });

  describe('string keys', () => {
    it('works with various string key formats', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      const keys = [
        'repo-abc/pr-123',
        'my-org/my-repo/456',
        'simple',
        'with spaces in key',
        'unicode-kéy-ñ',
        '',
      ];

      for (const key of keys) {
        store.markProcessed(key);
      }

      store.save();

      const store2 = new StateStore(dir);

      for (const key of keys) {
        expect(store2.isProcessed(key)).toBe(true);
      }

      expect(store2.processedCount).toBe(keys.length);
    });

    it('treats different string keys as distinct', () => {
      const dir = makeTmpDir();
      const store = new StateStore(dir);

      store.markProcessed('repo/pr-1');
      store.markProcessed('repo/pr-01');
      store.markProcessed('repo/PR-1');

      expect(store.processedCount).toBe(3);
      expect(store.isProcessed('repo/pr-1')).toBe(true);
      expect(store.isProcessed('repo/pr-01')).toBe(true);
      expect(store.isProcessed('repo/PR-1')).toBe(true);
      expect(store.isProcessed('repo/pr-001')).toBe(false);
    });
  });
});
