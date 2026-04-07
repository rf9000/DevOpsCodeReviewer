# Troubleshooting Guide

## AL CLI Not Found

**Symptom:** `al compile` command not recognized or `Compile-ALApp.ps1` reports "AL CLI tools not found"

**Solution:**
```powershell
# Install AL CLI tools globally
dotnet tool install -g Microsoft.Dynamics.BusinessCentral.Development.Tools

# Or update existing installation
dotnet tool update -g Microsoft.Dynamics.BusinessCentral.Development.Tools
```

### Checking Available Versions

If you get version mismatch errors or need to find the latest version, check NuGet:
https://www.nuget.org/packages/Microsoft.Dynamics.BusinessCentral.Development.Tools

To install a specific version:
```powershell
dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools --version 18.0.33.65164-beta
```

## Analyzers Not Loading

**Symptom:** Compilation runs but no AA*/AS*/AW* warnings appear - only AL* codes visible

### Quick Diagnosis

Run with verbose mode to see the analyzer paths:
```powershell
.\Compile-ALApp.ps1 -AppFolder "{APP-FOLDER}" -Verbose
```

Check that the output shows:
1. AL CLI version detected
2. Analyzer path exists
3. Full command includes `/analyzer:` parameter

### Manual Verification

```powershell
# Check AL CLI version
dotnet tool list -g | findstr dynamics.businesscentral

# Find analyzer DLLs
$version = (dotnet tool list -g | Select-String "dynamics.businesscentral").ToString().Split()[1].Trim()
$analyzerPath = "$env:USERPROFILE\.dotnet\tools\.store\microsoft.dynamics.businesscentral.development.tools\$version\microsoft.dynamics.businesscentral.development.tools\$version\tools\net8.0\any"
Test-Path "$analyzerPath\Microsoft.Dynamics.Nav.CodeCop.dll"
```

### If DLLs Not Found

Use fallback discovery:
```powershell
Get-ChildItem "$env:USERPROFILE\.dotnet\tools\.store\microsoft.dynamics.businesscentral.development.tools" -Recurse -Filter "Microsoft.Dynamics.Nav.CodeCop.dll" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty DirectoryName
```

If path differs from what the script expects, the script may need updating to match your AL CLI installation.

### Reinstall AL CLI

If analyzers still won't load:
```powershell
dotnet tool uninstall -g Microsoft.Dynamics.BusinessCentral.Development.Tools
dotnet tool install -g Microsoft.Dynamics.BusinessCentral.Development.Tools
```

## Missing Symbols (.alpackages)

**Symptom:** Errors like "The type 'X' was not found" or "Cannot find object 'Y'"

**Solution:**
1. Verify `.alpackages` folder exists in workspace root
2. Download symbols from VS Code: `AL: Download Symbols`
3. Or copy from another working environment

## Compilation Timeout

**Symptom:** Compilation hangs or takes extremely long

**Solutions:**
- Exclude workspace from antivirus real-time scanning
- Use local SSD storage instead of network drive
- Close other resource-intensive applications

## Ruleset Not Found

**Symptom:** Warning about missing ruleset file

**Solution:**
Verify `Rules.ruleset.json` exists in workspace root:
```powershell
Test-Path ".\Rules.ruleset.json"
```

## Common Compilation Errors

### AA0137 - Unused Variable
```
The local variable 'X' is declared but never used.
```
**Fix:** Remove the unused variable declaration.

### AA0005 - Unnecessary Begin..End
```
Only use BEGIN..END to enclose compound statements.
```
**Fix:** Remove `begin..end` when there's only one statement.

### AS0087 - Breaking Change
```
The procedure 'X' has changed signature.
```
**Fix:** Add `[Obsolete]` attribute and create new procedure, or revert signature.

### AL0432 - Missing SetLoadFields
```
Consider using partial records.
```
**Fix:** Add `SetLoadFields()` before `Get()` or `FindFirst()`.

## Script-Specific Issues

### RepoRoot Not Detected

If the script can't find the workspace root:
```powershell
# Explicitly specify RepoRoot
.\Compile-ALApp.ps1 -AppFolder "base-application" -RepoRoot "C:\path\to\workspace"
```

### Skip Analyzers for Debugging

To isolate whether an issue is analyzer-related:
```powershell
.\Compile-ALApp.ps1 -AppFolder "{APP-FOLDER}" -SkipAnalyzers
```

If compilation succeeds without analyzers but fails with them, check analyzer path/version.

## Quick Verification Commands

```powershell
# List available apps
.\Compile-ALApp.ps1 -ListApps

# Check AL CLI version
dotnet tool list -g | findstr dynamics.businesscentral

# Check package cache
Get-ChildItem ".\.alpackages\*.app" | Select-Object Name
```
