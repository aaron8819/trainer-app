Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-GitRead {
    param(
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )

    $output = @(& git -C $WorkingDirectory @Arguments 2>$null)
    $exitCode = $LASTEXITCODE
    if (($exitCode -ne 0) -and (-not $AllowFailure)) {
        throw "git $($Arguments -join ' ') failed with exit code $exitCode."
    }

    [pscustomobject][ordered]@{
        Output = $output
        ExitCode = $exitCode
    }
}

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    [System.IO.Path]::GetFullPath($Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
}

function ConvertTo-TrainerRepositoryPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $normalized = $Path.Trim().Replace('\', '/')
    while ($normalized.StartsWith('./', [System.StringComparison]::Ordinal)) {
        $normalized = $normalized.Substring(2)
    }
    $normalized.TrimStart('/')
}

function Test-TrainerPolicyPattern {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Pattern
    )

    $wildcard = [System.Management.Automation.WildcardPattern]::new(
        (ConvertTo-TrainerRepositoryPath -Path $Pattern),
        [System.Management.Automation.WildcardOptions]::IgnoreCase
    )
    $wildcard.IsMatch((ConvertTo-TrainerRepositoryPath -Path $Path))
}

function Get-DirtyPaths {
    param([Parameter(Mandatory = $true)][string]$WorktreePath)

    $status = Invoke-GitRead -WorkingDirectory $WorktreePath -Arguments @(
        'status', '--short', '--untracked-files=all'
    ) -AllowFailure
    if ($status.ExitCode -ne 0) {
        return $null
    }

    @($status.Output | ForEach-Object {
        if ($_.Length -ge 4) { $_.Substring(3) } else { $_ }
    })
}

function Read-Worktrees {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$CanonicalRoot
    )

    $lines = (Invoke-GitRead -WorkingDirectory $RepositoryRoot -Arguments @(
        'worktree', 'list', '--porcelain'
    )).Output
    $records = [System.Collections.Generic.List[object]]::new()
    $current = [ordered]@{}

    foreach ($line in @($lines) + '') {
        if ([string]::IsNullOrWhiteSpace($line)) {
            if ($current.Contains('path')) {
                $records.Add([pscustomobject]$current)
            }
            $current = [ordered]@{}
            continue
        }

        $parts = $line -split ' ', 2
        switch ($parts[0]) {
            'worktree' { $current.path = $parts[1] }
            'HEAD' { $current.head = $parts[1] }
            'branch' { $current.branch = $parts[1] -replace '^refs/heads/', '' }
            'detached' { $current.branch = $null }
            'prunable' { $current.prunable = $true }
        }
    }

    $primaryPath = if ($records.Count -gt 0) {
        Get-NormalizedPath -Path $records[0].path
    }
    else {
        $null
    }
    $canonicalNormalized = Get-NormalizedPath -Path $CanonicalRoot
    $result = [System.Collections.Generic.List[object]]::new()

    foreach ($record in $records) {
        $normalized = Get-NormalizedPath -Path $record.path
        $isPrimary = $null -ne $primaryPath -and $normalized -ieq $primaryPath
        $compliance = $null
        $complianceReason = 'Unable to determine canonical-path compliance.'
        if ($isPrimary) {
            $complianceReason = 'Primary checkout is exempt from the task-worktree root convention.'
        }
        elseif ($normalized.StartsWith(
                $canonicalNormalized + [System.IO.Path]::DirectorySeparatorChar,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            $compliance = $true
            $complianceReason = 'Path is under the canonical Trainer worktree root.'
        }
        else {
            $compliance = $false
            $complianceReason = 'Path is outside the canonical Trainer worktree root.'
        }

        $pathAvailable = Test-Path -LiteralPath $normalized
        $dirtyPaths = @()
        if ($pathAvailable) {
            $dirtyPaths = @(Get-DirtyPaths -WorktreePath $normalized)
        }
        $result.Add([pscustomobject][ordered]@{
            path = $normalized
            branch = if ($record.PSObject.Properties.Name -contains 'branch') {
                $record.branch
            }
            else {
                $null
            }
            head = if ($record.PSObject.Properties.Name -contains 'head') {
                $record.head
            }
            else {
                $null
            }
            dirty = if (-not $pathAvailable) { $null } else { $dirtyPaths.Count -gt 0 }
            dirtyPaths = @($dirtyPaths)
            canonicalPathCompliant = $compliance
            canonicalPathReason = $complianceReason
            primary = $isPrimary
        })
    }

    $result.ToArray()
}

function Read-TrainerPolicy {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required policy file is missing: $Path"
    }

    $policy = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
    if (($policy.schema -ne 'trainer-policy') -or ($policy.version -ne 1)) {
        throw 'Unsupported or invalid trainer policy schema.'
    }
    $policy
}

function Read-TrainerJsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required JSON file is missing: $Path"
    }

    try {
        Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -Depth 100
    }
    catch {
        throw "Invalid JSON file '$Path': $($_.Exception.Message)"
    }
}

