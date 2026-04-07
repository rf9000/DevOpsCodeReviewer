#Requires -Version 5.1
<#
.SYNOPSIS
    Compiles an AL app with all required analyzers.

.DESCRIPTION
    Automatically detects the AL CLI tool version and builds the correct
    analyzer paths. Includes CodeCop, AppSourceCop, and UICop analyzers.
    Uses the Banking Rulesets (AppSourceCop, CodeCop, Compiler, UICop, LinterCop)
    and downloads the remote Continia AppSource ruleset for CLI compatibility.

.PARAMETER AppFolder
    The app folder name to compile (e.g., "base-application", "import", "banking-dk")

.PARAMETER RepoRoot
    The repository root path. Defaults to script location.

.PARAMETER ListApps
    Lists all available app folders.

.PARAMETER SkipAnalyzers
    Skip analyzers (not recommended, for troubleshooting only)

.PARAMETER PropagateSymbols
    After successful compilation, copies the compiled .app to .alpackages/ so
    dependent apps can resolve the new symbols. Automatically reads version from
    app.json, removes ALL stale versions of this app from .alpackages/, and
    copies the freshly compiled .app.

.EXAMPLE
    .\Compile-ALApp.ps1 -AppFolder "base-application"

.EXAMPLE
    .\Compile-ALApp.ps1 -AppFolder "base-application" -PropagateSymbols

.EXAMPLE
    .\Compile-ALApp.ps1 -AppFolder "import" -Verbose

.EXAMPLE
    .\Compile-ALApp.ps1 -ListApps
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$AppFolder,

    [Parameter()]
    [string]$RepoRoot,

    [Parameter()]
    [switch]$ListApps,

    [Parameter()]
    [switch]$SkipAnalyzers,

    [Parameter()]
    [switch]$PropagateSymbols
)

# Resolve RepoRoot - script is in .claude/skills/al-compile-on-change/, need to go up 3 levels
if (-not $RepoRoot) {
    if ($PSScriptRoot) {
        # Script is in .claude/skills/al-compile-on-change/ - go up 3 levels to repo root
        $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
    } elseif ($MyInvocation.MyCommand.Path) {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
        $RepoRoot = (Resolve-Path (Join-Path $scriptDir "..\..\..")).Path
    } else {
        $RepoRoot = Get-Location
    }
}

# Configuration
$PackageCachePath = Join-Path $RepoRoot ".alpackages"
$BankingRulesetsPath = Join-Path $RepoRoot "Banking Rulesets"
$RulesetPath = Join-Path $BankingRulesetsPath "ruleset.json"

function Get-ALCliVersion {
    $toolList = dotnet tool list -g 2>&1 | Select-String "microsoft.dynamics.businesscentral.development.tools"
    if (-not $toolList) {
        throw "AL CLI tools not found. Install with: dotnet tool install -g Microsoft.Dynamics.BusinessCentral.Development.Tools"
    }

    # Extract version from output (format: "package-name    version    commands")
    $parts = $toolList.Line -split '\s+'
    return $parts[1]
}

function Get-AnalyzerPath {
    param([string]$Version)

    $basePath = Join-Path $env:USERPROFILE ".dotnet\tools\.store\microsoft.dynamics.businesscentral.development.tools"
    $analyzerPath = Join-Path $basePath "$Version\microsoft.dynamics.businesscentral.development.tools\$Version\tools\net8.0\any"

    if (-not (Test-Path $analyzerPath)) {
        throw "Analyzer path not found: $analyzerPath"
    }

    return $analyzerPath
}

function Get-AppFolders {
    param([string]$Root)

    Get-ChildItem -Path $Root -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName "app.json") } |
        Select-Object -ExpandProperty Name |
        Sort-Object
}

