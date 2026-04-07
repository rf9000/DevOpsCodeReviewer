---
paths: "**/*.al"
---

# AL Integration Patterns

Patterns for event-driven extensibility, API pages, HTTP communication, background tasks, and external service resilience in AL.

---

## Pattern 1: Event Publisher/Subscriber Patterns

**Rule:** Integration events must include sufficient parameters for subscribers to make decisions without re-querying.

**Rule:** Publishers must not modify state after raising the event (publisher isolation). The event is a notification, not a delegation.

**Rule:** Subscribers must not assume execution order or modify shared state that other subscribers depend on (subscriber independence).

**Rule:** Use the IsHandled pattern for extensibility events: publisher checks `var IsHandled: Boolean` and skips default behavior when handled.

### Why This Matters
- Events with insufficient parameters force subscribers to re-read the database, causing extra SQL round-trips and potential dirty-read issues
- Publishers that modify state after raising an event can silently override subscriber changes, making extension behavior unpredictable
- Subscribers that depend on execution order or mutate shared state create hidden coupling that breaks when new subscribers are added
- The IsHandled pattern is the standard BC extensibility mechanism allowing partners to replace default behavior cleanly

### Good Code

```al
// GOOD: Event passes the full record and relevant context so subscribers never re-query
[IntegrationEvent(false, false)]
local procedure OnBeforeValidatePayment(var PaymentLine: Record "CTS-CB Payment Line"; CurrencyCode: Code[10]; PostingDate: Date; var IsHandled: Boolean)
begin
end;

procedure ValidatePayment(var PaymentLine: Record "CTS-CB Payment Line")
var
    IsHandled: Boolean;
begin
    OnBeforeValidatePayment(PaymentLine, PaymentLine."Currency Code", PaymentLine."Posting Date", IsHandled);
    if IsHandled then
        exit;

    // Default validation — publisher does NOT touch PaymentLine after the event
    if PaymentLine.Amount = 0 then
        Error(AmountMustNotBeZeroErr);
end;
```

### Bad Code

```al
// BAD: Event only passes the primary key — subscribers must re-query to inspect fields
[IntegrationEvent(false, false)]
local procedure OnBeforeValidatePayment(PaymentLineNo: Integer)
begin
end;

// BAD: Publisher modifies the record AFTER raising the event, overriding subscriber changes
procedure ValidatePayment(var PaymentLine: Record "CTS-CB Payment Line")
begin
    OnBeforeValidatePayment(PaymentLine."Line No.");
    PaymentLine.Status := PaymentLine.Status::Validated; // overwrites subscriber's status change
end;

// BAD: No IsHandled pattern — subscribers cannot replace default behavior
[IntegrationEvent(false, false)]
local procedure OnBeforeValidatePayment(var PaymentLine: Record "CTS-CB Payment Line")
begin
end;
```

---

## Pattern 2: API Page Design

**Rule:** API pages must define `EntityName` and `EntitySetName` properties.

**Rule:** Sensitive fields (credentials, internal IDs, PII) must NOT be exposed on API pages.

**Rule:** API pages must set `ODataKeyFields` matching the primary key.

**Rule:** Breaking changes to API pages (removing fields, changing types) require a new API version.

### Why This Matters
- Missing `EntityName`/`EntitySetName` causes OData endpoints to use auto-generated names that are unstable and break integrations on recompile
- Exposing credentials or PII on API pages creates security vulnerabilities that can be exploited by any user with API access
- Incorrect or missing `ODataKeyFields` prevents OData clients from reliably addressing individual entities
- Removing or changing fields on a published API page breaks all consumers; a new version preserves backward compatibility

### Good Code

```al
// GOOD: Proper API page with all required properties and no sensitive fields
page 71553600 "CTS-CB Bank Account API"
{
    APIGroup = 'continiaBanking';
    APIPublisher = 'continia';
    APIVersion = 'v2.0';
    Caption = 'Bank Account';
    DelayedInsert = true;
    EntityName = 'bankAccount';
    EntitySetName = 'bankAccounts';
    ODataKeyFields = SystemId;
    PageType = API;
    SourceTable = "CTS-CB Bank Account";

    layout
    {
        area(Content)
        {
            field(id; Rec.SystemId)
            {
                Caption = 'Id';
            }
            field(bankAccountNo; Rec."No.")
            {
                Caption = 'Bank Account No.';
            }
            field(name; Rec.Name)
            {
                Caption = 'Name';
            }
            field(iban; Rec.IBAN)
            {
                Caption = 'IBAN';
            }
            // Sensitive fields like "API Key", "Password", "Client Secret" are NOT exposed
        }
    }
}
```

