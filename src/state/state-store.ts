import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import type { ProcessedState } from '../types/index.ts';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export class StateStore {
  private filePath: string;
  private state: ProcessedState;
  private processedSet: Set<string>;

  constructor(stateDir: string) {
    this.filePath = join(stateDir, 'processed-prs.json');
    this.state = this.load();
    this.processedSet = new Set(this.state.processedPrKeys);
  }

  private load(): ProcessedState {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'processedPrKeys' in parsed &&
          Array.isArray((parsed as ProcessedState).processedPrKeys)
        ) {
          return parsed as ProcessedState;
        }
      }
    } catch {
      // file doesn't exist or is corrupted JSON — start fresh
    }
    return {
      processedPrKeys: [],
      lastRunAt: '',
      dailyReviewCount: 0,
      dailyCountDate: '',
    };
  }

  save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.state.lastRunAt = new Date().toISOString();
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  isProcessed(prKey: string): boolean {
    return this.processedSet.has(prKey);
  }

  markProcessed(prKey: string): void {
    if (!this.processedSet.has(prKey)) {
      this.processedSet.add(prKey);
      this.state.processedPrKeys.push(prKey);
    }
  }

  canReviewToday(max: number): boolean {
    const today = todayISO();
    if (this.state.dailyCountDate !== today) {
      this.state.dailyReviewCount = 0;
      this.state.dailyCountDate = today;
    }
    return this.state.dailyReviewCount < max;
  }

  incrementDailyCount(): void {
    const today = todayISO();
    if (this.state.dailyCountDate !== today) {
      this.state.dailyReviewCount = 0;
      this.state.dailyCountDate = today;
    }
    this.state.dailyReviewCount++;
  }

  pruneProcessed(currentKeys: string[]): void {
    const currentSet = new Set(currentKeys);
    const kept = this.state.processedPrKeys.filter((key) => currentSet.has(key));
    this.state.processedPrKeys = kept;
    this.processedSet = new Set(kept);
  }

  reset(): void {
    this.state = {
      processedPrKeys: [],
      lastRunAt: '',
      dailyReviewCount: 0,
      dailyCountDate: '',
    };
    this.processedSet = new Set();
    this.save();
  }

  get isFirstRun(): boolean {
    return this.state.lastRunAt === '';
  }

  get processedCount(): number {
    return this.state.processedPrKeys.length;
  }
}
