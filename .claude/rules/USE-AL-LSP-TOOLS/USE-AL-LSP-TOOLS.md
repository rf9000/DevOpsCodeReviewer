# When to Use AL Code Intelligence Tools

This rule instructs Claude on when and how to use the available code intelligence tools for AL (Business Central) development. These tools provide precise, semantic-aware code navigation that is more accurate than text-based search.

## MANDATORY: Proactive LSP Usage for AL Code Changes

When editing or analyzing AL code, you MUST proactively use LSP tools — do not wait for the user to ask. Specifically:

- **Before editing a file**: Use `documentSymbol` to understand its structure
- **Before modifying a procedure**: Use `hover` to check its signature and types
- **Before renaming or changing a symbol**: Use `findReferences` to find all usages
- **When navigating to related code**: Use `goToDefinition`, not text search
- **When understanding call flow**: Use `incomingCalls`/`outgoingCalls`
- **After making changes**: Check LSP diagnostics for errors introduced

Never rely on Grep/Glob for AL code navigation when LSP is available. Text search is only appropriate for comments, TODOs, and non-code content.

## Available Tool Categories

| Tool | Best For |
|------|----------|
| **LSP** | Compiler-aware navigation (definitions, references, types, call hierarchy) |
| **Serena** | Symbolic code analysis, editing, and cross-reference exploration |
| **Grep/Glob** | Text patterns, comments, file discovery |

## Available LSP Operations

### goToDefinition
**Use when:** You need to find where a symbol (procedure, variable, field, table, enum, etc.) is defined.

**Better than Grep because:** It follows the compiler's resolution rules, handles imports, and works across files including dependencies.

**Examples:**
- "Where is `UpdateSearchName` defined?" → Use `goToDefinition` on the procedure call
- "What table is `Customer` referring to?" → Use `goToDefinition` on the table reference
- "Where is this enum value declared?" → Use `goToDefinition` on the enum value

**Actual output:**
```
LSP goToDefinition on Customer.UpdateSearchName() call
→ Defined in /U:/Git/.../Tables/Customer.Table.al:190:15
```

### findReferences
**Use when:** You need to find all places where a symbol is used.

**Better than Grep because:** It understands AL semantics - won't match comments, strings, or similarly-named symbols in different scopes.

**Examples:**
- "Where is `UpdateSearchName` called from?" → Use `findReferences` on the procedure
- "What code uses the `Customer` table?" → Use `findReferences` on the table
- "Find all usages of this field" → Use `findReferences` on the field

**Actual output:**
```
LSP findReferences on UpdateSearchName procedure
→ Found 3 references across 2 files:

  /U:/.../Tables/Customer.Table.al:
    Line 30:21
    Line 190:15

  /U:/.../Codeunits/CustomerMgt.Codeunit.al:
    Line 33:18
```

### hover
**Use when:** You need type information, documentation, or signature details for a symbol.

**Better than reading the file because:** It provides compiled type information including inferred types, full field lists for records, and procedure signatures.

**Examples:**
- "What type is this variable?" → Use `hover` on the variable
- "What parameters does this procedure take?" → Use `hover` on the procedure call
- "What fields does this record have?" → Use `hover` on a Record variable
- "What is the return type of this function?" → Use `hover` on the function

**Actual output for a Record variable:**
```
LSP hover on Customer: Record "TEST Customer"
→ (local) Customer: Record "TEST Customer"
  "No."                   Code[20] (PK1)
  Name                    Text[100]
  "Search Name"           Code[100]
  Address                 Text[100]
  "Customer Type"         Enum CustomerType
  Balance                 Decimal
  "Credit Limit"          Decimal
  Blocked                 Boolean
  ... (all fields listed with types)
```

**Actual output for a procedure:**
```
LSP hover on CreateCustomer procedure
→ procedure CreateCustomer(CustomerNo: Code[20], CustomerName: Text[100], CustomerType: Enum CustomerType): Boolean
```

**Actual output for a Table:**
```
LSP hover on "TEST Customer" table name
→ Table "TEST Customer"
  "No."                   Code[20] (PK1)
  Name                    Text[100]
  ... (complete field list)
```

### documentSymbol
**Use when:** You need to see all symbols in a file, get object IDs, or understand file structure.

**Better than reading the file because:** It provides structured outline with object IDs, symbol kinds, types, and hierarchy.

**Examples:**
- "What procedures are in this codeunit?" → Use `documentSymbol`
- "What is the object ID of this table?" → Use `documentSymbol` (returns `Table 50000 "Name"`)
- "Show me the structure of this page" → Use `documentSymbol`
- "List all triggers in this table" → Use `documentSymbol`
- "What are the enum values?" → Use `documentSymbol`

