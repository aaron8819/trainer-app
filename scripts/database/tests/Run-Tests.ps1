[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$backupScript = Join-Path $repositoryRoot 'scripts\database\Backup-TrainerProduction.ps1'
$inspectScript = Join-Path $repositoryRoot 'scripts\database\Inspect-TrainerBackup.ps1'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("trainer-backup-tests-" + [guid]::NewGuid().ToString('N'))
$fakeBin = Join-Path $testRoot 'fake-bin'
$expectedReference = 'abcdefghijklmnopqrst'
$otherReference = 'zyxwvutsrqponmlkjihg'
$directUrl = "postgresql://postgres:secret-value@db.$expectedReference.supabase.co:5432/postgres?sslmode=require"
$passed = 0
$failed = 0
$results = [System.Collections.Generic.List[object]]::new()

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if (-not $Condition) { throw $Message }
}

function Assert-Equal {
    param(
        [AllowNull()]$Actual,
        [AllowNull()]$Expected,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if ($Actual -ne $Expected) { throw "$Message Expected='$Expected' Actual='$Actual'." }
}

function Invoke-Case {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Body
    )
    try {
        & $Body
        $script:passed++
        $script:results.Add([pscustomobject]@{ Name = $Name; Result = 'PASS'; Detail = '' })
        Write-Output "PASS: $Name"
    }
    catch {
        $script:failed++
        $script:results.Add([pscustomobject]@{ Name = $Name; Result = 'FAIL'; Detail = $_.Exception.Message })
        Write-Output "FAIL: $Name - $($_.Exception.Message)"
    }
}

function New-EnvironmentFile {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Url
    )
    $path = Join-Path $testRoot "$Name.env"
    Set-Content -LiteralPath $path -Value "TRAINER_PRODUCTION_DATABASE_URL=$Url" -Encoding utf8NoBOM
    return $path
}

function Invoke-ChildPowerShell {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments,
        [hashtable]$Environment = @{},
        [AllowNull()][string]$StandardInput
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Get-Command pwsh -CommandType Application).Source
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.CreateNoWindow = $true
    $startInfo.ArgumentList.Add('-NoProfile')
    $startInfo.ArgumentList.Add('-File')
    $startInfo.ArgumentList.Add($ScriptPath)
    foreach ($argument in $Arguments) { $startInfo.ArgumentList.Add($argument) }
    foreach ($entry in $Environment.GetEnumerator()) {
        if ($null -eq $entry.Value) { $startInfo.Environment.Remove([string]$entry.Key) }
        else { $startInfo.Environment[[string]$entry.Key] = [string]$entry.Value }
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $null = $process.Start()
    if ($null -ne $StandardInput) { $process.StandardInput.WriteLine($StandardInput) }
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    [pscustomobject]@{
        ExitCode = $process.ExitCode
        Output = $stdout + $stderr
        StdOut = $stdout
        StdErr = $stderr
    }
}

function Invoke-Backup {
    param(
        [Parameter(Mandatory = $true)][string]$Destination,
        [string]$Url = $directUrl,
        [string]$ProjectReference = $expectedReference,
        [string]$BinDirectory = $fakeBin,
        [switch]$AllowSessionPooler,
        [switch]$UsePath,
        [string]$Confirmation = "BACK UP $expectedReference",
        [hashtable]$Environment = @{},
        [string]$ScriptPath = $backupScript,
        [switch]$UseProcessEnvironment
    )

    $arguments = [System.Collections.Generic.List[string]]::new()
    if ($UseProcessEnvironment) {
        $arguments.Add('-UseProcessEnvironment')
        $Environment.TRAINER_PRODUCTION_DATABASE_URL = $Url
    }
    else {
        $environmentFile = New-EnvironmentFile -Name ([guid]::NewGuid().ToString('N')) -Url $Url
        $arguments.Add('-EnvironmentFilePath')
        $arguments.Add($environmentFile)
    }
    $arguments.Add('-ExpectedProjectReference')
    $arguments.Add($ProjectReference)
    $arguments.Add('-DestinationRoot')
    $arguments.Add($Destination)
    if (-not $UsePath -and -not [string]::IsNullOrWhiteSpace($BinDirectory)) {
        $arguments.Add('-PostgreSQLBinDirectory')
        $arguments.Add($BinDirectory)
    }
    if ($AllowSessionPooler) { $arguments.Add('-AllowSessionPooler') }
    $arguments.Add('-GitShaOverride')
    $arguments.Add('1111111111111111111111111111111111111111')
    if ($UsePath) { $Environment.PATH = "$fakeBin;$env:PATH" }
    Invoke-ChildPowerShell -ScriptPath $ScriptPath -Arguments $arguments.ToArray() -Environment $Environment -StandardInput $Confirmation
}

