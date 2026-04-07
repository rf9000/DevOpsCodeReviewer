import { describe, expect, it, afterEach } from 'bun:test';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  lstatSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stageAgentWorkspace } from '../../src/sdk/agent-workspace.ts';

let tempDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agent-ws-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/** Create a source directory with .claude/ and CLAUDE.md */
function createSourceDir(): string {
  const dir = makeTmpDir('source');
  const claudeDir = join(dir, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, 'settings.json'), '{"model":"test"}', 'utf-8');
  writeFileSync(
    join(claudeDir, 'config.yml'),
    'key: value\n',
    'utf-8',
  );
  writeFileSync(join(dir, 'CLAUDE.md'), '# Source CLAUDE.md\nInstructions here.', 'utf-8');
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

describe('stageAgentWorkspace', () => {
  describe('staging .claude/ directory', () => {
    it('creates a junction for .claude/ directory in the target', async () => {
      const sourceDir = createSourceDir();
      const targetDir = makeTmpDir('target');

      const workspace = await stageAgentWorkspace(sourceDir, targetDir);

      const claudeDirTarget = join(targetDir, '.claude');
      expect(existsSync(claudeDirTarget)).toBe(true);

      // Verify it is a symlink/junction
      const stats = lstatSync(claudeDirTarget);
      expect(stats.isSymbolicLink()).toBe(true);

      // Verify contents are accessible through the junction
      const settingsContent = readFileSync(
        join(claudeDirTarget, 'settings.json'),
        'utf-8',
      );
      expect(settingsContent).toBe('{"model":"test"}');

      expect(workspace.links).toContain(claudeDirTarget);

      await workspace.cleanup();
    });
  });

  describe('staging CLAUDE.md file', () => {
    it('creates a symlink or copy for CLAUDE.md in the target', async () => {
      const sourceDir = createSourceDir();
      const targetDir = makeTmpDir('target');

      const workspace = await stageAgentWorkspace(sourceDir, targetDir);

      const claudeMdTarget = join(targetDir, 'CLAUDE.md');
      expect(existsSync(claudeMdTarget)).toBe(true);

      // Verify contents match (works for both symlink and copy)
      const content = readFileSync(claudeMdTarget, 'utf-8');
      expect(content).toBe('# Source CLAUDE.md\nInstructions here.');

      expect(workspace.links).toContain(claudeMdTarget);

      await workspace.cleanup();
    });
  });

  describe('backing up existing files', () => {
    it('backs up existing .claude/ and CLAUDE.md in the target', async () => {
      const sourceDir = createSourceDir();
      const targetDir = makeTmpDir('target');

      // Pre-populate target with existing .claude/ and CLAUDE.md
      const existingClaudeDir = join(targetDir, '.claude');
      mkdirSync(existingClaudeDir, { recursive: true });
      writeFileSync(
        join(existingClaudeDir, 'original.txt'),
        'original content',
        'utf-8',
      );
      writeFileSync(
        join(targetDir, 'CLAUDE.md'),
        '# Original CLAUDE.md',
        'utf-8',
      );

      const workspace = await stageAgentWorkspace(sourceDir, targetDir);

      // Backups should exist
      const claudeDirBackup = join(targetDir, '.claude.bak');
      const claudeMdBackup = join(targetDir, 'CLAUDE.md.bak');

      expect(existsSync(claudeDirBackup)).toBe(true);
      expect(existsSync(claudeMdBackup)).toBe(true);
      expect(workspace.backups).toContain(claudeDirBackup);
      expect(workspace.backups).toContain(claudeMdBackup);

      // Backup content should be the original
      expect(
        readFileSync(join(claudeDirBackup, 'original.txt'), 'utf-8'),
      ).toBe('original content');
      expect(readFileSync(claudeMdBackup, 'utf-8')).toBe(
        '# Original CLAUDE.md',
      );

      // Staged content should be from source
      const stagedContent = readFileSync(
        join(targetDir, 'CLAUDE.md'),
        'utf-8',
      );
      expect(stagedContent).toBe('# Source CLAUDE.md\nInstructions here.');

      await workspace.cleanup();
    });
  });

  describe('cleanup restores backups', () => {
    it('removes staged links and restores original files', async () => {
      const sourceDir = createSourceDir();
      const targetDir = makeTmpDir('target');

      // Pre-populate target with existing files
      const existingClaudeDir = join(targetDir, '.claude');
      mkdirSync(existingClaudeDir, { recursive: true });
      writeFileSync(
        join(existingClaudeDir, 'original.txt'),
        'original content',
        'utf-8',
      );
      writeFileSync(
        join(targetDir, 'CLAUDE.md'),
        '# Original CLAUDE.md',
        'utf-8',
      );

      const workspace = await stageAgentWorkspace(sourceDir, targetDir);
      await workspace.cleanup();

      // Staged symlinks/copies should be removed
      // Backups should be restored to original paths
      const restoredClaudeDir = join(targetDir, '.claude');
      const restoredClaudeMd = join(targetDir, 'CLAUDE.md');

      expect(existsSync(restoredClaudeDir)).toBe(true);
      expect(existsSync(restoredClaudeMd)).toBe(true);

      // Restored content should be the originals
      expect(
        readFileSync(join(restoredClaudeDir, 'original.txt'), 'utf-8'),
      ).toBe('original content');
      expect(readFileSync(restoredClaudeMd, 'utf-8')).toBe(
        '# Original CLAUDE.md',
      );

      // Backup files should no longer exist
      expect(existsSync(join(targetDir, '.claude.bak'))).toBe(false);
      expect(existsSync(join(targetDir, 'CLAUDE.md.bak'))).toBe(false);
    });
  });

  describe('cleanup is idempotent', () => {
    it('can call cleanup multiple times without error', async () => {
      const sourceDir = createSourceDir();
      const targetDir = makeTmpDir('target');

      // With backups
      mkdirSync(join(targetDir, '.claude'), { recursive: true });
      writeFileSync(join(targetDir, 'CLAUDE.md'), 'original', 'utf-8');

      const workspace = await stageAgentWorkspace(sourceDir, targetDir);

      // Call cleanup three times — should not throw
      await workspace.cleanup();
      await workspace.cleanup();
      await workspace.cleanup();

      // State should be consistent after multiple cleanups
      expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(true);
      expect(readFileSync(join(targetDir, 'CLAUDE.md'), 'utf-8')).toBe(
        'original',
      );
    });

    it('can call cleanup multiple times without backups', async () => {
      const sourceDir = createSourceDir();
      const targetDir = makeTmpDir('target');

      const workspace = await stageAgentWorkspace(sourceDir, targetDir);

      await workspace.cleanup();
      await workspace.cleanup();
      await workspace.cleanup();

      // Links should be removed and no errors thrown
      expect(existsSync(join(targetDir, '.claude'))).toBe(false);
      expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(false);
    });
  });

  describe('handles missing source files gracefully', () => {
    it('handles missing .claude/ directory in source', async () => {
      const sourceDir = makeTmpDir('source-no-claude-dir');
      // Only create CLAUDE.md, no .claude/ directory
      writeFileSync(join(sourceDir, 'CLAUDE.md'), '# Just markdown', 'utf-8');

      const targetDir = makeTmpDir('target');

      const workspace = await stageAgentWorkspace(sourceDir, targetDir);

      // .claude/ should not be staged
      expect(existsSync(join(targetDir, '.claude'))).toBe(false);

      // CLAUDE.md should be staged
      expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(true);
      expect(readFileSync(join(targetDir, 'CLAUDE.md'), 'utf-8')).toBe(
        '# Just markdown',
      );

      expect(workspace.links.length).toBe(1);
      expect(workspace.backups.length).toBe(0);

      await workspace.cleanup();
    });

    it('handles missing CLAUDE.md in source', async () => {
      const sourceDir = makeTmpDir('source-no-claude-md');
      // Only create .claude/ directory, no CLAUDE.md
      const claudeDir = join(sourceDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'config.yml'), 'key: value', 'utf-8');

      const targetDir = makeTmpDir('target');

      const workspace = await stageAgentWorkspace(sourceDir, targetDir);

      // .claude/ should be staged
      expect(existsSync(join(targetDir, '.claude'))).toBe(true);
      expect(
        readFileSync(join(targetDir, '.claude', 'config.yml'), 'utf-8'),
      ).toBe('key: value');

      // CLAUDE.md should not be staged
      expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(false);

      expect(workspace.links.length).toBe(1);
      expect(workspace.backups.length).toBe(0);

      await workspace.cleanup();
    });

    it('handles completely empty source directory', async () => {
      const sourceDir = makeTmpDir('source-empty');
      const targetDir = makeTmpDir('target');

      const workspace = await stageAgentWorkspace(sourceDir, targetDir);

      expect(workspace.links.length).toBe(0);
      expect(workspace.backups.length).toBe(0);

      // Target should remain empty
      expect(existsSync(join(targetDir, '.claude'))).toBe(false);
      expect(existsSync(join(targetDir, 'CLAUDE.md'))).toBe(false);

      // Cleanup should still work fine
      await workspace.cleanup();
    });
  });

  describe('return value structure', () => {
    it('returns links and backups arrays and a cleanup function', async () => {
      const sourceDir = createSourceDir();
      const targetDir = makeTmpDir('target');

      const workspace = await stageAgentWorkspace(sourceDir, targetDir);

      expect(Array.isArray(workspace.links)).toBe(true);
      expect(Array.isArray(workspace.backups)).toBe(true);
      expect(typeof workspace.cleanup).toBe('function');

      // With a full source, should have 2 links (.claude/ and CLAUDE.md)
      expect(workspace.links.length).toBe(2);
      // No pre-existing files, so no backups
      expect(workspace.backups.length).toBe(0);

      await workspace.cleanup();
    });
  });
});
