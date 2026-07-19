[CmdletBinding()]
param(
    [switch]$Json,
    [switch]$Database,
    [switch]$GitHub,
    [switch]$Deployment,
    [switch]$All,
    [string[]]$Scope = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExitSuccess = 0
$ExitBlocked = 1
$ExitInvalid = 2
$ExitUnexpected = 3

Import-Module (Join-Path $PSScriptRoot 'Trainer.Tooling.psm1') -Force

function Write-HumanDoctorReport {
    param([Parameter(Mandatory = $true)][object]$Report)

    Write-Output 'Trainer local environment doctor'
    Write-Output "Inspection succeeded: $($Report.success)"
    Write-Output "Checkout: $($Report.repository.checkoutPath)"
    Write-Output "Branch / HEAD: $($Report.repository.branch) / $($Report.repository.head)"
    Write-Output "Checkout type: $($Report.repository.checkoutType)"
    Write-Output "Dirty: $($Report.repository.dirty)"
    Write-Output "Worktrees: $($Report.repository.worktreeCount)"
    Write-Output "Canonical linked paths: $($Report.repository.canonicalPaths.compliant) compliant, $($Report.repository.canonicalPaths.noncompliant) noncompliant"
    Write-Output 'Tools:'
    foreach ($tool in @($Report.tools)) {
        $version = if ($tool.version) { " version=$($tool.version)" } else { '' }
        $path = if ($tool.path) { " path=$($tool.path)" } else { '' }
        Write-Output "  - $($tool.name): $($tool.status)$version$path"
    }
    Write-Output 'Project:'
    Write-Output "  - package.json: $($Report.project.packageJson.status)"
    Write-Output "  - lockfile: $($Report.project.lockfile.status) ($($Report.project.lockfile.name))"
    Write-Output "  - node_modules: $($Report.project.dependencies.status) ($($Report.project.dependencies.state))"
    Write-Output "  - Prisma schema: $($Report.project.prismaSchema.status)"
    Write-Output "  - migrations: $($Report.project.migrations.status)"
    Write-Output "  - env-style filenames: $(@($Report.project.envFileNames).Count)"
    Write-Output 'Scopes:'
    foreach ($property in $Report.scopes.PSObject.Properties) {
        Write-Output "  - $($property.Name): $($property.Value.status) - $($property.Value.reason)"
    }
    Write-Output 'Warnings:'
    if (@($Report.warnings).Count -eq 0) {
        Write-Output '  - none'
    }
    else {
        $Report.warnings | ForEach-Object { Write-Output "  - $_" }
    }
    Write-Output 'Blockers:'
    if (@($Report.blockers).Count -eq 0) {
        Write-Output '  - none'
    }
    else {
        $Report.blockers | ForEach-Object { Write-Output "  - $_" }
    }
    Write-Output ''
    Write-Output 'Inspection only. No package installation, authentication, repair, database connection, migration, deployment, or recommended command was performed.'
}

function New-InvalidScopeReport {
    param([Parameter(Mandatory = $true)][string[]]$InvalidScopes)

    [pscustomobject][ordered]@{
        schema = 'trainer-doctor-report'
        version = 1
        inspectionOnly = $true
        repository = [pscustomobject][ordered]@{}
        tools = @()
        project = [pscustomobject][ordered]@{}
        scopes = [pscustomobject][ordered]@{
            local = [pscustomobject][ordered]@{ status = 'not-checked'; reason = 'Invocation was invalid.' }
            database = [pscustomobject][ordered]@{ status = 'not-checked'; reason = 'Invocation was invalid.' }
            github = [pscustomobject][ordered]@{ status = 'not-checked'; reason = 'Invocation was invalid.' }
            deployment = [pscustomobject][ordered]@{ status = 'not-checked'; reason = 'Invocation was invalid.' }
        }
        warnings = @()
        blockers = @("Invalid doctor scope: $($InvalidScopes -join ', '). Supported scopes are local, database, github, deployment, and all.")
        success = $false
    }
}

function New-ProjectStatus {
    param([bool]$Present, [string]$PresentStatus = 'available')

    if ($Present) { $PresentStatus } else { 'missing' }
}

$allowedScopes = @('local', 'database', 'github', 'deployment', 'all')
$requestedScopes = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
)
$requestedScopes.Add('local') | Out-Null
if ($Database) { $requestedScopes.Add('database') | Out-Null }
if ($GitHub) { $requestedScopes.Add('github') | Out-Null }
if ($Deployment) { $requestedScopes.Add('deployment') | Out-Null }
if ($All) { $requestedScopes.Add('all') | Out-Null }
foreach ($item in @($Scope)) {
    if (-not [string]::IsNullOrWhiteSpace($item)) {
        $requestedScopes.Add($item.Trim()) | Out-Null
    }
}