function Invoke-Inspector {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [string]$ProjectReference = $expectedReference,
        [int]$MaximumAgeMinutes = 60,
        [hashtable]$Environment = @{},
        [string]$BinDirectory = $fakeBin
    )

    $arguments = @(
        '-BackupDirectory', $Directory,
        '-ExpectedProjectReference', $ProjectReference,
        '-MaximumAgeMinutes', [string]$MaximumAgeMinutes
    )
    if (-not [string]::IsNullOrWhiteSpace($BinDirectory)) {
        $arguments += @('-PostgreSQLBinDirectory', $BinDirectory)
    }
    Invoke-ChildPowerShell -ScriptPath $inspectScript -Arguments $arguments -Environment $Environment
}

function Get-OnlyBackupDirectory {
    param([Parameter(Mandatory = $true)][string]$Destination)

    $directories = @(Get-ChildItem -LiteralPath $Destination -Directory | Where-Object {
        -not $_.Name.EndsWith('.partial') -and $_.Name -notmatch '\.failed(?:-|$)'
    })
    Assert-Equal $directories.Count 1 'Expected exactly one successful backup directory.'
    return $directories[0].FullName
}

function Copy-BackupFixture {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $destination = Join-Path $testRoot $Name
    Copy-Item -LiteralPath $Source -Destination $destination -Recurse
    return $destination
}

function Read-Manifest {
    param([Parameter(Mandatory = $true)][string]$Directory)
    Get-Content -Raw -LiteralPath (Join-Path $Directory 'manifest.json') | ConvertFrom-Json
}

function Write-Manifest {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)]$Manifest
    )
    $Manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $Directory 'manifest.json') -Encoding utf8NoBOM
}

function New-InjectedBackupScript {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Needle,
        [Parameter(Mandatory = $true)][string]$Replacement
    )
    $source = Get-Content -Raw -LiteralPath $backupScript
    Assert-True ($source.Contains($Needle)) "Injection marker was not found: $Needle"
    $source = $source.Replace(
        "(Join-Path `$PSScriptRoot '..\..')",
        "'$($repositoryRoot.Replace("'", "''"))'"
    )
    $source = $source.Replace($Needle, $Replacement)
    $path = Join-Path $testRoot "$Name.ps1"
    Set-Content -LiteralPath $path -Value $source -Encoding utf8NoBOM
    return $path
}

