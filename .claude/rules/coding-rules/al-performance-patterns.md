---
paths: "**/*.al"
---

# AL Performance Patterns

Validate these critical performance patterns when writing or reviewing AL code.

---

## Pattern 1: SetLoadFields Before Get/Find

**Rule:** Always use `SetLoadFields` before `Get()`, `Find()`, or `FindSet()` to load only needed fields.

**Exception:** Setup tables (tables with "Setup" in name) are small single-record tables - SetLoadFields not required.

### Why Use SetLoadFields?
- Reduces network traffic between Application Server and SQL Server
- Improves query performance by selecting only needed columns
- Reduces memory usage for large records
- Critical for tables with BLOB fields (File, Content fields)

### Basic Pattern
```al
// GOOD: Load only needed fields
Item.SetLoadFields("No.");
if not Item.Get(ItemNo) then
    exit();

// BAD: Loads all fields unnecessarily
if not Item.Get(ItemNo) then
    exit();
```

### Placement Rules
- Place `SetLoadFields` immediately before the Get/Find call
- Filter fields are auto-loaded - don't include them in SetLoadFields

```al
// GOOD: SetLoadFields after SetRange, before FindFirst
Item.SetRange("Third Party Item Exists", false);
Item.SetLoadFields("Item Category Code");
Item.FindFirst();
```

### For Looping Operations
```al
// GOOD: Set load fields before loop
FileArchive.SetLoadFields("Entry No.", Type, File, FileName);
FileArchive.SetRange(Type, TransactionType);
if FileArchive.FindSet() then
    repeat
        // Process records
    until FileArchive.Next() = 0;
```

### With BLOB Fields
```al
// GOOD: Load metadata first, then CalcFields for BLOB when needed
RequestLog.SetLoadFields("Entry No.", "Transaction Type", "Request Header Content");
if RequestLog.FindFirst() then begin
    if RequestLog."Request Header Content".HasValue() then begin
        RequestLog.CalcFields("Request Header Content"); // Only calc when needed
        // Process BLOB content
    end;
end;
```

### Expanded Example
```al
// GOOD: Load only needed fields
CustomerRec.SetLoadFields("No.", Name, "Phone No.");
if CustomerRec.Get(CustomerNo) then begin
    // Use only the loaded fields
    Message('Customer %1: %2, Phone: %3', CustomerRec."No.", CustomerRec.Name, CustomerRec."Phone No.");
end;

// BAD: Loads all fields unnecessarily
if CustomerRec.Get(CustomerNo) then begin
    Message('Customer %1: %2', CustomerRec."No.", CustomerRec.Name);
end;
```

---

## Pattern 2: DeleteAll with IsEmpty Guard

**Rule:** Always check `IsEmpty()` before `DeleteAll()` to avoid unnecessary table locks.

An empty DeleteAll still acquires a table lock, causing performance issues.

### Bad Code
```al
TempBuffer.SetRange(Code, 'AJ');
TempBuffer.DeleteAll(true);
```

### Good Code
```al
TempBuffer.SetRange(Code, 'AJ');
if not TempBuffer.IsEmpty() then
    TempBuffer.DeleteAll(true);
```

---

## Pattern 3: Subscriber Codeunit Design

**Rules for event subscriber codeunits:**

1. **Use SingleInstance = true** - Avoids reloading codeunit each invocation
2. **Keep codeunits small** - Split by functionality (Sales-subs, Purchase-subs)
3. **Move business logic out** - Subscribers should call method codeunits
4. **Consider manual binding** - Use BindSubscription/UnbindSubscription when applicable
5. **Avoid OnInsert/OnModify/OnDelete** - These break bulk operations

### Bad Code
```al
codeunit 50100 "All Subs"
{
    // NO SingleInstance - reloads every call!

    [EventSubscriber(ObjectType::Table, Database::"Sales Header", 'OnAfterInsertEvent', '', false, false)]
    local procedure OnAfterInsertSalesHeader(var Rec: Record "Sales Header")
    var
        // Large amounts of business logic HERE - bad!
    begin
        // 50+ lines of code directly in subscriber
    end;
}
```

