---
paths: "**/*.al"
---

# AL Design for Testability

Design production code so that components with external dependencies can be tested in isolation — but only where the cost of abstraction is justified.

---

## The Core Principle

**Extract an interface when a dependency makes tests slow, brittle, or non-deterministic. Don't extract when a simple `Record.Insert()` in a test is sufficient setup.**

Interfaces add indirection and complexity. Only pay that cost when the testing or extensibility benefit is clear. Most code in the codebase should use direct Record access and Codeunit calls — interfaces are reserved for specific boundary situations.

---

## When to Extract an Interface

Extract an interface when the dependency has **at least one** of these characteristics:

| Characteristic | Why It Warrants Extraction | Example |
|---|---|---|
| **External I/O** | Can't run in tests without real endpoints | HTTP calls, file system, external APIs |
| **Multiple implementations** | Different behavior needed per context | Bank-specific auth (OAuth vs certificate vs SFTP) |
| **Non-deterministic behavior** | Makes tests flaky | CurrentDateTime, random values, external service responses |
| **Expensive setup** | Slows tests significantly | Deep dependency chains requiring 4+ tables of setup |
| **Cross-cutting concern** | Used across 5+ unrelated procedures | Logging, telemetry, authentication |

### Real Examples from Our Codebase

```al
// GOOD EXTRACTION: HTTP communication — can't test without real endpoints
procedure EstablishConnection(Bank: Record "CTS-CB Bank"; BankSystemCode: Code[30];
    RequestValues: Dictionary of [Text, Text]; var IHttpFactory: Interface "CTS-CB IHttpFactory")

// GOOD EXTRACTION: Authentication — multiple strategies per bank
procedure GetAuthenticationEntry(AuthenticationFactory: Interface "CTS-CB IAuthentication Factory")

// GOOD EXTRACTION: Email validation — different providers possible
procedure IsEmailValid(ParamEmail: Text; IEmailHelper: Interface "CTS-CB IEmail Helper")
```

---

## When NOT to Extract an Interface

Do **not** extract an interface when:

| Situation | Why Extraction Hurts | What to Do Instead |
|---|---|---|
| **Single-table CRUD** | Adds indirection with zero benefit | Use direct Record access |
| **Internal helper procedures** | Over-abstracts implementation details | Keep as private/local procedure |
| **Simple lookups** | One `Record.Insert()` sets up the test | Direct `Record.Get()` / `FindFirst()` |
| **Permission isolation** | Interfaces don't solve this | Use `TableNo`, `Permissions` property, or background sessions |
| **One implementation forever** | Interface with one implementer is noise | Direct Codeunit call |
| **Setup table reads** | Small single-record tables, trivial to set up | Direct Record access |

### Real Examples from Our Codebase

```al
// CORRECT: Direct Record access — simple lookup, one implementation
procedure GetCommunicationType(BankSystemCode: Code[30]): Enum "CTS-CB Communication Type"
var
    BankSystem: Record "CTS-CB Bank System";
begin
    if BankSystem.Get(BankSystemCode) then
        exit(BankSystem."Communication Type");
end;

// CORRECT: Direct CRUD — internal detail, no variation needed
local procedure InsertBankFileCheckList(BankFileList: Record "CTS-CB Bank File List"): Boolean
var
    BankFileCheckList: Record "CTS-CB Bank File Check List";
begin
    BankFileCheckList.TransferFields(BankFileList);
    if not BankFileCheckList.Get(BankFileList.FileReference) then
        if BankFileCheckList.Insert(false) then
            Commit();
end;

// CORRECT: Permission isolation via codeunit properties, not interface
codeunit 72282333 "CTS-CB ModifyBank"
{
    Access = Internal;
    Permissions = tabledata "CTS-CB Bank" = RM;
    TableNo = "CTS-CB Bank";
}
```

---

## The Decision Flowchart

Ask these questions in order. Stop at the first "No":

1. **Does this dependency cross an external boundary?** (HTTP, file I/O, external API, secure storage)
   - Yes → Extract interface
   - No → Continue

2. **Do multiple implementations exist or are concretely planned?** (Not hypothetical future needs)
   - Yes → Extract interface
   - No → Continue

3. **Does testing this require setting up 4+ tables of unrelated data?**
   - Yes → Consider extracting the expensive dependency
   - No → Continue

4. **Is this a cross-cutting concern used in 5+ unrelated places?**
   - Yes → Consider extracting interface
   - No → **Don't extract. Use direct access.**

**When in doubt, don't extract.** You can always introduce an interface later using the backward-compatible overload pattern (see below). Premature abstraction is harder to undo than missing abstraction is to add.

---

## Pattern: Backward-Compatible Overload

When introducing an interface parameter to an existing procedure, preserve the original signature to avoid breaking callers:

```al
// Step 1: New overload accepts the interface — contains the business logic
procedure Convert(FromAmount: Decimal; FromCurrency: Code[10]; ToCurrency: Code[10];
    Converter: Interface ICurrencyConverter): Decimal
begin
    exit(Converter.Convert(WorkDate(), FromCurrency, ToCurrency, FromAmount));
end;

// Step 2: Original signature delegates with default implementation — no breaking change
procedure Convert(FromAmount: Decimal; FromCurrency: Code[10]; ToCurrency: Code[10]): Decimal
var
    BCConverter: Codeunit "BC Currency Converter";
begin
    exit(Convert(FromAmount, FromCurrency, ToCurrency, BCConverter));
end;
```

