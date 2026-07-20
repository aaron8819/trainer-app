[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [string]$Classification,

    [Parameter(Mandatory = $true)]
    [string]$BaseBranch,

    [switch]$Json,

    [string[]]$ChangedPath = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExitSuccess = 0
$ExitBlocked = 1
$ExitInvalid = 2
$ExitUnexpected = 3

Import-Module (Join-Path $PSScriptRoot 'Trainer.Tooling.psm1') -Force

function Write-HumanManifest {
    param([Parameter(Mandatory = $true)][object]$Manifest)

    Write-Output "Trainer task inspection: $($Manifest.task.name)"
    Write-Output "Inspection succeeded: $($Manifest.success)"
    Write-Output "Classification: $($Manifest.task.classification)"
    Write-Output "Repository root: $($Manifest.repository.root)"
    Write-Output "Current checkout: $($Manifest.repository.currentCheckoutPath)"
    Write-Output "Current branch / HEAD: $($Manifest.repository.currentBranch) / $($Manifest.repository.currentHead)"
    Write-Output "Requested base: $($Manifest.task.requestedBaseBranch)"
    Write-Output "Resolved base SHA: $($Manifest.task.resolvedBaseSha)"
    Write-Output "Proposed branch: $($Manifest.task.proposedBranch)"
    Write-Output "Proposed worktree: $($Manifest.task.proposedWorktreePath)"
    Write-Output "Primary checkout dirty: $($Manifest.repository.primaryDirty)"
    if (@($Manifest.repository.primaryDirtyPaths).Count -gt 0) {
        Write-Output 'Primary dirty paths:'
        $Manifest.repository.primaryDirtyPaths | ForEach-Object { Write-Output "  - $_" }
    }
    Write-Output "Registered worktrees: $(@($Manifest.worktrees).Count)"
    foreach ($worktree in $Manifest.worktrees) {
        Write-Output "  - $($worktree.path) | branch=$($worktree.branch) | head=$($worktree.head) | dirty=$($worktree.dirty) | canonical=$($worktree.canonicalPathCompliant)"
    }
    Write-Output "Database policy: $($Manifest.databasePolicy.access); writesAllowed=$($Manifest.databasePolicy.writesAllowed)"
    Write-Output 'Allowed path roots:'
    $Manifest.pathPolicy.allowedPathRoots | ForEach-Object { Write-Output "  - $_" }
    Write-Output 'Forbidden path roots:'
    $Manifest.pathPolicy.forbiddenPathRoots | ForEach-Object { Write-Output "  - $_" }
    Write-Output 'Proposed implementation checks:'
    $Manifest.verification.implementation | ForEach-Object { Write-Output "  - $($_.command)" }
    Write-Output 'Proposed release checks:'
    $Manifest.verification.release | ForEach-Object { Write-Output "  - $($_.command)" }
    Write-Output 'Warnings:'
    if (@($Manifest.warnings).Count -eq 0) { Write-Output '  - none' } else { $Manifest.warnings | ForEach-Object { Write-Output "  - $_" } }
    Write-Output 'Blockers:'
    if (@($Manifest.blockers).Count -eq 0) { Write-Output '  - none' } else { $Manifest.blockers | ForEach-Object { Write-Output "  - $_" } }
    Write-Output ''
    Write-Output 'Inspection only. No worktree, branch, package, database, deployment, or repository state was modified.'
}

try {
    $policyPath = Join-Path $PSScriptRoot 'trainer-policy.v1.json'
    $policy = Read-TrainerPolicy -Path $policyPath

    $scriptRepositoryRoot = Get-NormalizedPath -Path (Join-Path $PSScriptRoot '..\..')
    $repositoryProbe = Invoke-GitRead -WorkingDirectory $scriptRepositoryRoot -Arguments @('rev-parse', '--show-toplevel')
    $currentCheckoutPath = Get-NormalizedPath -Path $repositoryProbe.Output[0]

    $warnings = [System.Collections.Generic.List[string]]::new()
    $blockers = [System.Collections.Generic.List[string]]::new()
    $invalidInvocation = $false

    $nameValid = $Name -cmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$' -and $Name.Length -le 64
    if (-not $nameValid) {
        $blockers.Add("Invalid task name '$Name'. Use 1-64 lowercase letters, numbers, and single hyphen separators.")
        $invalidInvocation = $true
    }

    $classificationProperty = $policy.classifications.PSObject.Properties[$Classification]
    if ($null -eq $classificationProperty) {
        $blockers.Add("Invalid classification '$Classification'.")
        $invalidInvocation = $true
        $classificationPolicy = [pscustomobject][ordered]@{
            allowedPathRoots = @()
            forbiddenPathRoots = @()
            databasePolicy = [pscustomobject][ordered]@{ access = 'unavailable'; writesAllowed = $false }
            productionWritesMayEverBeAllowed = $false
            implementationChecks = @()
            releaseChecks = @()
            warnings = @()
            authorizationRequirements = @()
        }
    }
    else {
        $classificationPolicy = $classificationProperty.Value
    }

    $canonicalRoot = Get-NormalizedPath -Path $policy.repository.canonicalWorktreeRoot
    $proposedWorktreePath = Get-NormalizedPath -Path (Join-Path $canonicalRoot $Name)
    $proposedBranch = "$($policy.repository.branchPrefix)$Name"
    $worktrees = @(Read-Worktrees -RepositoryRoot $currentCheckoutPath -CanonicalRoot $canonicalRoot)
    $primaryWorktree = @($worktrees | Where-Object { $_.primary }) | Select-Object -First 1

    $baseProbe = Invoke-GitRead -WorkingDirectory $currentCheckoutPath -Arguments @('rev-parse', '--verify', "$BaseBranch^{commit}") -AllowFailure
    $resolvedBaseSha = if ($baseProbe.ExitCode -eq 0) { $baseProbe.Output[0] } else { $null }
    if ($null -eq $resolvedBaseSha) {
        $blockers.Add("Requested base '$BaseBranch' does not resolve to a commit.")
    }

    $pathRegistered = @($worktrees | Where-Object { (Get-NormalizedPath -Path $_.path) -ieq $proposedWorktreePath }).Count -gt 0
    $pathExists = Test-Path -LiteralPath $proposedWorktreePath
    $pathConflict = $pathRegistered -or $pathExists
    if ($pathRegistered) {
        $blockers.Add("Proposed worktree path is already registered: $proposedWorktreePath")
    }
    elseif ($pathExists) {
        $blockers.Add("Proposed worktree path already exists: $proposedWorktreePath")
    }

    $branchProbe = Invoke-GitRead -WorkingDirectory $currentCheckoutPath -Arguments @('show-ref', '--verify', '--quiet', "refs/heads/$proposedBranch") -AllowFailure
    $branchExists = $branchProbe.ExitCode -eq 0
    $branchCheckedOut = @($worktrees | Where-Object { $_.branch -eq $proposedBranch }).Count -gt 0
    if ($branchCheckedOut) {
        $blockers.Add("Proposed branch is already checked out: $proposedBranch")
    }
    elseif ($branchExists) {
        $blockers.Add("Proposed branch already exists: $proposedBranch")
    }

    $manifestPath = Join-Path $currentCheckoutPath 'trainer-app\package.json'
    $lockfilePath = Join-Path $currentCheckoutPath 'trainer-app\package-lock.json'
    $dependencyPath = Join-Path $currentCheckoutPath 'trainer-app\node_modules'
    $dependency = Get-DependencyInfo -Path $dependencyPath
    if (-not $dependency.present) {
        $warnings.Add('Dependency directory is absent. Phase 1 inspection does not install or link dependencies.')
    }

    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        $blockers.Add('Required trainer-app/package.json is missing.')
    }
    if (-not (Test-Path -LiteralPath $lockfilePath -PathType Leaf)) {
        $blockers.Add('Required trainer-app/package-lock.json is missing.')
    }

    if (($null -ne $primaryWorktree) -and $primaryWorktree.dirty) {
        $warnings.Add('The primary checkout is dirty. Its changes were inspected only and are not authorized task inputs.')
    }
    foreach ($worktree in $worktrees) {
        if (($worktree.canonicalPathCompliant -eq $false) -and (-not $worktree.primary)) {
            $warnings.Add("Registered worktree is outside the canonical root: $($worktree.path)")
        }
        if ($worktree.dirty -and (-not $worktree.primary) -and ((Get-NormalizedPath -Path $worktree.path) -ine $currentCheckoutPath)) {
            $warnings.Add("Unrelated registered worktree is dirty: $($worktree.path)")
        }
    }
    foreach ($warning in @($classificationPolicy.warnings)) {
        $warnings.Add([string]$warning)
    }

    $implementationIds = [System.Collections.Generic.List[string]]::new()
    $releaseIds = [System.Collections.Generic.List[string]]::new()
    foreach ($id in @($classificationPolicy.implementationChecks)) { $implementationIds.Add([string]$id) }
    foreach ($id in @($classificationPolicy.releaseChecks)) { $releaseIds.Add([string]$id) }

    $unmatchedChangedPaths = [System.Collections.Generic.List[string]]::new()
    foreach ($changed in @($ChangedPath)) {
        $matched = $false
        foreach ($rule in @($policy.verification.pathRules)) {
            $ruleMatches = $false
            foreach ($pattern in @($rule.patterns)) {
                if (Test-TrainerPolicyPattern -Path $changed -Pattern $pattern) {
                    $ruleMatches = $true
                    break
                }
            }
            if ($ruleMatches) {
                $matched = $true
                foreach ($id in @($rule.implementation)) { $implementationIds.Add([string]$id) }
                foreach ($id in @($rule.release)) { $releaseIds.Add([string]$id) }
            }
        }
        if (-not $matched) { $unmatchedChangedPaths.Add($changed) }
    }
    if ($unmatchedChangedPaths.Count -gt 0) {
        foreach ($id in @($policy.verification.fallback.implementation)) { $implementationIds.Add([string]$id) }
        foreach ($id in @($policy.verification.fallback.release)) { $releaseIds.Add([string]$id) }
        $warnings.Add([string]$policy.verification.fallback.warning)
    }

    $implementationChecks = @(Resolve-TrainerVerificationCommands -Policy $policy -Ids $implementationIds.ToArray())
    $releaseChecks = @(Resolve-TrainerVerificationCommands -Policy $policy -Ids $releaseIds.ToArray())
    $currentBranchProbe = Invoke-GitRead -WorkingDirectory $currentCheckoutPath -Arguments @('branch', '--show-current')
    $currentHeadProbe = Invoke-GitRead -WorkingDirectory $currentCheckoutPath -Arguments @('rev-parse', 'HEAD')
    $primaryDirtyPaths = if ($null -eq $primaryWorktree) { @() } else { @($primaryWorktree.dirtyPaths) }

    $manifest = [pscustomobject][ordered]@{
        schema = 'trainer-task-manifest'
        version = 1
        inspectionOnly = $true
        task = [pscustomobject][ordered]@{
            name = $Name
            nameValid = $nameValid
            classification = $Classification
            requestedBaseBranch = $BaseBranch
            resolvedBaseSha = $resolvedBaseSha
            proposedWorktreePath = $proposedWorktreePath
            proposedBranch = $proposedBranch
            changedPaths = @($ChangedPath)
            worktreePathConflict = $pathConflict
            branchConflict = $branchExists
            branchCheckedOut = $branchCheckedOut
        }
        repository = [pscustomobject][ordered]@{
            name = $policy.repository.name
            root = if ($null -eq $primaryWorktree) { $currentCheckoutPath } else { $primaryWorktree.path }
            currentCheckoutPath = $currentCheckoutPath
            currentBranch = $currentBranchProbe.Output[0]
            currentHead = $currentHeadProbe.Output[0]
            primaryDirty = if ($null -eq $primaryWorktree) { $null } else { $primaryWorktree.dirty }
            primaryDirtyPaths = $primaryDirtyPaths
            dependencyManifestPresent = Test-Path -LiteralPath $manifestPath -PathType Leaf
            lockfilePresent = Test-Path -LiteralPath $lockfilePath -PathType Leaf
            dependency = [pscustomobject][ordered]@{
                path = $dependencyPath
                state = $dependency.state
                target = $dependency.target
                expected = 'An existing directory, or a verified junction to the primary checkout after lockfile equality is confirmed.'
            }
        }
        worktrees = $worktrees
        pathPolicy = [pscustomobject][ordered]@{
            allowedPathRoots = @($classificationPolicy.allowedPathRoots)
            forbiddenPathRoots = @($classificationPolicy.forbiddenPathRoots)
            authorizationRequirements = @($classificationPolicy.authorizationRequirements)
        }
        databasePolicy = [pscustomobject][ordered]@{
            access = $classificationPolicy.databasePolicy.access
            writesAllowed = [bool]$classificationPolicy.databasePolicy.writesAllowed
            productionWritesMayEverBeAllowed = [bool]$classificationPolicy.productionWritesMayEverBeAllowed
        }
        verification = [pscustomobject][ordered]@{
            implementation = $implementationChecks
            release = $releaseChecks
            unmatchedChangedPaths = $unmatchedChangedPaths.ToArray()
        }
        warnings = $warnings.ToArray()
        blockers = $blockers.ToArray()
        success = $blockers.Count -eq 0
    }

    if ($Json) {
        $manifest | ConvertTo-Json -Depth 12
    }
    else {
        Write-HumanManifest -Manifest $manifest
    }

    if ($invalidInvocation) { exit $ExitInvalid }
    if ($blockers.Count -gt 0) { exit $ExitBlocked }
    exit $ExitSuccess
}
catch {
    if ($Json) {
        [pscustomobject][ordered]@{
            schema = 'trainer-task-manifest-error'
            version = 1
            inspectionOnly = $true
            error = $_.Exception.Message
            success = $false
        } | ConvertTo-Json -Depth 4
    }
    else {
        [Console]::Error.WriteLine("Trainer task inspection failed: $($_.Exception.Message)")
    }
    exit $ExitUnexpected
}
