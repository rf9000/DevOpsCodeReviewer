---
paths: "**/*.al"
---

# AL Code Structure Patterns

Validate these 9 code structure patterns when writing or reviewing AL code.

---

## Pattern 1: Early Exit with `if not...then exit`

**Rule:** Use `if not Record.FindSet() then exit;` instead of wrapping code in `if Record.FindSet() then begin...end`.

This pattern:
- Reduces nesting levels
- Improves readability
- Leads to smaller, focused procedures
- Makes it clear where readers can stop in certain cases

### Bad Code
```al
procedure ProcessSalesOrders()
var
    SalesHeader: Record "Sales Header";
    SalesLine: Record "Sales Line";
begin
    SalesHeader.SetRange("Document Type", SalesHeader."Document Type"::Order);
    SalesHeader.SetRange(Status, SalesHeader.Status::Open);
    if SalesHeader.FindSet(false) then begin
        repeat
            SalesLine.SetRange("Document Type", SalesHeader."Document Type");
            SalesLine.SetRange("Document No.", SalesHeader."No.");
            if SalesLine.FindSet(true) then begin
                repeat
                    DoSomething();
                until SalesLine.Next() = 0;
            end;
        until SalesHeader.Next() = 0;
        DoSomethingElse();
    end;
end;
```

### Good Code
```al
procedure ProcessSalesOrders()
var
    SalesHeader: Record "Sales Header";
begin
    SalesHeader.SetRange("Document Type", SalesHeader."Document Type"::Order);
    SalesHeader.SetRange(Status, SalesHeader.Status::Open);
    if not SalesHeader.FindSet(false) then
        exit;

    repeat
        ProcessSalesLines(SalesHeader);
    until SalesHeader.Next() = 0;

    DoSomethingElse();
end;

procedure ProcessSalesLines(var SalesHeader: Record "Sales Header")
var
    SalesLine: Record "Sales Line";
begin
    SalesLine.SetRange("Document Type", SalesHeader."Document Type");
    SalesLine.SetRange("Document No.", SalesHeader."No.");
    if not SalesLine.FindSet(true) then
        exit;

    repeat
        DoSomething();
    until SalesLine.Next() = 0;
end;
```

### Exception: `FindSet` + `repeat..until` Without Subsequent Code

**When `FindSet` is followed by a `repeat..until` loop and there is no code after the loop**, do NOT use early exit. The `FindSet` and `repeat..until` form a natural pair that should stay together. Splitting them with an early exit disconnects logically paired operations and reduces readability.

```al
// BAD: Early exit splits FindSet from its repeat..until
PaymentLedgerEntry.ReadIsolation := IsolationLevel::UpdLock;
if not PaymentLedgerEntry.FindSet() then
    exit(false);

repeat
    UpdateStatus(PaymentLedgerEntry);
until PaymentLedgerEntry.Next() = 0;
exit(true);
```

```al
// GOOD: FindSet and repeat..until stay together
PaymentLedgerEntry.ReadIsolation := IsolationLevel::UpdLock;
if PaymentLedgerEntry.FindSet() then
    repeat
        UpdateStatus(PaymentLedgerEntry);
    until PaymentLedgerEntry.Next() = 0;
```

**When to use early exit with FindSet:** Only when there is significant code **after** the loop that benefits from reduced nesting (see the Good Code example above where `DoSomethingElse()` follows the loop).

### Early Exit Guard Clauses

```al
// Guard clause reduces nesting
procedure ProcessRecord(RecRef: RecordRef)
begin
    if not RecRef.Active then
        exit;

    if RecRef.FieldCount = 0 then
        exit;

    // Main processing logic at lower nesting level
    ProcessFields(RecRef);
end;

// Early exit in BLOB handling
if not TempBlob.HasValue() or (TempBlob.Length() = 0) then begin
    JsonObject.Add(FieldRef.Name, '');
    JsonObject.Add(FieldRef.Name + '_HasContent', false);
end else begin
    // Success path at single nesting level
    BlobContent := Base64Convert.ToBase64(TempBlob.ToText());
    JsonObject.Add(FieldRef.Name, BlobContent);
end;
```

---

