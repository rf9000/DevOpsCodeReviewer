---
paths: "**/*.al"
---

# AL Security Patterns

Validate these critical security patterns when writing or reviewing AL code. Security bugs are harder to patch after release than functional bugs — get them right the first time.

---

## Pattern 1: Credential & Secret Management

**Rule:** Never store secrets (API keys, passwords, tokens, certificates) in string literals, code variables, or plaintext table fields. Use `IsolatedStorage` or the `IConfigureStorage` interface pattern.

### Why Use IsolatedStorage?
- String literals and plaintext fields are visible in source control, table data exports, and page inspections
- AL does not have a "const secret" type — any Text/Code variable holding a secret can leak via debugger, telemetry, or error messages
- `IsolatedStorage` encrypts values at rest and restricts access by scope (company, user, module)
- AppSource validation flags hardcoded credential patterns

### Bad Code — Hardcoded Secret
```al
// BAD: Secret in source code
local procedure GetAuthToken(): Text
begin
    exit('Bearer sk-12345-secret-key-here');
end;
```

### Bad Code — Plaintext Table Field
```al
// BAD: Secret stored in a readable table field
table 50100 "My Bank Setup"
{
    fields
    {
        field(10; "API Key"; Text[250])
        {
            Caption = 'API Key';
        }
    }
}
```

### Good Code — IsolatedStorage
```al
local procedure StoreApiKey(ApiKey: SecretText)
var
    StorageKey: Text;
begin
    StorageKey := GetApiKeyStorageKey();
    if not IsolatedStorage.Set(StorageKey, ApiKey, DataScope::Company) then
        Error(FailedToStoreSecretErr);
end;

local procedure GetApiKey(): SecretText
var
    StorageKey: Text;
    ApiKey: SecretText;
begin
    StorageKey := GetApiKeyStorageKey();
    if not IsolatedStorage.Get(StorageKey, DataScope::Company, ApiKey) then
        Error(SecretNotFoundErr);
    exit(ApiKey);
end;
```

### Never Log Credential Values
```al
// BAD: Secret value in telemetry
CustomDimension.Add('Token', Format(AuthToken));
Session.LogMessage('0000ABC', 'Auth completed', Verbosity::Normal, DataClassification::SystemMetadata, TelemetryScope::ExtensionPublisher, CustomDimension);

// GOOD: Log presence, not value
CustomDimension.Add('TokenPresent', Format(AuthToken.Unwrap() <> ''));
Session.LogMessage('0000ABC', 'Auth completed', Verbosity::Normal, DataClassification::SystemMetadata, TelemetryScope::ExtensionPublisher, CustomDimension);
```

---

## Pattern 2: Permission & Authorization

**Rule:** Codeunits performing database write operations (Insert/Modify/Delete) must declare explicit `Permissions = tabledata "Table Name" = RIMD` (or the appropriate subset).

**Rule:** New tables must be added to relevant PermissionSet extensions (Admin with RIMD, Edit with RIMD, Read with R).

### Why Declare Explicit Permissions?
- Without explicit `Permissions`, the codeunit relies on the calling user's permissions, which may be too broad or too narrow
- Explicit declarations document the data access contract and enable auditing
- AppSourceCop rule AS0084 flags implicit permission usage in certain scenarios
- Principle of least privilege: request only the access levels actually needed (R, RI, RIM, RIMD)

### Bad Code — No Permissions Property
```al
// BAD: No Permissions property — relies on caller's permissions
codeunit 50100 "Payment Processor"
{
    procedure ProcessPayment(PaymentEntryNo: Integer)
    var
        PaymentEntry: Record "CTS-CB Payment Entry";
    begin
        PaymentEntry.Get(PaymentEntryNo);
        PaymentEntry.Status := PaymentEntry.Status::Processed;
        PaymentEntry.Modify(); // Write without declared permission
    end;
}
```

### Good Code — Explicit Permissions
```al
// GOOD: Explicit permissions declaring exactly what is needed
codeunit 50100 "Payment Processor"
{
    Permissions = tabledata "CTS-CB Payment Entry" = RM;

    procedure ProcessPayment(PaymentEntryNo: Integer)
    var
        PaymentEntry: Record "CTS-CB Payment Entry";
    begin
        PaymentEntry.Get(PaymentEntryNo);
        PaymentEntry.Status := PaymentEntry.Status::Processed;
        PaymentEntry.Modify();
    end;
}
```

