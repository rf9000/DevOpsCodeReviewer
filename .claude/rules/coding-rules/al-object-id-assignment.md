# AL Object ID Assignment

Never manually pick object IDs. Always use the **al-object-id-ninja** MCP to assign and release IDs.

---

## Why This Matters

Manual ID selection leads to collisions when multiple developers work in parallel. The al-object-id-ninja MCP tracks assigned IDs centrally, ensuring each ID is unique across the team.

---

## The Rule

### Assigning a new ID

Use `mcp__al-object-id-ninja__ninja_assignObjectId` whenever you create a new AL object.

| Parameter | Description | Example |
|-----------|-------------|---------|
| `objectType` | The AL object type | `"table"`, `"page"`, `"codeunit"`, `"enum"`, `"pageextension"`, `"tableextension"`, etc. |
| `targetFilePath` | Absolute path to any file in the target app | `"C:/repo/base-application/app.json"` |
| `rangeName` | (Optional) Logical range name when the app has multiple ranges | `"default"` |

**Special types for sub-object IDs:**
- Table fields: `"table_{tableId}"` (e.g., `"table_71553575"`)
- Enum values: `"enum_{enumId}"` (e.g., `"enum_71553580"`)

### Releasing an ID

Use `mcp__al-object-id-ninja__ninja_unassignObjectId` when deleting an AL object.

| Parameter | Description | Example |
|-----------|-------------|---------|
| `objectType` | The AL object type | `"table"`, `"page"`, etc. |
| `objectId` | The ID to release (positive number) | `71553600` |
| `targetFilePath` | Absolute path to any file in the target app | `"C:/repo/base-application/app.json"` |

---

## Quick Reference

```
Creating a new table in base-application?
  -> ninja_assignObjectId(objectType: "table", targetFilePath: "<abs path to any file in base-application>")

Creating a new field on table 71553575?
  -> ninja_assignObjectId(objectType: "table_71553575", targetFilePath: "<abs path to any file in the app>")

Deleting codeunit 71553600?
  -> ninja_unassignObjectId(objectType: "codeunit", objectId: 71553600, targetFilePath: "<abs path to any file in the app>")
```

---

## Prohibited Practices

- **Never hardcode or guess an ID** by scanning the repo for the next available number.
- **Never reuse an ID** from a deleted object without first confirming it was released via `ninja_unassignObjectId`.
- **Never skip ID assignment** for "temporary" or "draft" objects — assign immediately to avoid conflicts.

---

## References

- ID ranges per app: `/docs/al/object-ids.md`
- MCP tool source: al-object-id-ninja