function Propagate-AppSymbols {
    <#
    .SYNOPSIS
        Copies the freshly compiled .app to .alpackages/ for dependent apps.
    .DESCRIPTION
        Reads publisher, name, and version from app.json to construct the exact
        output filename. Removes ALL stale versions of this app from .alpackages/
        before copying the fresh one. This prevents version-shadowing issues where
        a stale higher-version .app takes precedence over the fresh one.
    #>
    param(
        [string]$ProjectPath,
        [string]$PackageCache
    )

    $appJsonPath = Join-Path $ProjectPath "app.json"
    $appJson = Get-Content -Path $appJsonPath -Raw | ConvertFrom-Json

    $publisher = $appJson.publisher
    $appName = $appJson.name
    $appVersion = $appJson.version

    # Construct the expected output filename (AL compiler convention)
    $expectedFileName = "${publisher}_${appName}_${appVersion}.app"
    $compiledAppPath = Join-Path $ProjectPath $expectedFileName

    if (-not (Test-Path $compiledAppPath)) {
        Write-Warning "PropagateSymbols: Compiled .app not found at: $compiledAppPath"
        return
    }

    # Verify it was freshly compiled (within last 5 minutes)
    $fileAge = (Get-Date) - (Get-Item $compiledAppPath).LastWriteTime
    if ($fileAge.TotalMinutes -gt 5) {
        Write-Warning "PropagateSymbols: .app file is $([int]$fileAge.TotalMinutes) minutes old - may be stale: $compiledAppPath"
    }

    # Remove ALL versions of this app from .alpackages/
    $stalePattern = "${publisher}_${appName}_*.app"
    $staleFiles = Get-ChildItem -Path $PackageCache -Filter $stalePattern -ErrorAction SilentlyContinue
    foreach ($stale in $staleFiles) {
        Write-Verbose "PropagateSymbols: Removing stale: $($stale.Name)"
        Remove-Item $stale.FullName -Force
    }

    # Copy fresh .app
    Copy-Item -Path $compiledAppPath -Destination $PackageCache -Force
    Write-Host ""
    Write-Host "Symbols propagated: $expectedFileName -> .alpackages/" -ForegroundColor Green
}

function Resolve-RulesetForCLI {
    <#
    .SYNOPSIS
        Creates a CLI-compatible ruleset by downloading remote rulesets locally.
    .DESCRIPTION
        The AL CLI does not support external/HTTPS ruleset URLs in includedRuleSets.
        This function reads the master ruleset, downloads any remote rulesets to local
        files, and creates a temporary copy with local paths for CLI use.
    #>
    param(
        [string]$MasterRulesetPath,
        [string]$RulesetsFolder
    )

    $masterContent = Get-Content -Path $MasterRulesetPath -Raw
    $masterJson = $masterContent | ConvertFrom-Json

    $hasRemote = $false
    foreach ($included in $masterJson.includedRuleSets) {
        if ($included.path -match '^https?://') {
            $hasRemote = $true
            $url = $included.path
            $fileName = [System.IO.Path]::GetFileName($url)
            $localPath = Join-Path $RulesetsFolder $fileName

            # Download if not cached or older than 24 hours
            $needsDownload = -not (Test-Path $localPath)
            if (-not $needsDownload) {
                $fileAge = (Get-Date) - (Get-Item $localPath).LastWriteTime
                if ($fileAge.TotalHours -gt 24) {
                    $needsDownload = $true
                }
            }

            if ($needsDownload) {
                try {
                    Write-Verbose "Downloading remote ruleset: $url"
                    Invoke-WebRequest -Uri $url -OutFile $localPath -UseBasicParsing
                    Write-Verbose "Cached to: $localPath"
                } catch {
                    if (Test-Path $localPath) {
                        Write-Warning "Could not refresh remote ruleset (using cached): $($_.Exception.Message)"
                    } else {
                        Write-Warning "Could not download remote ruleset: $($_.Exception.Message)"
                        continue
                    }
                }
            } else {
                Write-Verbose "Using cached remote ruleset: $localPath"
            }

            # Update path to local reference
            $included.path = "./$fileName"
        }
    }

    if ($hasRemote) {
        # Write a temporary CLI-compatible ruleset
        $cliRulesetPath = Join-Path $RulesetsFolder ".cli-ruleset.json"
        $masterJson | ConvertTo-Json -Depth 10 | Set-Content -Path $cliRulesetPath -Encoding UTF8
        Write-Verbose "Created CLI-compatible ruleset: $cliRulesetPath"
        return $cliRulesetPath
    }

    return $MasterRulesetPath
}

# Handle -ListApps
if ($ListApps) {
    Write-Host "Available app folders:" -ForegroundColor Cyan
    Get-AppFolders -Root $RepoRoot | ForEach-Object { Write-Host "  $_" }
    exit 0
}

# Validate AppFolder parameter
if (-not $AppFolder) {
    Write-Error "AppFolder parameter is required. Use -ListApps to see available folders."
    exit 1
}