### Access Control on Public Objects
```al
// BAD: Public object exposes internal write operations without gating
codeunit 50101 "Internal Cleanup"
{
    Access = Public;

    procedure PurgeAllRecords()
    var
        SensitiveData: Record "Sensitive Data";
    begin
        SensitiveData.DeleteAll(); // Anyone can call this
    end;
}

// GOOD: Use Access = Internal for operations not part of the public API
codeunit 50101 "Internal Cleanup"
{
    Access = Internal;
    Permissions = tabledata "Sensitive Data" = RD;

    procedure PurgeAllRecords()
    var
        SensitiveData: Record "Sensitive Data";
    begin
        if not SensitiveData.IsEmpty() then
            SensitiveData.DeleteAll();
    end;
}
```

---

## Pattern 3: Data Protection in Telemetry

**Rule:** Never include PII (email, phone, account numbers, customer names) in `Session.LogMessage` CustomDimension dictionaries. Use record identifiers (No., Entry No.) instead.

### Why Protect PII in Telemetry?
- Telemetry data flows to Application Insights or partner dashboards where access controls differ from BC
- GDPR and data protection regulations apply to telemetry pipelines, not just the application database
- PII in telemetry complicates data deletion requests (right to be forgotten)
- Record identifiers (entry numbers, codes) are sufficient for debugging and can be cross-referenced when needed

### Bad Code — PII in Telemetry
```al
// BAD: Customer PII in telemetry dimensions
local procedure LogPaymentProcessed(Customer: Record Customer; Amount: Decimal)
var
    CustomDimension: Dictionary of [Text, Text];
begin
    CustomDimension.Add('CustomerName', Customer.Name);
    CustomDimension.Add('Email', Customer."E-Mail");
    CustomDimension.Add('Phone', Customer."Phone No.");
    CustomDimension.Add('BankAccount', Customer."Bank Account No.");
    CustomDimension.Add('Amount', Format(Amount));
    Session.LogMessage('0000DEF', 'Payment processed', Verbosity::Normal,
        DataClassification::SystemMetadata, TelemetryScope::ExtensionPublisher, CustomDimension);
end;
```

### Good Code — Identifiers Only
```al
// GOOD: Use record identifiers, not PII
local procedure LogPaymentProcessed(Customer: Record Customer; Amount: Decimal)
var
    CustomDimension: Dictionary of [Text, Text];
begin
    CustomDimension.Add('CustomerNo', Customer."No.");
    CustomDimension.Add('AmountRange', GetAmountBucket(Amount));
    Session.LogMessage('0000DEF', 'Payment processed', Verbosity::Normal,
        DataClassification::SystemMetadata, TelemetryScope::ExtensionPublisher, CustomDimension);
end;
```

### Masking When Identifiers Are Needed for Debugging
```al
// GOOD: Mask sensitive identifiers when they must appear in telemetry
local procedure MaskBankAccount(BankAccountNo: Text): Text
begin
    if StrLen(BankAccountNo) <= 4 then
        exit('****');
    exit(PadStr('', StrLen(BankAccountNo) - 4, '*') + CopyStr(BankAccountNo, StrLen(BankAccountNo) - 3));
end;

// Usage: CustomDimension.Add('BankAccountMasked', MaskBankAccount(BankAccountNo));
// Result: '****5678' instead of 'NL91ABNA0417164300'
```

---

## Pattern 4: Error Information Disclosure

**Rule:** User-facing error messages (`Error()`, `Message()`) must not expose internal details like table names, field IDs, SQL errors, or stack traces. Use localized labels with business-friendly text. Internal details go to telemetry only.

### Why Hide Internal Details?
- Table names and field IDs reveal database schema to potential attackers
- SQL constraint messages expose implementation details and can hint at injection vectors
- Stack traces reveal internal procedure names and code paths
- Business users cannot act on technical details — they need actionable guidance

### Bad Code — Technical Details in Error
```al
// BAD: Exposes internal table/field information to the user
local procedure ValidatePayment(PaymentEntryNo: Integer)
var
    PaymentEntry: Record "CTS-CB Payment Entry";
begin
    if not PaymentEntry.Get(PaymentEntryNo) then
        Error('Table 50100 "CTS-CB Payment Entry" record with PK field 1 = %1 not found. SQL: SELECT TOP 1...', PaymentEntryNo);
end;
```

### Bad Code — GetLastErrorText Shown to User
```al
// BAD: Raw error text forwarded to the user
if not TryCallExternalService() then
    Error(GetLastErrorText()); // May contain stack trace, HTTP details, etc.
```

