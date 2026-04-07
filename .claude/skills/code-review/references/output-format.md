# Output Format

## Report Structure

```markdown
# Code Review: [Branch Name]

**Files reviewed:** X staged files
**Focus:** [Primary change summary]

---

## Issues Found

[List issues by severity]

---

## Action Items

### Required Changes (must fix)
- [ ] [Issue 1 with location]
- [ ] [Issue 2 with location]

### Suggested Improvements (should fix)
- [ ] [Improvement 1]

---

## Final Status

**Status:** APPROVED | REQUIRES CHANGES | REJECTED

**Summary:**
- 🔴 X BLOCKING issues
- 🟠 Y CRITICAL issues
- 🟡 Z STYLE issues

**Objects Requiring Changes:**
- `Object1.al` → `Procedure1()`
- `Object2.al` → `Procedure2()`

**VS Code Navigation:**
```
Ctrl+G → ObjectName.al:LineNumber
```
```

## Issue Format

### Complete Issue Template

```markdown
🔴 **Object:** `AccessPayImport.Codeunit.al` → `GetCurrency()` procedure (Lines 352-361)
**Location:** `base-application/Bank Communication/Codeunits/Import/AccessPayImport.Codeunit.al:356`
**Issue:** SetLoadFields missing before GeneralLedgerSetup.Get() - CRITICAL CLAUDE.md Violation
**CLAUDE.md Rule:** Line 69 - "ALWAYS SetLoadFields before Get/Find on records you don't fully consume"
**Performance Impact:** Loading all GeneralLedgerSetup fields when only "LCY Code" is needed
**Code Context:**
```al
procedure GetCurrency(BankAccount: Record "Bank Account"): Text
var
    GeneralLedgerSetup: Record "General Ledger Setup";
begin
    GeneralLedgerSetup.Get();                      ← LINE 356 - MISSING SetLoadFields
    if BankAccount."Currency Code" = '' then
        exit(GeneralLedgerSetup."LCY Code")
```
**Fix Required:**
```al
GeneralLedgerSetup.SetLoadFields("LCY Code");
GeneralLedgerSetup.Get();
```
```

### Compact Issue Format (for minor issues)

```markdown
🟡 **Style:** `FileName.al:123` → `ProcedureName()` - Variable `x` should be `camelCase`
```

## Severity Definitions

### 🔴 BLOCKING
- Compilation errors
- Runtime failures
- Data corruption risks

**Always include:**
- Exact error message
- Object and procedure context
- Direct fix

### 🟠 CRITICAL
- CLAUDE.md violations
- Performance problems
- Security issues

**Always include:**
- Rule reference (CLAUDE.md line or rules file)
- Impact assessment
- Before/after code

### 🟡 STYLE
- Naming conventions
- Code structure
- Readability

**Include:**
- Specific violation
- Correct pattern

### ⚠️ RECOMMENDATIONS
- Best practices
- Optional improvements

**Include:**
- Suggestion
- Benefits

## What NOT to Include

- Compliant code sections
- "Strengths" or "Good job" sections
- Code that follows standards
- Unchanged code analysis

---

## Agent-Level Output Format

Each review agent returns findings in this structured format for orchestrator parsing. This format is designed for machine consumption — the orchestrator transforms it into the human-readable format above.

### Issue Format

For each violation found, return one block per issue:

```
---BEGIN ISSUE---
SEVERITY: [BLOCKING|CRITICAL|STYLE|RECOMMENDATION]
FILE: [filename.al]
LINE: [line number in actual file, not diff-relative]
PROCEDURE: [procedure name, or "N/A" for object-level issues]
RULE_SOURCE: [rule file name > section/pattern, e.g., "al-performance-patterns.md > Pattern 1: SetLoadFields"]
TITLE: [Short issue title, max 80 chars]
DESCRIPTION: [Detailed description explaining what is wrong and why, with rule reference]
CODE_CONTEXT:
```al
[3 lines before the problematic line]
[PROBLEMATIC LINE]    <-- LINE [N] - [TITLE]
[2 lines after the problematic line]
```
FIX:
```al
[Corrected code showing the fix]
```
---END ISSUE---
```

### No Issues

When an agent finds no violations in its assigned scope:

```
---NO ISSUES---
[Agent Name] found no violations in assigned rule categories.
---NO ISSUES---
```

### Parsing Rules

- Issues are delimited by `---BEGIN ISSUE---` and `---END ISSUE---`
- Each field is on its own line with the format `FIELD_NAME: value`
- `CODE_CONTEXT` and `FIX` contain fenced AL code blocks (may span multiple lines)
- `FILE` + `LINE` together form the deduplication key
- `SEVERITY` determines merge priority: BLOCKING > CRITICAL > STYLE > RECOMMENDATION
- Line numbers must reference actual file lines (from diff hunk headers), not diff-relative positions