### Good Code
```al
codeunit 50100 "Sales Subs"
{
    SingleInstance = true;  // Loaded once per session

    [EventSubscriber(ObjectType::Table, Database::"Sales Header", 'OnAfterInsertEvent', '', false, false)]
    local procedure OnAfterInsertSalesHeader(var Rec: Record "Sales Header")
    var
        SalesHeaderMgt: Codeunit "Sales Header Mgt.";  // Method codeunit
    begin
        if Rec.IsTemporary() then
            exit;
        SalesHeaderMgt.HandleAfterInsert(Rec);  // Delegate to method codeunit
    end;
}
```

---

## Pattern 4: IsTemporary Safeguard

**Rule:** Check `IsTemporary()` before destructive operations and in event subscribers.

Prevents accidental operations on real data when expecting temporary records.

### Bad Code - Destructive Operation
```al
// Assumes TempBuffer is temporary - dangerous!
TempBuffer.DeleteAll(true);
```

### Good Code - Destructive Operation
```al
if TempBuffer.IsTemporary() then
    TempBuffer.DeleteAll(true);

// OR error if assumption is wrong
if not TempBuffer.IsTemporary() then
    Error(RecNotTemporaryErr);
TempBuffer.DeleteAll(true);
```

### Bad Code - Event Subscriber
```al
[EventSubscriber(ObjectType::Table, Database::"Sales Line", 'OnAfterInsertEvent', '', false, false)]
local procedure OnAfterInsertSalesLine(var Rec: Record "Sales Line")
begin
    DoSomething(Rec);  // Runs for temp records too!
end;
```

### Good Code - Event Subscriber
```al
[EventSubscriber(ObjectType::Table, Database::"Sales Line", 'OnAfterInsertEvent', '', false, false)]
local procedure OnAfterInsertSalesLine(var Rec: Record "Sales Line")
begin
    if Rec.IsTemporary() then
        exit;  // Skip temp records
    DoSomething(Rec);
end;
```

---

## Pattern 5: Read Isolation and Locking (BC v23+)

**Rule:** Use `ReadIsolation` instead of `LockTable`. LockTable disables tri-state locking and "leaks" locks to unrelated code.

### Why ReadIsolation over LockTable?
- **LockTable** = global session state -> ALL record instances of that table get UPDLOCK (including event subscribers!)
- **ReadIsolation** = per-variable -> only affects that specific record variable

### Isolation Levels Quick Reference

| Level | Locks | Default | Use For |
|-------|-------|---------|---------|
| `ReadUncommitted` | None | Before any write | Pages, counts, non-critical reads |
| `ReadCommitted` | None (Cloud) | In write transaction | Clean data to write, allow concurrent access |
| `RepeatableRead` | Keep read lock | - | Read data multiple times, ensure no changes |
| `UpdLock` | Exclusive | After LockTable | Modify records, exclusive access needed |

### Bad Code
```al
local procedure UpdateCustomer(CustomerNo: Code[20])
var
    Customer: Record Customer;
begin
    Customer.LockTable();  // BAD: Affects ALL Customer reads in session!
    Customer.Get(CustomerNo);
    Customer.Name := 'Updated';
    Customer.Modify();
end;
```

### Good Code
```al
local procedure UpdateCustomer(CustomerNo: Code[20])
var
    Customer: Record Customer;
begin
    Customer.ReadIsolation := IsolationLevel::UpdLock;  // Only this variable
    Customer.Get(CustomerNo);
    Customer.Name := 'Updated';
    Customer.Modify();
end;
```

### When to Use Each Level

- **ReadUncommitted**: Display data on pages, CalcSums for UI, IsEmpty checks
- **ReadCommitted**: Read data you'll write (default in write transaction)
- **RepeatableRead**: Must read same data multiple times without changes. **Caveat:** No `RunModal` or `if Codeunit.Run then` allowed after
- **UpdLock**: Exclusive lock before Modify - use sparingly

---

## Pattern 6: Filtering and Keys

**Rule:** Always set filters and use appropriate keys for large table queries.

### Use Proper Filters
```al
// GOOD: Filter early and use indexed fields
FileArchive.SetRange(Type, TransactionType);
FileArchive.SetRange("Import Date", StartDate, EndDate);
FileArchive.SetCurrentKey(Type, "Import Date"); // Use appropriate key
```

