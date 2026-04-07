# AL Obsolete Patterns for Released Objects

Never delete released page fields, actions, or groups. Obsolete them instead and create replacements.

---

## Why This Matters

Once a page field, action, or group has been **released** (shipped in a published version), it becomes part of the public surface area. Other extensions, customizations, or per-tenant configurations may reference these elements by name. Deleting them causes:

- **AppSourceCop violations**: AS0062 (page controls must not be deleted), AS0063 (page actions must not be deleted)
- **Breaking changes**: Extensions referencing the removed element will fail to compile
- **User personalization loss**: End-user page customizations referencing the element break silently
- **Upgrade failures**: Tenants upgrading from a version with the element will encounter errors

---

## The Rule

**Released page fields, actions, and groups MUST NOT be removed.** Instead:

1. **Mark the existing element as obsolete** (`ObsoleteState = Pending`)
2. **Hide it** (`Visible = false`)
3. **Create a new replacement element** if functionality is being replaced

This applies to:
- Page fields (`field`)
- Page actions (`action`)
- Page groups (`group`)
- Table fields (same principle - use `ObsoleteState` instead of deleting)

---

## Required Obsolete Properties

When obsoleting an element, always set all three properties:

| Property | Purpose | Example |
|----------|---------|---------|
| `ObsoleteState` | Marks the element as obsolete | `ObsoleteState = Pending;` |
| `ObsoleteReason` | Explains why and what replaces it | `ObsoleteReason = 'Replaced by "New Field Name" field.';` |
| `ObsoleteTag` | Version when obsoleted (for tracking removal timeline) | `ObsoleteTag = '27.5';` |

### ObsoleteState Values

- `Pending` - Marked for removal. Generates compiler warnings when referenced. **Use this first.**
- `Removed` - Fully removed in a later version (after sufficient deprecation period). Code referencing it will fail to compile.

---

## Pattern: Obsoleting a Page Field

### Bad Code - Deleting a released field

```al
// WRONG: Simply removing the field from the page
// (field "Old Amount" was here but got deleted)
field("New Amount"; Rec."New Amount")
{
    ToolTip = 'Specifies the amount.';
}
```

### Good Code - Obsolete and replace

```al
field("Old Amount"; Rec."Old Amount")
{
    ObsoleteReason = 'Replaced by "New Amount" field.';
    ObsoleteState = Pending;
    ObsoleteTag = '27.5';
    ToolTip = 'Specifies the amount.';
    Visible = false;
}
field("New Amount"; Rec."New Amount")
{
    ToolTip = 'Specifies the amount.';
}
```

---

## Pattern: Obsoleting a Page Action

### Bad Code - Deleting a released action

```al
// WRONG: Simply removing the action
// (action "Send Approval Request" was here but got deleted)
```

### Good Code - Obsolete and replace

```al
action("CTS-PE SendApprovalRequestJournalBatch")
{
    Caption = 'Send Approval Request';
    Image = SendApprovalRequest;
    ObsoleteReason = 'This action is no longer available.';
    ObsoleteState = Pending;
    ObsoleteTag = '27.0';
    ToolTip = 'Send all journal lines for approval.';
    Visible = false;

    trigger OnAction()
    begin
        // Keep empty or minimal - action is obsolete
    end;
}
```

---

## Pattern: Obsoleting a Page Group

### Bad Code - Deleting a released group

```al
// WRONG: Simply removing the group and its fields
// (group "OldSettings" was here but got deleted)
```

### Good Code - Obsolete the group

```al
group(OldSettings)
{
    Caption = 'Old Settings';
    ObsoleteReason = 'Replaced by "NewSettings" group.';
    ObsoleteState = Pending;
    ObsoleteTag = '27.5';
    Visible = false;

    field("Old Setting 1"; Rec."Old Setting 1")
    {
        ObsoleteReason = 'Replaced by "New Setting 1" field.';
        ObsoleteState = Pending;
        ObsoleteTag = '27.5';
        ToolTip = 'Specifies the old setting.';
        Visible = false;
    }
}
group(NewSettings)
{
    Caption = 'New Settings';

    field("New Setting 1"; Rec."New Setting 1")
    {
        ToolTip = 'Specifies the new setting.';
    }
}
```

---

## Pattern: Obsoleting a Table Field

The same principle applies to table fields. Never delete a released table field.

### Good Code

```al
field(10; "Old Field"; Text[100])
{
    Caption = 'Old Field';
    ObsoleteReason = 'This field is obsolete and will be removed in a future release. It is replaced with field "New Field".';
    ObsoleteState = Pending;
    ObsoleteTag = '27.5';
}
field(11; "New Field"; Text[100])
{
    Caption = 'New Field';
}
```

---

## When Obsoleting Is NOT Required

- **Unreleased elements**: Fields, actions, or groups added in the current development cycle that have NOT yet been shipped can be freely modified or deleted.
- **Internal/test objects**: Objects in test apps or `Access = Internal` objects that are not part of the public API surface.

---

## Lifecycle: From Pending to Removed

1. **Version N**: Mark as `ObsoleteState = Pending` with `ObsoleteTag = 'N'`
   - Element stays in code but is hidden and generates warnings
2. **Version N+2 (or later)**: Change to `ObsoleteState = Removed`
   - Element signature stays but any code referencing it will fail to compile
3. **Version N+4 (or later)**: Fully remove from source code
   - Only after sufficient deprecation period per AppSource policy

The exact timeline depends on AppSource deprecation policy and your release cadence.

---

## Quick Validation Checklist

- [ ] No released page fields have been deleted (use `ObsoleteState = Pending` instead)
- [ ] No released page actions have been deleted (use `ObsoleteState = Pending` instead)
- [ ] No released page groups have been deleted (use `ObsoleteState = Pending` instead)
- [ ] No released table fields have been deleted (use `ObsoleteState = Pending` instead)
- [ ] All obsoleted elements have `ObsoleteReason`, `ObsoleteState`, and `ObsoleteTag` set
- [ ] Obsoleted page elements have `Visible = false`
- [ ] Replacement elements are created alongside the obsoleted ones
- [ ] `ObsoleteReason` clearly states what replaces the element

---

## References

- [AS0062 - Page controls must not be deleted](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop-as0062)
- [AS0063 - Page actions must not be deleted](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop-as0063)
- [ObsoleteState Property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-obsoletestate-property)
- [ObsoleteReason Property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-obsoletereason-property)
- [ObsoleteTag Property](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-obsoletetag-property)
- [Best Practices for Deprecation](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-deprecation-guidelines)
