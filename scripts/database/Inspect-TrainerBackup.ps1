[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDirectory,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ExpectedProjectReference,

    [ValidateRange(1, 525600)]
    [int]$MaximumAgeMinutes = 60,

    [string]$PostgreSQLBinDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$requiredTables = @('User', 'Workout', 'Mesocycle')

function Resolve-InspectorPostgresTool {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][string]$BinDirectory
    )

    if (-not [string]::IsNullOrWhiteSpace($BinDirectory)) {
        $directory = [System.IO.Path]::GetFullPath($BinDirectory)
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            throw "The PostgreSQL binary directory does not exist."
        }
        foreach ($extension in @('.exe', '.cmd', '.bat', '')) {
            $candidate = Join-Path $directory ($Name + $extension)
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
        }
        throw "Required PostgreSQL tool '$Name' was not found in the explicit binary directory."
    }
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw "Required PostgreSQL tool '$Name' was not found on PATH." }
    return $command.Source
}

function Invoke-InspectorCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        & $Executable @Arguments 1> $stdoutPath 2> $stderrPath
        [pscustomobject]@{
            ExitCode = [int]$LASTEXITCODE
            StdOut = [string](Get-Content -Raw -LiteralPath $stdoutPath -ErrorAction SilentlyContinue)
            StdErr = [string](Get-Content -Raw -LiteralPath $stderrPath -ErrorAction SilentlyContinue)
        }
    }
    finally {
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Test-InspectorArchiveObjects {
    param([Parameter(Mandatory = $true)][string]$Listing)

    $publicPresent = [regex]::IsMatch($Listing, '(?im)\bSCHEMA\b.*\bpublic\b')
    $prismaPresent = [regex]::IsMatch($Listing, '(?im)\bTABLE(?: DATA)?\b.*\bpublic\b.*\b_prisma_migrations\b')
    $tables = [ordered]@{}
    foreach ($table in $requiredTables) {
        $tables[$table] = [regex]::IsMatch(
            $Listing,
            "(?im)\bTABLE(?: DATA)?\b.*\bpublic\b.*\b$([regex]::Escape($table))\b"
        )
    }
    [pscustomobject]@{
        PublicSchema = $publicPresent
        PrismaMigrations = $prismaPresent
        RequiredTables = $tables
        AllExpectedObjects = $publicPresent -and $prismaPresent -and -not ($tables.Values -contains $false)
    }
}

try {
    $backupPath = [System.IO.Path]::GetFullPath($BackupDirectory).TrimEnd('\', '/')
    $leaf = Split-Path -Leaf $backupPath
    if ($leaf.EndsWith('.partial', [System.StringComparison]::OrdinalIgnoreCase) -or
        $leaf -match '(?i)\.failed(?:-|$)') {
        throw "Partial or failed backup directories cannot be inspected as successful artifacts."
    }
    if (-not (Test-Path -LiteralPath $backupPath -PathType Container)) {
        throw "The backup directory does not exist."
    }

    $manifestPath = Join-Path $backupPath 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "manifest.json is missing." }
    try {
        $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    }
    catch {
        throw "manifest.json is malformed."
    }

    if ($manifest.schemaVersion -ne 1 -or $manifest.status -cne 'successful') {
        throw "The manifest schema or status is not a supported successful artifact."
    }
    if ($manifest.target.projectReference -cne $ExpectedProjectReference) {
        throw "The manifest project reference does not match the expected project."
    }
    if ($manifest.target.database -cne 'postgres') { throw "The manifest database must be postgres." }
    if ($manifest.target.dumpScope -cne 'public') { throw "The manifest dump scope must be public." }
    if ($manifest.target.connectionMode -notin @('direct', 'session_pooler')) {
        throw "The manifest connection mode is missing or unsupported."
    }
    if ($manifest.target.tlsMode -notin @('require', 'verify-ca', 'verify-full')) {
        throw "The manifest TLS evidence is missing or unsupported."
    }
    if ([string]::IsNullOrWhiteSpace([string]$manifest.target.host) -or $manifest.target.port -ne 5432) {
        throw "The manifest sanitized target identity is incomplete."
    }

    $evidence = $manifest.evidence
    if ($evidence.dumpProcessCompleted -ne $true -or
        $evidence.archiveNonempty -ne $true -or
        $evidence.archiveListingSucceeded -ne $true -or
        $evidence.expectedObjectsPresent -ne $true -or
        $evidence.checksumRecorded -ne $true -or
        $evidence.restoreTested -ne $false -or
        $evidence.applicationQueryTested -ne $false -or
        $manifest.restoreStatus -cne 'not_tested' -or
        $manifest.applicationQueryStatus -cne 'not_tested') {
        throw "The manifest evidence state is incomplete or internally inconsistent."
    }
    if ($manifest.objectPresence.publicSchema -ne $true -or
        $manifest.objectPresence.prismaMigrations -ne $true -or
        $manifest.objectPresence.allExpectedObjects -ne $true) {
        throw "The manifest expected-object evidence is incomplete."
    }
    foreach ($table in $requiredTables) {
        if ($manifest.objectPresence.requiredTables.$table -ne $true) {
            throw "The manifest is missing required table evidence for $table."
        }
    }

    $archivePath = Join-Path $backupPath ([string]$manifest.archive.fileName)
    if ($manifest.archive.fileName -cne 'database.dump' -or
        -not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        throw "database.dump is missing."
    }
    $archive = Get-Item -LiteralPath $archivePath
    if ($archive.Length -le 0 -or [long]$manifest.archive.sizeBytes -ne $archive.Length) {
        throw "The archive size does not match the manifest."
    }
    $actualHash = (Microsoft.PowerShell.Utility\Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
    if ([string]$manifest.archive.sha256 -cne $actualHash) { throw "The archive SHA-256 does not match the manifest." }

    $completedAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$manifest.timestamps.completedAtUtc, [ref]$completedAt)) {
        throw "The completion timestamp is invalid."
    }
    $startedAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$manifest.timestamps.startedAtUtc, [ref]$startedAt) -or
        $startedAt -gt $completedAt) {
        throw "The backup start/completion timestamp order is invalid."
    }
    $now = [DateTimeOffset]::UtcNow
    if ($completedAt -gt $now.AddMinutes(5)) { throw "The completion timestamp is unreasonably in the future." }
    $age = $now - $completedAt
    if ($age.TotalMinutes -gt $MaximumAgeMinutes) {
        throw "The backup is older than the selected maximum age of $MaximumAgeMinutes minutes."
    }

    $pgRestorePath = Resolve-InspectorPostgresTool -Name 'pg_restore' -BinDirectory $PostgreSQLBinDirectory
    $listResult = Invoke-InspectorCommand -Executable $pgRestorePath -Arguments @('--list', $archivePath)
    if ($listResult.ExitCode -ne 0) { throw "Fresh pg_restore --list inspection failed." }
    $objects = Test-InspectorArchiveObjects -Listing $listResult.StdOut
    if (-not $objects.AllExpectedObjects) {
        throw "The fresh archive listing is missing public, _prisma_migrations, or a required Trainer table."
    }

    Write-Output 'PASS: Trainer backup artifact inspection passed.'
    Write-Output "Backup directory: $backupPath"
    Write-Output "Project: $ExpectedProjectReference"
    Write-Output "Connection evidence: host=$($manifest.target.host) port=$($manifest.target.port) database=postgres mode=$($manifest.target.connectionMode) tls=$($manifest.target.tlsMode)"
    Write-Output 'Dump scope: public'
    Write-Output "Completion age (minutes): $([math]::Round($age.TotalMinutes, 2))"
    Write-Output 'Archive listable: yes'
    Write-Output 'Expected objects present: yes'
    Write-Output 'Checksum matches: yes'
    Write-Output 'Restore not tested.'
    Write-Output 'Restored-data query not tested.'
    Write-Output 'Application recovery not proven.'
}
catch {
    Write-Error "Trainer backup inspection failed: $($_.Exception.Message)"
    throw
}