### Avoid Unfiltered Operations
```al
// BAD: No filtering on large tables
if FileArchive.FindSet() then // Potentially thousands of records

// GOOD: Always filter
FileArchive.SetRange("Import Date", CalcDate('<-30D>', Today));
if FileArchive.FindSet() then
```

### Common Patterns in Banking App

**File Archive Access:**
```al
FileArchive.SetLoadFields("Entry No.", Type, File, FileName, "Import Date");
FileArchive.SetRange(Type, TransactionType);
FileArchive.SetCurrentKey("Entry No.");
FileArchive.SetAscending("Entry No.", false);
```

**Request Header Log Access:**
```al
RequestHeaderLog.SetLoadFields("Entry No.", "Transaction Type", "Request Header Content", UserID);
RequestHeaderLog.SetRange("Transaction Type", TransactionType);
RequestHeaderLog.SetCurrentKey("Entry No.");
RequestHeaderLog.SetAscending("Entry No.", false);
```

---

## Pattern 7: Bind Functions to Field Expressions Instead of OnAfterGetRecord

**Rule:** For computed/virtual page fields, bind the calculation function directly in the field expression instead of assigning values in `OnAfterGetRecord()`.

### Why?
- `OnAfterGetRecord()` runs for **every record** on every page load, even for hidden fields
- Field expressions are only evaluated when the field is **actually visible/rendered**
- For expensive calculations on fields that are hidden by default (`Visible = false`), this avoids unnecessary computation entirely

### Bad Code
```al
page 50100 "My Ledger Entries"
{
    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field(RunningBalance; RunningBalanceValue)
                {
                    Caption = 'Running Balance';
                    Visible = false;
                }
            }
        }
    }

    trigger OnAfterGetRecord()
    begin
        // BAD: Runs for EVERY record even when RunningBalance column is hidden!
        RunningBalanceValue := CalcRunningBalance.GetBalance(Rec);
    end;

    var
        CalcRunningBalance: Codeunit "Calc Running Balance";
        RunningBalanceValue: Decimal;
}
```

### Good Code
```al
page 50100 "My Ledger Entries"
{
    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                // GOOD: Function bound to field expression - only called when field is visible
                field(RunningBalance; CalcRunningBalance.GetBalance(Rec))
                {
                    Caption = 'Running Balance';
                    Visible = false;
                }
            }
        }
    }

    var
        CalcRunningBalance: Codeunit "Calc Running Balance";
}
```

### When to Use
- Computed fields on list pages with many records
- Fields that are hidden by default (`Visible = false`) but can be shown by the user
- Expensive calculations (running balances, aggregations, external lookups)
- Any page field that currently uses a global variable assigned in `OnAfterGetRecord()`

### When NOT to Use
- Fields that are always visible and always needed (no performance difference)
- When the same calculated value is used by multiple fields (avoid redundant calls)

---

## Pattern 8: Never Reassign the Loop Record Inside a FindSet Loop

**Rule:** Inside a `FindSet`/`repeat..until Next()` loop, never assign the loop record variable to a local copy before calling `Modify()`. This resets the internal SQL cursor and causes BC to re-issue the full query on every `Next()` call.

### Why?
The BC runtime maintains a server-side cursor for `FindSet` iteration. Assigning the record variable to another variable (or from another variable back) invalidates the cursor position. Each subsequent `Next()` then executes the original SQL query again from scratch, turning O(1) advancement into O(N) round-trips per iteration.

### Bad Code
```al
// BAD: Assigning to LocalRec resets the cursor on every Next()
if PaymentStatusEntry.FindSet() then
    repeat
        LocalPaymentStatusEntry := PaymentStatusEntry;
        LocalPaymentStatusEntry.Matched := true;
        LocalPaymentStatusEntry.Modify();
    until PaymentStatusEntry.Next() = 0;
```

### Good Code
```al
// GOOD: Modify the loop variable directly (passed as var or declared locally)
if PaymentStatusEntry.FindSet() then
    repeat
        PaymentStatusEntry.Matched := true;
        PaymentStatusEntry.Modify();
    until PaymentStatusEntry.Next() = 0;
```

### Key Point
This also applies to assigning *from* another record into the loop variable. Any record assignment (`A := B`) on the loop variable between `FindSet` and `Next()` breaks the cursor.

