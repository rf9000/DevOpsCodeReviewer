# Review Checklist

Complete checklist of AL violations to detect during code review.

## Table of Contents
- [Critical Violations](#critical-violations)
- [Code Structure Patterns](#code-structure-patterns)
- [Performance Patterns](#performance-patterns)
- [Error Handling](#error-handling)
- [Variable Naming](#variable-naming)
- [Enum Patterns](#enum-patterns)
- [PageStyle Patterns](#pagestyle-patterns)
- [Security Patterns](#security-patterns)
- [Integration Patterns](#integration-patterns)
- [Architecture](#architecture)
- [Test Quality](#test-quality-for-test-files-only)
- [Additional Performance Patterns](#additional-performance-patterns)
- [Breaking Changes](#breaking-changes)

## Critical Violations

### SetLoadFields Missing
- **Pattern**: `Record.Get()` or `Record.Find*()` without preceding `SetLoadFields`
- **Exception**: Setup tables with few fields
- **Check**: Only fields actually used should be loaded

### TryFunction with Database Writes
- **Pattern**: `[TryFunction]` procedure containing `Insert`, `Modify`, or `Delete`
- **Severity**: BLOCKING - causes transaction rollback issues
- **Fix**: Separate validation from write operations

### Secrets in Code
- **Pattern**: String literals containing passwords, API keys, tokens
- **Check**: Look for "password", "secret", "key", "token" in string literals

## Code Structure Patterns

### Early Exit Pattern
- **Violation**: Nested if-else structures
- **Fix**: Use guard clauses with early exit
```al
// Bad
if Condition1 then begin
    if Condition2 then
        DoSomething();
end;

// Good
if not Condition1 then
    exit;
if not Condition2 then
    exit;
DoSomething();
```

### Parameter Passing
- **Rule**: Use `var` ONLY when:
  1. Procedure modifies the parameter, OR
  2. Setting filters on Record variables (SetRange/SetFilter)
- **Violation**: Record parameter without `var` when filters are set
- **Violation**: `var` on parameters that are only read

### Begin..End Usage
- **Rule**: Only use for compound statements (AA0005)
- **Violation**: `begin..end` wrapping single statement

### Unnecessary Else
- **Rule**: Remove else after exit/error
- **Violation**: `if X then exit; else DoY;` (else is unreachable)

## Performance Patterns

### DeleteAll with IsEmpty Guard
```al
// Bad
Rec.DeleteAll();

// Good
if not Rec.IsEmpty() then
    Rec.DeleteAll();
```

### Unfiltered Queries
- **Violation**: `FindFirst`/`FindSet` without `SetRange` on large tables
- **Check**: Verify filters are set before database reads

### Read Isolation
- **Rule**: Use `ReadIsolation` for read-only operations
- **Violation**: `LockTable()` when only reading data

### Caching Repeated Calls
- **Violation**: Method calls inside loops that return same value
- **Fix**: Cache result before loop

## Error Handling

### TryFunction Use Cases (ALLOWED)
- Validation/parsing operations
- HTTP requests
- JSON parsing
- Authentication checks

### TryFunction Restrictions (NEVER)
- Database writes (Insert/Modify/Delete)
- Any operation that should commit on success

### Error Messages
- **Rule**: Always use labels for Error() and Message()
- **Violation**: `Error('Some text')` without label
- **Fix**: Use `Error(SomeErrorLbl)` with localized label

## Variable Naming

### Complex Type Variables
- **Rule**: Variable name should match object name (omit prefix)
- **Example**: `PaymentFieldMapper: Codeunit "CTS-CB Payment Field Mapper"` (correct)
- **Violation**: `FieldMapper: Codeunit "CTS-CB Payment Field Mapper"` (wrong)

### Declaration Order
1. Complex types (Record, Codeunit, Page, etc.)
2. Simple types (Integer, Text, Boolean, etc.)

### Text Constant Suffixes
- `Msg` - Messages
- `Err` - Errors
- `Qst` - Questions
- `Lbl` - Labels
- `Txt` - Text
- `Tok` - Tokens

## Enum Patterns

### Safe Conversions
```al
// Enum to Integer
IntValue := EnumValue.AsInteger();

// Integer to Enum (validate first)
if Enum.FromInteger(IntValue).HasValue() then
    EnumValue := Enum.FromInteger(IntValue);
```

### Extension Safety
- Use `Index` for iteration (0-based, extension-safe)
- Avoid `Ordinal` for iteration (not extension-safe)

## PageStyle Patterns

### StyleExpr Property
- **Rule**: StyleExpr requires Text value, not PageStyle directly
- **Fix**: Use `Format(PageStyle::Value)`
```al
// Bad
StyleExpr := PageStyle::Strong;

// Good
StyleExpr := Format(PageStyle::Strong);
```

## Security Patterns

### Credential Management
- **Pattern**: String literals containing "password", "secret", "key", "token", "apikey", "bearer"
- **Check**: Must use IsolatedStorage or IConfigureStorage interface
- **Pattern**: Table fields storing credentials in plaintext Text types
- **Check**: Must use SecretText or IsolatedStorage

### Permission Declarations
- **Rule**: Codeunits with Insert/Modify/Delete must declare `Permissions = tabledata`
- **Check**: New tables added to Admin/Edit/Read PermissionSet extensions

### Telemetry Safety
- **Rule**: No PII in LogMessage CustomDimension (email, phone, account numbers, names)
- **Check**: Use record identifiers (No., Entry No.) instead of PII fields

### Error Disclosure
- **Rule**: User-facing errors must not expose internal table names, field IDs, SQL details
- **Check**: GetLastErrorText to telemetry only, localized label to user

### Input Validation
- **Rule**: User text in SetFilter must use `'%1'` parameter substitution or use SetRange instead
- **Rule**: URLs from user input must validate https scheme
- **Check**: JSON/XML from external sources validated before property access

### Business Logic Security
- **Rule**: State-changing operations must validate current record state
- **Rule**: Check-then-modify patterns must use ReadIsolation::UpdLock
- **Rule**: Financial amounts must use Decimal, not Integer

### Tenant Isolation
- **Rule**: IsolatedStorage scope must match intent (Company/User/Module)
- **Rule**: Background jobs must operate in correct company context

## Integration Patterns

### Event Publisher/Subscriber
- **Rule**: Events must include sufficient parameters for subscribers
- **Rule**: Publishers must not modify state after raising event
- **Rule**: Subscribers must not assume execution order
- **Rule**: IsHandled pattern for extensibility OnBefore events

### API Pages
- **Rule**: EntityName and EntitySetName properties required
- **Rule**: ODataKeyFields must match primary key
- **Check**: No sensitive fields (credentials, PII) exposed
- **Rule**: Breaking changes require new API version

### HTTP Communication
- **Rule**: All HTTP calls through IHttpFactory interface
- **Rule**: Check IsSuccessStatusCode before body access
- **Rule**: Log errors with context, without credentials/tokens

### Background Tasks
- **Rule**: Job Queue codeunits must be idempotent
- **Rule**: Must set meaningful error status, not swallow failures
- **Rule**: Long-running jobs use Commit at checkpoints

### External Service Resilience
- **Rule**: Retry logic for transient failures (HTTP 429, 503)
- **Rule**: Failed external calls must not block user
- **Rule**: Failure isolation between integrations

## Breaking Changes

### Public API Changes
- **Rule**: Changes to public procedures require ObsoleteState
- **Check**: Modified signatures, removed procedures, changed return types
- **Transition**: Add `ObsoleteState = Pending` before removal

### Internal vs Public
- **Internal** (`Access = Internal`): Breaking changes affect only same app
- **Public** (default): Breaking changes are CRITICAL

## Architecture

### God Object Detection
- **Pattern**: Codeunit with 10+ non-local procedures serving unrelated purposes
- **Check**: Do all procedures share a cohesive responsibility?
- **Exception**: Factory codeunits, DI containers, setup/initialization codeunits

### Circular Dependencies
- **Pattern**: Codeunit A calls B and B calls A
- **Check**: Use LSP findReferences to verify
- **Exception**: Event publisher/subscriber patterns, interface implementations

## Test Quality (for `*-test/` files only)

### Test Naming
- **Rule**: Test procedures should describe the scenario: `Test{Feature}{Scenario}`
- **Violation**: Generic names like `Test1`, `TestIt`, `MyTest`

### Test Structure (Arrange/Act/Assert)
- **Rule**: Clear separation of setup, action, and verification
- **Violation**: Assert calls mixed with Insert/Modify throughout
- **Violation**: Test procedures with no Assert calls

### Assert Messages
- **Rule**: All Assert calls should include descriptive failure messages
- **Violation**: Empty messages `''` or generic `'Failed'`

## Additional Performance Patterns

### N+1 Queries
- **Pattern**: `Record.Get()` inside `repeat..until` loop
- **Fix**: Cache results in Dictionary or bulk-fetch before loop

### CalcFields in Loops
- **Pattern**: `CalcFields` on FlowFields inside loop iterations
- **Fix**: Filter first to reduce iterations, or calculate outside loop

### COMMIT Placement
- **Rule**: Long-running operations need checkpoint `Commit()`
- **Risk**: 10-minute SQL transaction timeout on BC SaaS

### Lock Duration
- **Rule**: Minimize work between lock acquisition and commit
- **Violation**: HTTP calls or complex calculations while holding UpdLock

### String Concatenation
- **Rule**: Use `TextBuilder` for iterative string assembly in loops
- **Violation**: `Text + Text` concatenation in loops (quadratic)

## Unused Procedures (YAGNI)

### New Procedures Without Production Callers
- **Pattern**: New procedure added with zero callers, or only callers in `*-test` apps
- **Detection**: Use LSP `findReferences` on each new procedure in the diff
- **Zero callers** → STYLE: dead code
- **Test-only callers** → RECOMMENDATION: consider moving to test codeunit
- **Exceptions**: event publishers, interface implementations, triggers, public API contracts

### Schema Changes
- Table field changes require upgrade codeunits
- New mandatory fields need default values or upgrade logic
