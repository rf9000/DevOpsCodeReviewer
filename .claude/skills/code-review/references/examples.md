# Common Violation Examples

## Early-Exit Pattern Violation

**Bad:**
```al
procedure ProcessExportSelection(Selection: Integer; FilesCollected: Boolean)
begin
    if Selection > 0 then begin
        if FilesCollected then
            ExportFilesToZip()
        else
            Message(NoFilesFoundMsg);
    end;
end;
```

**Good:**
```al
procedure ProcessExportSelection(Selection: Integer; FilesCollected: Boolean)
begin
    if Selection = 0 then
        exit;

    if not FilesCollected then begin
        Message(NoFilesFoundMsg);
        exit;
    end;

    ExportFilesToZip();
end;
```

**Report Format:**
```markdown
🔴 **Object:** `ExportManagement.Codeunit.al` → `ProcessExportSelection()` (Lines 45-58)
**Location:** `base-application/Helper/Codeunits/ExportManagement.Codeunit.al:47`
**Issue:** Nested if statements instead of guard clauses
**CLAUDE.md Rule:** Line 58 - "minimal begin..end; early-exit guard clauses"
```

## SetLoadFields Missing

**Bad:**
```al
procedure GetCurrency(BankAccount: Record "Bank Account"): Text
var
    GeneralLedgerSetup: Record "General Ledger Setup";
begin
    GeneralLedgerSetup.Get();
    if BankAccount."Currency Code" = '' then
        exit(GeneralLedgerSetup."LCY Code")
    else
        exit(BankAccount."Currency Code");
end;
```

**Good:**
```al
procedure GetCurrency(BankAccount: Record "Bank Account"): Text
var
    GeneralLedgerSetup: Record "General Ledger Setup";
begin
    GeneralLedgerSetup.SetLoadFields("LCY Code");
    GeneralLedgerSetup.Get();
    if BankAccount."Currency Code" = '' then
        exit(GeneralLedgerSetup."LCY Code")
    else
        exit(BankAccount."Currency Code");
end;
```

## Parameter Passing - Missing var

**Bad:**
```al
procedure FilterRecords(CustomerRec: Record Customer)
begin
    CustomerRec.SetRange(Blocked, CustomerRec.Blocked::" ");
end;
```

**Good:**
```al
procedure FilterRecords(var CustomerRec: Record Customer)
begin
    CustomerRec.SetRange(Blocked, CustomerRec.Blocked::" ");
end;
```

## TryFunction with Database Write

**Bad:**
```al
[TryFunction]
procedure TryInsertRecord(var Rec: Record MyTable)
begin
    Rec.Insert(true);  // NEVER do this in TryFunction
end;
```

**Good:**
```al
[TryFunction]
procedure TryValidateRecord(Rec: Record MyTable): Boolean
begin
    // Validation only
    if Rec.Code = '' then
        exit(false);
    exit(true);
end;

procedure InsertRecord(var Rec: Record MyTable)
begin
    if not TryValidateRecord(Rec) then
        Error(ValidationFailedErr);
    Rec.Insert(true);
end;
```

## Variable Naming

**Bad:**
```al
var
    FieldMapper: Codeunit "CTS-CB Payment Field Mapper";
    Mgmt: Codeunit "CTS-CB Bank Account Management";
```

**Good:**
```al
var
    PaymentFieldMapper: Codeunit "CTS-CB Payment Field Mapper";
    BankAccountManagement: Codeunit "CTS-CB Bank Account Management";
```

## Error Without Label

**Bad:**
```al
Error('The payment could not be processed');
```

**Good:**
```al
var
    PaymentNotProcessedErr: Label 'The payment could not be processed';
begin
    Error(PaymentNotProcessedErr);
end;
```

## DeleteAll Without Guard

**Bad:**
```al
TempRecord.DeleteAll();
```

**Good:**
```al
if not TempRecord.IsEmpty() then
    TempRecord.DeleteAll();
```

## Hardcoded Secret (Security)

**Bad:**
```al
procedure GetAuthToken(): Text
begin
    exit('Bearer sk-12345-secret-key-here');
end;
```

**Good:**
```al
procedure GetAuthToken() AuthToken: SecretText
var
    IsolatedStorageValue: Text;
begin
    if IsolatedStorage.Get('AUTH_TOKEN', DataScope::Company, IsolatedStorageValue) then
        AuthToken := IsolatedStorageValue;
end;
```

## PII in Telemetry (Security)