### Good Code — Friendly Error with Telemetry
```al
// GOOD: Friendly message for user, technical details to telemetry
local procedure ValidatePayment(PaymentEntryNo: Integer)
var
    PaymentEntry: Record "CTS-CB Payment Entry";
    CustomDimension: Dictionary of [Text, Text];
begin
    if not PaymentEntry.Get(PaymentEntryNo) then begin
        CustomDimension.Add('EntryNo', Format(PaymentEntryNo));
        Session.LogMessage('0000GHI', 'Payment entry not found', Verbosity::Warning,
            DataClassification::SystemMetadata, TelemetryScope::ExtensionPublisher, CustomDimension);
        Error(PaymentEntryNotFoundErr);
    end;
end;

var
    PaymentEntryNotFoundErr: Label 'The payment entry could not be found. Verify the entry exists and try again.';
```

### Good Code — External Service Error Handling
```al
// GOOD: Log technical error, show friendly message
if not TryCallExternalService() then begin
    CustomDimension.Add('ErrorText', GetLastErrorText());
    Session.LogMessage('0000JKL', 'External service call failed', Verbosity::Error,
        DataClassification::SystemMetadata, TelemetryScope::ExtensionPublisher, CustomDimension);
    Error(ExternalServiceFailedErr);
end;

var
    ExternalServiceFailedErr: Label 'The bank service is currently unavailable. Please try again later or contact support.';
```

---

## Pattern 5: Input Validation (Filter Injection)

**Rule:** User-supplied text used in `SetFilter` must be validated or escaped. AL's `SetFilter` interprets special characters (`*`, `@`, `..`, `|`, `<`, `>`) as filter operators — unescaped user input can produce unintended filter results or errors.

**Rule:** URLs constructed from user input must validate scheme (https only) and domain.

### Why Validate Filter Input?
- `SetFilter(Field, UserInput)` treats `*` as wildcard, `..` as range, `|` as OR, `@` as case-insensitive — user input containing these characters changes the query semantics
- A user entering `*` in a name filter could return all records instead of a specific match
- A user entering `10000..99999` in a code filter could match an entire range unintentionally
- `SetRange` does not interpret filter operators, making it the safe default for exact matches

### Bad Code — Unescaped Filter Input
```al
// BAD: User input interpreted as filter expression
// If UserInputText = '*' or '@*', this returns ALL records
local procedure FindByName(UserInputText: Text)
var
    Customer: Record Customer;
begin
    Customer.SetFilter(Name, UserInputText);
    if Customer.FindFirst() then
        ShowCustomer(Customer);
end;
```

### Good Code — Parameter Substitution
```al
// GOOD: %1 parameter substitution escapes filter operators
local procedure FindByName(UserInputText: Text)
var
    Customer: Record Customer;
begin
    Customer.SetFilter(Name, '%1', UserInputText);
    if Customer.FindFirst() then
        ShowCustomer(Customer);
end;
```

### Good Code — SetRange for Exact Match
```al
// GOOD: SetRange never interprets filter operators
local procedure FindByName(UserInputText: Text)
var
    Customer: Record Customer;
begin
    Customer.SetRange(Name, UserInputText);
    if Customer.FindFirst() then
        ShowCustomer(Customer);
end;
```

### URL Validation
```al
// BAD: No scheme validation — user could supply http:// or file://
local procedure CallBankApi(UserUrl: Text)
var
    HttpClient: HttpClient;
    HttpResponseMessage: HttpResponseMessage;
begin
    HttpClient.Get(UserUrl, HttpResponseMessage);
end;

// GOOD: Validate scheme before use
local procedure CallBankApi(UserUrl: Text)
var
    HttpClient: HttpClient;
    HttpResponseMessage: HttpResponseMessage;
begin
    if not UserUrl.StartsWith('https://') then
        Error(InvalidUrlSchemeErr);
    HttpClient.Get(UserUrl, HttpResponseMessage);
end;

var
    InvalidUrlSchemeErr: Label 'The URL must use HTTPS.';
```

### External Data Validation
```al
// GOOD: Validate JSON structure before accessing nested properties
local procedure ParseBankResponse(ResponseText: Text)
var
    JsonObject: JsonObject;
    JsonToken: JsonToken;
begin
    if not JsonObject.ReadFrom(ResponseText) then
        Error(InvalidResponseFormatErr);
    if not JsonObject.Get('status', JsonToken) then
        Error(MissingStatusFieldErr);
    // Safe to process JsonToken
end;

var
    InvalidResponseFormatErr: Label 'The bank response is not valid JSON.';
    MissingStatusFieldErr: Label 'The bank response is missing the required status field.';
```

---

