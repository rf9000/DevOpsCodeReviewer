---
paths: "**/*.al"
---

# AL Error Handling Patterns

---

## TryFunction Best Practices

### Critical Rule: NO Database Writes in TryFunction

**NEVER perform database write operations (Insert, Modify, Delete) inside TryFunction methods.**

### Why TryFunction is Problematic for Database Operations

- **SaaS vs On-Premise Inconsistency**: SaaS allows writes but they're dangerous; On-premise typically blocks them
- **Transaction Integrity**: Failed TryFunction calls may leave partial data changes
- **Unpredictable Behavior**: Data corruption can occur when errors are "handled" but writes persist

---

## When to Use TryFunction

### Good Use: Validation Without Database Writes

```al
[TryFunction]
local procedure TryValidateUrl(Url: Text): Boolean
var
    Uri: Codeunit Uri;
begin
    Uri.Init(Url);
    if Uri.GetScheme() <> 'https' then
        Error('URL must use HTTPS');
    exit(true);
end;

// Usage
if TryValidateUrl(MyUrl) then
    ProcessUrl(MyUrl)
else
    Message('Invalid URL: %1', GetLastErrorText());
```

### Good Use: HTTP Operations That Might Fail

```al
[TryFunction]
local procedure TryDownloadFile(Url: Text; var FileContent: Text): Boolean
var
    HttpClient: HttpClient;
    HttpResponse: HttpResponseMessage;
begin
    if not HttpClient.Get(Url, HttpResponse) then
        exit(false);
    if not HttpResponse.IsSuccessStatusCode() then
        exit(false);
    HttpResponse.Content.ReadAs(FileContent);
    exit(true);
end;
```

### Good Use: JSON Parsing

```al
[TryFunction]
local procedure TryParseJsonResponse(JsonText: Text; var JsonObject: JsonObject): Boolean
begin
    if not JsonObject.ReadFrom(JsonText) then
        Error('Invalid JSON format');
    exit(true);
end;
```

### Good Use: Bank Authentication

```al
[TryFunction]
local procedure TryAuthenticateWithBank(var AuthToken: Text): Boolean
var
    HttpClient: HttpClient;
    HttpResponse: HttpResponseMessage;
begin
    if not HttpClient.Post(AuthUrl, HttpContent, HttpResponse) then
        exit(false);
    if not HttpResponse.IsSuccessStatusCode() then
        exit(false);
    // Extract token from response
    exit(true);
end;
```

---

## When NOT to Use TryFunction

### Bad: Database Writes in TryFunction

```al
// BAD: Database writes in TryFunction
[TryFunction]
local procedure TryCreateBankAccount(BankAccount: Record "CTS-CB Bank Account"): Boolean
begin
    BankAccount.Insert(); // DANGEROUS! This might persist even if error occurs later
    BankAccount.Validate(Name);
    exit(true);
end;

// BAD: Complex business logic with multiple database operations
[TryFunction]
local procedure TryProcessPaymentFile(): Boolean
var
    FileArchive: Record "CTS-CB File Archive";
    PaymentHeader: Record "CTS-CB Payment Header";
begin
    FileArchive.Get(); // Read is OK
    PaymentHeader.Init();
    PaymentHeader.Insert(); // DANGEROUS! Avoid writes
    exit(true);
end;
```

---

## Better Alternatives to TryFunction with Database Operations

### Pattern 1: Separate Validation from Write Operations

```al
// GOOD: Validate first, then write
local procedure ProcessBankAccount(var BankAccount: Record "CTS-CB Bank Account")
begin
    if not TryValidateBankAccount(BankAccount) then begin
        Message('Validation failed: %1', GetLastErrorText());
        exit;
    end;

    // Safe to write after validation passed
    BankAccount.Insert();
    BankAccount.Validate(Name);
end;

[TryFunction]
local procedure TryValidateBankAccount(BankAccount: Record "CTS-CB Bank Account"): Boolean
begin
    if BankAccount."Account No." = '' then
        Error('Account number is required');
    if StrLen(BankAccount."Account No.") < 5 then
        Error('Account number must be at least 5 characters');
    exit(true);
end;
```

### Pattern 2: Use Standard AL Error Handling

```al
// GOOD: Let AL handle errors naturally with proper user messages
local procedure CreatePaymentFile(var FileArchive: Record "CTS-CB File Archive")
begin
    FileArchive.TestField("File Name");
    FileArchive.TestField(Type);

    if FileArchive.FileName = '' then
        Error('File name cannot be empty');

    FileArchive.Insert(true);
    Commit(); // Explicit transaction control
end;
```

---

## Error Message Handling

```al
// Get error details from TryFunction
if not TryOperation() then begin
    ErrorText := GetLastErrorText();
    // Log error for troubleshooting
    LogError('Operation failed', ErrorText);
    // Show user-friendly message
    Message('The operation could not be completed. Please try again.');
end;
```

---

## Testing TryFunction Methods

```al
// Test both success and failure paths
procedure TestTryValidateUrl()
var
    ValidUrl: Text;
    InvalidUrl: Text;
begin
    ValidUrl := 'https://continia.com';
    InvalidUrl := 'http://unsecure.com';

    Assert.IsTrue(TryValidateUrl(ValidUrl), 'Valid HTTPS URL should pass');
    Assert.IsFalse(TryValidateUrl(InvalidUrl), 'HTTP URL should fail');
end;
```

---

## Quick Validation Checklist

- [ ] **Use TryFunction for validation, parsing, and external operations**
- [ ] **NEVER use TryFunction for database write operations**
- [ ] **Separate validation from data persistence**
- [ ] **Prefer standard AL error handling for business logic**
- [ ] **Always test both success and failure paths**

---

## References

- [TryFunction Attribute - Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/attributes/devenv-tryfunction-attribute)
- [Handling Errors Using Try Methods - Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-handling-errors-using-try-methods)
- [TryFunction Warnings - Community Blog](https://demiliani.com/2023/02/08/dynamics-365-business-central-and-tryfunctions-be-careful/)
