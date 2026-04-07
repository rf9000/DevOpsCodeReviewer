---
name: al-compile-on-change
description: ALWAYS run after ALL AL code changes. Compiles AL projects with full analyzer support (CodeCop, AppSourceCop, UICop). Auto-discovers AL CLI tools, builds analyzer paths, validates output. Use immediately after any AL code modification - this is MANDATORY for code quality.
---

# AL Compile Skill

## MANDATORY TRIGGER RULE

**You MUST invoke this skill after EVERY AL code change.** This includes:
- Any `.al` file created, modified, or deleted
- Any changes to tables, pages, codeunits, enums, interfaces, reports
- Any refactoring or code cleanup

**No exceptions.** Compilation validates code quality and catches errors immediately.

## Compilation Process

### Step 1: Identify Modified App(s)

Find the app folder containing the modified file:
1. Start from the folder containing the modified file
2. Walk up the directory tree until you find a folder with `app.json`
3. That folder is the app folder to compile

**If `app.json` is at workspace root:** Use `.` as the app folder

**List available apps:**
```bash
powershell.exe -ExecutionPolicy Bypass -File ./.claude/skills/al-compile-on-change/Compile-ALApp.ps1 -ListApps
```

**IMPORTANT: Compile ONE app at a time.** When changes span multiple apps, compile them sequentially in dependency order (e.g., base-application before export). After compiling a dependency, you must propagate its symbols before compiling the dependent app — see [Multi-App Compilation](#multi-app-compilation) below.

### Step 2: Run Compilation

Use the `Compile-ALApp.ps1` script:

```bash
powershell.exe -ExecutionPolicy Bypass -File ./.claude/skills/al-compile-on-change/Compile-ALApp.ps1 -AppFolder "{APP-FOLDER}"
```

**Examples:**
```bash
# Compile base-application
powershell.exe -ExecutionPolicy Bypass -File ./.claude/skills/al-compile-on-change/Compile-ALApp.ps1 -AppFolder "base-application"

# Compile import module
powershell.exe -ExecutionPolicy Bypass -File ./.claude/skills/al-compile-on-change/Compile-ALApp.ps1 -AppFolder "import"

# Compile with verbose output (shows full command)
powershell.exe -ExecutionPolicy Bypass -File ./.claude/skills/al-compile-on-change/Compile-ALApp.ps1 -AppFolder "banking-dk" -Verbose
```

The script automatically:
- Detects AL CLI tool version
- Builds analyzer paths
- Includes all analyzers (CodeCop, AppSourceCop, UICop)
- Uses the project ruleset
- Shows all errors (`/continuebuildonerror:+`)

### Step 3: Validate Compilation Results

**Understanding analyzer output:**
- `AL*` codes: Core compiler errors/warnings
- `AA*` codes: CodeCop violations (code quality)
- `AS*` codes: AppSourceCop violations (AppSource rules)
- `AW*` codes: UICop violations (UI/UX issues)

**Verify analyzers are loaded:**
- ✅ **GOOD**: You see AA*/AS*/AW* codes → Analyzers working
- ⚠️ **OK**: Only AL* codes and Step 2 completed without errors → Code is clean
- ❌ **BAD**: Script error about missing analyzers → See troubleshooting

### Step 4: Report Results

Summarize compilation results:

```
Compilation Results for {APP-FOLDER}:
- Errors: X
- Warnings: Y

[List any errors that need fixing]
```

## Analyzer Reference

| Analyzer | Rule Prefix | Purpose |
|----------|-------------|---------|
| CodeCop | AA* | Code quality, best practices |
| AppSourceCop | AS* | AppSource submission rules |
| UICop | AW* | UI/UX best practices |

## Common Error Codes

- `AA0137`: Unused variable - remove the declaration
- `AA0005`: Begin..end used for single statement - simplify
- `AS0087`: Breaking change in procedure signature
- `AL0432`: Missing SetLoadFields before Get/Find

## Quick Reference

**Compile an app:**
```bash
powershell.exe -ExecutionPolicy Bypass -File ./.claude/skills/al-compile-on-change/Compile-ALApp.ps1 -AppFolder "{APP-FOLDER}"
```

**List available apps:**
```bash
powershell.exe -ExecutionPolicy Bypass -File ./.claude/skills/al-compile-on-change/Compile-ALApp.ps1 -ListApps
```

**Verbose mode (debugging):**
```bash
powershell.exe -ExecutionPolicy Bypass -File ./.claude/skills/al-compile-on-change/Compile-ALApp.ps1 -AppFolder "{APP-FOLDER}" -Verbose
```

**Skip analyzers (troubleshooting only):**
```bash
powershell.exe -ExecutionPolicy Bypass -File ./.claude/skills/al-compile-on-change/Compile-ALApp.ps1 -AppFolder "{APP-FOLDER}" -SkipAnalyzers
```

## Multi-App Compilation

When changes span multiple apps (e.g., adding a codeunit in base-application and referencing it from export), you **must** compile one app at a time and propagate symbols between steps.

### Why?

The AL compiler resolves dependencies from `.app` files in the package cache (`/.alpackages/`). If you add a new symbol in base-application, the export app won't see it until the freshly compiled base-application `.app` replaces the stale one in `.alpackages/`.

### Recommended: Use `-PropagateSymbols` (automated)

**ALWAYS use `-PropagateSymbols` when compiling a dependency app that other apps depend on.** This flag automates the entire symbol propagation workflow:

1. Reads publisher, name, and version from `app.json`
2. Removes ALL stale versions of this app from `.alpackages/`
3. Copies the freshly compiled `.app` to `.alpackages/`

```bash
# 1. Compile base-application AND propagate symbols automatically
powershell.exe -ExecutionPolicy Bypass -File ./.claude/skills/al-compile-on-change/Compile-ALApp.ps1 -AppFolder "base-application" -PropagateSymbols

# 2. Compile the dependent app
powershell.exe -ExecutionPolicy Bypass -File ./.claude/skills/al-compile-on-change/Compile-ALApp.ps1 -AppFolder "export"
```

The flag is skipped automatically if compilation has errors.

### Manual Fallback (if -PropagateSymbols fails)

If `-PropagateSymbols` reports a warning or the automated copy doesn't work:

1. **Read the version from `app.json`** in the dependency app folder
2. **Construct the filename**: `{Publisher}_{AppName}_{Version}.app`
3. **Remove ALL versions** of this app from `.alpackages/` (not just one — the compiler picks the highest version, so a stale higher-version file will shadow the fresh one):
   ```bash
   rm .alpackages/{Publisher}_{AppName}_*.app
   ```
4. **Copy the fresh .app** (compiled output is in the app folder root, NOT `build/`):
   ```bash
   cp "{APP-FOLDER}/{Publisher}_{AppName}_{Version}.app" ".alpackages/"
   ```

### Common Pitfall: "Codeunit X is missing" / "Interface Y is missing"

If the dependent app reports missing symbols that exist in the dependency app:
1. The dependency `.app` in `.alpackages/` is stale — re-run with `-PropagateSymbols`
2. A higher-version stale `.app` is shadowing the fresh one — remove ALL versions first
3. You copied the wrong `.app` file — check `app.json` for the correct version (don't guess from filenames in the output directory, there may be old builds with different versions)
4. The `.app` is in `build/` (old output) instead of the app folder root — check the correct location

## Troubleshooting

See [references/troubleshooting.md](references/troubleshooting.md) for common issues.

## App Folder Reference

See [references/app-folders.md](references/app-folders.md) for complete list.
