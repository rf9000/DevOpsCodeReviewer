---
paths: "**/*.al"
---

# AL Enum Conversion Patterns

Comprehensive guide for safe, performant, and extension-compatible enum conversions in AL.

---

## Quick Reference

| Pattern | Safe Method | Unsafe Method |
|---------|-------------|---------------|
| **Enum -> Integer** | `Level.AsInteger()` | Direct casting |
| **Integer -> Enum** | `Enum::Level.FromInteger(ordinal)` with validation | Direct assignment |
| **Enum -> Text** | `Level.Names.Get(Level.Ordinals.IndexOf(Level.AsInteger()))` | `Format(Level)` for storage |
| **Text -> Enum** | Case-insensitive name lookup with error handling | `IndexOf()` without validation |

---

## Safe Conversion Patterns

### 1. Enum to Integer (Getting Ordinal Value)

```al
// CORRECT: Safe ordinal extraction
procedure GetLevelOrdinal(Level: Enum "Priority Level"): Integer
begin
    exit(Level.AsInteger());
end;
```

### 2. Integer to Enum (From Ordinal Value)

```al
// CORRECT: Safe integer-to-enum with validation
procedure SetLevelFromOrdinal(OrdinalValue: Integer; var Level: Enum "Priority Level"): Boolean
var
    TempLevel: Enum "Priority Level";
begin
    if TempLevel.Ordinals.Contains(OrdinalValue) then begin
        Level := Enum::"Priority Level".FromInteger(OrdinalValue);
        exit(true);
    end;
    exit(false); // Invalid ordinal value
end;
```

### 3. Enum to Text (Getting Display Name)

```al
// CORRECT: Get enum display name
procedure GetLevelName(Level: Enum "Priority Level"): Text
var
    TempLevel: Enum "Priority Level";
    Index: Integer;
begin
    Index := TempLevel.Ordinals.IndexOf(Level.AsInteger());
    if Index > 0 then
        exit(TempLevel.Names.Get(Index))
    else
        exit(''); // Handle unknown enum value
end;
```

### 4. Text to Enum (Case-Insensitive with Error Handling)

```al
// CORRECT: Safe text-to-enum conversion
procedure SetLevelFromText(LevelText: Text; var Level: Enum "Priority Level"): Boolean
var
    TempLevel: Enum "Priority Level";
    i: Integer;
begin
    for i := 1 to TempLevel.Names.Count do
        if UpperCase(TempLevel.Names.Get(i)) = UpperCase(LevelText) then begin
            Level := Enum::"Priority Level".FromInteger(TempLevel.Ordinals.Get(i));
            exit(true);
        end;
    exit(false); // Conversion failed
end;
```

### 5. Extension-Safe Enum Iteration

```al
// CORRECT: Iterate all enum values safely
procedure ProcessAllLevels()
var
    Level: Enum "Priority Level";
    TempLevel: Enum "Priority Level";
    i: Integer;
begin
    for i := 1 to TempLevel.Ordinals.Count do begin
        Level := Enum::"Priority Level".FromInteger(TempLevel.Ordinals.Get(i));
        ProcessLevel(Level);
    end;
end;
```

---

## Dangerous Anti-Patterns

### Hardcoded Ordinal Assumptions

```al
// WRONG: Assumes 'High' is always ordinal 2 (breaks with extensions)
procedure IsHighPriority(Level: Enum "Priority Level"): Boolean
begin
    exit(Level.AsInteger() = 2); // Dangerous assumption!
end;

// CORRECT: Compare enum values directly
procedure IsHighPriority(Level: Enum "Priority Level"): Boolean
begin
    exit(Level = Enum::"Priority Level"::High); // Safe with extensions
end;
```

### Case-Sensitive Text Conversion

```al
// WRONG: Case-sensitive, no error handling
procedure SetLevelFromText(LevelText: Text)
var
    Level: Enum "Priority Level";
begin
    Level := Level.Names.Get(Level.Names.IndexOf(LevelText)); // Breaks with wrong case
end;
```

### Index vs Ordinal Confusion

```al
// WRONG: Assumes indexes match ordinals (dangerous)
procedure GetLevelByIndex(Index: Integer): Enum "Priority Level"
begin
    exit(Enum::"Priority Level".FromInteger(Index)); // Index != Ordinal!
end;

// CORRECT: Use ordinals array for safe conversion
procedure GetLevelByIndex(Index: Integer): Enum "Priority Level"
var
    Level: Enum "Priority Level";
begin
    if (Index >= 1) and (Index <= Level.Ordinals.Count) then
        exit(Enum::"Priority Level".FromInteger(Level.Ordinals.Get(Index)))
    else
        Error('Invalid enum index: %1', Index);
end;
```

### Performance Anti-Patterns

```al
// WRONG: Repeated conversions in loops
procedure ProcessLevels()
var
    Level: Enum "Priority Level";
    LevelRec: Record "Level Table";
begin
    if LevelRec.FindSet() then
        repeat
            if Format(Level) = 'High' then // Format() called repeatedly!
                ProcessHighPriority();
        until LevelRec.Next() = 0;
end;

// CORRECT: Cache converted values
procedure ProcessLevels()
var
    Level: Enum "Priority Level";
    LevelRec: Record "Level Table";
    HighLevelText: Text;
begin
    HighLevelText := Format(Enum::"Priority Level"::High); // Cache once

    if LevelRec.FindSet() then
        repeat
            if Format(Level) = HighLevelText then
                ProcessHighPriority();
        until LevelRec.Next() = 0;
end;
```