**Bad:**
```al
CustomDimension.Add('CustomerEmail', Customer."E-Mail");
CustomDimension.Add('AccountNo', BankAccount.IBAN);
Session.LogMessage('0001', 'Payment processed', Verbosity::Normal, DataClassification::SystemMetadata, TelemetryScope::ExtensionPublisher, CustomDimension);
```

**Good:**
```al
CustomDimension.Add('CustomerNo', Customer."No.");
CustomDimension.Add('BankAccountNo', BankAccount."No.");
Session.LogMessage('0001', 'Payment processed', Verbosity::Normal, DataClassification::SystemMetadata, TelemetryScope::ExtensionPublisher, CustomDimension);
```

## Filter Injection (Security)

**Bad:**
```al
// User enters '*' or '@*a*' — returns all records
Rec.SetFilter(Name, UserInputText);
```

**Good:**
```al
// Parameter substitution escapes filter operators
Rec.SetFilter(Name, '%1', UserInputText);

// Or use SetRange which doesn't interpret operators
Rec.SetRange(Name, UserInputText);
```

## TryFunction Unchecked Return (Safety)

**Bad:**
```al
// Return value silently ignored — error swallowed
TryValidateUrl(InputUrl);
ProcessUrl(InputUrl);
```

**Good:**
```al
if not TryValidateUrl(InputUrl) then begin
    Session.LogMessage('0002', GetLastErrorText(), Verbosity::Error, DataClassification::SystemMetadata, TelemetryScope::ExtensionPublisher);
    Error(InvalidUrlErr);
end;
ProcessUrl(InputUrl);
```

## Missing CalcFields Before FlowField (Safety)

**Bad:**
```al
BankAccount.Get(AccountNo);
AmountValue := BankAccount.Balance;  // FlowField — value is 0!
```

**Good:**
```al
BankAccount.SetLoadFields(Balance);
BankAccount.Get(AccountNo);
BankAccount.CalcFields(Balance);
AmountValue := BankAccount.Balance;
```

## N+1 Query Pattern (Performance)

**Bad:**
```al
// Get() inside loop — N SQL round-trips
if PaymentLine.FindSet() then
    repeat
        BankAccount.Get(PaymentLine."Bank Account No.");
        ProcessWithBank(PaymentLine, BankAccount);
    until PaymentLine.Next() = 0;
```

**Good:**
```al
// Cache before loop — 1 SQL round-trip for all bank accounts
var
    BankAccountCache: Dictionary of [Code[20], Boolean];
begin
    if PaymentLine.FindSet() then
        repeat
            if not BankAccountCache.ContainsKey(PaymentLine."Bank Account No.") then begin
                BankAccount.SetLoadFields("No.", Name);
                BankAccount.Get(PaymentLine."Bank Account No.");
                BankAccountCache.Add(PaymentLine."Bank Account No.", true);
            end;
            ProcessWithBank(PaymentLine, BankAccount);
        until PaymentLine.Next() = 0;
end;
```

## Swallowed Exception (Error Handling)

**Bad:**
```al
// Error caught and silently ignored — no logging, no status update
if not TryProcessPayment(PaymentHeader) then
    exit; // Silent failure — what went wrong?
```

**Good:**
```al
if not TryProcessPayment(PaymentHeader) then begin
    Session.LogMessage('0003', GetLastErrorText(), Verbosity::Error,
        DataClassification::SystemMetadata, TelemetryScope::ExtensionPublisher);
    Error(PaymentProcessingFailedErr);
end;
```

## Test Assert Without Message (Test Quality)

**Bad:**
```al
Assert.AreEqual(ExpectedAmount, ActualAmount, '');
Assert.IsTrue(PaymentHeader.Find(), '');
```

**Good:**
```al
Assert.AreEqual(ExpectedAmount, ActualAmount, 'Payment amount should match invoice total after discount');
Assert.IsTrue(PaymentHeader.Find(), 'Payment header should exist after posting');
```

## Procedure Length Violation (Structure)

**Bad:**
```al
procedure ProcessAllPayments(var PaymentHeader: Record "CTS-CB Payment Header")
begin
    // 120+ lines of mixed validation, processing, and logging
    // Should be split into focused sub-procedures
end;
```

**Good:**
```al
procedure ProcessAllPayments(var PaymentHeader: Record "CTS-CB Payment Header")
begin
    ValidatePaymentHeader(PaymentHeader);
    ExecutePaymentProcessing(PaymentHeader);
    LogPaymentResult(PaymentHeader);
end;
```