$invalidScopes = @($requestedScopes | Where-Object { $_ -notin $allowedScopes })
if ($invalidScopes.Count -gt 0) {
    $invalidReport = New-InvalidScopeReport -InvalidScopes $invalidScopes
    if ($Json) {
        $invalidReport | ConvertTo-Json -Depth 8
    }
    else {
        Write-Output 'Trainer local environment doctor'
        Write-Output 'Inspection succeeded: False'
        Write-Output 'Blockers:'
        $invalidReport.blockers | ForEach-Object { Write-Output "  - $_" }
        Write-Output ''
        Write-Output 'Inspection only. No package installation, authentication, repair, database connection, migration, deployment, or recommended command was performed.'
    }
    exit $ExitInvalid
}
if ($requestedScopes.Contains('all')) {
    @('database', 'github', 'deployment') | ForEach-Object {
        $requestedScopes.Add($_) | Out-Null
    }
}

try {
    $policyPath = Join-Path $PSScriptRoot 'trainer-policy.v1.json'
    $policy = Read-TrainerPolicy -Path $policyPath
    $scriptRepositoryRoot = Get-NormalizedPath -Path (Join-Path $PSScriptRoot '..\..')
    $repositoryProbe = Invoke-GitRead -WorkingDirectory $scriptRepositoryRoot -Arguments @(
        'rev-parse', '--show-toplevel'
    )
    $checkoutPath = Get-NormalizedPath -Path $repositoryProbe.Output[0]
    $canonicalRoot = Get-NormalizedPath -Path $policy.repository.canonicalWorktreeRoot
    $worktrees = @(Read-Worktrees -RepositoryRoot $checkoutPath -CanonicalRoot $canonicalRoot)
    $currentWorktree = @($worktrees | Where-Object {
        (Get-NormalizedPath -Path $_.path) -ieq $checkoutPath
    }) | Select-Object -First 1
    if ($null -eq $currentWorktree) {
        throw "Current checkout is not present in git worktree inventory: $checkoutPath"
    }

    $warnings = [System.Collections.Generic.List[string]]::new()
    $blockers = [System.Collections.Generic.List[string]]::new()
    $branchProbe = Invoke-GitRead -WorkingDirectory $checkoutPath -Arguments @(
        'branch', '--show-current'
    )
    $headProbe = Invoke-GitRead -WorkingDirectory $checkoutPath -Arguments @('rev-parse', 'HEAD')
    $branch = if (@($branchProbe.Output).Count -eq 0 -or [string]::IsNullOrWhiteSpace($branchProbe.Output[0])) {
        $null
    }
    else {
        $branchProbe.Output[0]
    }
    $linked = @($worktrees | Where-Object { -not $_.primary })
    $compliant = @($linked | Where-Object { $_.canonicalPathCompliant -eq $true })
    $noncompliant = @($linked | Where-Object { $_.canonicalPathCompliant -eq $false })
    if ($noncompliant.Count -gt 0) {
        $warnings.Add("$($noncompliant.Count) linked worktree(s) are outside the canonical Trainer worktree root.")
    }

    $tools = [System.Collections.Generic.List[object]]::new()
    $powershellPath = (Get-Process -Id $PID).Path
    $tools.Add([pscustomobject][ordered]@{
        id = 'powershell'
        name = 'PowerShell'
        status = 'available'
        version = $PSVersionTable.PSVersion.ToString()
        path = $powershellPath
        requiredFor = @('application-implementation', 'database-implementation', 'migration-work', 'deployment-work')
        remediation = $null
    })

    foreach ($definition in @($policy.doctor.tools)) {
        $capability = Get-ExecutableCapability `
            -Id $definition.id `
            -Name $definition.name `
            -CommandNames @($definition.commandNames) `
            -PresenceOnly:([bool]$definition.presenceOnly) `
            -RequiredFor @($definition.requiredFor) `
            -MissingHint $definition.missingHint
        $tools.Add($capability)
        if ($capability.status -ne 'available') {
            $warnings.Add("$($capability.name): $($capability.status). $($capability.remediation)")
        }
    }

    $trainerAppPath = Join-Path $checkoutPath 'trainer-app'
    $packagePath = Join-Path $trainerAppPath 'package.json'
    $lockfileCandidates = @('package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock')
    $recognizedLockfiles = @($lockfileCandidates | Where-Object {
        Test-Path -LiteralPath (Join-Path $trainerAppPath $_) -PathType Leaf
    })
    $lockfileName = if ($recognizedLockfiles.Count -gt 0) { $recognizedLockfiles[0] } else { $null }
    $dependency = Get-DependencyInfo -Path (Join-Path $trainerAppPath 'node_modules')
    $primaryWorktree = @($worktrees | Where-Object { $_.primary }) | Select-Object -First 1
    $primaryTrainerAppPath = Join-Path $primaryWorktree.path 'trainer-app'
    $primaryDependency = Get-DependencyInfo -Path (Join-Path $primaryTrainerAppPath 'node_modules')
    $currentLockfilePath = if ($lockfileName) { Join-Path $trainerAppPath $lockfileName } else { $null }
    $primaryLockfilePath = if ($lockfileName) { Join-Path $primaryTrainerAppPath $lockfileName } else { $null }
    $lockfileMatchesPrimary = $null
    if (($null -ne $currentLockfilePath) -and
        (Test-Path -LiteralPath $currentLockfilePath -PathType Leaf) -and
        (Test-Path -LiteralPath $primaryLockfilePath -PathType Leaf)) {
        $currentLockHash = (Get-FileHash -LiteralPath $currentLockfilePath -Algorithm SHA256).Hash
        $primaryLockHash = (Get-FileHash -LiteralPath $primaryLockfilePath -Algorithm SHA256).Hash
        $lockfileMatchesPrimary = $currentLockHash -ceq $primaryLockHash
    }
    $schemaPath = Join-Path $trainerAppPath 'prisma\schema.prisma'
    $migrationPath = Join-Path $trainerAppPath 'prisma\migrations'
    $envFileNames = @(
        Get-ChildItem -LiteralPath $trainerAppPath -File -Filter '.env*' -ErrorAction SilentlyContinue |
            Sort-Object Name |
            ForEach-Object { $_.Name }
    )

    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        $blockers.Add('Required trainer-app/package.json is missing.')
    }
    if ($null -eq $lockfileName) {
        $blockers.Add('No recognized lockfile exists under trainer-app.')
    }
    if (-not $dependency.present) {
        $warnings.Add('trainer-app/node_modules is missing. The doctor did not install or link dependencies.')
    }
    if ((-not $currentWorktree.primary) -and ($lockfileMatchesPrimary -eq $false)) {
        $warnings.Add('The linked worktree lockfile differs from the primary checkout; its dependency installation must not be linked.')
    }
    if (($dependency.state -ne 'missing') -and $dependency.target -and
        ($dependency.target -notlike "$($primaryDependency.path)*")) {
        $warnings.Add('The dependency link target does not resolve under the primary Trainer dependency path.')
    }
    if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) {
        $blockers.Add('Prisma schema is missing.')
    }
    if (-not (Test-Path -LiteralPath $migrationPath -PathType Container)) {
        $blockers.Add('Prisma migration directory is missing.')
    }

    $prismaCliPath = Join-Path $trainerAppPath 'node_modules\.bin\prisma.cmd'
    $prismaPackagePath = Join-Path $trainerAppPath 'node_modules\prisma\package.json'
    $prismaVersion = $null
    if (Test-Path -LiteralPath $prismaPackagePath -PathType Leaf) {
        try {
            $prismaVersion = (Get-Content -Raw -LiteralPath $prismaPackagePath | ConvertFrom-Json).version
        }
        catch {
            $warnings.Add('Prisma package metadata exists but its version could not be read.')
        }
    }
    $prismaPresent = Test-Path -LiteralPath $prismaCliPath -PathType Leaf
    $prismaCapability = [pscustomobject][ordered]@{
        id = 'prisma'
        name = 'Prisma CLI'
        status = if ($prismaPresent) { 'available' } else { 'missing' }
        version = $prismaVersion
        path = if ($prismaPresent) { Get-NormalizedPath -Path $prismaCliPath } else { $null }
        requiredFor = @('database-implementation', 'migration-work')
        remediation = if ($prismaPresent) { $null } else { 'Use the existing verified trainer-app dependency installation; no package download was attempted.' }
    }
    $prismaIndex = [Math]::Min(4, $tools.Count)
    $tools.Insert($prismaIndex, $prismaCapability)
    if (-not $prismaPresent) {
        $warnings.Add("Prisma CLI: missing. $($prismaCapability.remediation)")
    }

    $databaseSelected = $requestedScopes.Contains('database')
    $githubSelected = $requestedScopes.Contains('github')
    $deploymentSelected = $requestedScopes.Contains('deployment')
    $scopes = [pscustomobject][ordered]@{
        local = [pscustomobject][ordered]@{
            status = 'checked'
            reason = 'Local repository, project files, and executable presence/version were inspected.'
        }
        database = [pscustomobject][ordered]@{
            status = 'not-checked'
            reason = if ($databaseSelected) {
                'Configuration prerequisites were inventoried, but Phase 2 does not connect to a database.'
            }
            else {
                'Database scope was not requested; no connection was attempted.'
            }
        }
        github = [pscustomobject][ordered]@{
            status = 'not-checked'
            reason = if ($githubSelected) {
                'GitHub CLI presence was inventoried, but Phase 2 does not authenticate or contact GitHub.'
            }
            else {
                'GitHub scope was not requested; no authentication check was attempted.'
            }
        }
        deployment = [pscustomobject][ordered]@{
            status = 'not-checked'
            reason = if ($deploymentSelected) {
                'Vercel CLI presence was inventoried, but Phase 2 does not authenticate, resolve a project, or contact Vercel.'
            }
            else {
                'Deployment scope was not requested; no authentication or project check was attempted.'
            }
        }
    }

    $report = [pscustomobject][ordered]@{
        schema = 'trainer-doctor-report'
        version = 1
        inspectionOnly = $true
        repository = [pscustomobject][ordered]@{
            root = (@($worktrees | Where-Object { $_.primary }) | Select-Object -First 1).path
            checkoutPath = $checkoutPath
            branch = $branch
            head = $headProbe.Output[0]
            dirty = [bool]$currentWorktree.dirty
            dirtyPaths = @($currentWorktree.dirtyPaths)
            policy = [pscustomobject][ordered]@{
                path = $policyPath
                present = $true
                valid = $true
                schema = $policy.schema
                version = $policy.version
            }
            phaseOneInspectorPresent = Test-Path -LiteralPath (Join-Path $PSScriptRoot 'Start-TrainerTask.ps1') -PathType Leaf
            worktreeCount = $worktrees.Count
            canonicalPaths = [pscustomobject][ordered]@{
                root = $canonicalRoot
                linked = $linked.Count
                compliant = $compliant.Count
                noncompliant = $noncompliant.Count
            }
            checkoutType = if ($currentWorktree.primary) { 'primary' } else { 'linked-worktree' }
        }
        tools = $tools.ToArray()
        project = [pscustomobject][ordered]@{
            packageJson = [pscustomobject][ordered]@{
                path = $packagePath
                status = New-ProjectStatus -Present (Test-Path -LiteralPath $packagePath -PathType Leaf)
            }
            lockfile = [pscustomobject][ordered]@{
                name = $lockfileName
                path = if ($lockfileName) { Join-Path $trainerAppPath $lockfileName } else { $null }
                status = New-ProjectStatus -Present ($null -ne $lockfileName)
                recognizedCount = $recognizedLockfiles.Count
            }
            dependencies = [pscustomobject][ordered]@{
                path = $dependency.path
                status = if ($dependency.present) { 'available' } else { 'warning' }
                state = $dependency.state
                target = $dependency.target
                primaryPath = $primaryDependency.path
                primaryState = $primaryDependency.state
                lockfileMatchesPrimary = $lockfileMatchesPrimary
                arrangement = if ($currentWorktree.primary) {
                    'primary-checkout'
                }
                elseif ($dependency.present) {
                    'linked-worktree-dependencies-present'
                }
                elseif (($lockfileMatchesPrimary -eq $true) -and $primaryDependency.present) {
                    'verified-primary-installation-available-for-approved-junction'
                }
                else {
                    'dependency-arrangement-unavailable'
                }
                expected = 'An existing directory, or a verified junction to the primary checkout after lockfile equality is confirmed.'
            }
            prismaSchema = [pscustomobject][ordered]@{
                path = $schemaPath
                status = New-ProjectStatus -Present (Test-Path -LiteralPath $schemaPath -PathType Leaf)
            }
            migrations = [pscustomobject][ordered]@{
                path = $migrationPath
                status = New-ProjectStatus -Present (Test-Path -LiteralPath $migrationPath -PathType Container)
                count = if (Test-Path -LiteralPath $migrationPath -PathType Container) {
                    @(Get-ChildItem -LiteralPath $migrationPath -Directory).Count
                }
                else {
                    0
                }
            }
            envFileNames = @($envFileNames)
        }
        scopes = $scopes
        warnings = $warnings.ToArray()
        blockers = $blockers.ToArray()
        success = $blockers.Count -eq 0
    }

    if ($Json) { $report | ConvertTo-Json -Depth 12 } else { Write-HumanDoctorReport -Report $report }
    if ($blockers.Count -gt 0) { exit $ExitBlocked }
    exit $ExitSuccess
}
catch {
    if ($Json) {
        [pscustomobject][ordered]@{
            schema = 'trainer-doctor-report-error'
            version = 1
            inspectionOnly = $true
            error = $_.Exception.Message
            success = $false
        } | ConvertTo-Json -Depth 4
    }
    else {
        [Console]::Error.WriteLine("Trainer doctor failed: $($_.Exception.Message)")
    }
    exit $ExitUnexpected
}