New-Item -ItemType Directory -Path $testRoot, $fakeBin | Out-Null
$pgDump = @'
@echo off
if "%~1"=="--version" (
  if "%FAKE_MALFORMED_DUMP_VERSION%"=="1" (echo pg_dump unknown& exit /b 0)
  if not "%FAKE_DUMP_MAJOR%"=="" (echo pg_dump ^(PostgreSQL^) %FAKE_DUMP_MAJOR%.1& exit /b 0)
  echo pg_dump ^(PostgreSQL^) 16.4
  exit /b 0
)
if not "%~1"=="--format" exit /b 81
if not "%~2"=="custom" exit /b 82
if not "%~3"=="--schema" exit /b 83
if not "%~4"=="public" exit /b 84
if not "%~5"=="--file" exit /b 85
if "%~6"=="" exit /b 86
if not "%~7"=="" exit /b 87
if not "%TRAINER_FAKE_ARGUMENT_LOG%"=="" echo pg_dump^|%*>>"%TRAINER_FAKE_ARGUMENT_LOG%"
if not "%TRAINER_FAKE_ENVIRONMENT_LOG%"=="" echo pg_dump^|%PGHOST%^|%PGPORT%^|%PGDATABASE%^|%PGSSLMODE%^|%PGSERVICE%>>"%TRAINER_FAKE_ENVIRONMENT_LOG%"
if "%FAKE_DUMP_FAIL%"=="1" (echo simulated dump failure 1>&2& exit /b 9)
if "%FAKE_DUMP_MISSING%"=="1" exit /b 0
if "%FAKE_DUMP_ZERO%"=="1" (type nul > "%~6"& exit /b 0)
> "%~6" echo fake-custom-archive
exit /b 0
'@
$pgRestore = @'
@echo off
if "%~1"=="--version" (
  if "%FAKE_MALFORMED_RESTORE_VERSION%"=="1" (echo pg_restore unknown& exit /b 0)
  if not "%FAKE_RESTORE_MAJOR%"=="" (echo pg_restore ^(PostgreSQL^) %FAKE_RESTORE_MAJOR%.1& exit /b 0)
  echo pg_restore ^(PostgreSQL^) 16.4
  exit /b 0
)
if not "%~1"=="--list" exit /b 91
if "%~2"=="" exit /b 92
if not "%~3"=="" exit /b 93
if not "%TRAINER_FAKE_ARGUMENT_LOG%"=="" echo pg_restore^|%*>>"%TRAINER_FAKE_ARGUMENT_LOG%"
if "%FAKE_LIST_FAIL%"=="1" (echo simulated listing failure 1>&2& exit /b 7)
if not "%FAKE_MISSING_PUBLIC%"=="1" echo 1; 0 0 SCHEMA - public postgres
if not "%FAKE_MISSING_PRISMA%"=="1" echo 2; 0 0 TABLE public _prisma_migrations postgres
if not "%FAKE_MISSING_USER%"=="1" echo 3; 0 0 TABLE public User postgres
if not "%FAKE_MISSING_WORKOUT%"=="1" echo 4; 0 0 TABLE public Workout postgres
if not "%FAKE_MISSING_MESOCYCLE%"=="1" echo 5; 0 0 TABLE public Mesocycle postgres
exit /b 0
'@
Set-Content -LiteralPath (Join-Path $fakeBin 'pg_dump.cmd') -Value $pgDump -Encoding ascii
Set-Content -LiteralPath (Join-Path $fakeBin 'pg_restore.cmd') -Value $pgRestore -Encoding ascii