### Bad Code

```al
// BAD: Missing EntityName, EntitySetName, ODataKeyFields — endpoint name is unstable
page 71553601 "CTS-CB Bank Account API v2"
{
    APIGroup = 'continiaBanking';
    APIPublisher = 'continia';
    APIVersion = 'v2.0';
    Caption = 'Bank Account';
    PageType = API;
    SourceTable = "CTS-CB Bank Account";

    layout
    {
        area(Content)
        {
            field(bankAccountNo; Rec."No.")
            {
                Caption = 'Bank Account No.';
            }
            // BAD: Exposing credentials on API page
            field(apiKey; Rec."API Key")
            {
                Caption = 'API Key';
            }
            field(clientSecret; Rec."Client Secret")
            {
                Caption = 'Client Secret';
            }
        }
    }
}
```

---

## Pattern 3: HttpClient Usage

**Rule:** All HTTP calls must go through an `IHttpFactory` interface (or equivalent factory pattern) to enable testability and consistent error handling.

**Rule:** HTTP responses must check `IsSuccessStatusCode()` before processing the response body. Non-success responses must be logged and handled.

**Rule:** HTTP error responses must be logged with request context (URL, method, status code) but NEVER with credentials, tokens, or request bodies containing secrets.

**Rule:** Authentication tokens must be validated/refreshed before HTTP calls to avoid unnecessary failed requests.

### Why This Matters
- Direct `HttpClient` usage makes code untestable because you cannot inject a fake HTTP layer; the factory pattern allows substituting a mock in tests
- Processing a response body without checking the status code leads to cryptic JSON parse errors instead of clear HTTP failure messages
- Logging authorization headers or token values in error telemetry creates a security incident — status codes and URLs are sufficient for diagnostics
- Sending requests with expired tokens wastes a round-trip and triggers unnecessary retry logic

### Good Code

```al
// GOOD: Factory-based HTTP with status check and safe logging
procedure SendPayment(var PaymentHeader: Record "CTS-CB Payment Header"; HttpFactory: Interface "CTS-CB IHttpFactory"): Boolean
var
    HttpClient: HttpClient;
    HttpRequestMessage: HttpRequestMessage;
    HttpResponseMessage: HttpResponseMessage;
begin
    EnsureTokenIsValid(PaymentHeader);

    HttpClient := HttpFactory.CreateHttpClient();
    PrepareRequest(HttpRequestMessage, PaymentHeader);

    if not HttpClient.Send(HttpRequestMessage, HttpResponseMessage) then begin
        LogHttpError(PaymentHeader."No.", HttpRequestMessage.Method(), GetRequestUrl(HttpRequestMessage), 0);
        exit(false);
    end;

    if not HttpResponseMessage.IsSuccessStatusCode() then begin
        LogHttpError(
            PaymentHeader."No.",
            HttpRequestMessage.Method(),
            GetRequestUrl(HttpRequestMessage),
            HttpResponseMessage.HttpStatusCode());
        exit(false);
    end;

    ProcessResponse(PaymentHeader, HttpResponseMessage);
    exit(true);
end;

// GOOD: Log context without secrets
local procedure LogHttpError(documentNo: Code[20]; httpMethod: Text; requestUrl: Text; statusCode: Integer)
begin
    Session.LogMessage(
        'CTSHTTP001',
        StrSubstNo(HttpErrorTelemetryTxt, documentNo, httpMethod, requestUrl, statusCode),
        Verbosity::Error,
        DataClassification::SystemMetadata,
        TelemetryScope::ExtensionPublisher,
        'Category', 'BankCommunication');
end;
```

### Bad Code

```al
// BAD: Direct HttpClient, no factory, no status check, logs auth header
procedure SendPayment(var PaymentHeader: Record "CTS-CB Payment Header"): Boolean
var
    HttpClient: HttpClient;
    HttpRequestMessage: HttpRequestMessage;
    HttpResponseMessage: HttpResponseMessage;
    ResponseText: Text;
    Headers: HttpHeaders;
begin
    // No token validation before sending
    HttpClient.Send(HttpRequestMessage, HttpResponseMessage);

    // BAD: Reading body without checking status — will fail with cryptic error on 401/500
    HttpResponseMessage.Content().ReadAs(ResponseText);
    ProcessResponseText(ResponseText);

    // BAD: Logging the Authorization header value
    HttpRequestMessage.GetHeaders(Headers);
    Message('Auth: %1, Response: %2', Headers.GetValues('Authorization'), ResponseText);
    exit(true);
end;
```