---

## Critical Understanding: Index vs Ordinal

**KEY CONCEPT**: Enum **indexes** (position in Names/Ordinals arrays) != **ordinal values** (actual enum values)

```al
// Example enum with custom ordinal values
enum 50000 "Priority Level"
{
    value(10; Low) { }      // Index: 1, Ordinal: 10
    value(50; Medium) { }   // Index: 2, Ordinal: 50
    value(100; High) { }    // Index: 3, Ordinal: 100
}
```

**Safe Pattern**: Always use `Ordinals.Get(index)` to get the actual ordinal value:

```al
// CORRECT: Get ordinal from index
procedure GetOrdinalByIndex(Index: Integer): Integer
var
    Level: Enum "Priority Level";
begin
    if (Index >= 1) and (Index <= Level.Ordinals.Count) then
        exit(Level.Ordinals.Get(Index))
    else
        Error('Invalid index: %1', Index);
end;
```

---

## Extension Compatibility

### Safe Patterns for Enum Extensions

1. **Never assume specific ordinal values**
2. **Always compare enum values directly** (`Level = Enum::"Priority Level"::High`)
3. **Use Names and Ordinals collections** for dynamic behavior
4. **Validate conversions** before using results

```al
// EXTENSION-SAFE: Works even when new enum values are added
procedure ValidateLevel(Level: Enum "Priority Level"): Boolean
var
    TempLevel: Enum "Priority Level";
begin
    exit(TempLevel.Ordinals.Contains(Level.AsInteger()));
end;
```

---

## Performance Considerations

### 1. Cache Repeated Conversions

```al
// Cache enum text representations when used frequently
local HighPriorityText: Text;
local MediumPriorityText: Text;

HighPriorityText := Format(Enum::"Priority Level"::High);
MediumPriorityText := Format(Enum::"Priority Level"::Medium);
```

### 2. Avoid Format() for Storage

```al
// AVOID: Format() for database storage (localization issues)
procedure StoreLevelInField(Level: Enum "Priority Level")
begin
    LevelTextField := Format(Level); // Locale-dependent!
end;

// BETTER: Store ordinal value
procedure StoreLevelInField(Level: Enum "Priority Level")
begin
    LevelIntegerField := Level.AsInteger(); // Locale-independent
end;
```

### 3. Efficient Enum Lookups

Use `Contains()` method for validation instead of loops when possible:

```al
// EFFICIENT: Use built-in Contains() method
procedure IsValidOrdinal(OrdinalValue: Integer): Boolean
var
    Level: Enum "Priority Level";
begin
    exit(Level.Ordinals.Contains(OrdinalValue));
end;
```

---

## Error Handling Best Practices

### 1. Always Validate Conversions

```al
procedure SafeConversion(Input: Text; var Level: Enum "Priority Level"): Boolean
begin
    if not SetLevelFromText(Input, Level) then begin
        Message('Invalid priority level: %1', Input);
        exit(false);
    end;
    exit(true);
end;
```

### 2. Provide Meaningful Error Messages

```al
procedure ValidateEnumValue(Level: Enum "Priority Level")
var
    TempLevel: Enum "Priority Level";
begin
    if not TempLevel.Ordinals.Contains(Level.AsInteger()) then
        Error('Invalid priority level ordinal: %1. Valid values are: %2',
              Level.AsInteger(),
              GetValidOrdinalsList());
end;
```

---

## Testing Guidelines

### Test All Conversion Scenarios

```al
// Test case-insensitive conversion
[Test]
procedure TestTextToEnumConversion_CaseInsensitive()
var
    Level: Enum "Priority Level";
begin
    Assert.IsTrue(SetLevelFromText('HIGH', Level), 'Uppercase should work');
    Assert.IsTrue(SetLevelFromText('high', Level), 'Lowercase should work');
    Assert.IsTrue(SetLevelFromText('High', Level), 'Mixed case should work');
end;

// Test invalid conversions
[Test]
procedure TestTextToEnumConversion_InvalidText()
var
    Level: Enum "Priority Level";
begin
    Assert.IsFalse(SetLevelFromText('Invalid', Level), 'Invalid text should fail');
    Assert.IsFalse(SetLevelFromText('', Level), 'Empty text should fail');
end;
```

---

## Quick Validation Checklist

When reviewing enum conversion code, check for:

- [ ] Use `AsInteger()` for enum-to-integer conversion
- [ ] Use `Enum::EnumName.FromInteger()` with validation for integer-to-enum
- [ ] Always validate conversions - never assume success
- [ ] Use case-insensitive text-to-enum conversion with error handling
- [ ] Compare enum values directly (`Level = Enum::"Level"::High`) - never hardcode ordinals
- [ ] Cache repeated enum conversions for performance
- [ ] No hardcoded ordinal assumptions that break with extensions
- [ ] No index/ordinal confusion in conversion logic

---

## References

- [Microsoft AL Enum Documentation](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-enum-data-type)
- [AL Enum Extensions](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-enum-extensibility)
- [Enum Conversion Methods](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods/devenv-enum-data-type)
- [Converting Enum Values in AL](https://www.kauffmann.nl/2020/07/16/converting-enum-values-in-al/) (External reference)