$validBackup = $null
$junctionPath = $null
try {
    Invoke-Case 'correct direct endpoint creates a public-schema backup' {
        $destination = Join-Path $testRoot 'direct-success'
        $result = Invoke-Backup -Destination $destination
        Assert-Equal $result.ExitCode 0 "Direct backup failed. $($result.Output)"
        $script:validBackup = Get-OnlyBackupDirectory $destination
        $manifest = Read-Manifest $script:validBackup
        Assert-Equal $manifest.target.connectionMode 'direct' 'Direct connection mode mismatch.'
        Assert-Equal $manifest.target.dumpScope 'public' 'Dump scope mismatch.'
    }

    Invoke-Case 'process-environment source is explicit and supported' {
        $result = Invoke-Backup -Destination (Join-Path $testRoot 'process-env') -UseProcessEnvironment
        Assert-Equal $result.ExitCode 0 "Explicit process environment failed. $($result.Output)"
    }

    Invoke-Case 'session pooler requires explicit fallback flag' {
        $url = "postgresql://postgres.${expectedReference}:secret-value@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"
        $result = Invoke-Backup -Destination (Join-Path $testRoot 'pooler-no-flag') -Url $url
        Assert-True ($result.ExitCode -ne 0) 'Session pooler passed without opt-in.'
    }

    Invoke-Case 'explicit session pooler fallback succeeds' {
        $url = "postgresql://postgres.${expectedReference}:secret-value@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"
        $result = Invoke-Backup -Destination (Join-Path $testRoot 'pooler-success') -Url $url -AllowSessionPooler
        Assert-Equal $result.ExitCode 0 "Explicit session pooler failed. $($result.Output)"
        $manifest = Read-Manifest (Get-OnlyBackupDirectory (Join-Path $testRoot 'pooler-success'))
        Assert-Equal $manifest.target.connectionMode 'session_pooler' 'Session-pooler mode mismatch.'
    }

    $invalidTargets = @(
        @{ Name = 'transaction pooler'; Url = "postgresql://postgres.${expectedReference}:secret-value@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require"; Ref = $expectedReference; Flag = $true },
        @{ Name = 'wrong project reference'; Url = $directUrl; Ref = $otherReference; Flag = $false },
        @{ Name = 'wrong database name'; Url = "postgresql://postgres:secret-value@db.$expectedReference.supabase.co:5432/trainer?sslmode=require"; Ref = $expectedReference; Flag = $false },
        @{ Name = 'missing TLS'; Url = "postgresql://postgres:secret-value@db.$expectedReference.supabase.co:5432/postgres"; Ref = $expectedReference; Flag = $false },
        @{ Name = 'unsupported host'; Url = "postgresql://postgres:secret-value@example.com:5432/postgres?sslmode=require"; Ref = $expectedReference; Flag = $false },
        @{ Name = 'unsupported URL option'; Url = "postgresql://postgres:secret-value@db.$expectedReference.supabase.co:5432/postgres?sslmode=require&application_name=x"; Ref = $expectedReference; Flag = $false }
    )
    foreach ($case in $invalidTargets) {
        Invoke-Case "$($case.Name) is rejected" {
            $result = Invoke-Backup -Destination (Join-Path $testRoot ([guid]::NewGuid().ToString('N'))) -Url $case.Url -ProjectReference $case.Ref -AllowSessionPooler:([bool]$case.Flag)
            Assert-True ($result.ExitCode -ne 0) "$($case.Name) unexpectedly passed."
        }
    }

    Invoke-Case 'credentials and complete URL are redacted' {
        $result = Invoke-Backup -Destination (Join-Path $testRoot 'redaction') -Environment @{ FAKE_DUMP_FAIL = '1' }
        Assert-True ($result.ExitCode -ne 0) 'Forced dump failure unexpectedly passed.'
        Assert-True ($result.Output -notmatch 'secret-value|postgres(?:ql)?://') 'Credential or URL leaked.'
    }

    Invoke-Case 'inherited PostgreSQL service variables are removed from tools and parent remains unchanged' {
        $environmentLog = Join-Path $testRoot 'environment.log'
        $priorService = [System.Environment]::GetEnvironmentVariable('PGSERVICE', 'Process')
        try {
            [System.Environment]::SetEnvironmentVariable('PGSERVICE', 'parent-service', 'Process')
            $result = Invoke-Backup -Destination (Join-Path $testRoot 'environment') -Environment @{
                PGSERVICE = 'forbidden-service'
                TRAINER_FAKE_ENVIRONMENT_LOG = $environmentLog
            }
            Assert-Equal $result.ExitCode 0 "Environment isolation backup failed. $($result.Output)"
            $log = Get-Content -Raw -LiteralPath $environmentLog
            Assert-True ($log -notmatch 'forbidden-service') 'Fake tool inherited PGSERVICE.'
            Assert-Equal ([System.Environment]::GetEnvironmentVariable('PGSERVICE', 'Process')) 'parent-service' 'Parent process environment changed.'
        }
        finally {
            [System.Environment]::SetEnvironmentVariable('PGSERVICE', $priorService, 'Process')
        }
    }

    Invoke-Case 'repository destination is rejected before artifact creation' {
        $destination = Join-Path $repositoryRoot 'forbidden-backup-output'
        $result = Invoke-Backup -Destination $destination
        Assert-True ($result.ExitCode -ne 0) 'Repository destination unexpectedly passed.'
        Assert-True (-not (Test-Path -LiteralPath $destination)) 'Repository artifact was created.'
    }

    Invoke-Case 'destination reparse point is rejected' {
        $junctionTarget = Join-Path $testRoot 'junction-target'
        $script:junctionPath = Join-Path $testRoot 'junction-destination'
        New-Item -ItemType Directory -Path $junctionTarget | Out-Null
        New-Item -ItemType Junction -Path $script:junctionPath -Target $junctionTarget | Out-Null
        $result = Invoke-Backup -Destination $script:junctionPath
        Assert-True ($result.ExitCode -ne 0) 'Reparse destination unexpectedly passed.'
        Remove-Item -LiteralPath $script:junctionPath -Force
        $script:junctionPath = $null
    }

    Invoke-Case 'explicit PostgreSQL binary directory takes precedence' {
        $argumentLog = Join-Path $testRoot 'explicit-bin.log'
        $result = Invoke-Backup -Destination (Join-Path $testRoot 'explicit-bin') -Environment @{ TRAINER_FAKE_ARGUMENT_LOG = $argumentLog }
        Assert-Equal $result.ExitCode 0 "Explicit binary directory failed. $($result.Output)"
        Assert-True (Test-Path -LiteralPath $argumentLog) 'Explicit fake tools were not invoked.'
    }

    Invoke-Case 'PATH PostgreSQL tool resolution succeeds' {
        $result = Invoke-Backup -Destination (Join-Path $testRoot 'path-bin') -UsePath
        Assert-Equal $result.ExitCode 0 "PATH tool resolution failed. $($result.Output)"
    }

    Invoke-Case 'missing pg_dump fails clearly' {
        $bin = Join-Path $testRoot 'restore-only'
        New-Item -ItemType Directory -Path $bin | Out-Null
        Copy-Item -LiteralPath (Join-Path $fakeBin 'pg_restore.cmd') -Destination $bin
        $result = Invoke-Backup -Destination (Join-Path $testRoot 'missing-dump') -BinDirectory $bin
        Assert-True ($result.ExitCode -ne 0 -and $result.Output -match 'pg_dump') 'Missing pg_dump did not fail clearly.'
    }

    Invoke-Case 'missing pg_restore fails clearly' {
        $bin = Join-Path $testRoot 'dump-only'
        New-Item -ItemType Directory -Path $bin | Out-Null
        Copy-Item -LiteralPath (Join-Path $fakeBin 'pg_dump.cmd') -Destination $bin
        $result = Invoke-Backup -Destination (Join-Path $testRoot 'missing-restore') -BinDirectory $bin
        Assert-True ($result.ExitCode -ne 0 -and $result.Output -match 'pg_restore') 'Missing pg_restore did not fail clearly.'
    }

    Invoke-Case 'malformed PostgreSQL version output fails' {
        $result = Invoke-Backup -Destination (Join-Path $testRoot 'bad-version') -Environment @{ FAKE_MALFORMED_DUMP_VERSION = '1' }
        Assert-True ($result.ExitCode -ne 0) 'Malformed version unexpectedly passed.'
    }

    Invoke-Case 'older pg_restore than pg_dump fails compatibility check' {
        $result = Invoke-Backup -Destination (Join-Path $testRoot 'incompatible-tools') -Environment @{
            FAKE_DUMP_MAJOR = '17'
            FAKE_RESTORE_MAJOR = '16'
        }
        Assert-True ($result.ExitCode -ne 0 -and $result.Output -match 'must not be older') 'Incompatible tools unexpectedly passed.'
    }

    Invoke-Case 'exact pg_dump and pg_restore list arguments contain no secret' {
        $argumentLog = Join-Path $testRoot 'arguments.log'
        $result = Invoke-Backup -Destination (Join-Path $testRoot 'arguments') -Environment @{ TRAINER_FAKE_ARGUMENT_LOG = $argumentLog }
        Assert-Equal $result.ExitCode 0 "Argument-contract backup failed. $($result.Output)"
        $log = Get-Content -Raw -LiteralPath $argumentLog
        Assert-True ($log -match 'pg_dump\|--format custom --schema public --file ') 'pg_dump arguments are incomplete.'
        Assert-True ($log -match 'pg_restore\|--list ') 'pg_restore list arguments are incomplete.'
        Assert-True ($log -notmatch 'no-owner|no-privileges|secret-value|postgres(?:ql)?://') 'Arguments contain forbidden ownership flags or secrets.'
    }

    $artifactFailures = @(
        @{ Name = 'dump command failure'; Environment = @{ FAKE_DUMP_FAIL = '1' } },
        @{ Name = 'exit zero with missing archive'; Environment = @{ FAKE_DUMP_MISSING = '1' } },
        @{ Name = 'exit zero with zero-byte archive'; Environment = @{ FAKE_DUMP_ZERO = '1' } },
        @{ Name = 'archive listing failure'; Environment = @{ FAKE_LIST_FAIL = '1' } },
        @{ Name = 'missing public schema'; Environment = @{ FAKE_MISSING_PUBLIC = '1' } },
        @{ Name = 'missing Prisma migration table'; Environment = @{ FAKE_MISSING_PRISMA = '1' } },
        @{ Name = 'missing required Trainer table'; Environment = @{ FAKE_MISSING_WORKOUT = '1' } }
    )
    foreach ($case in $artifactFailures) {
        Invoke-Case "$($case.Name) leaves no successful artifact" {
            $destination = Join-Path $testRoot ([guid]::NewGuid().ToString('N'))
            $result = Invoke-Backup -Destination $destination -Environment $case.Environment
            Assert-True ($result.ExitCode -ne 0) "$($case.Name) unexpectedly passed."
            $manifests = @(
                if (Test-Path -LiteralPath $destination) {
                    Get-ChildItem -LiteralPath $destination -Filter manifest.json -File -Recurse -ErrorAction SilentlyContinue
                }
            )
            Assert-Equal $manifests.Count 0 "$($case.Name) left a success manifest."
            $partials = @(
                if (Test-Path -LiteralPath $destination) {
                    Get-ChildItem -LiteralPath $destination -Directory |
                        Where-Object { $_.Name.EndsWith('.partial') }
                }
            )
            Assert-Equal $partials.Count 0 "$($case.Name) left a partial directory."
        }
    }

    Invoke-Case 'successful manifest records hash, size, timestamps, objects, and honest evidence' {
        $manifest = Read-Manifest $validBackup
        $archive = Join-Path $validBackup 'database.dump'
        $hash = (Microsoft.PowerShell.Utility\Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
        Assert-Equal $manifest.archive.sha256 $hash 'Manifest hash mismatch.'
        Assert-Equal ([long]$manifest.archive.sizeBytes) (Get-Item -LiteralPath $archive).Length 'Manifest size mismatch.'
        Assert-True ([DateTimeOffset]$manifest.timestamps.startedAtUtc -le [DateTimeOffset]$manifest.timestamps.completedAtUtc) 'Timestamp order is invalid.'
        Assert-True $manifest.objectPresence.allExpectedObjects 'Expected objects were not recorded.'
        Assert-True ($manifest.evidence.restoreTested -eq $false -and $manifest.restoreStatus -eq 'not_tested') 'Restore evidence is dishonest.'
    }

    Invoke-Case 'unique backup output never overwrites' {
        $destination = Join-Path $testRoot 'unique-output'
        Assert-Equal (Invoke-Backup -Destination $destination).ExitCode 0 'First unique backup failed.'
        Assert-Equal (Invoke-Backup -Destination $destination).ExitCode 0 'Second unique backup failed.'
        Assert-Equal @(Get-ChildItem -LiteralPath $destination -Directory).Count 2 'Unique output count mismatch.'
    }

    Invoke-Case 'incorrect confirmation fails before directory creation' {
        $destination = Join-Path $testRoot 'bad-confirmation'
        $result = Invoke-Backup -Destination $destination -Confirmation 'yes'
        Assert-True ($result.ExitCode -ne 0) 'Incorrect confirmation unexpectedly passed.'
        Assert-True (-not (Test-Path -LiteralPath $destination)) 'Destination was created before confirmation.'
    }

    Invoke-Case 'manifest-write failure removes partial state and success evidence' {
        $injected = New-InjectedBackupScript `
            -Name 'manifest-failure' `
            -Needle '$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM' `
            -Replacement 'throw "simulated manifest write failure"'
        $destination = Join-Path $testRoot 'manifest-failure-output'
        $result = Invoke-Backup -Destination $destination -ScriptPath $injected
        Assert-True ($result.ExitCode -ne 0) 'Manifest failure unexpectedly passed.'
        Assert-Equal @(Get-ChildItem -LiteralPath $destination -Force -ErrorAction SilentlyContinue).Count 0 'Manifest failure left artifact state.'
    }

    Invoke-Case 'final-rename failure removes success manifest and partial state' {
        $injected = New-InjectedBackupScript `
            -Name 'rename-failure' `
            -Needle 'Move-Item -LiteralPath $partialPath -Destination $finalPath' `
            -Replacement 'throw "simulated final rename failure"'
        $destination = Join-Path $testRoot 'rename-failure-output'
        $result = Invoke-Backup -Destination $destination -ScriptPath $injected
        Assert-True ($result.ExitCode -ne 0) 'Rename failure unexpectedly passed.'
        $manifests = @(Get-ChildItem -LiteralPath $destination -Filter manifest.json -File -Recurse -ErrorAction SilentlyContinue)
        Assert-Equal $manifests.Count 0 'Rename failure left a success manifest.'
        $partials = @(Get-ChildItem -LiteralPath $destination -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name.EndsWith('.partial') })
        Assert-Equal $partials.Count 0 'Rename failure left a partial directory.'
    }

    Invoke-Case 'valid offline artifact inspection freshly lists archive' {
        $argumentLog = Join-Path $testRoot 'inspect-list.log'
        $result = Invoke-Inspector -Directory $validBackup -Environment @{ TRAINER_FAKE_ARGUMENT_LOG = $argumentLog }
        Assert-Equal $result.ExitCode 0 "Valid inspection failed. $($result.Output)"
        Assert-True ((Get-Content -Raw -LiteralPath $argumentLog) -match 'pg_restore\|--list ') 'Inspector did not freshly list the archive.'
        Assert-True ($result.Output -match 'Restore not tested' -and $result.Output -match 'Application recovery not proven') 'Inspector conclusion was not honest.'
    }

    $manifestMutations = @(
        @{ Name = 'wrong project'; Mutate = { param($m) $m.target.projectReference = $otherReference } },
        @{ Name = 'wrong database'; Mutate = { param($m) $m.target.database = 'trainer' } },
        @{ Name = 'wrong scope'; Mutate = { param($m) $m.target.dumpScope = 'all' } },
        @{ Name = 'stale completion'; Mutate = { param($m) $m.timestamps.startedAtUtc = [DateTimeOffset]::UtcNow.AddHours(-3).ToString('o'); $m.timestamps.completedAtUtc = [DateTimeOffset]::UtcNow.AddHours(-2).ToString('o') } },
        @{ Name = 'future completion'; Mutate = { param($m) $m.timestamps.startedAtUtc = [DateTimeOffset]::UtcNow.AddHours(1).ToString('o'); $m.timestamps.completedAtUtc = [DateTimeOffset]::UtcNow.AddHours(2).ToString('o') } },
        @{ Name = 'dishonest restore state'; Mutate = { param($m) $m.evidence.restoreTested = $true } }
    )
    foreach ($case in $manifestMutations) {
        Invoke-Case "offline inspection rejects $($case.Name)" {
            $fixture = Copy-BackupFixture -Source $validBackup -Name ([guid]::NewGuid().ToString('N'))
            $manifest = Read-Manifest $fixture
            & $case.Mutate $manifest
            Write-Manifest -Directory $fixture -Manifest $manifest
            $result = Invoke-Inspector -Directory $fixture
            Assert-True ($result.ExitCode -ne 0) "$($case.Name) unexpectedly passed."
        }
    }

    Invoke-Case 'offline inspection rejects missing manifest' {
        $fixture = Copy-BackupFixture -Source $validBackup -Name 'missing-manifest'
        Remove-Item -LiteralPath (Join-Path $fixture 'manifest.json') -Force
        Assert-True ((Invoke-Inspector -Directory $fixture).ExitCode -ne 0) 'Missing manifest unexpectedly passed.'
    }

    Invoke-Case 'offline inspection rejects malformed manifest' {
        $fixture = Copy-BackupFixture -Source $validBackup -Name 'malformed-manifest'
        Set-Content -LiteralPath (Join-Path $fixture 'manifest.json') -Value '{invalid' -Encoding utf8NoBOM
        Assert-True ((Invoke-Inspector -Directory $fixture).ExitCode -ne 0) 'Malformed manifest unexpectedly passed.'
    }

    Invoke-Case 'offline inspection rejects missing archive' {
        $fixture = Copy-BackupFixture -Source $validBackup -Name 'missing-archive'
        Remove-Item -LiteralPath (Join-Path $fixture 'database.dump') -Force
        Assert-True ((Invoke-Inspector -Directory $fixture).ExitCode -ne 0) 'Missing archive unexpectedly passed.'
    }

    Invoke-Case 'offline inspection rejects size mismatch' {
        $fixture = Copy-BackupFixture -Source $validBackup -Name 'size-mismatch'
        $manifest = Read-Manifest $fixture
        $manifest.archive.sizeBytes = [long]$manifest.archive.sizeBytes + 1
        Write-Manifest -Directory $fixture -Manifest $manifest
        Assert-True ((Invoke-Inspector -Directory $fixture).ExitCode -ne 0) 'Size mismatch unexpectedly passed.'
    }

    Invoke-Case 'offline inspection rejects hash mismatch' {
        $fixture = Copy-BackupFixture -Source $validBackup -Name 'hash-mismatch'
        Add-Content -LiteralPath (Join-Path $fixture 'database.dump') -Value 'tamper'
        $manifest = Read-Manifest $fixture
        $manifest.archive.sizeBytes = (Get-Item -LiteralPath (Join-Path $fixture 'database.dump')).Length
        Write-Manifest -Directory $fixture -Manifest $manifest
        Assert-True ((Invoke-Inspector -Directory $fixture).ExitCode -ne 0) 'Hash mismatch unexpectedly passed.'
    }

    Invoke-Case 'offline inspection rejects fresh listing failure' {
        Assert-True ((Invoke-Inspector -Directory $validBackup -Environment @{ FAKE_LIST_FAIL = '1' }).ExitCode -ne 0) 'Fresh listing failure unexpectedly passed.'
    }

    Invoke-Case 'offline inspection rejects missing object in fresh listing' {
        Assert-True ((Invoke-Inspector -Directory $validBackup -Environment @{ FAKE_MISSING_MESOCYCLE = '1' }).ExitCode -ne 0) 'Fresh missing object unexpectedly passed.'
    }

    Invoke-Case 'offline inspection rejects partial directory name' {
        $fixture = Copy-BackupFixture -Source $validBackup -Name 'artifact.partial'
        Assert-True ((Invoke-Inspector -Directory $fixture).ExitCode -ne 0) 'Partial directory unexpectedly passed.'
    }

    Invoke-Case 'scripts contain no migration executor, shared hash helper, summary, or editable restore flag' {
        $source = (Get-Content -Raw -LiteralPath $backupScript) + (Get-Content -Raw -LiteralPath $inspectScript)
        Assert-True ($source -notmatch '(?i)prisma\s+migrate|summary\.txt|Get-TrainerFileSha256|restoreVerified') 'Forbidden workflow surface was introduced.'
        Assert-True ($source -match 'Microsoft\.PowerShell\.Utility\\Get-FileHash') 'Module-qualified native hashing is missing.'
    }

    Invoke-Case 'canonical operations documentation contains the backup and restore contract' {
        $operationsPath = Join-Path $repositoryRoot 'trainer-app\docs\07_OPERATIONS.md'
        $operations = Get-Content -Raw -LiteralPath $operationsPath
        foreach ($requiredText in @(
                'Backup-TrainerProduction.ps1',
                'Inspect-TrainerBackup.ps1',
                'TRAINER_PRODUCTION_DATABASE_URL',
                'pg_restore --exit-on-error --no-owner --no-privileges',
                'Supabase Storage objects are not included',
                'latest three successful backups'
            )) {
            Assert-True ($operations.Contains($requiredText)) "Operations documentation is missing: $requiredText"
        }
        Assert-True ($operations -notmatch 'Assert-TrainerMigrationBackup|Get-TrainerFileSha256|summary\.txt') 'Operations documentation references an excluded surface.'
    }
}
finally {
    if ($null -ne $junctionPath -and (Test-Path -LiteralPath $junctionPath)) {
        Remove-Item -LiteralPath $junctionPath -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}

Write-Output "Tests passed: $passed"
Write-Output "Tests failed: $failed"
if ($failed -gt 0) { exit 1 }
exit 0