**Actual output for a Codeunit:**
```
LSP documentSymbol on CustomerMgt.Codeunit.al
→ Codeunit 50000 CustomerMgt (Class) - Line 1          ← Object type + ID + name!
    OnRun() (Function) - Line 5
    CreateNewCustomer() (Function) - Line 10
    CreateCustomer(CustomerNo: Code[20], CustomerName: Text[100], CustomerType: Enum 50000 CustomerType): Boolean (Function) - Line 22
    AssistEdit(var Customer: Record 50000 "TEST Customer"): Boolean (Function) - Line 39
    ... (all procedures with full signatures)
```

**Actual output for a Table:**
```
LSP documentSymbol on Customer.Table.al
→ Table 50000 "TEST Customer" (Class) - Line 1         ← Object type + ID + name!
    fields (Class) - Line 6
      "No.": Code[20] (Field) - Line 8
        OnValidate() (Function) - Line 13              ← Nested triggers!
      Name: Text[100] (Field) - Line 22
      "Customer Type": Enum 50000 CustomerType (Field) - Line 77
      ... (all fields with types)
    keys (Class) - Line 131
      Key PK: "No." (Key) - Line 133
      Key SearchName: "Search Name" (Key) - Line 138
    var (Class) - Line 187
      CustomerMgt: Codeunit 50000 CustomerMgt (Variable) - Line 188
    OnInsert() (Function) - Line 158
    OnModify() (Function) - Line 168
    ... (all triggers and procedures)
```

**Actual output for an Enum:**
```
LSP documentSymbol on CustomerType.Enum.al
→ Enum 50000 CustomerType (Enum) - Line 1              ← Object type + ID + name!
    Enum Name Regular Ordinal 1 (EnumMember) - Line 11   ← Values with ordinals!
    Enum Name Premium Ordinal 2 (EnumMember) - Line 16
    Enum Name VIP Ordinal 3 (EnumMember) - Line 21
    Enum Name Corporate Ordinal 4 (EnumMember) - Line 26
```

**Actual output for a Page:**
```
LSP documentSymbol on CustomerCard.Page.al
→ Page 50001 "TEST Customer Card" (Class) - Line 1
    layout (Class) - Line 8
      Area Content (Namespace) - Line 10
        Group General (Namespace) - Line 12
          Field "No.": Code[20] (Field) - Line 16
            OnAssistEdit() (Function) - Line 21        ← Field triggers!
          Field Name: Text[100] (Field) - Line 28
    actions (Class) - Line 149
      Area Navigation (Object) - Line 151
        Action LedgerEntries (Method) - Line 157
    ... (full page structure)
```

**Key insight:** `documentSymbol` is the preferred way to get object IDs, not text parsing. The top-level symbol always includes: `ObjectType ObjectID "ObjectName" (Kind) - Line N`

### workspaceSymbol
**Use when:** You need to search for symbols across the entire project.

**Better than Glob/Grep because:** It searches the compiled symbol table, not just text patterns.

**Examples:**
- "Find all codeunits with 'Customer' in the name" → Use `workspaceSymbol`
- "Where is the `ProcessPayment` procedure?" → Use `workspaceSymbol`
- "Find tables related to 'Sales'" → Use `workspaceSymbol`

### prepareCallHierarchy
**Use when:** You need to analyze call relationships starting from a specific procedure.

**Provides:** A call hierarchy item with function identity that can be used with `incomingCalls` and `outgoingCalls`.

**Examples:**
- "Analyze the call hierarchy of `CreateCustomer`" → Use `prepareCallHierarchy`

**Actual output:**
```
LSP prepareCallHierarchy on CreateCustomer procedure
→ Call hierarchy item: CreateCustomer (Function) - /U:/.../CustomerMgt.Codeunit.al:22 [CustomerMgt.CreateCustomer]
```

### incomingCalls
**Use when:** You need to find all procedures that call a specific procedure (callers).

**Better than findReferences because:** It specifically focuses on call relationships and identifies the calling procedure, not just the location.

**Examples:**
- "What calls `CreateCustomer`?" → Use `incomingCalls`
- "Trace back who invokes this validation" → Use `incomingCalls`
- "Find the entry points that lead to this procedure" → Chain `incomingCalls`

**Actual output:**
```
LSP incomingCalls on CreateCustomer
→ No incoming calls found (nothing calls this function)
   -- or --
→ Found 2 incoming calls:
  OnRun (Function) - Line 5 [called from: 7:9]
  ProcessBatch (Function) - Line 45 [called from: 52:13]
```

### outgoingCalls
**Use when:** You need to find all procedures that a specific procedure calls (callees).