## Pattern 6: Business Logic Security

**Rule:** State-changing operations must validate the current record state before proceeding. This prevents workflow bypass (e.g., approving an already-rejected document, posting a cancelled payment).

**Rule:** Use Decimal (not Integer) for financial amount calculations to prevent numeric overflow.

**Rule:** Check-then-modify patterns must use `ReadIsolation::UpdLock` to prevent race conditions.

### Why Validate State Transitions?
- Without state validation, direct procedure calls or API invocations can skip workflow steps
- A payment marked "Cancelled" could be re-approved if the approval procedure does not check current status
- Race conditions in check-then-modify patterns allow two sessions to approve the same payment simultaneously

### Bad Code — No State Validation
```al
// BAD: No check on current status — allows invalid transitions
local procedure ApprovePayment(var PaymentHeader: Record "CTS-CB Payment Header")
begin
    PaymentHeader.Status := PaymentHeader.Status::Approved;
    PaymentHeader.Modify();
end;
```

### Good Code — State Validation
```al
// GOOD: Validate current state before transition
local procedure ApprovePayment(var PaymentHeader: Record "CTS-CB Payment Header")
begin
    PaymentHeader.TestField(Status, PaymentHeader.Status::Pending);
    PaymentHeader.Status := PaymentHeader.Status::Approved;
    PaymentHeader.Modify(true);
end;
```

### Bad Code — Race Condition (No Lock)
```al
// BAD: Another session can modify between Get and Modify
local procedure ApprovePayment(PaymentEntryNo: Integer)
var
    PaymentHeader: Record "CTS-CB Payment Header";
begin
    PaymentHeader.Get(PaymentEntryNo);
    PaymentHeader.TestField(Status, PaymentHeader.Status::Pending);
    PaymentHeader.Status := PaymentHeader.Status::Approved;
    PaymentHeader.Modify(true); // Another session may have already changed Status
end;
```

### Good Code — UpdLock Prevents Race Condition
```al
// GOOD: UpdLock ensures exclusive access during check-then-modify
local procedure ApprovePayment(PaymentEntryNo: Integer)
var
    PaymentHeader: Record "CTS-CB Payment Header";
begin
    PaymentHeader.ReadIsolation := IsolationLevel::UpdLock;
    PaymentHeader.Get(PaymentEntryNo);
    PaymentHeader.TestField(Status, PaymentHeader.Status::Pending);
    PaymentHeader.Status := PaymentHeader.Status::Approved;
    PaymentHeader.Modify(true);
end;
```

### Financial Amounts — Use Decimal
```al
// BAD: Integer overflow risk for large amounts (max Integer = 2,147,483,647)
local procedure CalcTotalAmount(Quantity: Integer; UnitPrice: Integer): Integer
begin
    exit(Quantity * UnitPrice); // Overflow when Quantity=100000, UnitPrice=30000
end;

// GOOD: Decimal handles financial precision and large values
local procedure CalcTotalAmount(Quantity: Decimal; UnitPrice: Decimal): Decimal
begin
    exit(Quantity * UnitPrice);
end;
```

---

## Pattern 7: Tenant Isolation (BC SaaS)

**Rule:** `IsolatedStorage` scope must match the intended data visibility. Use `DataScope::Company` for company-specific secrets, `DataScope::User` for user-specific, `DataScope::Module` for app-wide.

**Rule:** Background jobs (Job Queue entries) must operate in the correct company context. Do not assume the current company matches the data.

### Why Scope Matters?
- `DataScope::Module` is shared across all companies in the tenant — a company-specific API key stored at module scope leaks to all companies
- `DataScope::User` is tied to the user session — background jobs running as a different user (Job Queue) cannot access user-scoped secrets
- `DataScope::Company` is the correct default for per-company configuration (API keys, tokens, certificates)
- Wrong scope creates security holes where one company's credentials are accessible from another

### Bad Code — Wrong Scope for Company Secrets
```al
// BAD: Module scope shares the secret across ALL companies in the tenant
local procedure StoreCompanyApiKey(ApiKey: SecretText)
begin
    IsolatedStorage.Set('BankApiKey', ApiKey, DataScope::Module);
end;

// Company A stores their key → Company B can read it
```

### Good Code — Company Scope for Company Secrets
```al
// GOOD: Each company gets its own isolated secret
local procedure StoreCompanyApiKey(ApiKey: SecretText)
begin
    IsolatedStorage.Set('BankApiKey', ApiKey, DataScope::Company);
end;

local procedure GetCompanyApiKey(): SecretText
var
    ApiKey: SecretText;
begin
    if not IsolatedStorage.Get('BankApiKey', DataScope::Company, ApiKey) then
        Error(ApiKeyNotConfiguredErr);
    exit(ApiKey);
end;

var
    ApiKeyNotConfiguredErr: Label 'The bank API key has not been configured for this company. Go to Bank Setup to configure it.';
```