---

## Pattern 9: Pass Scalar Values Instead of Whole Record Parameters

**Rule:** When a procedure only needs a few fields from a record, pass those fields as scalar parameters instead of copying the entire record.

### Why?
When BC passes a Record by value (without `var`), it copies **all fields** in the record to the new variable. For tables with many fields (50+, or tables with BLOB/large text fields), this is a significant overhead — especially when called in a loop. Passing only the 2-3 values you actually need avoids this copy entirely.

### When to Apply
This is a judgment call based on the ratio of fields used vs. total fields on the table:

| Table Size | Fields Used | Action |
|------------|-------------|--------|
| Small (< 15 fields) | Any | Record parameter is fine |
| Medium (15-50 fields) | < 3 fields | Consider scalar parameters |
| Large (50+ fields) | < 5 fields | Prefer scalar parameters |
| Any size with BLOBs | Not using BLOB | Prefer scalar parameters |

**Exception:** If you pass the record as `var` (by reference), no copy occurs — the overhead is negligible regardless of table size. This rule applies only to by-value Record parameters.

### Bad Code
```al
// BAD: Copies all 80+ fields of Payment Status Entry just to read two integers
local procedure UpdateLedgerEntryStatus(PaymentStatusEntry: Record "CTS-PE Payment Status Entry"; ...)
begin
    DetailLog.Init();
    DetailLog."Header Entry No." := PaymentStatusEntry."Header Entry No.";
    DetailLog."Line No." := PaymentStatusEntry."Line No.";
    ...
end;
```

### Good Code
```al
// GOOD: Pass only the values actually needed
local procedure UpdateLedgerEntryStatus(PmtStatusHeaderNo: Integer; PmtStatusLineNo: Integer; ...)
begin
    DetailLog.Init();
    DetailLog."Header Entry No." := PmtStatusHeaderNo;
    DetailLog."Line No." := PmtStatusLineNo;
    ...
end;
```

---

## Pattern 10: Defer Database Reads Until Conditionally Needed

**Rule:** Don't perform a `Get()` or `Find()` before a conditional check if the result is only used inside one branch. Move the database read into the branch that needs it.

### Why?
A `Get()` call that runs unconditionally but whose result is only used in 1 of N branches wastes a SQL round-trip when the other branches execute. In loops this multiplies quickly.

### Bad Code
```al
// BAD: Get() runs every time, even when neither branch modifies the register
CTSCBPaymentRegister.Get(PaymentRegisterNo);
if SomeCondition then
    UpdateRegisterStatus(CTSCBPaymentRegister)
else if OtherCondition then
    UpdateRegisterStatus(CTSCBPaymentRegister);
// else: Get() was wasted
```

### Good Code
```al
// GOOD: Get() only runs when actually needed
if SomeCondition then begin
    CTSCBPaymentRegister.Get(PaymentRegisterNo);
    UpdateRegisterStatus(CTSCBPaymentRegister);
end else if OtherCondition then begin
    CTSCBPaymentRegister.Get(PaymentRegisterNo);
    UpdateRegisterStatus(CTSCBPaymentRegister);
end;
// else: no DB call at all
```

### When NOT to Apply
- When the `Get()` result is used in the condition itself (you need it to decide)
- When every branch uses the record (no savings from deferral)

---

## Pattern 11: Order Operations — Cheap Checks Before Expensive Queries

**Rule:** When a procedure performs multiple operations where a failure in any one causes an early exit, order them so cheap/in-memory checks run before expensive database queries.

### Why?
If a cheap validation (enum check, dictionary lookup, parameter validation) would cause an early exit, running it *before* a database query avoids the query entirely in the failing case.

### Bad Code
```al
// BAD: Expensive DB query runs first, then cheap lookup that might exit
if not FindPaymentRegister(PaymentStatusEntry, PaymentRegisterNo) then
    exit;
if not TryGetStatusDefinition(StatusCode, StatusDefinition) then
    exit;
ProcessStatus(PaymentRegisterNo, StatusDefinition);
```