---

## Pattern 4: Background Task Patterns

**Rule:** Job Queue codeunits must be idempotent — re-running the same job must not duplicate data or produce different results.

**Rule:** Job Queue error handling must set a meaningful error status and message, not silently swallow failures.

**Rule:** Long-running Job Queue entries must use `Commit()` at safe checkpoints to prevent transaction timeout and enable partial progress.

### Why This Matters
- Job Queue entries can be re-run after transient failures (network timeout, service restart); non-idempotent jobs create duplicate records or double-process transactions
- Swallowed errors leave the system in an unknown state — operators cannot diagnose failures and users see stale data without explanation
- A single transaction processing thousands of records will hit the 10-minute SQL timeout; checkpoint commits keep the transaction size manageable and allow the job to resume from the last checkpoint

### Good Code

```al
// GOOD: Idempotent job with checkpoint commits and meaningful error handling
procedure ProcessPendingStatements(var BankAccount: Record "CTS-CB Bank Account")
var
    BankStatement: Record "CTS-CB Bank Statement";
    ProcessedCount: Integer;
begin
    BankStatement.SetRange("Bank Account No.", BankAccount."No.");
    BankStatement.SetRange(Status, BankStatement.Status::Pending);
    BankStatement.SetLoadFields("Entry No.", Status, "Bank Account No.");
    if not BankStatement.FindSet() then
        exit;

    repeat
        // Idempotent: only process Pending records, skip already-processed
        if BankStatement.Status = BankStatement.Status::Pending then begin
            if not TryProcessStatement(BankStatement) then begin
                BankStatement.Status := BankStatement.Status::Error;
                BankStatement."Error Message" := CopyStr(GetLastErrorText(), 1, MaxStrLen(BankStatement."Error Message"));
                BankStatement.Modify();
            end;

            ProcessedCount += 1;
            // Checkpoint commit every 100 records to avoid transaction timeout
            if ProcessedCount mod 100 = 0 then
                Commit();
        end;
    until BankStatement.Next() = 0;
end;
```

### Bad Code

```al
// BAD: Not idempotent, no error handling, no checkpoint commits
procedure ProcessPendingStatements(var BankAccount: Record "CTS-CB Bank Account")
var
    BankStatement: Record "CTS-CB Bank Statement";
    NewLedgerEntry: Record "CTS-CB Bank Ledger Entry";
begin
    BankStatement.SetRange("Bank Account No.", BankAccount."No.");
    if BankStatement.FindSet() then
        repeat
            // BAD: Inserts unconditionally — re-run creates duplicates
            NewLedgerEntry.Init();
            NewLedgerEntry."Statement No." := BankStatement."No.";
            NewLedgerEntry.Amount := BankStatement.Amount;
            NewLedgerEntry.Insert();

            BankStatement.Status := BankStatement.Status::Processed;
            BankStatement.Modify();
            // BAD: No Commit() — 10,000 records in one transaction will timeout
        until BankStatement.Next() = 0;
    // BAD: Any error aborts the entire batch with no status or message
end;
```

---

## Pattern 5: External Service Resilience

**Rule:** External API calls should include retry logic for transient failures (HTTP 429 Too Many Requests, 503 Service Unavailable). Use exponential backoff or honor Retry-After headers.

**Rule:** Failed external calls must not block the user synchronously. Offer async retry via Job Queue or notify the user to retry later.

**Rule:** External service failures should be isolated — failure in one bank integration must not affect another bank or the core system.

### Why This Matters
- Transient failures (rate limits, temporary outages) resolve themselves within seconds; retrying with backoff avoids unnecessary manual intervention
- Blocking the UI on a failed external call freezes the user's session and provides no recovery path; async retry allows the system to recover without user involvement
- A shared error state or catch-all error handler that marks all integrations as failed turns a single-bank outage into a system-wide outage

### Good Code

