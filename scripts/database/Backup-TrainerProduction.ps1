[CmdletBinding()]
param(
    [Parameter(ParameterSetName = 'EnvironmentFile', Mandatory = $true)]
    [string]$EnvironmentFilePath,

    [Parameter(ParameterSetName = 'ProcessEnvironment', Mandatory = $true)]
    [switch]$UseProcessEnvironment,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ExpectedProjectReference,

    [Parameter(Mandatory = $true)]
    [string]$DestinationRoot,

    [string]$PostgreSQLBinDirectory,

    [switch]$AllowSessionPooler,

    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$GitShaOverride
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:SensitiveValues = [System.Collections.Generic.List[string]]::new()
$script:PostgresEnvironmentNames = @(
    'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE',
    'PGCONNECT_TIMEOUT', 'PGAPPNAME', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS'
)
$script:RequiredTables = @('User', 'Workout', 'Mesocycle')

function Protect-TrainerBackupText {
    param([AllowNull()][string]$Text)

    if ($null -eq $Text) { return '' }
    $safe = $Text
    foreach ($secret in $script:SensitiveValues) {
        if (-not [string]::IsNullOrEmpty($secret)) {
            $safe = $safe.Replace($secret, '<redacted>')
            $escaped = [uri]::EscapeDataString($secret)
            if ($escaped -ne $secret) { $safe = $safe.Replace($escaped, '<redacted>') }
        }
    }
    $safe = [regex]::Replace($safe, '(?i)postgres(?:ql)?://[^\s"'']+', '<redacted-database-url>')
    $safe = [regex]::Replace($safe, '(?i)(?:password|passwd|pwd)\s*[:=]\s*[^\s,;]+', 'password=<redacted>')
    return $safe
}

function Get-NormalizedTrainerPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Assert-NoTrainerReparsePoint {
    param([Parameter(Mandatory = $true)][string]$Path)

    $cursor = Get-NormalizedTrainerPath $Path
    while (-not (Test-Path -LiteralPath $cursor)) {
        $parent = Split-Path -Parent $cursor
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) {
            throw "Path cannot be resolved safely: $Path"
        }
        $cursor = $parent
    }

    while (-not [string]::IsNullOrWhiteSpace($cursor)) {
        $item = Get-Item -Force -LiteralPath $cursor
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Destination paths must not traverse a reparse point or junction."
        }
        $parent = Split-Path -Parent $cursor
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Test-TrainerPathInside {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Parent
    )

    $candidatePath = Get-NormalizedTrainerPath $Candidate
    $parentPath = Get-NormalizedTrainerPath $Parent
    $candidatePath.Equals($parentPath, [System.StringComparison]::OrdinalIgnoreCase) -or
        $candidatePath.StartsWith(
            $parentPath + [System.IO.Path]::DirectorySeparatorChar,
            [System.StringComparison]::OrdinalIgnoreCase
        )
}

function Read-TrainerEnvironmentFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot
    )

    $fullPath = Get-NormalizedTrainerPath $Path
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "The selected environment file does not exist."
    }
    if (Test-TrainerPathInside -Candidate $fullPath -Parent $RepositoryRoot) {
        $ignoreOutput = & git -C $RepositoryRoot check-ignore --quiet -- $fullPath 2>&1
        if ($LASTEXITCODE -ne 0) {
            $null = $ignoreOutput
            throw "A repository-local environment file must be ignored by Git."
        }
    }

    $values = @{}
    foreach ($rawLine in Get-Content -LiteralPath $fullPath) {
        $line = $rawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }
        if ($line.StartsWith('export ')) { $line = $line.Substring(7).Trim() }
        $separator = $line.IndexOf('=')
        if ($separator -lt 1) { throw "The selected environment file contains an invalid assignment." }
        $name = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            throw "The selected environment file contains an invalid variable name."
        }
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$name] = $value
    }
    return $values
}

