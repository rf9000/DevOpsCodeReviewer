# App Folders Reference

## Workspace Structure

### Single-App Project
```
{WORKSPACE_ROOT}/
├── app.json          # App manifest
├── src/              # AL source files
├── .alpackages/      # Symbol packages
└── Rules.ruleset.json
```

### Monorepo Project
```
{WORKSPACE_ROOT}/
├── core-app/
│   ├── app.json
│   └── src/
├── module-a/
│   ├── app.json
│   └── src/
├── module-a-test/
│   ├── app.json
│   └── src/
├── .alpackages/      # Shared package cache
└── Rules.ruleset.json
```

## Dynamic Discovery

**Detect project type:**
```powershell
# Check if single-app (app.json at root)
if (Test-Path ".\app.json") {
    Write-Host "Single-app project"
} else {
    Write-Host "Monorepo project"
}
```

**Find all app folders in monorepo:**
```powershell
Get-ChildItem -Directory | Where-Object { Test-Path "$($_.FullName)\app.json" } | Select-Object Name
```

**Map file to app folder:**
```powershell
# Find app folder by walking up from modified file location
# Example: "module-a/src/Codeunits/MyCode.Codeunit.al" → "module-a"
$filePath = "module-a/src/Codeunits/MyCode.Codeunit.al"
$folder = Split-Path $filePath -Parent

# Walk up until we find app.json
$appFolder = $null
while ($folder -and $folder -ne ".") {
    if (Test-Path ".\$folder\app.json") {
        $appFolder = $folder
        break
    }
    $folder = Split-Path $folder -Parent
}

# Check if app.json is at workspace root
if (-not $appFolder -and (Test-Path ".\app.json")) {
    $appFolder = "."
}

if ($appFolder) {
    Write-Host "Compile: $appFolder"
}
```

## Common Folder Patterns

| Pattern | Description |
|---------|-------------|
| `*-app/` or `*-application/` | Main application code |
| `*-test/` | Test apps (mirror main app structure) |
| `*-demo/` | Demo/sample data |
| `localization-*/` or `*-xx/` | Country-specific localizations |
| `import/`, `export/` | Feature-specific modules |

## Dependency Order (Guidance)

When compiling multiple apps, follow dependency order:

1. **Base/core apps** (no internal dependencies)
2. **Feature modules** (depend on core)
3. **Localizations** (depend on modules)
4. **Test apps** (depend on their main app)

**Check dependencies programmatically:**
```powershell
# Read dependencies from app.json
$appJson = Get-Content ".\module-a\app.json" | ConvertFrom-Json
$appJson.dependencies | ForEach-Object { Write-Host "Depends on: $($_.name)" }
```

## Path Mapping Examples

| File Changed | Compile |
|--------------|---------|
| `core-app/src/Codeunits/PaymentMgt.Codeunit.al` | `core-app` |
| `module-a/Pages/Setup.Page.al` | `module-a` |
| `module-a-test/src/Tests/UnitTests.Codeunit.al` | `module-a-test` |
| `localization-dk/Interfaces/IExporter.Interface.al` | `localization-dk` |
| `app.json` (at root) | `.` (single-app project) |