## Pattern 2: Unnecessary `else` Removal

**Rule:** Don't use `else` when the `then` block ends with `exit`, `error`, `break`, `skip`, or `quit`.

The else is unnecessary because these statements terminate the current flow.

### Bad Code
```al
procedure ValidateBinCode()
begin
    if IsAdjmtBinCodeChanged() then
        Error(AdjmtBinCodeChangeNotAllowedErr)
    else
        Error(BinCodeChangeNotAllowedErr);
end;
```

### Good Code
```al
procedure ValidateBinCode()
begin
    if IsAdjmtBinCodeChanged() then
        Error(AdjmtBinCodeChangeNotAllowedErr);

    Error(BinCodeChangeNotAllowedErr);
end;
```

### Another Example
```al
// BAD
if not Customer.Get(CustomerNo) then
    exit(false)
else
    exit(true);

// GOOD
if not Customer.Get(CustomerNo) then
    exit(false);

exit(true);
```

---

## Pattern 3: Begin..End for Compound Statements Only (AA0005)

**Rule:** Only use `begin..end` when enclosing multiple statements. Single statements don't need them.

This is enforced by analyzer rule AA0005.

### Single Statement - No begin..end Needed

```al
// Single statement in if condition
if not Customer.Get(CustomerNo) then
    exit(false);

// Single statement in case branch
case TransactionType of
    TransactionType::Payment:
        ProcessPayment();
    TransactionType::Refund:
        ProcessRefund();
end;

// Single statement after if (case is one compound statement)
if FieldRef.Active then
    case FieldRef.Type of
        FieldType::Text:
            JsonObject.Add(FieldRef.Name, Format(FieldRef.Value));
        FieldType::Integer:
            JsonObject.Add(FieldRef.Name, Format(FieldRef.Value));
    end;

// FindSet with single repeat..until
if FindSet() then
    repeat
        ProcessRecord();
    until Next() = 0;
```

### Multiple Statements - begin..end Required

```al
// Multiple statements in if condition
if not Customer.Get(CustomerNo) then begin
    LogError('Customer not found: ' + CustomerNo);
    exit(false);
end;

// Multiple statements in case branch
case TransactionType of
    TransactionType::Payment:
        begin
            ValidatePayment();
            ProcessPayment();
            LogTransaction();
        end;
end;

// Multiple statements in nested conditions
if TempBlob.HasValue() then begin
    if TempBlob.Length() > 0 then begin
        BlobContent := Base64Convert.ToBase64(TempBlob.ToText());
        JsonObject.Add(FieldRef.Name, BlobContent);
        JsonObject.Add(FieldRef.Name + '_Encoding', 'base64');
    end else begin
        JsonObject.Add(FieldRef.Name, '');
        JsonObject.Add(FieldRef.Name + '_HasContent', false);
    end;
end;
```

### Common AA0005 Violations & Fixes

```al
// VIOLATION 1: Unnecessary begin..end around single case
if condition then begin
    case value of
        Option1: DoSomething();
    end;
end;

// FIXED:
if condition then
    case value of
        Option1: DoSomething();
    end;

// VIOLATION 2: Unnecessary begin..end around single statement
if condition then begin
    DoSomething();
end;

// FIXED:
if condition then
    DoSomething();

// VIOLATION 3: Unnecessary begin..end in case branch
case TransactionType of
    TransactionType::Payment:
        begin
            ProcessPayment();
        end;
end;

// FIXED:
case TransactionType of
    TransactionType::Payment:
        ProcessPayment();
end;
```

### Exception: begin..end Needed for else Binding

`begin..end` IS needed when using `else` with nested `if`:

```al
// This is correct - begin..end needed for else to bind to outer if
if X then begin
    if Y then
        DoSomething();
end else
    DoSomethingElse();
```

### Real-World Example: JSON Serialization

