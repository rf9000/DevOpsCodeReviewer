---
paths: "**/*.al"
---

# AL Variable Naming Conventions

## Rule 1: Variable Names Must Match Object Names

Variables referencing AL objects must contain the object's name (abbreviated where necessary).

### Naming Requirements
- Start with a capital letter
- Use PascalCase for compound words
- Omit blanks, periods, parentheses, and special characters
- **Omit prefixes** (e.g., `CTS-CB`) from variable names - use the object name without the app-specific prefix
- Match the object name as closely as possible

### Bad Code
```al
var
    WIPBuffer: Record "Job WIP Buffer";
    Postline: Codeunit "Gen. Jnl.-Post Line";
    "Amount (LCY)": Decimal;
    Helper: Codeunit "Payment Field Mapper";
```

### Good Code
```al
var
    JobWIPBuffer: Record "Job WIP Buffer";
    GenJnlPostLine: Codeunit "Gen. Jnl.-Post Line";
    AmountLCY: Decimal;
    PaymentFieldMapper: Codeunit "Payment Field Mapper";
```

### Transformation Rules
| Object Name | Variable Name | Rule Applied |
|-------------|---------------|--------------|
| `"Job WIP Buffer"` | `JobWIPBuffer` | Remove spaces |
| `"Gen. Jnl.-Post Line"` | `GenJnlPostLine` | Remove periods, hyphens |
| `"Amount (LCY)"` | `AmountLCY` | Remove parentheses, spaces |
| `"Sales Header"` | `SalesHeader` | Remove space |
| `"CTS-CB Payment Field Mapper"` | `PaymentFieldMapper` | Omit prefix, remove spaces |

---

## Rule 2: Variable Declaration Order

Declare variables by type, with complex/object types first, followed by simple types.

### Correct Order (top to bottom)
1. Record
2. Report
3. Codeunit
4. XmlPort
5. Page
6. Query
7. Notification
8. BigText
9. DateFormula
10. RecordId
11. RecordRef
12. FieldRef
13. FilterPageBuilder
14. *(then simple types: Text, Code, Integer, Decimal, Boolean, Date, Time, DateTime, etc.)*

**Note:** Simple types (Text, Code, Integer, etc.) are not sorted relative to each other.

### Bad Code
```al
var
    StartingDateFilter: Text;
    TotalAmount: Decimal;
    Vendor: Record Vendor;
    IsValid: Boolean;
    PostingCodeunit: Codeunit "Gen. Jnl.-Post Line";
```

### Good Code
```al
var
    Vendor: Record Vendor;
    PostingCodeunit: Codeunit "Gen. Jnl.-Post Line";
    StartingDateFilter: Text;
    TotalAmount: Decimal;
    IsValid: Boolean;
```

---

## Rule 3: Standard Abbreviations

Avoid abbreviations when possible. When necessary, use only standard Microsoft abbreviations.

### Most Common Abbreviations

| Word | Abbrev | Word | Abbrev |
|------|--------|------|--------|
| Account | Acc | Management | Mgt |
| Address | Addr | Maximum | Max |
| Adjustment | Adjmt | Message | Msg |
| Amount | Amt | Minimum | Min |
| Buffer | Buf | Number | No |
| Calculate | Calc | Numbers | Nos |
| Category | Cat | Order | Ord |
| Codeunit | Cdu | Payment | Pmt |
| Company | Co | Percent | Pct |
| Customer | Cust | Posted | Pstd |
| Description | Desc | Posting | Post |
| Dimension | Dim | Purchase | Purch |
| Discount | Disc | Quantity | Qty |
| Document | Doc | Record | Rec |
| Entry | Entr | Reference | Ref |
| Exchange | Exch | Register | Reg |
| General | Gen | Remaining | Rem |
| General Ledger | GL | Requisition | Req |
| Header | Hdr | Resource | Res |
| Information | Info | Sales | Sales |
| Inventory | Invt | Shipment | Shpt |
| Invoice | Inv | Specification | Spec |
| Journal | Jnl | Standard | Std |
| Ledger | Ledg | Statement | Stmt |
| Line | Ln | Statistics | Stats |
| Local Currency | LCY | Temporary | Temp |
| Location | Loc | Total | Tot |

### Extended List (Less Common)

