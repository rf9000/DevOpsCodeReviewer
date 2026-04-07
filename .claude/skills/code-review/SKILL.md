---
name: code-review
description: AL code review skill for Continia Banking. Reviews AL code changes provided as a unified diff against CLAUDE.md and .claude/rules/coding-rules/*.md standards. Provides precise Object→Procedure→Line references with VS Code navigation. Use when users say "review my code", "code review", "/review", "check my changes", "review staged changes", or "PR review". Callers must provide REVIEW_DIFF (unified diff) and BRANCH_NAME before invoking.
---

# AL Code Review (Multi-Agent Orchestrator)

Review AL code changes by dispatching 6 focused review agents in parallel, each responsible for a thematic group of coding rules. This eliminates attention dilution from a single agent trying to check all rules simultaneously.

## Prerequisites

This skill expects two inputs to be available in the conversation context before it is invoked:

- **`REVIEW_DIFF`**: A unified diff (`--unified=5`) of the AL files to review, stored as a file in the working directory (e.g., `REVIEW_DIFF_123.diff`). The caller provides the filename. Read the file to access the diff content.
- **`BRANCH_NAME`**: The current branch name (for the report header).

If `REVIEW_DIFF` is empty or contains no `.al` file changes, report **"Nothing to review — no AL file changes found in the provided diff."** and stop.

## Orchestration Flow

```
1. Parse AL object metadata from diff
2. Extract CLAUDE.md rule excerpts per agent
3. Dispatch 6 review agents in parallel
4. Collect results, deduplicate by file:line
5. Assemble final report
```

## Step 1: Parse AL Object Metadata

For each file in the diff, extract:
- **Object header**: `^(codeunit|page|table|enum|pageextension|tableextension|enumextension|interface|report|query)\s+(\d+)\s+"([^"]+)"`
- **Procedure boundaries**: `^\s*(local\s+)?(internal\s+)?procedure\s+(\w+)`
- **Object Access level**: `Access = (Internal|Public)` property

Build `AL_OBJECT_MAP`: `{file -> {objectType, objectId, objectName, access, procedures: [{name, startLine, endLine}]}}`

## Step 2: Extract CLAUDE.md Rule Excerpts

Read `CLAUDE.md`. Extract these text blocks for agent injection:

### CLAUDE_SAFETY (for Agent 1: Safety & Correctness)
- TryFunction: "NEVER use database write operations (Insert/Modify/Delete) inside TryFunction methods"
- Error labels: "ALWAYS use labels for Error() and Message() text to support localization"
- StrSubstNo: "use StrSubstNo with Text variable, add Comment to describe parameters"
- Security: "Do not store secrets in code or plaintext fields; use secure storage patterns"
- Breaking changes: "Never introduce breaking changes to public APIs without proper ObsoleteState and upgrade codeunits"

### CLAUDE_PERF (for Agent 2: Performance)
- "Avoid unfiltered FIND/FINDSET on large tables; set ranges and use indexes"
- SetLoadFields before Get/Find operations

### CLAUDE_STRUCTURE (for Agent 3: Code Structure & Design)
- All 5 SOLID bullet points (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion)
- "Use early exits, small diffs"
- Parameter passing: "Use var parameters ONLY when the procedure modifies the parameter OR when setting filters on Record variables"
- Page standards: "Set ApplicationArea on page properties (not on individual fields)"
- Access rules: "In Access = Public objects, all non-local procedures MUST be explicitly marked as internal unless part of a documented API contract"
- "In Access = Internal objects, omit the internal keyword on procedures"
- Interface type testing: "Use is operator to check interface compatibility before casting. Use as operator for safe casting."

### CLAUDE_NAMING (for Agent 4: Naming & Style)
- "PascalCase for objects/public members; camelCase for locals/params"
- "Names of Page/Table/Codeunit must match object caption"
- Object ID: "ALWAYS use mcp__al-object-id-ninja__ninja_assignObjectId"

### CLAUDE_SECURITY (for Agent 5: Security)
- "Do not store secrets in code or plaintext fields; use secure storage patterns"
- Telemetry: "Emit structured telemetry for critical paths; avoid PII"

### CLAUDE_INTEGRATION (for Agent 6: Integration)
- "Prefer interfaces + events; use dependency inversion for externalized logic"
- "Publish integration events for extensibility; keep subscribers small and focused"
- "Prefer Job Queue for heavy background work"

## Step 3: Dispatch Review Agents

Read each agent prompt file from `.claude/skills/code-review/agents/` and dispatch all 6 in parallel using the Agent tool with `subagent_type: "general-purpose"`.

Each agent receives in its prompt:
1. The agent prompt file content (its instructions)
2. Its CLAUDE.md excerpt (from Step 2)
3. The `REVIEW_DIFF` filename — tell agents to read the diff from this file in the working directory (do NOT paste the diff content into the agent prompt)
4. The `AL_OBJECT_MAP` (from Step 1)
5. Instruction to read its assigned rule files (paths listed in agent prompt)

### Agent 1: Safety & Correctness Reviewer
- Prompt file: `.claude/skills/code-review/agents/safety-correctness-reviewer.md`
- CLAUDE excerpt: `CLAUDE_SAFETY`
- Rule files: `al-error-handling.md`, `al-common-pitfalls.md`, `al-obsolete-patterns.md`

### Agent 2: Performance Reviewer
- Prompt file: `.claude/skills/code-review/agents/performance-reviewer.md`
- CLAUDE excerpt: `CLAUDE_PERF`
- Rule files: `al-performance-patterns.md`

### Agent 3: Code Structure & Design Reviewer
- Prompt file: `.claude/skills/code-review/agents/code-structure-reviewer.md`
- CLAUDE excerpt: `CLAUDE_STRUCTURE`
- Rule files: `al-code-structure-patterns.md`, `al-design-for-testability.md`

### Agent 4: Naming & Style Reviewer
- Prompt file: `.claude/skills/code-review/agents/naming-style-reviewer.md`
- CLAUDE excerpt: `CLAUDE_NAMING`
- Rule files: `al-variable-naming.md`, `al-enum-patterns.md`, `al-pagestyle-patterns.md`, `al-object-id-assignment.md`

### Agent 5: Security Reviewer
- Prompt file: `.claude/skills/code-review/agents/security-reviewer.md`
- CLAUDE excerpt: `CLAUDE_SECURITY`
- Rule files: `al-security-patterns.md`

### Agent 6: Integration Reviewer
- Prompt file: `.claude/skills/code-review/agents/integration-reviewer.md`
- CLAUDE excerpt: `CLAUDE_INTEGRATION`
- Rule files: `al-integration-patterns.md`

## Step 4: Collect and Deduplicate Results

Parse each agent's output for `---BEGIN ISSUE---` / `---END ISSUE---` blocks.

**Agents returning `---NO ISSUES---`**: Skip — no findings from that agent.

**Deduplication rules** (when two agents flag the same `FILE` + `LINE`):
1. Take the highest severity (BLOCKING > CRITICAL > STYLE > RECOMMENDATION)
2. Concatenate `RULE_SOURCE` values with ` + `
3. Use the higher-severity agent's DESCRIPTION as primary
4. Append: "(Also flagged by [other agent]: [other description summary])"
5. Use the higher-severity agent's FIX (if severities equal, use Agent 1 > 5 > 2 > 6 > 3 > 4 priority)

## Step 5: Generate Final Report

Sort issues: by severity (BLOCKING first), then by file, then by line number.

Transform each issue from agent format to the display format in `references/output-format.md`:

| Agent Severity | Display |
|---|---|
| BLOCKING | 🔴 |
| CRITICAL | 🟠 |
| STYLE | 🟡 |
| RECOMMENDATION | ⚠️ |

Assemble the full report:

```markdown
# Code Review: [BRANCH_NAME]

**Files reviewed:** [count] AL files
**Review agents:** Safety & Correctness, Performance, Code Structure, Naming & Style, Security, Integration
**Focus:** [summary of primary changes from diff]

---

## Issues Found

[Sorted, formatted issues using the issue template from references/output-format.md]

---

## Action Items

### Required Changes (must fix)
- [ ] [BLOCKING and CRITICAL issues with file:line]

### Suggested Improvements (should fix)
- [ ] [STYLE issues]

---

## Final Status

**Status:** [APPROVED if 0 BLOCKING + 0 CRITICAL | REQUIRES CHANGES if any CRITICAL | REJECTED if any BLOCKING]
**Summary:** X BLOCKING, Y CRITICAL, Z STYLE, W RECOMMENDATION issues

**Objects Requiring Changes:**
- `Object.al` → `Procedure()`

**VS Code Navigation:**
[Top issues with file:line paths for Ctrl+G navigation]
```

Report ONLY issues found. Never report compliant code or "Strengths" sections.

## References

- Agent output format: `references/output-format.md`
- Violation examples: `references/examples.md`
- Review checklist (human reference): `references/review-checklist.md`
- Team standards: `CLAUDE.md`, `.claude/rules/coding-rules/`
- [AL Developer Reference](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/devenv-reference-overview)
- [TryFunction Attribute](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/attributes/devenv-tryfunction-attribute)