function Resolve-TrainerRepositoryRoot {
    param([Parameter(Mandatory = $true)][string]$StartPath)

    $probe = Invoke-GitRead -WorkingDirectory $StartPath -Arguments @(
        'rev-parse', '--show-toplevel'
    )
    if (@($probe.Output).Count -ne 1) {
        throw "Unable to resolve the Trainer repository root from '$StartPath'."
    }
    Get-NormalizedPath -Path $probe.Output[0]
}

function Get-TrainerErrorMessage {
    param([Parameter(Mandatory = $true)]$ErrorRecord)

    $message = if ($ErrorRecord -is [System.Management.Automation.ErrorRecord]) {
        $ErrorRecord.Exception.Message
    }
    elseif ($ErrorRecord -is [System.Exception]) {
        $ErrorRecord.Message
    }
    else {
        [string]$ErrorRecord
    }
    $message.Trim()
}

function Resolve-TrainerVerificationCommands {
    param(
        [Parameter(Mandatory = $true)][object]$Policy,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Ids
    )

    $seen = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $result = [System.Collections.Generic.List[object]]::new()
    foreach ($id in $Ids) {
        if (-not $seen.Add($id)) { continue }
        $property = $Policy.commands.PSObject.Properties[$id]
        if ($null -eq $property) {
            throw "Policy references unknown command id '$id'."
        }
        $metadata = $property.Value
        $result.Add([pscustomobject][ordered]@{
            id = $id
            command = $metadata.command
            defaultSideEffectClass = $metadata.defaultSideEffectClass
            accessesNetwork = [bool]$metadata.accessesNetwork
            accessesDatabase = [bool]$metadata.accessesDatabase
            writesLocalArtifacts = [bool]$metadata.writesLocalArtifacts
            explicitAuthorizationRequired = [bool]$metadata.explicitAuthorizationRequired
        })
    }
    $result.ToArray()
}

function Get-TrainerCommandRegistration {
    param(
        [Parameter(Mandatory = $true)][object]$Policy,
        [Parameter(Mandatory = $true)][string]$Id
    )

    $matches = @($Policy.commandRegistry | Where-Object { $_.id -ceq $Id })
    if ($matches.Count -ne 1) {
        throw "Verification command '$Id' must map to exactly one command registry entry."
    }
    $profileProperty = $Policy.commandProfiles.PSObject.Properties[$matches[0].profile]
    if ($null -eq $profileProperty) {
        throw "Command '$Id' references unknown profile '$($matches[0].profile)'."
    }
    [pscustomobject][ordered]@{
        entry = $matches[0]
        profile = $profileProperty.Value
    }
}

function Get-DependencyInfo {
    param([Parameter(Mandatory = $true)][string]$Path)

    $state = 'missing'
    $target = $null
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if ($item.LinkType) {
            $state = $item.LinkType.ToString().ToLowerInvariant()
            $target = @($item.Target) -join '; '
        }
        else {
            $state = 'directory'
        }
    }

    [pscustomobject][ordered]@{
        path = Get-NormalizedPath -Path $Path
        state = $state
        target = $target
        present = $state -ne 'missing'
    }
}

function Get-ExecutableCapability {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$CommandNames,
        [string[]]$VersionArguments = @('--version'),
        [switch]$PresenceOnly,
        [string[]]$RequiredFor = @(),
        [Parameter(Mandatory = $true)][string]$MissingHint
    )

    $command = $null
    foreach ($candidate in $CommandNames) {
        $command = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $command) { break }
    }

    if ($null -eq $command) {
        return [pscustomobject][ordered]@{
            id = $Id
            name = $Name
            status = 'missing'
            version = $null
            path = $null
            requiredFor = @($RequiredFor)
            remediation = $MissingHint
        }
    }

    $version = $null
    $status = 'available'
    if (-not $PresenceOnly) {
        try {
            $versionOutput = @(& $command.Source @VersionArguments 2>&1)
            if ($LASTEXITCODE -eq 0) {
                $version = (@($versionOutput | ForEach-Object { $_.ToString().Trim() }) |
                    Where-Object { $_ } | Select-Object -First 1)
            }
            else {
                $status = 'warning'
            }
        }
        catch {
            $status = 'warning'
        }
    }

    [pscustomobject][ordered]@{
        id = $Id
        name = $Name
        status = $status
        version = $version
        path = $command.Source
        requiredFor = @($RequiredFor)
        remediation = if ($status -eq 'available') {
            $null
        }
        else {
            "The executable was found, but its local version could not be read. $MissingHint"
        }
    }
}

Export-ModuleMember -Function @(
    'Invoke-GitRead',
    'Get-NormalizedPath',
    'ConvertTo-TrainerRepositoryPath',
    'Test-TrainerPolicyPattern',
    'Get-DirtyPaths',
    'Read-Worktrees',
    'Read-TrainerPolicy',
    'Read-TrainerJsonFile',
    'Resolve-TrainerRepositoryRoot',
    'Get-TrainerErrorMessage',
    'Resolve-TrainerVerificationCommands',
    'Get-TrainerCommandRegistration',
    'Get-DependencyInfo',
    'Get-ExecutableCapability'
)
