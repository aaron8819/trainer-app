[CmdletBinding()]
param(
    [switch]$Json,
    [switch]$GitHub,
    [switch]$Deployment,
    [switch]$Database,
    [switch]$All
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExitSuccess = 0
$ExitBlocked = 1
$ExitInvalid = 2
$ExitUnexpected = 3

Import-Module (Join-Path $PSScriptRoot 'Trainer.Tooling.psm1') -Force

function Test-ConfiguredValue {
    param([AllowNull()]$Value)

    ($null -ne $Value) -and
        (-not [string]::IsNullOrWhiteSpace([string]$Value)) -and
        ([string]$Value -ine 'unconfigured')
}

function Assert-ContractProperty {
    param(
        [Parameter(Mandatory = $true)][object]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Path
    )

    if ($null -eq $Object -or $Object.PSObject.Properties.Name -notcontains $Name) {
        throw "Remote identity contract is missing required property '$Path.$Name'."
    }
}

function Assert-RemoteIdentityStructure {
    param([Parameter(Mandatory = $true)][object]$Identity)

    if (($Identity.schema -cne 'trainer-remote-identity') -or ($Identity.version -ne 1)) {
        throw 'Unsupported or invalid trainer remote identity schema.'
    }

    foreach ($section in @('environment', 'github', 'vercel', 'supabase')) {
        Assert-ContractProperty -Object $Identity -Name $section -Path 'root'
        if ($null -eq $Identity.$section) {
            throw "Remote identity contract section '$section' must be an object."
        }
    }
    foreach ($name in @('id', 'label')) {
        Assert-ContractProperty -Object $Identity.environment -Name $name -Path 'environment'
    }
    foreach ($name in @('owner', 'repository', 'defaultBranch', 'changePolicy')) {
        Assert-ContractProperty -Object $Identity.github -Name $name -Path 'github'
    }
    foreach ($name in @('teamId', 'teamSlug', 'projectId', 'projectName', 'productionAlias')) {
        Assert-ContractProperty -Object $Identity.vercel -Name $name -Path 'vercel'
    }
    foreach ($name in @(
            'projectRef',
            'expectedDatabaseName',
            'allowedConnectionClasses',
            'forbiddenConnectionClasses'
        )) {
        Assert-ContractProperty -Object $Identity.supabase -Name $name -Path 'supabase'
    }
    if ($null -eq $Identity.supabase.allowedConnectionClasses -or
        $null -eq $Identity.supabase.forbiddenConnectionClasses) {
        throw 'Supabase connection-class fields must be arrays, including when empty.'
    }
}

function Get-UnsafeContractFindings {
    param([Parameter(Mandatory = $true)][object]$Identity)

    $findings = [System.Collections.Generic.List[string]]::new()
    function Visit-IdentityValue {
        param([AllowNull()]$Value, [Parameter(Mandatory = $true)][string]$Path)

        if ($null -eq $Value) { return }
        if ($Value -is [string]) {
            if ($Value -match '(?i)(?:[a-z][a-z0-9+.-]*://|^git@|bearer\s|password\s*=|token\s*=|api[_-]?key\s*=|connection\s*string)') {
                $findings.Add("Unsafe secret-like or URL value at '$Path'.")
            }
            return
        }
        if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [pscustomobject]) {
            $index = 0
            foreach ($item in $Value) {
                Visit-IdentityValue -Value $item -Path "$Path[$index]"
                $index++
            }
            return
        }
        foreach ($property in $Value.PSObject.Properties) {
            if ($property.Name -match '(?i)(password|secret|token|api[_-]?key|database[_-]?url|connection[_-]?string)') {
                $findings.Add("Unsafe property name '$Path.$($property.Name)'.")
            }
            Visit-IdentityValue -Value $property.Value -Path "$Path.$($property.Name)"
        }
    }

    Visit-IdentityValue -Value $Identity -Path 'identity'
    $findings.ToArray()
}