**Better than reading the procedure because:** It lists all called functions with their definition locations AND the call site within the procedure.

**Examples:**
- "What does `CreateCustomer` call?" → Use `outgoingCalls`
- "What are the dependencies of this procedure?" → Use `outgoingCalls`
- "Trace the call tree from this entry point" → Chain `outgoingCalls`

**Actual output:**
```
LSP outgoingCalls on CreateCustomer procedure
→ Found 4 outgoing calls:

  /U:/.../CustomerMgt.Codeunit.al:
    Get (Function) - Line 26 [called from: 26:12]        ← Definition line + call site!
    Init (Function) - Line 29 [called from: 29:9]
    UpdateSearchName (Function) - Line 33 [called from: 33:9]
    Insert (Function) - Line 34 [called from: 34:9]
```

**Key insight:** `outgoingCalls` shows both WHERE the called function is defined AND WHERE in your procedure you call it.

## Serena Symbolic Tools

Serena provides semantic code tools through MCP (Model Context Protocol). These tools work at the symbol level rather than the text level.

### get_symbols_overview
**Use when:** You need a quick overview of all symbols in a file without reading the entire file.

**Better than reading the file because:** Returns structured symbol information with hierarchy.

**Examples:**
- "What procedures are in this codeunit?" → Use `get_symbols_overview`
- "Show me the structure of this table" → Use `get_symbols_overview`

### find_symbol
**Use when:** You need to find a symbol by name pattern across the codebase.

**Parameters:**
- `name_path` - Symbol path pattern (e.g., `Foo/__init__`, `CustomerMgt/CreateCustomer`)
- `include_body` - Whether to include the full symbol body
- `depth` - How deep to traverse nested symbols

**Examples:**
- "Find the CreateCustomer procedure" → `find_symbol` with `name_path: "CreateCustomer"`
- "Get all methods of CDOSetup codeunit" → `find_symbol` with `name_path: "CDO Setup/*"` and `depth: 1`

### find_referencing_symbols
**Use when:** You need to find symbols that reference a given symbol, with code context.

**Better than findReferences because:** Provides symbolic context around each reference, not just locations.

**Examples:**
- "What procedures call CreateCustomer?" → Use `find_referencing_symbols`
- "Find all code that uses the Customer table" → Use `find_referencing_symbols`

### search_for_pattern
**Use when:** You need fast regex-based search when you're unsure about exact symbol names.

**Better than Grep for:** Finding candidates before using symbolic tools.

**Examples:**
- "Find files mentioning 'Signature'" → Use `search_for_pattern`
- "Search for error handling patterns" → Use `search_for_pattern`

### Serena Editing Tools

For code modifications, Serena provides symbol-aware editing:

| Tool | Use Case |
|------|----------|
| `insert_after_symbol` | Add code after a specific procedure/trigger |
| `insert_before_symbol` | Add code before a specific procedure/trigger |
| `replace_content` | Regex-based find/replace within files |

## Decision Guide: LSP vs Serena vs Text Search

| Task | LSP | Serena | Grep/Glob |
|------|-----|--------|-----------|
| Find where a symbol is defined | `goToDefinition` ✓ | `find_symbol` | - |
| Find all usages of a symbol | `findReferences` ✓ | `find_referencing_symbols` | - |
| Get type/signature info | `hover` ✓ | - | - |
| Get all fields of a Record/Table | `hover` ✓ | - | - |
| **Get object ID (codeunit/table/page number)** | `documentSymbol` ✓ | - | - |
| **Get enum values with ordinals** | `documentSymbol` ✓ | - | - |
| List symbols in a file | `documentSymbol` ✓ | `get_symbols_overview` | - |
| Get file structure (page layout, keys, etc.) | `documentSymbol` ✓ | - | - |
| Search symbols by name | `workspaceSymbol` | `find_symbol` ✓ | - |
| Find callers of a procedure | `incomingCalls` ✓ | `find_referencing_symbols` | - |
| Find callees of a procedure | `outgoingCalls` ✓ | - | - |
| Get symbol body/implementation | Read file | `find_symbol` with `include_body` ✓ | - |
| Symbol-aware code insertion | - | `insert_after/before_symbol` ✓ | - |
| Regex find/replace in files | - | `replace_content` ✓ | - |
| Search for text in comments | - | `search_for_pattern` | `Grep` ✓ |
| Find files by naming pattern | - | `find_file` | `Glob` ✓ |
| Search for TODO/FIXME | - | `search_for_pattern` | `Grep` ✓ |
| Find configuration values | - | - | `Grep` ✓ |

**✓ = Preferred tool for this task**

### Key AL-Specific Insights

