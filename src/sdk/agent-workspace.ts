import { symlink, rename, rm, copyFile, stat, lstat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Agent workspace staging — symlinks agent CLAUDE.md / .claude/ into cwd
// ---------------------------------------------------------------------------

export interface StagedWorkspace {
  /** Symlink (or copy) paths created in targetCwd */
  links: string[];
  /** Paths of backed-up originals (if any) */
  backups: string[];
  /** Removes symlinks, restores backups. Safe to call multiple times. */
  cleanup(): Promise<void>;
}

/**
 * Stage an agent's CLAUDE.md and .claude/ directory into the target cwd
 * so that the Claude Agent SDK's settingSources loader can find them.
 *
 * - `.claude/` → junction symlink (works without admin on Windows)
 * - `CLAUDE.md` → file symlink with fallback to copy (file symlinks need
 *   Developer Mode on Windows)
 * - If the target already has CLAUDE.md or .claude/, they are backed up
 *   and restored on cleanup.
 */
export async function stageAgentWorkspace(
  agentSourceDir: string,
  targetCwd: string,
): Promise<StagedWorkspace> {
  const links: string[] = [];
  const backups: string[] = [];

  // --- Stage .claude/ directory (junction) ---
  const claudeDirSource = join(agentSourceDir, '.claude');
  const claudeDirTarget = join(targetCwd, '.claude');

  if (existsSync(claudeDirSource)) {
    if (existsSync(claudeDirTarget)) {
      const backupPath = join(targetCwd, '.claude.bak');
      await rename(claudeDirTarget, backupPath);
      backups.push(backupPath);
    }
    await symlink(claudeDirSource, claudeDirTarget, 'junction');
    links.push(claudeDirTarget);
  }

  // --- Stage CLAUDE.md file (symlink with copy fallback) ---
  const claudeMdSource = join(agentSourceDir, 'CLAUDE.md');
  const claudeMdTarget = join(targetCwd, 'CLAUDE.md');

  if (existsSync(claudeMdSource)) {
    if (existsSync(claudeMdTarget)) {
      const backupPath = join(targetCwd, 'CLAUDE.md.bak');
      await rename(claudeMdTarget, backupPath);
      backups.push(backupPath);
    }
    try {
      await symlink(claudeMdSource, claudeMdTarget, 'file');
    } catch {
      // File symlinks need Developer Mode on Windows — fall back to copy
      await copyFile(claudeMdSource, claudeMdTarget);
    }
    links.push(claudeMdTarget);
  }

  let cleaned = false;

  async function cleanup(): Promise<void> {
    if (cleaned) return;
    cleaned = true;

    // Remove staged links/copies
    for (const link of links) {
      try {
        await rm(link, { force: true, recursive: true });
      } catch {
        // Swallow — cleanup must never throw
      }
    }

    // Restore backups
    for (const backup of backups) {
      try {
        const originalPath = backup
          .replace(/\.claude\.bak$/, '.claude')
          .replace(/CLAUDE\.md\.bak$/, 'CLAUDE.md');
        await rename(backup, originalPath);
      } catch {
        // Swallow — cleanup must never throw
      }
    }
  }

  return { links, backups, cleanup };
}