**Rules:**
- The original signature always creates the default (production) implementation and delegates
- The new overload contains the actual logic
- Callers choose: simple call (original) or testable call (new overload with injected dependency)
- Apply incrementally — one dependency at a time, not a big-bang rewrite

---

## Pattern: Interface Parameter Passing

Pass interfaces through the call chain only where they're used. Don't thread them through unrelated procedures.

```al
// GOOD: IHttpFactory passed to procedures that need HTTP
procedure ImportTransactions(Bank: Record "CTS-CB Bank";
    var IHttpFactory: Interface "CTS-CB IHttpFactory")
begin
    SendRequest(Bank, IHttpFactory);        // needs HTTP
    HandleResponse(Bank, IHttpFactory);     // needs HTTP
end;

// BAD: IHttpFactory passed to procedures that don't use HTTP
procedure ValidatePayment(Payment: Record "CTS-CB Payment";
    var IHttpFactory: Interface "CTS-CB IHttpFactory")  // Why? This just validates fields
begin
    Payment.TestField(Amount);
    Payment.TestField("Bank Account No.");
end;
```

**Rule:** Only add interface parameters to procedures that actually call methods on the interface. Don't pass them "just in case" or for consistency.

---

## Anti-Patterns to Avoid

### 1. Interface for a Single Table Operation

```al
// BAD: Over-engineering a simple record lookup
interface IPermissionChecker
{
    procedure CanConvert(FromCurrency: Code[20]; ToCurrency: Code[20]; User: Text[50]): Boolean;
}

// ...when the only implementation is:
procedure CanConvert(...): Boolean
var
    Permission: Record "Demo Currency Exch. Permission";
begin
    Permission.SetRange("User ID", User);
    exit(not Permission.IsEmpty());
end;

// BETTER: Just use direct Record access. Test setup = one Permission.Insert().
```

**Exception:** If the permission check will have multiple sources (database AND Entra ID AND external API), then the interface IS warranted — but only when the second implementation actually exists or is being built.

### 2. Extracting Everything Because "It Might Change"

```al
// BAD: Interface for every dependency
procedure ProcessPayment(
    Payment: Record "CTS-CB Payment";
    Validator: Interface IPaymentValidator;      // Only one implementation
    Formatter: Interface IPaymentFormatter;      // Only one implementation
    Logger: Interface IPaymentLogger;            // Only one implementation
    Notifier: Interface IPaymentNotifier)        // Only one implementation
```

Four interfaces with one implementation each = four times the code for zero benefit. Extract only when a second implementation materializes.

### 3. Global Interface Variables Instead of Parameters

```al
// BAD: Stored as codeunit global — hidden dependency, hard to test
codeunit 50100 "Payment Processor"
{
    var
        HttpFactory: Interface "CTS-CB IHttpFactory";

    procedure SetHttpFactory(Factory: Interface "CTS-CB IHttpFactory")
    begin
        HttpFactory := Factory;
    end;

    procedure Process(Payment: Record "CTS-CB Payment")
    begin
        HttpFactory.GetHttp().Post(...);  // Where was HttpFactory set? Who knows.
    end;
}

// GOOD: Passed as parameter — explicit, traceable, testable
procedure Process(Payment: Record "CTS-CB Payment";
    var IHttpFactory: Interface "CTS-CB IHttpFactory")
begin
    IHttpFactory.GetHttp().Post(...);
end;
```

**Exception:** The IHttpFactory container itself uses internal state (the Get/Set pairs). This is acceptable for DI containers specifically — not for business logic codeunits.

---

## How This Relates to IHttpFactory

IHttpFactory is the canonical example of justified extraction in our codebase. It works because:

1. **External boundary**: HTTP calls can't run in tests
2. **Multiple implementations**: Each fake replaces a real external service
3. **Cross-cutting**: Used across imports, exports, authentication, file archiving
4. **DI container pattern**: One factory manages 18+ dependencies

This pattern should NOT be replicated for every feature. IHttpFactory exists because bank communication has uniquely complex dependency needs. Most business logic procedures need 0-2 interface parameters, not a factory.

---

## Quick Validation Checklist

When reviewing production code for testability:

- [ ] External I/O dependencies (HTTP, file, API) are injected via interface parameters
- [ ] No premature interfaces — each interface has or will imminently have 2+ implementations
- [ ] Backward-compatible overloads used when adding interface parameters to existing procedures
- [ ] Interfaces passed only to procedures that use them, not threaded through unrelated code
- [ ] Business logic procedures contain decisions, not infrastructure (no direct HTTP/file operations)
- [ ] Simple lookups and CRUD operations use direct Record access (no interface wrapping)
- [ ] Setup table reads use direct Record access (no interface wrapping)

---

## References

- [Testing in Isolation (Vjeko)](https://vjeko.com/2023/12/09/testing-in-isolation/) — Interface extraction, dependency injection, backward-compatible overloads
- [SOLID Principles](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-programming-in-al) — Dependency Inversion applies at external boundaries
- IHttpFactory implementation: `base-application/Communication/Decoupled HTTP/`
- IAuthentication implementation: `base-application/Authentication/`