function ConvertFrom-TrainerProductionDatabaseUrl {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$ExpectedReference,
        [Parameter(Mandatory = $true)][bool]$SessionPoolerAllowed
    )

    try { $uri = [uri]$Url } catch { throw "TRAINER_PRODUCTION_DATABASE_URL is not a valid PostgreSQL URL." }
    if ($uri.Scheme -notin @('postgres', 'postgresql') -or [string]::IsNullOrWhiteSpace($uri.Host)) {
        throw "TRAINER_PRODUCTION_DATABASE_URL must be a PostgreSQL URL with a host."
    }
    if (-not [string]::IsNullOrEmpty($uri.Fragment)) { throw "URL fragments are not supported." }

    $userSeparator = $uri.UserInfo.IndexOf(':')
    if ($userSeparator -lt 1) { throw "The database URL must include an explicit username and password." }
    $databaseUser = [uri]::UnescapeDataString($uri.UserInfo.Substring(0, $userSeparator))
    $databasePassword = [uri]::UnescapeDataString($uri.UserInfo.Substring($userSeparator + 1))
    if ([string]::IsNullOrWhiteSpace($databaseUser) -or [string]::IsNullOrEmpty($databasePassword)) {
        throw "The database URL must include an explicit username and password."
    }
    $script:SensitiveValues.Add($databasePassword)

    $hostName = $uri.Host.ToLowerInvariant()
    $port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    if ($port -eq 6543) { throw "Supabase transaction-pooler port 6543 is not supported." }
    if ($port -ne 5432) { throw "Only PostgreSQL port 5432 is supported." }

    $hostProjectReference = $null
    $userProjectReference = $null
    $connectionMode = $null
    if ($hostName -match '^db\.([a-z0-9]{20})\.supabase\.co$') {
        $hostProjectReference = $Matches[1]
        $connectionMode = 'direct'
    }
    elseif ($hostName -match '^[a-z0-9-]+\.pooler\.supabase\.com$') {
        if (-not $SessionPoolerAllowed) {
            throw "A session-pooler endpoint requires the explicit -AllowSessionPooler flag."
        }
        if ($databaseUser -notmatch '^postgres\.([a-z0-9]{20})$') {
            throw "The session-pooler username must identify the project as postgres.<project-reference>."
        }
        $userProjectReference = $Matches[1]
        $connectionMode = 'session_pooler'
    }
    else {
        throw "The database host is not a supported Supabase direct or session-pooler endpoint."
    }

    if ($hostProjectReference -and $databaseUser -match '^postgres\.([a-z0-9]{20})$') {
        $userProjectReference = $Matches[1]
    }
    $references = @(
        @($hostProjectReference, $userProjectReference) |
            Where-Object { $_ } |
            Select-Object -Unique
    )
    if (@($references).Count -ne 1 -or $references[0] -cne $ExpectedReference) {
        throw "The database URL does not identify the expected Supabase project."
    }

    $databaseName = [uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    if ($databaseName -cne 'postgres') { throw "The database name must be postgres." }

    $options = @{}
    foreach ($pair in $uri.Query.TrimStart('?').Split('&')) {
        if ([string]::IsNullOrWhiteSpace($pair)) { continue }
        $separator = $pair.IndexOf('=')
        if ($separator -lt 1) { throw "Every connection option must have one explicit value." }
        $key = [uri]::UnescapeDataString($pair.Substring(0, $separator)).ToLowerInvariant()
        $value = [uri]::UnescapeDataString($pair.Substring($separator + 1))
        if ($options.ContainsKey($key)) { throw "Duplicate connection option '$key' is not supported." }
        if ($key -cne 'sslmode') { throw "Unsupported connection option '$key'." }
        $options[$key] = $value
    }
    if (-not $options.ContainsKey('sslmode') -or $options.sslmode -notin @('require', 'verify-ca', 'verify-full')) {
        throw "sslmode=require, verify-ca, or verify-full is required."
    }

    [pscustomobject][ordered]@{
        Host = $hostName
        Port = $port
        Database = $databaseName
        User = $databaseUser
        Password = $databasePassword
        TlsMode = $options.sslmode
        ProjectReference = $references[0]
        ConnectionMode = $connectionMode
    }
}