### Background Job Company Context
```al
// BAD: Assumes current company is the correct one
codeunit 50100 "Payment Sync Job"
{
    trigger OnRun()
    var
        PaymentEntry: Record "CTS-CB Payment Entry";
    begin
        // This runs in whatever company the Job Queue entry was created in
        // If copied between companies, it processes wrong data
        PaymentEntry.SetRange(Status, PaymentEntry.Status::Pending);
        if PaymentEntry.FindSet() then
            ProcessPendingPayments(PaymentEntry);
    end;
}

// GOOD: Explicit company context validation
codeunit 50100 "Payment Sync Job"
{
    trigger OnRun()
    var
        BankSetup: Record "CTS-CB Bank Setup";
        PaymentEntry: Record "CTS-CB Payment Entry";
    begin
        // Validate that this company has bank setup configured
        if not BankSetup.Get() then
            exit;
        if not BankSetup."Enable Payment Sync" then
            exit;

        PaymentEntry.SetRange(Status, PaymentEntry.Status::Pending);
        if PaymentEntry.FindSet() then
            ProcessPendingPayments(PaymentEntry);
    end;
}
```

### Cross-Company Data Access
```al
// BAD: Accessing another company's data without explicit ChangeCompany
local procedure GetOtherCompanyBalance(): Decimal
var
    BankAccount: Record "Bank Account";
begin
    // This reads the CURRENT company's data, not the target company
    BankAccount.Get('BANK-001');
    exit(BankAccount.Balance);
end;

// GOOD: Explicit ChangeCompany with clear scoping
local procedure GetOtherCompanyBalance(TargetCompanyName: Text): Decimal
var
    BankAccount: Record "Bank Account";
begin
    BankAccount.ChangeCompany(TargetCompanyName);
    BankAccount.SetLoadFields(Balance);
    if not BankAccount.Get('BANK-001') then
        exit(0);
    BankAccount.CalcFields(Balance);
    exit(BankAccount.Balance);
end;
```

---

## Quick Validation Checklist

After code changes, verify:

- [ ] No secrets (API keys, passwords, tokens) in string literals or plaintext table fields
- [ ] All credentials stored via `IsolatedStorage` with appropriate `DataScope`
- [ ] Secret values never appear in telemetry dimensions, error messages, or Message() calls
- [ ] Codeunits with database writes declare explicit `Permissions = tabledata` property
- [ ] New tables are added to PermissionSet extensions (Admin RIMD, Edit RIMD, Read R)
- [ ] `Access = Public` objects do not expose destructive internal operations
- [ ] Telemetry uses record identifiers (No., Entry No.), not PII (names, emails, account numbers)
- [ ] Sensitive identifiers are masked when they must appear in telemetry
- [ ] Error messages use localized labels with business-friendly text, not internal details
- [ ] `GetLastErrorText()` goes to telemetry, not to `Error()` or `Message()`
- [ ] `SetFilter` with user input uses `'%1'` parameter substitution or `SetRange` for exact match
- [ ] URLs from user input validate `https://` scheme before use
- [ ] JSON/XML from external sources validates structure before accessing properties
- [ ] State-changing operations validate current record state before transition
- [ ] Check-then-modify patterns use `ReadIsolation::UpdLock` to prevent race conditions
- [ ] Financial calculations use Decimal, not Integer
- [ ] `IsolatedStorage` scope matches data visibility (Company for per-company, User for per-user)
- [ ] Background jobs validate company context and do not assume the current company
- [ ] Cross-company data access uses explicit `ChangeCompany`

---

## References

- [IsolatedStorage (Microsoft)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/isolatedstorage/isolatedstorage-data-type)
- [SecretText Data Type (Microsoft)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/secrettext/secrettext-data-type)
- [PermissionSet Object (Microsoft)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-permissionset-object)
- [Telemetry Best Practices (Microsoft)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/telemetry-overview)
- [SetFilter Method (Microsoft)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/record/record-setfilter-method)
- [ReadIsolation Property (Microsoft)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/record/record-readisolation-method)
- [DataScope Option (Microsoft)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/isolatedstorage/isolatedstorage-set-string-secrettext-datascope-method)
- [GDPR and Business Central (Microsoft)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/security/customer-data)