```al
local procedure SerializeRecordToJson(RecRef: RecordRef): Text
var
    FieldRef: FieldRef;
    JsonObject: JsonObject;
    TempBlob: Codeunit "Temp Blob";
    Base64Convert: Codeunit "Base64 Convert";
    BlobContent: Text;
    FieldCount: Integer;
    i: Integer;
begin
    FieldCount := RecRef.FieldCount;  // Performance: cache field count
    for i := 1 to FieldCount do begin
        FieldRef := RecRef.FieldIndex(i);
        if FieldRef.Active then  // Single statement - no begin..end needed
            case FieldRef.Type of
                FieldType::BLOB:
                    begin  // Multiple statements - begin..end required
                        TempBlob.FromFieldRef(FieldRef);
                        // Early exit guard clause pattern
                        if not TempBlob.HasValue() or (TempBlob.Length() = 0) then begin
                            JsonObject.Add(FieldRef.Name, '');
                            JsonObject.Add(FieldRef.Name + '_HasContent', false);
                        end else begin
                            BlobContent := Base64Convert.ToBase64(TempBlob.ToText());
                            JsonObject.Add(FieldRef.Name, BlobContent);
                            JsonObject.Add(FieldRef.Name + '_Encoding', 'base64');
                            JsonObject.Add(FieldRef.Name + '_HasContent', true);
                        end;
                    end;
                FieldType::RecordID:
                    JsonObject.Add(FieldRef.Name, Format(FieldRef.Value));  // Single statement - no begin..end
                else
                    JsonObject.Add(FieldRef.Name, Format(FieldRef.Value));  // Single statement - no begin..end
            end;
    end;
    exit(JsonObject.AsJson());
end;
```

---

## Pattern 4: Unnecessary `true`/`false` Simplification

**Rule:** Don't compare boolean expressions to `true` or `false` - the expression already IS boolean.

### Bad Code
```al
if IsPositive() = true then
    Process();

if Complete <> true then
    Continue();

if Rec.Blocked = false then
    Allow();
```

### Good Code
```al
if IsPositive() then
    Process();

if not Complete then
    Continue();

if not Rec.Blocked then
    Allow();
```

---

## Pattern 5: Formatting - `repeat` and `case` Placement

### 5a: `repeat` on Its Own Line

**Rule:** The `repeat` keyword should always be alone on its own line.

```al
// BAD
if ReservEntry.FindSet() then repeat
    Process(ReservEntry);
until ReservEntry.Next() = 0;

// GOOD
if ReservEntry.FindSet() then
    repeat
        Process(ReservEntry);
    until ReservEntry.Next() = 0;
```

### 5b: `case` Actions on Next Line

**Rule:** Case actions should start on the line after the case value, not on the same line.

```al
// BAD
case Letter of
    'A': Letter2 := '10';
    'B': Letter2 := '11';
end;

// GOOD
case Letter of
    'A':
        Letter2 := '10';
    'B':
        Letter2 := '11';
end;
```

---

## Pattern 6: Cache Repeated Method Calls

**Rule:** Cache the result of method calls that don't change during a loop.

### Bad Code
```al
// Repeated calls in loop condition - FieldCount called every iteration
for i := 1 to RecRef.FieldCount do begin
    // Process fields
end;
```

### Good Code
```al
// Cache the value
procedure SerializeRecord(RecRef: RecordRef): Text
var
    FieldCount: Integer;
    i: Integer;
begin
    FieldCount := RecRef.FieldCount;  // Cache the value
    for i := 1 to FieldCount do begin
        // Process fields
    end;
end;
```

---

## Pattern 7: No Redundant Default Exit Values

**Rule:** Do not use `exit(value)` at the end of a procedure when `value` is the default for the return type. AL initializes return values to the type's default, so the explicit exit is redundant.

Default values by type:
- `Integer` / `Decimal` → `0`
- `Boolean` → `false`
- `Text` / `Code` → `''` (empty string)
- `Guid` → empty GUID

### Bad Code
```al
internal procedure HandleGetBankAccessResponse(...): Integer
var
    ResponseJsonObject: JsonObject;
begin
    if not IHttpFactory.GetResponse().IsSuccessStatusCode() then
        HandleErrorResponseWithAuth(Bank, BankSystemCode, IHttpFactory);
    if ResponseJsonObject.ReadFrom(IHttpFactory.GetResponse().GetResponseBodyAsText()) then begin
        if IHttpFactory.GetErrorHandlingFactory().GetContentDecodedAsJsonObject(ResponseJsonObject) then
            exit(HandleGetBankAccessResponseJson(IHttpFactory, ResponseJsonObject, BankAccount, Bank, BankSystemCode, ShowConfirmation, IBankProductUpdate));
    end else
        JsonFunctions.CannotReadJSON(IHttpFactory, Bank, BankSystemCode, Enum::"CTS-CB File Type"::" ");
    exit(0); // Redundant: Integer defaults to 0
end;
```