$projectPath = Join-Path $RepoRoot $AppFolder
if (-not (Test-Path (Join-Path $projectPath "app.json"))) {
    Write-Error "Invalid app folder: $AppFolder (no app.json found)"
    exit 1
}

# Get AL CLI version and analyzer path
try {
    $version = Get-ALCliVersion
    Write-Verbose "AL CLI version: $version"

    $analyzerBasePath = Get-AnalyzerPath -Version $version
    Write-Verbose "Analyzer path: $analyzerBasePath"
} catch {
    Write-Error $_.Exception.Message
    exit 1
}

# Resolve ruleset for CLI (download remote rulesets if needed)
try {
    $resolvedRulesetPath = Resolve-RulesetForCLI -MasterRulesetPath $RulesetPath -RulesetsFolder $BankingRulesetsPath
} catch {
    Write-Warning "Could not resolve rulesets: $($_.Exception.Message). Using master ruleset directly."
    $resolvedRulesetPath = $RulesetPath
}

# Build analyzer argument
$analyzers = @(
    "Microsoft.Dynamics.Nav.CodeCop.dll",
    "Microsoft.Dynamics.Nav.AppSourceCop.dll",
    "Microsoft.Dynamics.Nav.UICop.dll"
) | ForEach-Object { Join-Path $analyzerBasePath $_ }

# Find LinterCop analyzer (BusinessCentral.LinterCop.dll)
$linterCopPath = $null
# Check VS Code AL extension for LinterCop
$vsCodeExtensions = Join-Path $env:USERPROFILE ".vscode\extensions"
if (Test-Path $vsCodeExtensions) {
    $linterCopPath = Get-ChildItem -Path $vsCodeExtensions -Recurse -Filter "BusinessCentral.LinterCop.dll" -ErrorAction SilentlyContinue |
        Sort-Object { $_.Directory.Parent.Name } -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if ($linterCopPath) {
    Write-Verbose "LinterCop found: $linterCopPath"
    $analyzers += $linterCopPath
} else {
    Write-Warning "LinterCop analyzer not found. LC* rules will not be checked."
}

$analyzerArg = $analyzers -join ";"

# Build compile command
$compileArgs = @(
    "/project:`"$projectPath`"",
    "/packagecachepath:`"$PackageCachePath`"",
    "/ruleset:`"$resolvedRulesetPath`"",
    "/continuebuildonerror:+"
)

if (-not $SkipAnalyzers) {
    $compileArgs += "/analyzer:`"$analyzerArg`""
}

# Execute compilation
Write-Host ""
Write-Host "Compiling: $AppFolder" -ForegroundColor Cyan
Write-Host ("-" * 50) -ForegroundColor DarkGray

$startTime = Get-Date
$command = "al compile $($compileArgs -join ' ')"

Write-Verbose "Command: $command"
$rawOutput = Invoke-Expression $command 2>&1
$rawOutput | Out-Host

$duration = (Get-Date) - $startTime
Write-Host ""
Write-Host ("-" * 50) -ForegroundColor DarkGray
Write-Host "Completed in $($duration.TotalSeconds.ToString('F1'))s" -ForegroundColor Green

# Summary
$lines = $rawOutput | Out-String -Stream
$errors = @($lines | Where-Object { $_ -match ': error ' })
$warnings = @($lines | Where-Object { $_ -match ': warning ' })

Write-Host ""
Write-Host "Summary" -ForegroundColor Cyan
Write-Host ("-" * 50) -ForegroundColor DarkGray
if ($errors.Count -eq 0) {
    Write-Host "  Errors:   0" -ForegroundColor Green
} else {
    Write-Host "  Errors:   $($errors.Count)" -ForegroundColor Red
}
Write-Host "  Warnings: $($warnings.Count)" -ForegroundColor Yellow

if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host "Errors:" -ForegroundColor Red
    foreach ($err in $errors) {
        Write-Host "  $err" -ForegroundColor Red
    }
}

# Propagate symbols after successful compilation
if ($PropagateSymbols -and $errors.Count -eq 0) {
    Propagate-AppSymbols -ProjectPath $projectPath -PackageCache $PackageCachePath
} elseif ($PropagateSymbols -and $errors.Count -gt 0) {
    Write-Warning "PropagateSymbols skipped: compilation has errors"
}
