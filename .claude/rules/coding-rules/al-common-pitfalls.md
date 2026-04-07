---
paths: "**/*.al"
---

# AL Common Pitfalls

Recurring mistakes that cause compilation errors or runtime bugs. Check these before presenting code.

---

## Pitfall 1: DateTime Literals

Use `0DT` for DateTime comparisons, **never** `0D`. `0D` is a Date literal and will cause a type mismatch.

```al
// BAD: Type mismatch - 0D is Date, not DateTime
if Rec."Last Modified DateTime" = 0D then

// GOOD: 0DT is DateTime
if Rec."Last Modified DateTime" = 0DT then
```

---

## Pitfall 2: String Methods on Code Types

`Code[N]` does not support all `Text` methods. `StartsWith`, `EndsWith`, `Contains` do **not** exist on `Code` types.

```al
// BAD: StartsWith doesn't exist on Code[20]
if PaymentMethod.Code.StartsWith('SEPA') then

// GOOD: Use CopyStr or StrPos
if CopyStr(PaymentMethod.Code, 1, 4) = 'SEPA' then
```

---

## Pitfall 3: Use `this` Instead of Redundant Local Variables

When a codeunit needs to call its own procedures, use `this` — do not create a local variable of the same codeunit type.

```al
// BAD: Redundant local variable
var
    MyMgt: Codeunit "CTS-CB My Mgt.";
begin
    MyMgt.DoSomething();
end;

// GOOD: Use this
begin
    this.DoSomething();
end;
```

---

## Pitfall 4: File Stream Handling (TempBlob Pattern)

When reading uploaded file content, always use the TempBlob intermediary. `InStream.Read(Text)` on raw upload streams produces empty content.

```al
// BAD: Direct InStream.Read on upload stream
InStream.Read(FileContent);

// GOOD: Use TempBlob intermediary
TempBlob.CreateInStream(InStream);
InStream.Read(FileContent);
// Or use TempBlob.CreateOutStream for writing
```

---

## Pitfall 5: Upgrade Code Placement

Place upgrade codeunits in the app that **owns the table** being upgraded. Do not put upgrade code for base-application tables in psp, export, or other dependent apps.

Before creating upgrade code, check existing upgrade codeunits to confirm the correct app location.

---

## Pitfall 6: Existing Patterns Before New Code

When implementing a pattern that likely exists elsewhere in the codebase (interfaces, factories, upgrade procedures, wizard steps, etc.), **find and reference an existing implementation first**. Use it as a template to match the project's established conventions.

This prevents wrong-approach iterations where code is written in the wrong style, wrong app, or wrong structure.

---

## Pitfall 7: Record.Get Must Match Full Primary Key

`Record.Get()` requires **all** primary key fields in the correct order. Passing fewer fields than the PK causes a silent failure (returns `false`) or a runtime error — not a compile error. This is especially dangerous with composite keys where the first field alone looks correct.

Before writing `.Get(value)`, check the table's primary key definition with `documentSymbol` or by reading the table's `keys` section.

```al
// BAD: CTS-CB Payment Method has PK (Code, "Sender Country", "Recipient Country")
// Get with only Code silently fails — returns false, no compile error
CTSCBPaymentMethod.Get(PaymentMethodCode);

// GOOD: Pass all PK fields
CTSCBPaymentMethod.Get(PaymentMethodCode, SenderCountry, RecipientCountry);

// GOOD: When you only know one PK field, use SetRange + FindFirst
CTSCBPaymentMethod.SetLoadFields("Payment Method Code");
CTSCBPaymentMethod.SetRange(Code, PaymentMethodCode);
if CTSCBPaymentMethod.FindFirst() then
    // ...
```

---

## Quick Checklist

- [ ] DateTime comparisons use `0DT`, not `0D`
- [ ] No `StartsWith`/`EndsWith`/`Contains` on `Code[N]` variables
- [ ] Self-referencing uses `this`, not a redundant local variable
- [ ] File streams use TempBlob intermediary pattern
- [ ] Upgrade code is in the app that owns the affected table
- [ ] Checked for existing similar implementations before writing new code
- [ ] Every `Record.Get()` call passes all primary key fields (check table definition first)