### Good Code
```al
internal procedure HandleGetBankAccessResponse(...): Integer
var
    ResponseJsonObject: JsonObject;
begin
    if not IHttpFactory.GetResponse().IsSuccessStatusCode() then
        HandleErrorResponseWithAuth(Bank, BankSystemCode, IHttpFactory);
    if ResponseJsonObject.ReadFrom(IHttpFactory.GetResponse().GetResponseBodyAsText()) then begin
        if IHttpFactory.GetErrorHandlingFactory().GetContentDecodedAsJsonObject(ResponseJsonObject) then
            exit(HandleGetBankAccessResponseJson(IHttpFactory, ResponseJsonObject, BankAccount, Bank, BankSystemCode, ShowConfirmation, IBankProductUpdate));
    end else
        JsonFunctions.CannotReadJSON(IHttpFactory, Bank, BankSystemCode, Enum::"CTS-CB File Type"::" ");
end;
```

### Bad Code (Boolean)
```al
internal procedure MatchCustomStatusEntry(PaymentStatusEntry: Record "CTS-PE Payment Status Entry"; var EndToEndIdDictionary: Dictionary of [Code[50], Boolean]): Boolean
begin
    case true of
        UpdateTxSts(PaymentStatusEntry, EndToEndIdDictionary):
            exit(true);
        UpdatePmtInfSts(PaymentStatusEntry, EndToEndIdDictionary):
            exit(true);
        UpdateGrpSts(PaymentStatusEntry, EndToEndIdDictionary):
            exit(true);
    end;
    exit(false); // Redundant: Boolean defaults to false
end;
```

### Good Code (Boolean)
```al
internal procedure MatchCustomStatusEntry(PaymentStatusEntry: Record "CTS-PE Payment Status Entry"; var EndToEndIdDictionary: Dictionary of [Code[50], Boolean]): Boolean
begin
    case true of
        UpdateTxSts(PaymentStatusEntry, EndToEndIdDictionary):
            exit(true);
        UpdatePmtInfSts(PaymentStatusEntry, EndToEndIdDictionary):
            exit(true);
        UpdateGrpSts(PaymentStatusEntry, EndToEndIdDictionary):
            exit(true);
    end;
end;
```

### Important: Only Remove When Value Matches the Default

Do NOT remove `exit(value)` when the value is non-default — those are meaningful:
```al
// KEEP: exit(true) is non-default for Boolean
exit(true);

// KEEP: exit(1) is non-default for Integer
exit(1);

// REMOVE: exit(false) is the default for Boolean
exit(false);

// REMOVE: exit(0) is the default for Integer
exit(0);

// REMOVE: exit('') is the default for Text
exit('');
```

---

## Pattern 8: No Redundant `internal` on Procedures in `Access = Internal` Objects

**Rule:** When an object (codeunit, table, page, etc.) has `Access = Internal`, all its procedures inherit that access level. Do not mark individual procedures as `internal` — it is redundant.

Only use explicit `internal` on procedures when the object itself is `Access = Public` and you want to restrict specific procedures.

### Bad Code
```al
codeunit 50000 "My Codeunit"
{
    Access = Internal;

    internal procedure DoSomething()
    begin
        // ...
    end;

    internal procedure DoSomethingElse()
    begin
        // ...
    end;
}
```

### Good Code
```al
codeunit 50000 "My Codeunit"
{
    Access = Internal;

    procedure DoSomething()
    begin
        // ...
    end;

    procedure DoSomethingElse()
    begin
        // ...
    end;
}
```

### When `internal` IS Needed

Use explicit `internal` when the object is `Access = Public` but specific procedures should be restricted:

```al
codeunit 50001 "My Public Codeunit"
{
    Access = Public;

    procedure PublicAPI()
    begin
        // Accessible to other extensions
    end;

    internal procedure HelperForInternalUse()
    begin
        // NOT accessible to other extensions
    end;
}
```

---

## Pattern 9: No Unused Procedures (YAGNI)

**Rule:** Every new non-local procedure must have at least one production caller. Do not create procedures speculatively — write them when a caller needs them.

This pattern catches two problems:
- **Dead code**: Procedures with zero callers anywhere
- **Test-only helpers in production**: Procedures called only from `*-test` apps that should live in the test codeunit instead

### Detection (during code review)

For each **new** procedure introduced in the staged diff:
1. Use LSP `findReferences` to find all callers
2. Classify callers as "production" (any non-test app) or "test" (`*-test` app)
3. Flag based on results:
   - **Zero callers** → STYLE: dead code, likely speculative
   - **Test-only callers** → RECOMMENDATION: consider moving to test codeunit

### Exceptions — Do NOT Flag

- **Event publishers** (`[IntegrationEvent]`, `[BusinessEvent]`): designed to have zero direct callers; subscribers bind at runtime
- **Interface implementations**: required by the interface contract, not called directly
- **Trigger procedures** (`OnInsert`, `OnValidate`, etc.): called by the AL runtime
- **Procedures in `Access = Public` objects that are part of a documented API contract**: may be called by external extensions
- **Modified (not new) procedures**: only check procedures newly introduced in this diff

### Bad Code
```al
// Speculative helper — no production code calls it
// Only tests reference it (if any)
procedure EnableByTransferType(var BankAccComSetup: Record "CTS-CB Bank Acc. Com. Setup"; EnableCommType: Enum "CTS-CB Import/Export Comm Type")
begin
    // ... logic that no production flow uses
end;
```

### Good Code
```al
// Production caller exists — procedure was created because it's needed
procedure SetDefaultCommunicationForAccount(BankAccountNo: Code[20])
begin
    // Called from BankAccComSetup.Page.al action
    // ...
end;
```

### Why This Matters

Unused procedures:
- Increase maintenance burden (must be updated during refactors)
- Create false confidence (tests pass for code nobody calls)
- Obscure the actual public surface of a codeunit
- Often indicate incomplete features or abandoned approaches

---

## Quick Validation Checklist

After code changes, verify:

- [ ] No deep nesting from `if Record.Find() then begin...end` patterns
- [ ] No `else` after `exit`, `error`, `break`, `skip`, `quit`
- [ ] No `begin..end` around single statements (except else-binding case)
- [ ] No `= true`, `= false`, `<> true`, `<> false` comparisons
- [ ] `repeat` is on its own line
- [ ] `case` actions are on the line below the match value
- [ ] Repeated method calls are cached outside loops
- [ ] No redundant `exit(default_value)` at end of procedures (e.g., `exit(0)`, `exit(false)`, `exit('')`)
- [ ] No redundant `internal` on procedures when the object has `Access = Internal`
- [ ] New procedures have at least one production caller (not test-only)

---

## Refactoring Tips

**Detecting over-nesting:** If you have more than 2 levels of indentation in a procedure, consider:
1. Using early exits with `if not...then exit`
2. Extracting inner logic to separate procedures
3. Inverting conditions to reduce nesting

**VS Code Extension:** The [AZ AL Dev Tools/AL Code Outline](https://marketplace.visualstudio.com/items?itemName=andrzejzwierzchowski.al-code-outline) can automatically:
- Remove `begin..end` around single statements
- Apply to single file or entire project

---

## References

- [if not then exit](https://alguidelines.dev/docs/bestpractices/if-not-find-then-exit/)
- [Unnecessary else](https://alguidelines.dev/docs/bestpractices/unnecessary-else/)
- [Begin-End Compound Only](https://alguidelines.dev/docs/bestpractices/begin-end/)
- [Unnecessary true/false](https://alguidelines.dev/docs/bestpractices/unnecessary-truefalse/)
- [Lonely Repeat](https://alguidelines.dev/docs/bestpractices/lonely-repeat/)
- [Case Actions](https://alguidelines.dev/docs/bestpractices/case-actions/)