function Resolve-TrainerPostgresTool {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][string]$BinDirectory
    )

    if (-not [string]::IsNullOrWhiteSpace($BinDirectory)) {
        $directory = Get-NormalizedTrainerPath $BinDirectory
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

function Invoke-TrainerCapturedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments
    )

    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        & $Executable @Arguments 1> $stdoutPath 2> $stderrPath
        $exitCode = [int]$LASTEXITCODE
        [pscustomobject]@{
            ExitCode = $exitCode
            StdOut = Protect-TrainerBackupText ([string](Get-Content -Raw -LiteralPath $stdoutPath -ErrorAction SilentlyContinue))
            StdErr = Protect-TrainerBackupText ([string](Get-Content -Raw -LiteralPath $stderrPath -ErrorAction SilentlyContinue))
        }
    }
    finally {
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Get-TrainerCommandFailure {
    param([Parameter(Mandatory = $true)]$Result)

    $line = @($Result.StdErr, $Result.StdOut) |
        ForEach-Object { $_ -split "`r?`n" } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -First 1
    if ($line) { return $line.Trim() }
    return 'No child-process error text was captured.'
}

function Get-TrainerPostgresVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Executable
    )

    $result = Invoke-TrainerCapturedCommand -Executable $Executable -Arguments @('--version')
    if ($result.ExitCode -ne 0) {
        throw "Unable to read the $Name version: $(Get-TrainerCommandFailure $result)"
    }
    $text = ($result.StdOut + ' ' + $result.StdErr).Trim()
    if ($text -notmatch '(?i)\bPostgreSQL\)?\s+(\d+)(?:\.(\d+))?') {
        throw "Unable to parse the $Name PostgreSQL version."
    }
    [pscustomobject]@{ Text = $text; Major = [int]$Matches[1] }
}

function Save-TrainerPostgresEnvironment {
    $snapshot = @{}
    $processEnvironment = [System.Environment]::GetEnvironmentVariables('Process')
    foreach ($name in $script:PostgresEnvironmentNames) {
        $snapshot[$name] = [pscustomobject]@{
            Exists = $processEnvironment.Contains($name)
            Value = [System.Environment]::GetEnvironmentVariable($name, 'Process')
        }
        if ($processEnvironment.Contains($name)) { Remove-Item -LiteralPath "Env:$name" -Force }
    }
    return $snapshot
}