| Word | Abbrev | Word | Abbrev |
|------|--------|------|--------|
| Agreement | Agrmt | Outstanding | Outstd |
| Allocation | Alloc | Prepayment | Prepmt |
| Assembly | Asm | Production | Prod |
| Assignment | Assgnt | Project | Proj |
| Availability | Avail | Receipt | Rcpt |
| Average | Avg | Reconciliation | Recon |
| Balance | Bal | Relationship | Rlshp |
| Bill of Materials | BOM | Replacement | Repl |
| Cash Flow | CF | Report | Rpt |
| Confirmation | Cnfrmn | Requirement | Reqt |
| Consumption | Consump | Reservation | Reserv |
| Contract | Contr | Responsibility | Resp |
| Control | Ctrl | Rounding | Rndg |
| Conversion | Conv | Schedule | Sched |
| Correspondence | Corres | Selection | Selctn |
| Currency | Curr | Sequence | Seq |
| Distribution | Distrn | Service | Serv |
| Expected | Expd | Source | Src |
| Extended | Ext | Substitute | Sub |
| Finance | Fin | Suggestion | Sugn |
| Fixed Asset | FA | Summary | Sum |
| Freight | Frt | Synchronize | Synch |
| Human Resource | HR | Transaction | Transac |
| Interaction | Interact | Transfer | Trans |
| Manufacturing | Mfg | Unit of Measure | UOM |
| Marketing | Mktg | Value Added Tax | VAT |
| Notification | Notif | Variance | Var |
| Organization | Org | Vendor | Vend |
| Original | Orig | Warehouse | Whse |

---

## Rule 4: Text Constant Suffixes (AA0074)

**Rule:** Text constants and labels must use appropriate suffixes based on their purpose.

### Required Suffixes

| Suffix | Purpose | Example |
|--------|---------|---------|
| `Msg` | Messages shown to user | `CustomerCreatedMsg` |
| `Err` | Error messages | `CustomerNotFoundErr` |
| `Qst` | Question/confirmation dialogs | `DeleteRecordQst` |
| `Lbl` | Labels/captions | `CustomerNameLbl` |
| `Txt` | General text constants | `DefaultValueTxt` |
| `Tok` | Tokens (format strings, XML tags, etc.) | `DateFormatTok` |

### Bad Code
```al
var
    CustomerCreated: Label 'Customer %1 created successfully';
    CustomerNotFound: Label 'Customer not found';
    DeleteConfirm: Label 'Delete this record?';
```

### Good Code
```al
var
    CustomerCreatedMsg: Label 'Customer %1 created successfully';
    CustomerNotFoundErr: Label 'Customer not found';
    DeleteRecordQst: Label 'Delete this record?';
```

---

## Rule 5: Text Constants for StrSubstNo (AA0217)

**Rule:** Use text constants/labels for StrSubstNo format strings, not inline strings.

### Bad Code
```al
procedure ShowMessage(CustomerName: Text)
begin
    Message('Customer %1 was processed', CustomerName);
    Error('Failed to process %1 with code %2', CustomerName, ErrorCode);
end;
```

### Good Code
```al
var
    CustomerProcessedMsg: Label 'Customer %1 was processed', Comment = '%1 - Customer Name';
    ProcessingFailedErr: Label 'Failed to process %1 with code %2', Comment = '%1 - Customer Name, %2 - Error Code';

procedure ShowMessage(CustomerName: Text)
begin
    Message(CustomerProcessedMsg, CustomerName);
    Error(ProcessingFailedErr, CustomerName, ErrorCode);
end;
```

### Comment Convention for Labels

Always add `Comment` to describe parameters:
```al
var
    AmountExceedsLimitErr: Label 'Amount %1 exceeds limit %2 for %3', Comment = '%1 - Amount, %2 - Limit, %3 - Account No.';
```

---

## Rule 6: Table Key Naming

**Rule:** Name table keys consistently using `Key1`, `Key2`, `Key3`, etc.

### Pattern
```al
table 50100 "My Table"
{
    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Document Type"; Enum "Document Type") { }
        field(3; "Document No."; Code[20]) { }
        field(4; "Posting Date"; Date) { }
    }

    keys
    {
        key(Key1; "Entry No.")
        {
            Clustered = true;
        }
        key(Key2; "Document Type", "Document No.")
        {
        }
        key(Key3; "Posting Date")
        {
        }
    }
}
```

---

## Quick Validation Checklist

- [ ] Variable names match their object names (no generic names like `Helper`, `Temp`, `Buffer`)
- [ ] No spaces, periods, parentheses in variable names
- [ ] Variables start with capital letter and use PascalCase
- [ ] Complex types (Record, Codeunit, etc.) declared before simple types
- [ ] Abbreviations use standard Microsoft abbreviations only
- [ ] No unnecessary abbreviations (prefer full words when reasonable)
- [ ] Text constants use appropriate suffixes (Msg, Err, Qst, Lbl, Txt, Tok)
- [ ] StrSubstNo/Message/Error use labels, not inline strings
- [ ] Labels have Comment describing parameters
- [ ] Table keys named Key1, Key2, Key3, etc.

---

## References

- [Variable Naming](https://alguidelines.dev/docs/bestpractices/variable-naming/)
- [Variables Declarations Order](https://alguidelines.dev/docs/bestpractices/variables-declarations-order/)
- [Suggested Abbreviations](https://alguidelines.dev/docs/bestpractices/suggested-abbreviations/)
- [CodeCop AA0021](https://docs.microsoft.com/dynamics365/business-central/dev-itpro/developer/analyzers/codecop-aa0021)