function Get-SafeIdentityValue {
    param([AllowNull()]$Value)

    if ($null -eq $Value) { return $null }
    $text = [string]$Value
    if ($text -match '(?i)(?:[a-z][a-z0-9+.-]*://|^git@|bearer\s|password\s*=|token\s*=|api[_-]?key\s*=|connection\s*string)') {
        return '[unsafe-redacted]'
    }
    $Value
}

function ConvertFrom-GitHubRemote {
    param([AllowNull()][string]$Remote)

    if ([string]::IsNullOrWhiteSpace($Remote)) {
        return [pscustomobject][ordered]@{
            status = 'missing'
            host = $null
            owner = $null
            repository = $null
            transport = $null
            credentialBearing = $false
        }
    }

    $value = $Remote.Trim()
    $match = [regex]::Match(
        $value,
        '^(?<scheme>https?)://(?:(?<userinfo>[^/@]+)@)?(?<host>[^/]+)/(?<owner>[^/]+)/(?<repository>[^/]+)/?$',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($match.Success) {
        $repository = $match.Groups['repository'].Value -replace '\.git$', ''
        $isGitHub = $match.Groups['host'].Value -ieq 'github.com'
        return [pscustomobject][ordered]@{
            status = if ($isGitHub) { 'parsed' } else { 'unsupported-host' }
            host = $match.Groups['host'].Value.ToLowerInvariant()
            owner = if ($isGitHub) { $match.Groups['owner'].Value } else { $null }
            repository = if ($isGitHub) { $repository } else { $null }
            transport = $match.Groups['scheme'].Value.ToLowerInvariant()
            credentialBearing = $match.Groups['userinfo'].Success
        }
    }

    $match = [regex]::Match(
        $value,
        '^git@github\.com:(?<owner>[^/]+)/(?<repository>[^/]+?)(?:\.git)?$',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($match.Success) {
        return [pscustomobject][ordered]@{
            status = 'parsed'
            host = 'github.com'
            owner = $match.Groups['owner'].Value
            repository = $match.Groups['repository'].Value
            transport = 'ssh-scp'
            credentialBearing = $false
        }
    }

    $match = [regex]::Match(
        $value,
        '^ssh://git@github\.com/(?<owner>[^/]+)/(?<repository>[^/]+?)(?:\.git)?/?$',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($match.Success) {
        return [pscustomobject][ordered]@{
            status = 'parsed'
            host = 'github.com'
            owner = $match.Groups['owner'].Value
            repository = $match.Groups['repository'].Value
            transport = 'ssh'
            credentialBearing = $false
        }
    }

    [pscustomobject][ordered]@{
        status = 'unsupported-format'
        host = $null
        owner = $null
        repository = $null
        transport = $null
        credentialBearing = $false
    }
}

function Test-GitTrackedPath {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $probe = Invoke-GitRead -WorkingDirectory $RepositoryRoot -Arguments @(
        'ls-files', '--error-unmatch', '--', $Path
    ) -AllowFailure
    $probe.ExitCode -eq 0
}

function Get-GitTrackedPaths {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $probe = Invoke-GitRead -WorkingDirectory $RepositoryRoot -Arguments @(
        'ls-files', '--', $Path
    ) -AllowFailure
    if ($probe.ExitCode -ne 0) { return @() }
    @($probe.Output)
}

function Get-ComparisonStatus {
    param(
        [AllowNull()]$Expected,
        [AllowNull()]$Observed,
        [switch]$ObservedMissing
    )

    if (-not (Test-ConfiguredValue -Value $Expected)) { return 'unknown' }
    if ($ObservedMissing -or -not (Test-ConfiguredValue -Value $Observed)) { return 'missing' }
    if ([string]$Expected -ieq [string]$Observed) { return 'match' }
    'mismatch'
}

function Write-HumanStatus {
    param([Parameter(Mandatory = $true)][object]$Report)

    Write-Output 'Trainer offline remote status'
    Write-Output "Success: $($Report.success)"
    Write-Output "Identity foundation: $($Report.identity.foundationStatus)"
    Write-Output "Environment: $($Report.identity.expected.environment.id) / $($Report.identity.expected.environment.label)"
    Write-Output "GitHub expected: $($Report.identity.expected.github.owner)/$($Report.identity.expected.github.repository) default=$($Report.identity.expected.github.defaultBranch)"
    Write-Output "GitHub local comparison: $($Report.providers.github.status)"
    Write-Output "Vercel expected identity: $($Report.providers.deployment.expectedIdentityStatus)"
    Write-Output "Supabase expected identity: $($Report.providers.database.expectedIdentityStatus)"
    Write-Output "Prisma migrations: $($Report.localEvidence.supabase.prismaMigrationCount)"
    Write-Output 'Traceability:'
    foreach ($step in @($Report.traceability.chain)) {
        Write-Output "  - $($step.label): $($step.status)"
    }
    Write-Output 'Required operator values:'
    if (@($Report.identity.requiredOperatorValues).Count -eq 0) { Write-Output '  - none' }
    foreach ($value in @($Report.identity.requiredOperatorValues)) { Write-Output "  - $value" }
    Write-Output 'Warnings:'
    if (@($Report.warnings).Count -eq 0) { Write-Output '  - none' }
    foreach ($warning in @($Report.warnings)) { Write-Output "  - $warning" }
    Write-Output 'Blockers:'
    if (@($Report.blockers).Count -eq 0) { Write-Output '  - none' }
    foreach ($blocker in @($Report.blockers)) { Write-Output "  - $blocker" }
    Write-Output ''
    Write-Output 'Offline remote status validates expected identity and local linkage only. It does not authenticate, contact providers, inspect deployments, connect to databases, or prove production state.'
}

try {
    if ($GitHub -or $Deployment -or $Database -or $All) {
        throw [System.ArgumentException]::new(
            'Authenticated provider scopes are not implemented in remote-integration Phase 1.'
        )
    }
    $repositoryRoot = Resolve-TrainerRepositoryRoot -StartPath $PSScriptRoot
    $identityPath = Join-Path $PSScriptRoot 'trainer-remote.v1.json'
    $identity = Read-TrainerJsonFile -Path $identityPath
    Assert-RemoteIdentityStructure -Identity $identity

    $warnings = [System.Collections.Generic.List[string]]::new()
    $blockers = [System.Collections.Generic.List[string]]::new()
    foreach ($finding in @(Get-UnsafeContractFindings -Identity $identity)) {
        $blockers.Add($finding)
    }

    $allowedClasses = @($identity.supabase.allowedConnectionClasses | ForEach-Object { [string]$_ })
    $forbiddenClasses = @($identity.supabase.forbiddenConnectionClasses | ForEach-Object { [string]$_ })
    $duplicateAllowed = @($allowedClasses | Group-Object | Where-Object { $_.Count -gt 1 })
    $duplicateForbidden = @($forbiddenClasses | Group-Object | Where-Object { $_.Count -gt 1 })
    if ($duplicateAllowed.Count -gt 0 -or $duplicateForbidden.Count -gt 0) {
        $blockers.Add('Supabase connection-class lists contain duplicate values.')
    }
    $connectionConflicts = @($allowedClasses | Where-Object { $_ -iin $forbiddenClasses })
    if ($connectionConflicts.Count -gt 0) {
        $blockers.Add('Supabase connection classes cannot be both allowed and forbidden.')
    }

    $githubFields = @($identity.github.owner, $identity.github.repository, $identity.github.defaultBranch)
    $configuredGitHubFields = @($githubFields | Where-Object { Test-ConfiguredValue -Value $_ }).Count
    if ($configuredGitHubFields -gt 0 -and $configuredGitHubFields -lt $githubFields.Count) {
        $blockers.Add('GitHub expected identity is internally incomplete.')
    }

    $vercelFields = [ordered]@{
        teamId = $identity.vercel.teamId
        teamSlug = $identity.vercel.teamSlug
        projectId = $identity.vercel.projectId
        projectName = $identity.vercel.projectName
        productionAlias = $identity.vercel.productionAlias
    }
    $requiredOperatorValues = [System.Collections.Generic.List[string]]::new()
    foreach ($property in $vercelFields.GetEnumerator()) {
        if (-not (Test-ConfiguredValue -Value $property.Value)) {
            $requiredOperatorValues.Add("vercel.$($property.Key)")
        }
    }
    if (-not (Test-ConfiguredValue -Value $identity.supabase.projectRef)) {
        $requiredOperatorValues.Add('supabase.projectRef')
    }
    if (-not (Test-ConfiguredValue -Value $identity.github.changePolicy)) {
        $requiredOperatorValues.Add('github.changePolicy')
    }
    $requiredOperatorValues.Add('supabase.canonicalDirectEndpointClassification')
    $requiredOperatorValues.Add('supabase.canonicalSessionPoolerClassification')

    $originProbe = Invoke-GitRead -WorkingDirectory $repositoryRoot -Arguments @(
        'config', '--get', 'remote.origin.url'
    ) -AllowFailure
    $originValue = if ($originProbe.ExitCode -eq 0 -and @($originProbe.Output).Count -gt 0) {
        [string]$originProbe.Output[0]
    }
    else {
        $null
    }
    $observedRemote = ConvertFrom-GitHubRemote -Remote $originValue
    if ($observedRemote.credentialBearing) {
        $blockers.Add('The local origin remote is credential-bearing. Its raw value was not reported.')
    }

    $cachedHeadProbe = Invoke-GitRead -WorkingDirectory $repositoryRoot -Arguments @(
        'symbolic-ref', 'refs/remotes/origin/HEAD'
    ) -AllowFailure
    $cachedDefaultBranch = if ($cachedHeadProbe.ExitCode -eq 0 -and @($cachedHeadProbe.Output).Count -eq 1) {
        [string]$cachedHeadProbe.Output[0] -replace '^refs/remotes/origin/', ''
    }
    else {
        $null
    }

    $ownerStatus = Get-ComparisonStatus -Expected $identity.github.owner -Observed $observedRemote.owner -ObservedMissing:($observedRemote.status -eq 'missing')
    $repositoryStatus = Get-ComparisonStatus -Expected $identity.github.repository -Observed $observedRemote.repository -ObservedMissing:($observedRemote.status -eq 'missing')
    $branchStatus = Get-ComparisonStatus -Expected $identity.github.defaultBranch -Observed $cachedDefaultBranch -ObservedMissing:($null -eq $cachedDefaultBranch)
    if ($observedRemote.status -in @('unsupported-host', 'unsupported-format')) {
        $ownerStatus = 'mismatch'
        $repositoryStatus = 'mismatch'
    }
    foreach ($comparison in @(
            [pscustomobject]@{ name = 'GitHub owner'; status = $ownerStatus },
            [pscustomobject]@{ name = 'GitHub repository'; status = $repositoryStatus },
            [pscustomobject]@{ name = 'GitHub cached default branch'; status = $branchStatus }
        )) {
        if ($comparison.status -eq 'mismatch') {
            $blockers.Add("$($comparison.name) does not match the committed expected identity.")
        }
        elseif ($comparison.status -eq 'missing' -and $configuredGitHubFields -eq $githubFields.Count) {
            $blockers.Add("$($comparison.name) is missing from local Git linkage.")
        }
    }
    if ($configuredGitHubFields -eq 0) {
        $warnings.Add('GitHub expected identity is intentionally unconfigured; local linkage cannot be classified as a match.')
    }

    $githubStatus = if (@($ownerStatus, $repositoryStatus, $branchStatus) -contains 'mismatch') {
        'mismatch'
    }
    elseif (@($ownerStatus, $repositoryStatus, $branchStatus) -contains 'missing') {
        'missing'
    }
    elseif (@($ownerStatus, $repositoryStatus, $branchStatus) -contains 'unknown') {
        'unknown'
    }
    else {
        'match'
    }

    $vercelConfigured = @($vercelFields.Values | Where-Object { Test-ConfiguredValue -Value $_ }).Count
    $vercelStatus = if ($vercelConfigured -eq $vercelFields.Count) { 'configured' } elseif ($vercelConfigured -gt 0) { 'partial' } else { 'unknown' }
    $supabaseStatus = if (Test-ConfiguredValue -Value $identity.supabase.projectRef) { 'configured' } else { 'unknown' }
    if ($vercelStatus -ne 'configured') {
        $warnings.Add('Vercel expected identity is not fully configured; no mismatch or live-state claim was made.')
    }
    if ($supabaseStatus -ne 'configured') {
        $warnings.Add('Supabase expected project identity is unconfigured; no live project or database state was verified.')
    }

    $trackedVercelJson = Test-GitTrackedPath -RepositoryRoot $repositoryRoot -Path 'trainer-app/vercel.json'
    $trackedVercelProject = Test-GitTrackedPath -RepositoryRoot $repositoryRoot -Path 'trainer-app/.vercel/project.json'
    $localVercelProjectPath = Join-Path $repositoryRoot 'trainer-app\.vercel\project.json'
    $localVercelProjectPresent = Test-Path -LiteralPath $localVercelProjectPath -PathType Leaf
    $supabaseTrackedPaths = @(Get-GitTrackedPaths -RepositoryRoot $repositoryRoot -Path 'trainer-app/supabase')
    $migrationPath = Join-Path $repositoryRoot 'trainer-app\prisma\migrations'
    $migrationCount = if (Test-Path -LiteralPath $migrationPath -PathType Container) {
        @(Get-ChildItem -LiteralPath $migrationPath -Directory).Count
    }
    else {
        0
    }

    $identityIsInconsistent = $blockers.Count -gt 0 -and @($blockers | Where-Object {
        $_ -match '^(Unsafe|Remote identity contract|Supabase connection class|GitHub expected identity is internally)'
    }).Count -gt 0
    $configuredProviderCount = 0
    if ($configuredGitHubFields -eq $githubFields.Count) { $configuredProviderCount++ }
    if ($vercelStatus -eq 'configured') { $configuredProviderCount++ }
    if ($supabaseStatus -eq 'configured') { $configuredProviderCount++ }
    $foundationStatus = if ($identityIsInconsistent) {
        'internally inconsistent'
    }
    elseif ($configuredProviderCount -eq 3 -and $requiredOperatorValues.Count -eq 0) {
        'complete'
    }
    elseif ($configuredProviderCount -gt 0) {
        'partially configured'
    }
    else {
        'incomplete'
    }

    $report = [pscustomobject][ordered]@{
        schema = 'trainer-remote-status'
        version = 1
        inspectionOnly = $true
        networkAccessed = $false
        databaseAccessed = $false
        identity = [pscustomobject][ordered]@{
            contract = [pscustomobject][ordered]@{
                present = $true
                schema = $identity.schema
                version = $identity.version
                source = 'committed repository truth'
                unsafeFindingCount = @(Get-UnsafeContractFindings -Identity $identity).Count
                requiredFieldsValid = $true
                duplicateValueCount = $duplicateAllowed.Count + $duplicateForbidden.Count
                contradictionCount = $connectionConflicts.Count
            }
            foundationStatus = $foundationStatus
            configuration = [pscustomobject][ordered]@{
                github = if ($configuredGitHubFields -eq $githubFields.Count) { 'configured' } elseif ($configuredGitHubFields -gt 0) { 'partial' } else { 'unknown' }
                vercel = $vercelStatus
                supabase = $supabaseStatus
                immutableIdsPresent = [pscustomobject][ordered]@{
                    vercelTeamId = Test-ConfiguredValue -Value $identity.vercel.teamId
                    vercelProjectId = Test-ConfiguredValue -Value $identity.vercel.projectId
                    supabaseProjectRef = Test-ConfiguredValue -Value $identity.supabase.projectRef
                }
            }
            productionDefinition = [pscustomobject][ordered]@{
                intendedEnvironment = (Test-ConfiguredValue -Value $identity.environment.id) -and (Test-ConfiguredValue -Value $identity.environment.label)
                intendedVercelProject = (Test-ConfiguredValue -Value $identity.vercel.teamId) -and (Test-ConfiguredValue -Value $identity.vercel.projectId)
                intendedVercelProductionAlias = Test-ConfiguredValue -Value $identity.vercel.productionAlias
                intendedSupabaseProject = Test-ConfiguredValue -Value $identity.supabase.projectRef
            }
            expected = [pscustomobject][ordered]@{
                environment = [pscustomobject][ordered]@{
                    id = Get-SafeIdentityValue -Value $identity.environment.id
                    label = Get-SafeIdentityValue -Value $identity.environment.label
                }
                github = [pscustomobject][ordered]@{
                    owner = Get-SafeIdentityValue -Value $identity.github.owner
                    repository = Get-SafeIdentityValue -Value $identity.github.repository
                    defaultBranch = Get-SafeIdentityValue -Value $identity.github.defaultBranch
                    changePolicy = Get-SafeIdentityValue -Value $identity.github.changePolicy
                }
                vercel = [pscustomobject][ordered]@{
                    teamId = Get-SafeIdentityValue -Value $identity.vercel.teamId
                    teamSlug = Get-SafeIdentityValue -Value $identity.vercel.teamSlug
                    projectId = Get-SafeIdentityValue -Value $identity.vercel.projectId
                    projectName = Get-SafeIdentityValue -Value $identity.vercel.projectName
                    productionAlias = Get-SafeIdentityValue -Value $identity.vercel.productionAlias
                }
                supabase = [pscustomobject][ordered]@{
                    projectRef = Get-SafeIdentityValue -Value $identity.supabase.projectRef
                    expectedDatabaseName = Get-SafeIdentityValue -Value $identity.supabase.expectedDatabaseName
                    allowedConnectionClasses = [object[]]@($allowedClasses | ForEach-Object { Get-SafeIdentityValue -Value $_ })
                    forbiddenConnectionClasses = [object[]]@($forbiddenClasses | ForEach-Object { Get-SafeIdentityValue -Value $_ })
                }
            }
            requiredOperatorValues = [object[]]$requiredOperatorValues.ToArray()
        }
        localEvidence = [pscustomobject][ordered]@{
            freshness = 'local/offline at command execution'
            authority = 'local non-authoritative linkage evidence'
            git = [pscustomobject][ordered]@{
                originPresent = $observedRemote.status -ne 'missing'
                originFormatStatus = $observedRemote.status
                originCredentialBearing = [bool]$observedRemote.credentialBearing
                observed = [pscustomobject][ordered]@{
                    host = $observedRemote.host
                    owner = $observedRemote.owner
                    repository = $observedRemote.repository
                    transport = $observedRemote.transport
                    cachedDefaultBranch = $cachedDefaultBranch
                }
                rawRemoteReported = $false
            }
            vercel = [pscustomobject][ordered]@{
                committedVercelJsonPresent = $trackedVercelJson
                committedProjectLinkPresent = $trackedVercelProject
                localProjectLinkFilenamePresent = $localVercelProjectPresent
                localProjectLinkValuesInspected = $false
            }
            supabase = [pscustomobject][ordered]@{
                committedConfigPresent = $supabaseTrackedPaths.Count -gt 0
                committedConfigFileCount = $supabaseTrackedPaths.Count
                prismaMigrationDirectoryPresent = Test-Path -LiteralPath $migrationPath -PathType Container
                prismaMigrationCount = $migrationCount
                liveProjectIdentityVerified = $false
                databaseStateVerified = $false
            }
        }
        providers = [pscustomobject][ordered]@{
            github = [pscustomobject][ordered]@{
                status = $githubStatus
                ownerComparison = $ownerStatus
                repositoryComparison = $repositoryStatus
                defaultBranchComparison = $branchStatus
                liveState = 'not-checked'
                source = 'expected: committed identity; observed: cached local Git configuration'
            }
            deployment = [pscustomobject][ordered]@{
                status = 'not-checked'
                expectedIdentityStatus = $vercelStatus
                liveState = 'not-checked'
                mismatchClaimed = $false
                source = 'committed identity and filename presence only'
            }
            database = [pscustomobject][ordered]@{
                status = 'not-checked'
                expectedIdentityStatus = $supabaseStatus
                liveState = 'not-checked'
                mismatchClaimed = $false
                source = 'committed identity and repository structure only'
            }
        }
        traceability = [pscustomobject][ordered]@{
            chain = [object[]]@(
                [pscustomobject][ordered]@{ label = 'local repository identity'; status = 'checked-offline' },
                [pscustomobject][ordered]@{ label = 'cached Git remote identity'; status = $githubStatus },
                [pscustomobject][ordered]@{ label = 'GitHub live state'; status = 'not-checked' },
                [pscustomobject][ordered]@{ label = 'Vercel deployment'; status = 'not-checked' },
                [pscustomobject][ordered]@{ label = 'Supabase project/database'; status = 'not-checked' }
            )
            identityGates = [object[]]@(
                [pscustomobject][ordered]@{ scope = 'github-read'; stopOnMismatch = $true; required = @('github.owner', 'github.repository', 'github.defaultBranch') },
                [pscustomobject][ordered]@{ scope = 'deployment-read'; stopOnMismatch = $true; required = @('vercel.teamId', 'vercel.projectId', 'vercel.productionAlias') },
                [pscustomobject][ordered]@{ scope = 'database-read'; stopOnMismatch = $true; required = @('supabase.projectRef', 'supabase.connectionClass') },
                [pscustomobject][ordered]@{ scope = 'cross-system-traceability'; stopOnMismatch = $true; required = @('github', 'vercel', 'supabase') }
            )
            endToEndProductionVerified = $false
        }
        warnings = [object[]]$warnings.ToArray()
        blockers = [object[]]$blockers.ToArray()
        success = $blockers.Count -eq 0
    }

    if ($Json) {
        $report | ConvertTo-Json -Depth 20
    }
    else {
        Write-HumanStatus -Report $report
    }
    if (-not $report.success) { exit $ExitBlocked }
    exit $ExitSuccess
}
catch [System.ArgumentException] {
    if ($Json) {
        [pscustomobject][ordered]@{
            schema = 'trainer-remote-status-error'
            version = 1
            error = Get-TrainerErrorMessage -ErrorRecord $_
            success = $false
        } | ConvertTo-Json -Depth 4
    }
    else {
        [Console]::Error.WriteLine("Invalid Trainer remote-status invocation: $(Get-TrainerErrorMessage -ErrorRecord $_)")
    }
    exit $ExitInvalid
}
catch {
    if ($Json) {
        [pscustomobject][ordered]@{
            schema = 'trainer-remote-status-error'
            version = 1
            error = Get-TrainerErrorMessage -ErrorRecord $_
            success = $false
        } | ConvertTo-Json -Depth 4
    }
    else {
        [Console]::Error.WriteLine("Trainer remote status failed: $(Get-TrainerErrorMessage -ErrorRecord $_)")
    }
    exit $ExitUnexpected
}