### Good Code
```al
// GOOD: Cheap in-memory lookup first, expensive query only if needed
if not TryGetStatusDefinition(StatusCode, StatusDefinition) then
    exit;
if not FindPaymentRegister(PaymentStatusEntry, PaymentRegisterNo) then
    exit;
ProcessStatus(PaymentRegisterNo, StatusDefinition);
```

### Heuristic for Ordering
1. Parameter/input validation (free)
2. In-memory lookups (dictionaries, enum checks, temporary tables)
3. Single-record `Get()` calls
4. Filtered `Find()`/`FindSet()` queries
5. Unfiltered or cross-table queries

---

## Pattern 12: Replace Re-Query with Post-Find Field Check

**Rule:** When you have already found a record via a unique key, don't add an extra filter and re-query to check an additional field. Instead, check the field value directly on the loaded record.

### Why?
Each `Find()` call is a SQL round-trip. If you already have the record in memory (found via a unique identifier like an Entry No. or End-to-End ID), reading a field value from the loaded record is free — no need to hit the database again.

### Bad Code
```al
// BAD: Found the record, then re-queries with additional filter
PaymentLedgerEntry.SetRange("End To End Id", EndToEndId);
if PaymentLedgerEntry.FindFirst() then begin
    // Now re-filter and re-query to check transaction type
    PaymentLedgerEntry.SetRange("Initial Transaction Type", ExpectedType);
    if not PaymentLedgerEntry.FindFirst() then
        exit(false);
end;
```

### Good Code
```al
// GOOD: Find once, check the field on the loaded record
PaymentLedgerEntry.SetRange("End To End Id", EndToEndId);
if PaymentLedgerEntry.FindFirst() then begin
    if PaymentLedgerEntry."Initial Transaction Type" <> ExpectedType then
        exit(false);
end;
```

### When to Apply
- The initial find uses a **unique** or sufficiently selective key
- You need to validate one or two additional fields that were not part of the filter
- The additional fields are already in `SetLoadFields` (or you add them)

### When NOT to Apply
- The additional filter significantly narrows a non-unique result set (you genuinely need SQL to filter thousands of rows)
- You need the database to apply sorting on the additional field

---

## Pattern 13: N+1 Query — Record.Get Inside Loops

**Rule:** Never call `Record.Get()` inside a `repeat..until` loop when the target records could be bulk-fetched with a single `FindSet()` or cached in a temporary table/dictionary before the loop.

### Why?
Each `Get()` is a separate SQL round-trip. Inside a loop processing N records, this creates N+1 queries (1 for the loop + N for the Gets). A single `FindSet()` with appropriate filters fetches all needed records in one query.

### Bad Code
```al
// BAD: N+1 pattern — one Get per payment line
if PaymentLine.FindSet() then
    repeat
        BankAccount.Get(PaymentLine."Bank Account No."); // SQL round-trip per line
        ProcessWithBank(PaymentLine, BankAccount);
    until PaymentLine.Next() = 0;
```

### Good Code
```al
// GOOD: Cache bank accounts before the loop
var
    BankAccountDict: Dictionary of [Code[20], Boolean];
begin
    if PaymentLine.FindSet() then
        repeat
            if not BankAccountDict.ContainsKey(PaymentLine."Bank Account No.") then begin
                BankAccount.SetLoadFields("No.", Name);
                BankAccount.Get(PaymentLine."Bank Account No.");
                BankAccountDict.Add(PaymentLine."Bank Account No.", true);
            end;
            ProcessWithBank(PaymentLine, BankAccount);
        until PaymentLine.Next() = 0;
end;
```

### Alternative: Pre-fetch with FindSet
```al
// GOOD: Bulk-fetch all needed bank accounts first
BankAccount.SetLoadFields("No.", Name);
BankAccount.SetFilter("No.", GetDistinctBankAccounts(PaymentLine));
if BankAccount.FindSet() then
    repeat
        BankAccountCache.Add(BankAccount."No.", BankAccount);
    until BankAccount.Next() = 0;
```

---

## Pattern 14: CalcFields Inside Loops

**Rule:** Avoid calling `CalcFields` on FlowFields inside loops. If possible, calculate the value once before the loop, or use a query/aggregation approach.

### Why?
`CalcFields` executes a separate SQL aggregate query per call. Inside a loop of N records, this becomes N additional SQL round-trips — one per iteration.