function Restore-TrainerPostgresEnvironment {
    param([Parameter(Mandatory = $true)][hashtable]$Snapshot)

    foreach ($name in $script:PostgresEnvironmentNames) {
        $saved = $Snapshot[$name]
        if ($saved.Exists) {
            [System.Environment]::SetEnvironmentVariable($name, [string]$saved.Value, 'Process')
        }
        else {
            [System.Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
    }
}

function Set-TrainerPostgresEnvironment {
    param([Parameter(Mandatory = $true)]$Connection)

    [System.Environment]::SetEnvironmentVariable('PGHOST', $Connection.Host, 'Process')
    [System.Environment]::SetEnvironmentVariable('PGPORT', [string]$Connection.Port, 'Process')
    [System.Environment]::SetEnvironmentVariable('PGDATABASE', $Connection.Database, 'Process')
    [System.Environment]::SetEnvironmentVariable('PGUSER', $Connection.User, 'Process')
    [System.Environment]::SetEnvironmentVariable('PGPASSWORD', $Connection.Password, 'Process')
    [System.Environment]::SetEnvironmentVariable('PGSSLMODE', $Connection.TlsMode, 'Process')
}

function Test-TrainerArchiveObjects {
    param([Parameter(Mandatory = $true)][string]$Listing)

    $publicPresent = [regex]::IsMatch($Listing, '(?im)\bSCHEMA\b.*\bpublic\b')
    $prismaPresent = [regex]::IsMatch($Listing, '(?im)\bTABLE(?: DATA)?\b.*\bpublic\b.*\b_prisma_migrations\b')
    $tableResults = [ordered]@{}
    foreach ($table in $script:RequiredTables) {
        $tableResults[$table] = [regex]::IsMatch(
            $Listing,
            "(?im)\bTABLE(?: DATA)?\b.*\bpublic\b.*\b$([regex]::Escape($table))\b"
        )
    }
    [pscustomobject][ordered]@{
        PublicSchema = $publicPresent
        PrismaMigrations = $prismaPresent
        RequiredTables = $tableResults
        AllExpectedObjects = $publicPresent -and $prismaPresent -and
            -not ($tableResults.Values -contains $false)
    }
}

function Invoke-TrainerProductionBackup {
    $repositoryRoot = Get-NormalizedTrainerPath (Join-Path $PSScriptRoot '..\..')
    $destination = Get-NormalizedTrainerPath $DestinationRoot
    Assert-NoTrainerReparsePoint -Path $destination
    if (Test-TrainerPathInside -Candidate $destination -Parent $repositoryRoot) {
        throw "DestinationRoot must be outside the repository."
    }

    $selectedValues = if ($PSCmdlet.ParameterSetName -eq 'EnvironmentFile') {
        Read-TrainerEnvironmentFile -Path $EnvironmentFilePath -RepositoryRoot $repositoryRoot
    }
    else {
        @{
            TRAINER_PRODUCTION_DATABASE_URL = [System.Environment]::GetEnvironmentVariable(
                'TRAINER_PRODUCTION_DATABASE_URL',
                'Process'
            )
        }
    }
    $databaseUrl = [string]$selectedValues.TRAINER_PRODUCTION_DATABASE_URL
    if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
        throw "TRAINER_PRODUCTION_DATABASE_URL is required from the explicitly selected source."
    }
    $script:SensitiveValues.Add($databaseUrl)

    $connection = ConvertFrom-TrainerProductionDatabaseUrl `
        -Url $databaseUrl `
        -ExpectedReference $ExpectedProjectReference `
        -SessionPoolerAllowed $AllowSessionPooler.IsPresent

    $pgDumpPath = Resolve-TrainerPostgresTool -Name 'pg_dump' -BinDirectory $PostgreSQLBinDirectory
    $pgRestorePath = Resolve-TrainerPostgresTool -Name 'pg_restore' -BinDirectory $PostgreSQLBinDirectory
    $pgDumpVersion = Get-TrainerPostgresVersion -Name 'pg_dump' -Executable $pgDumpPath
    $pgRestoreVersion = Get-TrainerPostgresVersion -Name 'pg_restore' -Executable $pgRestorePath
    if ($pgRestoreVersion.Major -lt $pgDumpVersion.Major) {
        throw "pg_restore must not be older than pg_dump for custom-archive inspection."
    }

    Write-Output "Target: host=$($connection.Host) port=$($connection.Port) database=$($connection.Database) mode=$($connection.ConnectionMode) project=$($connection.ProjectReference) tls=$($connection.TlsMode)"
    Write-Output 'Dump scope: public'
    $confirmation = Read-Host "Type BACK UP $ExpectedProjectReference to begin the production read"
    if ($confirmation -cne "BACK UP $ExpectedProjectReference") {
        throw "Operator confirmation did not match; no production read was started."
    }

    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Assert-NoTrainerReparsePoint -Path $destination
    $startedAt = [DateTimeOffset]::UtcNow
    $baseName = 'trainer-production-{0}-{1}' -f $startedAt.ToString('yyyyMMddTHHmmssfffZ'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $partialPath = Join-Path $destination "$baseName.partial"
    $finalPath = Join-Path $destination $baseName
    if ((Test-Path -LiteralPath $partialPath) -or (Test-Path -LiteralPath $finalPath)) {
        throw "The unique backup path already exists; no artifact was overwritten."
    }

    $savedEnvironment = $null
    try {
        New-Item -ItemType Directory -Path $partialPath | Out-Null
        $archivePath = Join-Path $partialPath 'database.dump'
        $savedEnvironment = Save-TrainerPostgresEnvironment
        Set-TrainerPostgresEnvironment -Connection $connection

        $dumpResult = Invoke-TrainerCapturedCommand -Executable $pgDumpPath -Arguments @(
            '--format', 'custom',
            '--schema', 'public',
            '--file', $archivePath
        )
        if ($dumpResult.ExitCode -ne 0) {
            throw "pg_dump failed with exit code $($dumpResult.ExitCode): $(Get-TrainerCommandFailure $dumpResult)"
        }
        if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
            throw "pg_dump reported success but database.dump is missing."
        }
        $archive = Get-Item -LiteralPath $archivePath
        if ($archive.Length -le 0) { throw "pg_dump reported success but database.dump is empty." }

        $listResult = Invoke-TrainerCapturedCommand -Executable $pgRestorePath -Arguments @('--list', $archivePath)
        if ($listResult.ExitCode -ne 0) {
            throw "pg_restore --list failed with exit code $($listResult.ExitCode): $(Get-TrainerCommandFailure $listResult)"
        }
        $objects = Test-TrainerArchiveObjects -Listing $listResult.StdOut
        if (-not $objects.AllExpectedObjects) {
            throw "The archive listing is missing public, _prisma_migrations, or a required Trainer table."
        }

        $gitSha = $null
        if (-not [string]::IsNullOrWhiteSpace($GitShaOverride)) {
            $gitSha = $GitShaOverride.ToLowerInvariant()
        }
        else {
            $gitResult = Invoke-TrainerCapturedCommand -Executable 'git' -Arguments @('-C', $repositoryRoot, 'rev-parse', 'HEAD')
            if ($gitResult.ExitCode -ne 0 -or $gitResult.StdOut.Trim() -notmatch '^[0-9a-fA-F]{40}$') {
                throw "Git SHA resolution failed; use -GitShaOverride only when repository state cannot be resolved."
            }
            $gitSha = $gitResult.StdOut.Trim().ToLowerInvariant()
        }

        $archiveHash = (Microsoft.PowerShell.Utility\Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
        $completedAt = [DateTimeOffset]::UtcNow
        $manifest = [ordered]@{
            schemaVersion = 1
            status = 'successful'
            target = [ordered]@{
                projectReference = $connection.ProjectReference
                host = $connection.Host
                port = $connection.Port
                database = $connection.Database
                connectionMode = $connection.ConnectionMode
                tlsMode = $connection.TlsMode
                dumpScope = 'public'
            }
            timestamps = [ordered]@{
                startedAtUtc = $startedAt.ToString('o')
                completedAtUtc = $completedAt.ToString('o')
            }
            source = [ordered]@{ gitSha = $gitSha }
            tools = [ordered]@{
                pgDump = $pgDumpVersion.Text
                pgRestore = $pgRestoreVersion.Text
            }
            archive = [ordered]@{
                fileName = 'database.dump'
                sizeBytes = [long]$archive.Length
                sha256 = $archiveHash
            }
            objectPresence = [ordered]@{
                publicSchema = $objects.PublicSchema
                prismaMigrations = $objects.PrismaMigrations
                requiredTables = $objects.RequiredTables
                allExpectedObjects = $objects.AllExpectedObjects
            }
            evidence = [ordered]@{
                dumpProcessCompleted = $true
                archiveNonempty = $true
                archiveListingSucceeded = $true
                expectedObjectsPresent = $true
                checksumRecorded = $true
                restoreTested = $false
                applicationQueryTested = $false
            }
            restoreStatus = 'not_tested'
            applicationQueryStatus = 'not_tested'
        }
        $manifestPath = Join-Path $partialPath 'manifest.json'
        $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            throw "Manifest finalization did not create manifest.json."
        }

        Move-Item -LiteralPath $partialPath -Destination $finalPath
        Write-Output 'PASS: Trainer production backup completed.'
        Write-Output "Final path: $finalPath"
        Write-Output "Target: host=$($connection.Host) port=$($connection.Port) database=$($connection.Database) mode=$($connection.ConnectionMode) project=$($connection.ProjectReference)"
        Write-Output 'Dump scope: public'
        Write-Output "Completed (UTC): $($completedAt.ToString('o'))"
        Write-Output "Archive size (bytes): $($archive.Length)"
        Write-Output "SHA-256: $archiveHash"
        Write-Output 'Expected objects: present'
        Write-Output 'Restore status: not tested'
        Write-Output "Next: pwsh -NoProfile -File scripts/database/Inspect-TrainerBackup.ps1 -BackupDirectory `"$finalPath`" -ExpectedProjectReference $ExpectedProjectReference"
    }
    catch {
        $manifestPath = Join-Path $partialPath 'manifest.json'
        if (Test-Path -LiteralPath $manifestPath) {
            Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $partialPath) {
            try {
                Remove-Item -LiteralPath $partialPath -Recurse -Force
                Write-Warning "Removed incomplete backup directory: $partialPath"
            }
            catch {
                $failedPath = "$partialPath.failed-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
                try {
                    Move-Item -LiteralPath $partialPath -Destination $failedPath
                    Write-Warning "Retained failed artifact without a success manifest: $failedPath"
                }
                catch {
                    Write-Warning "Incomplete artifact could not be removed or renamed safely: $partialPath"
                }
            }
        }
        throw
    }
    finally {
        if ($null -ne $savedEnvironment) {
            Restore-TrainerPostgresEnvironment -Snapshot $savedEnvironment
        }
    }
}

try {
    Invoke-TrainerProductionBackup
}
catch {
    $safeMessage = Protect-TrainerBackupText $_.Exception.Message
    Write-Error "Trainer production backup failed: $safeMessage"
    throw
}