```al
// GOOD: Retry with backoff for transient errors, isolated per bank
procedure SendWithRetry(var PaymentHeader: Record "CTS-CB Payment Header"; HttpFactory: Interface "CTS-CB IHttpFactory"): Boolean
var
    HttpClient: HttpClient;
    HttpRequestMessage: HttpRequestMessage;
    HttpResponseMessage: HttpResponseMessage;
    RetryCount: Integer;
    MaxRetries: Integer;
    StatusCode: Integer;
begin
    MaxRetries := 3;
    HttpClient := HttpFactory.CreateHttpClient();

    for RetryCount := 0 to MaxRetries do begin
        PrepareRequest(HttpRequestMessage, PaymentHeader);
        if not HttpClient.Send(HttpRequestMessage, HttpResponseMessage) then begin
            if RetryCount = MaxRetries then
                exit(false);
            Sleep(Power(2, RetryCount) * 1000); // Exponential backoff: 1s, 2s, 4s
        end else begin
            StatusCode := HttpResponseMessage.HttpStatusCode();
            if HttpResponseMessage.IsSuccessStatusCode() then
                exit(true);

            // Retry only on transient errors
            if not (StatusCode in [429, 503]) then
                exit(false);

            if RetryCount = MaxRetries then
                exit(false);
            Sleep(Power(2, RetryCount) * 1000);
        end;
    end;

    exit(false);
end;

// GOOD: Async fallback when synchronous send fails
procedure HandleSendFailure(var PaymentHeader: Record "CTS-CB Payment Header")
var
    JobQueueEntry: Record "Job Queue Entry";
begin
    PaymentHeader.Status := PaymentHeader.Status::"Pending Retry";
    PaymentHeader."Error Message" := CopyStr(GetLastErrorText(), 1, MaxStrLen(PaymentHeader."Error Message"));
    PaymentHeader.Modify();

    ScheduleRetryJob(PaymentHeader, JobQueueEntry);
    Message(PaymentScheduledForRetryMsg, PaymentHeader."No.");
end;

// GOOD: Isolated error handling per bank — one bank's failure does not affect others
procedure ProcessAllBanks()
var
    BankAccount: Record "CTS-CB Bank Account";
begin
    BankAccount.SetLoadFields("No.", Name, "Bank System Code");
    if BankAccount.FindSet() then
        repeat
            // Each bank is processed independently; failure is contained
            if not TryProcessBank(BankAccount) then
                LogBankError(BankAccount."No.", GetLastErrorText());
        until BankAccount.Next() = 0;
end;
```

### Bad Code

```al
// BAD: No retry, blocks user on failure, shared error state across banks
procedure SendPaymentAndWait(var PaymentHeader: Record "CTS-CB Payment Header")
var
    HttpClient: HttpClient;
    HttpRequestMessage: HttpRequestMessage;
    HttpResponseMessage: HttpResponseMessage;
begin
    // BAD: Single attempt — transient 429/503 fails permanently
    HttpClient.Send(HttpRequestMessage, HttpResponseMessage);
    if not HttpResponseMessage.IsSuccessStatusCode() then
        // BAD: Blocking error shown to user with no async recovery path
        Error(ExternalServiceFailedErr);
end;

// BAD: One bank failure aborts all banks
procedure ProcessAllBanks()
var
    BankAccount: Record "CTS-CB Bank Account";
begin
    if BankAccount.FindSet() then
        repeat
            ProcessBank(BankAccount); // Unhandled error here stops the entire loop
        until BankAccount.Next() = 0;
end;
```

---

## Quick Validation Checklist

- [ ] Integration events pass the full record (var) and relevant context fields, not just primary keys
- [ ] Publishers do not modify shared state after raising events
- [ ] Extensibility events use the IsHandled pattern (`var IsHandled: Boolean`)
- [ ] API pages define `EntityName`, `EntitySetName`, and `ODataKeyFields`
- [ ] API pages do not expose credentials, secrets, or PII fields
- [ ] API page changes are versioned — no breaking changes to published endpoints
- [ ] HTTP calls go through a factory interface, not direct `HttpClient`
- [ ] HTTP responses check `IsSuccessStatusCode()` before processing the body
- [ ] HTTP error logging includes URL and status code but never auth tokens or secrets
- [ ] Job Queue codeunits are idempotent — safe to re-run without duplicating data
- [ ] Job Queue failures set a meaningful error status and message
- [ ] Long-running jobs use checkpoint `Commit()` to avoid transaction timeout
- [ ] External API calls include retry logic for transient failures (429, 503)
- [ ] Failed external calls offer async retry, not synchronous blocking errors
- [ ] External service failures are isolated per integration — one failure does not cascade