### Bad Code
```al
// BAD: CalcFields runs a SQL aggregate query per iteration
if BankAccount.FindSet() then
    repeat
        BankAccount.CalcFields(Balance); // SQL round-trip per row
        if BankAccount.Balance > 0 then
            ProcessAccount(BankAccount);
    until BankAccount.Next() = 0;
```

### Good Code
```al
// GOOD: Use SetLoadFields to include the FlowField, letting BC batch-optimize
BankAccount.SetLoadFields("No.", Name, Balance);
if BankAccount.FindSet() then
    repeat
        BankAccount.CalcFields(Balance); // Still needed, but SetLoadFields hints to BC
        if BankAccount.Balance > 0 then
            ProcessAccount(BankAccount);
    until BankAccount.Next() = 0;

// BETTER: Filter first to reduce the number of iterations
BankAccount.SetFilter(Balance, '>0');
BankAccount.SetLoadFields("No.", Name, Balance);
if BankAccount.FindSet() then
    repeat
        BankAccount.CalcFields(Balance);
        ProcessAccount(BankAccount);
    until BankAccount.Next() = 0;
```

---

## Pattern 15: COMMIT Placement in Long Operations

**Rule:** In procedures processing many records, place `Commit()` at safe checkpoints to prevent transaction timeout and reduce lock duration. Never place `Commit()` inside code that might be called from a write transaction context without explicit isolation.

### Why?
- BC SaaS has a 10-minute SQL transaction timeout. Processing thousands of records without committing will exceed this limit.
- Long-held transactions block other users from reading/writing the same tables.
- However, `Commit()` in the wrong place (e.g., in a procedure that a page trigger calls) can cause "cannot commit within a write transaction" errors.

### Bad Code
```al
// BAD: 10,000 records in one transaction — will timeout on SaaS
if PaymentEntry.FindSet() then
    repeat
        ProcessEntry(PaymentEntry);
        PaymentEntry.Modify();
    until PaymentEntry.Next() = 0;
```

### Good Code
```al
// GOOD: Checkpoint commit every 100 records
if PaymentEntry.FindSet() then begin
    ProcessedCount := 0;
    repeat
        ProcessEntry(PaymentEntry);
        PaymentEntry.Modify();
        ProcessedCount += 1;
        if ProcessedCount mod 100 = 0 then
            Commit();
    until PaymentEntry.Next() = 0;
end;
```

---

## Pattern 16: Lock Duration — Minimize Time Between Lock and Commit

**Rule:** When using `ReadIsolation::UpdLock` or performing record modifications, minimize the work done between acquiring the lock and committing. Do not perform HTTP calls, complex calculations, or user interactions while holding locks.

### Why?
- Locks block other sessions from accessing the same records.
- An HTTP call or lengthy calculation while holding a lock can block other users for seconds or minutes.
- Move expensive non-database work outside the locked section.

### Bad Code
```al
// BAD: HTTP call while holding a lock — blocks other users for the entire HTTP round-trip
PaymentHeader.ReadIsolation := IsolationLevel::UpdLock;
PaymentHeader.Get(EntryNo);
Response := CallExternalBankApi(PaymentHeader); // May take 5-30 seconds
PaymentHeader.Status := ParseStatus(Response);
PaymentHeader.Modify();
```

### Good Code
```al
// GOOD: Do expensive work first, then lock-modify-commit quickly
Response := CallExternalBankApi(PaymentHeader); // No lock held
NewStatus := ParseStatus(Response);

PaymentHeader.ReadIsolation := IsolationLevel::UpdLock;
PaymentHeader.Get(EntryNo);
PaymentHeader.Status := NewStatus;
PaymentHeader.Modify();
```

---

## Pattern 17: Batch Size for Bulk Operations

**Rule:** When performing bulk Insert/Modify/Delete operations, process records in batches rather than one-at-a-time or all-at-once. A batch size of 50-200 records balances throughput against lock contention.

### Why?
- One-at-a-time: N SQL round-trips, excessive overhead.
- All-at-once: One massive transaction that times out and blocks everyone.
- Batch processing: Predictable performance, bounded lock duration, resumable on failure.