1. **Object IDs**: Use `documentSymbol` to get object IDs (e.g., `Codeunit 50000`), NOT line 1 parsing
2. **Record fields**: Use `hover` on a Record variable to get complete field list with types
3. **Enum values**: Use `documentSymbol` to get enum values with their ordinal numbers
4. **Page structure**: Use `documentSymbol` to understand page layout, groups, fields, and actions
5. **Call analysis**: Use `outgoingCalls` to see what a procedure calls (better than reading the code)

### When to Choose Which

**Use LSP when:**
- You need object metadata (object ID, type, name) → `documentSymbol`
- You need field information for a Record/Table → `hover`
- You need enum values with ordinals → `documentSymbol`
- You need compiler-aware type information → `hover`
- You need precise call hierarchy analysis → `incomingCalls`/`outgoingCalls`
- You're navigating between definitions and references → `goToDefinition`/`findReferences`

**Use Serena when:**
- You want to read/edit code at the symbol level
- You need to find symbols with context (surrounding code)
- You're doing refactoring that requires symbol-aware insertion
- LSP is not returning results (e.g., missing dependencies)

**Use Grep/Glob when:**
- You're searching for text patterns (comments, strings, TODOs)
- You need to find files by name patterns
- You're searching for non-code content

## Practical Workflow Examples

### Understanding a procedure
**With LSP:**
1. `hover` - Get signature and documentation
2. `documentSymbol` - See context (what else is in the file)
3. `incomingCalls` - Who calls this?
4. `outgoingCalls` - What does it call?

**With Serena:**
1. `find_symbol` with `include_body: false` - Get signature
2. `get_symbols_overview` - See file structure
3. `find_referencing_symbols` - Find callers with context

### Tracing a bug
**With LSP:**
1. `goToDefinition` - Navigate to the relevant code
2. `findReferences` - Find all usages
3. `incomingCalls` - Trace back to the source

**With Serena:**
1. `find_symbol` with `include_body: true` - Read the code
2. `find_referencing_symbols` - Find usages with surrounding context

### Refactoring safely
**With LSP:**
1. `findReferences` - Find all usages before changing
2. `incomingCalls`/`outgoingCalls` - Understand dependencies
3. `hover` - Verify types are compatible

**With Serena:**
1. `find_referencing_symbols` - Find all usages with context
2. `replace_content` - Make regex-based replacements
3. `insert_after_symbol`/`insert_before_symbol` - Add new code at symbol boundaries

### Exploring unfamiliar code
**With LSP:**
1. `documentSymbol` - Get file overview
2. `workspaceSymbol` - Find related symbols
3. `goToDefinition` - Navigate to dependencies

**With Serena:**
1. `get_symbols_overview` - Get structured file overview
2. `find_symbol` - Search by name pattern across codebase
3. `find_symbol` with `include_body: true` - Read specific procedures

## Important Notes

### LSP Notes
1. **Line and character numbers are 1-based** - Use the line numbers as shown in editors
2. **The file must be in an AL project** - LSP requires `app.json` in the project root
3. **Position matters** - Place cursor on the symbol you want to query
4. **Results include file paths and ranges** - Use these to navigate or read specific code
5. **Requires dependencies** - LSP may fail if `.alpackages` folder is missing

### Serena Notes
1. **Activate project first** - Use `activate_project` if Serena doesn't recognize the codebase
2. **Name path patterns** - Use patterns like `Codeunit/Procedure` or wildcards `*Setup*`
3. **Depth parameter** - Control how deep to traverse nested symbols
4. **Efficient reading** - Use `include_body: false` first, then `include_body: true` for specific symbols

## When Tools Return No Results

**If an LSP operation fails:**
1. **Verify the file path exists** — use `Glob` to confirm the exact path. This is the most common cause of LSP failures.
2. Common path mistakes:
   - Wrong subdirectory (e.g., `AL/Codeunit/` vs `.dependencies/CDO/Codeunit/`)
   - Missing or wrong object number prefix in filename
   - Case sensitivity issues on Linux/macOS
3. If the path is wrong, use `Glob` with the filename pattern (e.g., `**/*CDOQueueManagement*`) to find the correct location

**If LSP operations return empty results:**
1. Verify the file is a `.al` file in a valid AL project
2. Check that the position is on a valid symbol (not whitespace or comments)
3. The symbol might be from an external dependency (`.dal` virtual file)
4. **Try Serena** - It may work when LSP fails due to missing dependencies
5. Fall back to Grep/Glob for text-based search as a last resort

**If Serena operations fail:**
1. Ensure the project is activated with `activate_project`
2. Check that symbol name patterns are correct
3. Use `search_for_pattern` to find candidate names first
4. Fall back to LSP or Grep/Glob
