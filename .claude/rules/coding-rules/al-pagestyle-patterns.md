---
paths: "**/*.al"
---

# AL PageStyle Usage

---

## Overview

`PageStyle` is a **datatype** (not an enum) used in AL for page field styling. It provides standardized visual styling for fields in Business Central pages.

---

## Key Points

### Declaration and Usage

- **Type**: `PageStyle` is a datatype, not an enum
- **Declaration**: `var MyStyle: PageStyle;`
- **NOT**: `var MyStyle: Enum PageStyle;`

### Available Values

Use the `::` syntax to access PageStyle values:

- `PageStyle::Favorable` - Green/positive styling
- `PageStyle::Unfavorable` - Red/negative styling
- `PageStyle::Ambiguous` - Yellow/warning styling
- `PageStyle::Standard` - Default/neutral styling
- `PageStyle::Strong` - Bold/emphasized styling
- `PageStyle::Attention` - Orange/attention styling

---

## StyleExpr Property Requirement

**Important**: The `StyleExpr` property on page fields requires a `Text` value, NOT a `PageStyle` value directly.

### Correct Pattern

```al
var
    StatusStyle: Text;  // Must be Text for StyleExpr

trigger OnAfterGetRecord()
begin
    // Convert PageStyle to Text using Format()
    StatusStyle := Format(GetStatusStyle(Rec.Status));
end;

local procedure GetStatusStyle(Status: Enum "My Status"): PageStyle
begin
    case Status of
        Status::Ready:
            exit(PageStyle::Favorable);
        Status::NotReady:
            exit(PageStyle::Unfavorable);
        else
            exit(PageStyle::Standard);
    end;
end;
```

### In the Page Field

```al
field(Status; Rec.Status)
{
    StyleExpr = StatusStyle;  // StatusStyle is Text, not PageStyle
}
```

---

## Common Mistakes

### Wrong: Using String Literals

```al
exit('Favorable');  // Old way, causes AL cop warnings
```

### Wrong: Declaring as Enum

```al
var StatusStyle: Enum PageStyle;  // PageStyle is not an enum
```

### Wrong: Using PageStyle Directly in StyleExpr

```al
var StatusStyle: PageStyle;
// Then using StyleExpr = StatusStyle directly won't work
```

### Correct: Using PageStyle Datatype with Format()

```al
var StatusStyle: Text;
StatusStyle := Format(PageStyle::Favorable);
```

---

## Complete Example

```al
page 50100 "My List Page"
{
    PageType = List;
    SourceTable = "My Table";

    layout
    {
        area(Content)
        {
            repeater(Group)
            {
                field(Status; Rec.Status)
                {
                    ApplicationArea = All;
                    StyleExpr = StatusStyleText;
                }
                field(Amount; Rec.Amount)
                {
                    ApplicationArea = All;
                    StyleExpr = AmountStyleText;
                }
            }
        }
    }

    var
        StatusStyleText: Text;
        AmountStyleText: Text;

    trigger OnAfterGetRecord()
    begin
        StatusStyleText := Format(GetStatusStyle(Rec.Status));
        AmountStyleText := Format(GetAmountStyle(Rec.Amount));
    end;

    local procedure GetStatusStyle(Status: Enum "My Status"): PageStyle
    begin
        case Status of
            Status::Approved:
                exit(PageStyle::Favorable);
            Status::Rejected:
                exit(PageStyle::Unfavorable);
            Status::Pending:
                exit(PageStyle::Ambiguous);
            else
                exit(PageStyle::Standard);
        end;
    end;

    local procedure GetAmountStyle(Amount: Decimal): PageStyle
    begin
        if Amount > 0 then
            exit(PageStyle::Favorable);
        if Amount < 0 then
            exit(PageStyle::Unfavorable);
        exit(PageStyle::Standard);
    end;
}
```

---

## Quick Validation Checklist

- [ ] PageStyle declared as datatype, not enum: `var MyStyle: PageStyle;`
- [ ] StyleExpr uses Text variable, not PageStyle directly
- [ ] Use `Format(PageStyle::Value)` to convert to Text for StyleExpr
- [ ] No string literals like `'Favorable'` (use PageStyle datatype)
- [ ] Style calculation done in OnAfterGetRecord trigger

---

## Benefits

- Type-safe styling
- Avoids AL cop warnings about string literals
- Consistent with Microsoft's AL best practices
- IntelliSense support for available values

---

## Related AL Cop Rule

**Rule**: Avoid using string literals for page styling
**Fix**: Use PageStyle datatype instead of strings like 'Favorable', 'Unfavorable', etc.