### Good Code
```al
// GOOD: Process in batches of 100
BatchSize := 100;
ProcessedCount := 0;
if SourceRecord.FindSet() then
    repeat
        TargetRecord.TransferFields(SourceRecord);
        TargetRecord.Insert();
        ProcessedCount += 1;
        if ProcessedCount mod BatchSize = 0 then
            Commit();
    until SourceRecord.Next() = 0;
```

---

## Pattern 18: String Concatenation in Loops

**Rule:** Avoid building large strings by concatenation (`:= Text + Text`) inside loops. Use `TextBuilder` for iterative string assembly.

### Why?
- AL strings are immutable. Each `Text + Text` allocates a new string and copies both operands.
- In a loop of N iterations building a string of total length L, this is O(N*L) — quadratic.
- `TextBuilder` appends in amortized O(1) per operation.

### Bad Code
```al
// BAD: Quadratic string building
ResultText := '';
if LogEntry.FindSet() then
    repeat
        ResultText := ResultText + LogEntry.Description + ','; // O(N*L) total
    until LogEntry.Next() = 0;
```

### Good Code
```al
// GOOD: Linear string building with TextBuilder
var
    StringBuilder: TextBuilder;
begin
    if LogEntry.FindSet() then
        repeat
            StringBuilder.Append(LogEntry.Description);
            StringBuilder.Append(',');
        until LogEntry.Next() = 0;
    ResultText := StringBuilder.ToText();
end;
```

---

## Quick Validation Checklist

After code changes, verify:

- [ ] Every `Get()` / `Find()` / `FindSet()` has `SetLoadFields` (except Setup tables)
- [ ] Every `DeleteAll()` is preceded by `IsEmpty()` check
- [ ] Subscriber codeunits have `SingleInstance = true`
- [ ] Subscribers delegate to method codeunits (no large inline logic)
- [ ] Event subscribers check `IsTemporary()` at start
- [ ] Destructive operations on temp records validate `IsTemporary()`
- [ ] Use `ReadIsolation` instead of `LockTable` (LC0031)
- [ ] Large table queries have appropriate filters and keys
- [ ] Computed page fields use field expressions (not `OnAfterGetRecord()`) when possible
- [ ] No record assignment (`A := B`) on the loop variable between `FindSet` and `Next()`
- [ ] Procedures receiving Records by value actually use most fields; otherwise pass scalars
- [ ] Database reads (`Get`/`Find`) are deferred into the branch that uses them when conditional
- [ ] Cheap checks (validations, in-memory lookups) run before expensive database queries
- [ ] No re-query after a unique-key find just to check an additional field — check in memory
- [ ] No `Record.Get()` inside `repeat..until` loops — cache or bulk-fetch instead (N+1)
- [ ] No `CalcFields` on FlowFields inside loops without filtering to minimize iterations
- [ ] Long-running operations have checkpoint `Commit()` to avoid transaction timeout
- [ ] Lock duration minimized — expensive work (HTTP, calculations) done outside locked sections
- [ ] Bulk operations use batch sizes (50-200) rather than single transaction
- [ ] String concatenation in loops uses `TextBuilder`, not `Text + Text`

---

## References

- [SetLoadFields](https://alguidelines.dev/docs/bestpractices/setloadfields/)
- [DeleteAll](https://alguidelines.dev/docs/bestpractices/deleteall/)
- [Subscriber Codeunits](https://alguidelines.dev/docs/bestpractices/subscribercodeunits/)
- [IsTemporary Safeguard](https://alguidelines.dev/docs/bestpractices/istemporary-table-safeguard/)
- [Microsoft SetLoadFields docs](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/methods-auto/record/record-setloadfields-method)
- [Microsoft Performance Guide](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/performance/performance-overview)
- [LockTable: Good or Bad Practice? (Waldo)](https://www.waldo.be/2024/03/28/rec-locktable-good-practice-or-bad-practice/)
- [Tri-State Locking (BC Internals)](https://bcinternals.com/posts/tri-state-locking/)
- [LockTable vs ReadIsolation Scope (KeyToGoodCode)](https://www.keytogoodcode.com/post/locking-scope-differences-between-locktable-and-readisolation)
- [RCSI Impact in Cloud (Demiliani)](https://demiliani.com/2023/11/23/dynamics-365-business-central-sql-server-and-read-committed-snapshot-isolation-impact/)
