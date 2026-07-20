Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BaseRef = $null
$ChangedPathList = [System.Collections.Generic.List[string]]::new()
$ManifestPath = $null
$Json = $false
$Run = $false
$ContinueOnFailure = $false
$baseRefSpecified = $false
$invocationError = $null
for ($argumentIndex = 0; $argumentIndex -lt $args.Count; $argumentIndex++) {
    $argument = [string]$args[$argumentIndex]
    switch -CaseSensitive ($argument) {
        '-BaseRef' {
            if ($argumentIndex + 1 -ge $args.Count) { $invocationError = '-BaseRef requires a value.'; break }
            $argumentIndex++
            $BaseRef = [string]$args[$argumentIndex]
            $baseRefSpecified = $true
        }
        '-ChangedPath' {
            if ($argumentIndex + 1 -ge $args.Count) { $invocationError = '-ChangedPath requires a value.'; break }
            $argumentIndex++
            $ChangedPathList.Add([string]$args[$argumentIndex])
        }
        '-ManifestPath' {
            if ($argumentIndex + 1 -ge $args.Count) { $invocationError = '-ManifestPath requires a value.'; break }
            $argumentIndex++
            $ManifestPath = [string]$args[$argumentIndex]
        }
        '-Json' { $Json = $true }
        '-Run' { $Run = $true }
        '-ContinueOnFailure' { $ContinueOnFailure = $true }
        default { $invocationError = "Unknown option: $argument" }
    }
    if ($null -ne $invocationError) { break }
}
$ChangedPath = $ChangedPathList.ToArray()

$ExitSuccess = 0
$ExitBlocked = 1
$ExitInvalid = 2
$ExitUnexpected = 3

Import-Module (Join-Path $PSScriptRoot 'Trainer.Tooling.psm1') -Force

function Add-UniqueReason {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$Reasons,
        [Parameter(Mandatory = $true)][string]$Type,
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Rule
    )

    $exists = @($Reasons | Where-Object {
        $_.type -ceq $Type -and $_.source -ceq $Source -and $_.rule -ceq $Rule
    }).Count -gt 0
    if (-not $exists) {
        $Reasons.Add([pscustomobject][ordered]@{
            type = $Type
            source = $Source
            rule = $Rule
        })
    }
}

function Add-ChangedPathSource {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Records,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Source
    )

    $normalized = ConvertTo-TrainerRepositoryPath -Path $Path
    if ([string]::IsNullOrWhiteSpace($normalized)) { return }
    if (-not $Records.ContainsKey($normalized)) {
        $Records[$normalized] = [System.Collections.Generic.List[string]]::new()
    }
    if (-not $Records[$normalized].Contains($Source)) {
        $Records[$normalized].Add($Source)
    }
}

function Add-SelectedCommand {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Selection,
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Type,
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Rule
    )

    if (-not $Selection.ContainsKey($Id)) {
        $Selection[$Id] = [System.Collections.Generic.List[object]]::new()
    }
    Add-UniqueReason -Reasons $Selection[$Id] -Type $Type -Source $Source -Rule $Rule
}

function Get-GitChangedPaths {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$ResolvedBase
    )

    [pscustomobject][ordered]@{
        committed = @((Invoke-GitRead -WorkingDirectory $RepositoryRoot -Arguments @(
            '-c', 'core.quotepath=false', 'diff', '--name-only', '--diff-filter=ACDMRTUXB', "$ResolvedBase...HEAD"
        )).Output)
        staged = @((Invoke-GitRead -WorkingDirectory $RepositoryRoot -Arguments @(
            '-c', 'core.quotepath=false', 'diff', '--cached', '--name-only', '--diff-filter=ACDMRTUXB'
        )).Output)
        unstaged = @((Invoke-GitRead -WorkingDirectory $RepositoryRoot -Arguments @(
            '-c', 'core.quotepath=false', 'diff', '--name-only', '--diff-filter=ACDMRTUXB'
        )).Output)
        untracked = @((Invoke-GitRead -WorkingDirectory $RepositoryRoot -Arguments @(
            '-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard'
        )).Output)
    }
}

function Test-ManifestPathPolicy {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Roots
    )

    foreach ($root in $Roots) {
        if ($root -eq '**' -or (Test-TrainerPolicyPattern -Path $Path -Pattern $root) -or
            (Test-TrainerPolicyPattern -Path $Path -Pattern "$($root.TrimEnd('/'))/**")) {
            return $true
        }
    }
    $false
}

function Read-TaskManifest {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw [System.ArgumentException]::new("Task manifest does not exist: $Path")
    }
    try {
        $manifest = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -Depth 100
    }
    catch {
        throw [System.ArgumentException]::new("Task manifest is not valid JSON: $Path")
    }
    if ($manifest.schema -ne 'trainer-task-manifest' -or $manifest.version -ne 1) {
        throw [System.ArgumentException]::new('Unsupported or invalid task manifest schema/version.')
    }
    foreach ($property in @('task', 'pathPolicy', 'verification')) {
        if ($manifest.PSObject.Properties.Name -notcontains $property) {
            throw [System.ArgumentException]::new("Task manifest is missing required property '$property'.")
        }
    }
    $manifest
}

function Get-CommandPlanItem {
    param(
        [Parameter(Mandatory = $true)][object]$Policy,
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][object[]]$Reasons,
        [Parameter(Mandatory = $true)][bool]$ReleaseOnly
    )

    $property = $Policy.commands.PSObject.Properties[$Id]
    if ($null -eq $property) { throw "Policy references unknown command id '$Id'." }
    $metadata = $property.Value
    $registration = Get-TrainerCommandRegistration -Policy $Policy -Id $Id
    $profile = $registration.profile
    $entry = $registration.entry
    $releaseTier = $metadata.verificationTier -eq 'release'
    $unsafeClass = $profile.defaultSideEffectClass -in @('production-write', 'deploy', 'destructive')
    $hasMutationEscalation = @($entry.flagEscalations).Count -gt 0
    $downloadMechanism = $metadata.command -match '(?i)(^|\s)(npm\s+(install|ci)|npx\s)'
    $authorizationRequired = [bool]$metadata.explicitAuthorizationRequired -or
        $profile.authorizationRequirement -ne 'none'
    $executable = (-not $ReleaseOnly) -and (-not $releaseTier) -and
        [bool]$metadata.executableInImplementationMode -and
        (-not $unsafeClass) -and (-not [bool]$metadata.requiresDatabase) -and
        (-not [bool]$metadata.requiresNetwork) -and (-not $authorizationRequired) -and
        (-not $hasMutationEscalation) -and (-not $downloadMechanism)

    $skipReasons = [System.Collections.Generic.List[string]]::new()
    if ($ReleaseOnly) { $skipReasons.Add('Release-only checks are never executed in Phase 3.') }
    if ($releaseTier) { $skipReasons.Add('Policy classifies this command in the release verification tier.') }
    if (-not [bool]$metadata.executableInImplementationMode) { $skipReasons.Add('Policy does not authorize this command in local implementation mode.') }
    if ($unsafeClass) { $skipReasons.Add("Registry side-effect class '$($profile.defaultSideEffectClass)' is forbidden.") }
    if ([bool]$metadata.requiresDatabase) { $skipReasons.Add('Database access is outside Phase 3 execution scope.') }
    if ([bool]$metadata.requiresNetwork) { $skipReasons.Add('Network access is outside Phase 3 execution scope.') }
    if ($authorizationRequired) { $skipReasons.Add('The command requires separate authorization.') }
    if ($hasMutationEscalation) { $skipReasons.Add('Commands associated with mutation-escalation flags are not executable in Phase 3.') }
    if ($downloadMechanism) { $skipReasons.Add('Package installation or download mechanisms are forbidden.') }

    [pscustomobject][ordered]@{
        id = $Id
        command = [string]$metadata.command
        reasons = @($Reasons)
        sideEffectClass = [string]$profile.defaultSideEffectClass
        authorizationRequired = $authorizationRequired
        executableInRunMode = $executable
        verificationTier = [string]$metadata.verificationTier
        requirements = [pscustomobject][ordered]@{
            cleanWorktree = [bool]$metadata.requiresCleanWorktree
            dependencies = [bool]$metadata.requiresDependencies
            docker = [bool]$metadata.requiresDocker
            database = [bool]$metadata.requiresDatabase
            network = [bool]$metadata.requiresNetwork
            prisma = [bool]$metadata.requiresPrisma
            node = [bool]$metadata.requiresNode
            npm = [bool]$metadata.requiresNpm
            powershell = [bool]$metadata.requiresPowerShell
        }
        invocation = [pscustomobject][ordered]@{
            workingDirectory = [string]$metadata.invocation.workingDirectory
            executable = [string]$metadata.invocation.executable
            arguments = @($metadata.invocation.arguments | ForEach-Object { [string]$_ })
        }
        skipReasons = $skipReasons.ToArray()
    }
}

function Get-PrerequisitePlan {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Commands)

    $definitions = [ordered]@{
        powershell = 'PowerShell'
        node = 'Node.js'
        npm = 'npm'
        dependencies = 'trainer-app dependencies'
        prisma = 'Prisma CLI'
        docker = 'Docker'
        cleanWorktree = 'clean worktree'
        database = 'database access'
        network = 'network access'
    }
    $result = [System.Collections.Generic.List[object]]::new()
    foreach ($requirement in $definitions.GetEnumerator()) {
        $requiredBy = @($Commands | Where-Object { $_.requirements.($requirement.Key) } | ForEach-Object { $_.id })
        if ($requiredBy.Count -gt 0) {
            $result.Add([pscustomobject][ordered]@{
                id = $requirement.Key
                name = $requirement.Value
                requiredBy = @($requiredBy)
                status = 'not-checked'
                reason = 'Planning mode does not probe or remediate prerequisites.'
            })
        }
    }
    $result.ToArray()
}

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    $resolvedExecutable = $Executable
    if (-not [System.IO.Path]::IsPathRooted($resolvedExecutable)) {
        $localCandidate = Join-Path $WorkingDirectory $resolvedExecutable
        if (Test-Path -LiteralPath $localCandidate -PathType Leaf) {
            $resolvedExecutable = $localCandidate
        }
        else {
            $command = Get-Command $resolvedExecutable -CommandType Application -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($null -eq $command) { throw "Executable is unavailable: $Executable" }
            $resolvedExecutable = $command.Source
        }
    }

    $effectiveArguments = @($Arguments)
    if ([System.IO.Path]::GetExtension($resolvedExecutable) -in @('.cmd', '.bat')) {
        $effectiveArguments = @('/d', '/s', '/c', 'call', $resolvedExecutable) + @($Arguments)
        $resolvedExecutable = $env:ComSpec
    }

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $resolvedExecutable
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $effectiveArguments) { $startInfo.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    if (-not $process.Start()) { throw "Failed to start executable: $resolvedExecutable" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $stopwatch.Stop()
    [pscustomobject][ordered]@{
        exitCode = $process.ExitCode
        durationMs = $stopwatch.ElapsedMilliseconds
        stdout = $stdout.TrimEnd("`r", "`n")
        stderr = $stderr.TrimEnd("`r", "`n")
    }
}

function Update-PrerequisitesFromDoctor {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Preconditions,
        [Parameter(Mandatory = $true)][object]$Doctor
    )

    $toolMap = @{
        powershell = 'powershell'
        node = 'node'
        npm = 'npm'
        prisma = 'prisma'
        docker = 'docker'
    }
    foreach ($precondition in $Preconditions) {
        if ($toolMap.ContainsKey($precondition.id)) {
            $tool = @($Doctor.tools | Where-Object { $_.id -eq $toolMap[$precondition.id] }) | Select-Object -First 1
            $precondition.status = if ($null -ne $tool -and $tool.status -eq 'available') { 'available' } else { 'missing' }
            $precondition.reason = if ($null -eq $tool) { 'Doctor did not report this tool.' } else { "Doctor status: $($tool.status)." }
        }
        elseif ($precondition.id -eq 'dependencies') {
            $precondition.status = if ($Doctor.project.dependencies.status -eq 'available') { 'available' } else { 'missing' }
            $precondition.reason = "Doctor dependency status: $($Doctor.project.dependencies.status)."
        }
        elseif ($precondition.id -eq 'cleanWorktree') {
            $precondition.status = if ($Doctor.repository.dirty) { 'missing' } else { 'available' }
            $precondition.reason = if ($Doctor.repository.dirty) { 'Doctor reports a dirty worktree.' } else { 'Doctor reports a clean worktree.' }
        }
        else {
            $precondition.status = 'blocked'
            $precondition.reason = 'Phase 3 does not authorize this prerequisite.'
        }
    }
}

function Write-HumanPlan {
    param([Parameter(Mandatory = $true)][object]$Plan)

    Write-Output 'Trainer verification plan'
    Write-Output "Success: $($Plan.success)"
    Write-Output "Inspection only: $($Plan.inspectionOnly)"
    Write-Output "Run requested: $($Plan.runRequested)"
    Write-Output "Checkout: $($Plan.repository.checkoutPath)"
    Write-Output "Branch / HEAD: $($Plan.repository.branch) / $($Plan.repository.head)"
    Write-Output "Base: $($Plan.comparison.baseRef) / $($Plan.comparison.baseSha)"
    Write-Output 'Changed paths:'
    if (@($Plan.changedPaths).Count -eq 0) { Write-Output '  - none' }
    foreach ($path in @($Plan.changedPaths)) {
        Write-Output "  - $($path.path) [$($path.sources -join ', ')]"
    }
    Write-Output 'Implementation checks:'
    if (@($Plan.implementation).Count -eq 0) { Write-Output '  - none' }
    foreach ($command in @($Plan.implementation)) {
        Write-Output "  - [$($command.id)] $($command.command)"
        Write-Output "    sideEffect=$($command.sideEffectClass); executable=$($command.executableInRunMode); authorizationRequired=$($command.authorizationRequired)"
        foreach ($reason in @($command.reasons)) {
            Write-Output "    reason: $($reason.type) source=$($reason.source) rule=$($reason.rule)"
        }
    }
    Write-Output 'Release checks (never executed by Phase 3):'
    if (@($Plan.release).Count -eq 0) { Write-Output '  - none' }
    foreach ($command in @($Plan.release)) { Write-Output "  - [$($command.id)] $($command.command)" }
    Write-Output 'Prerequisites:'
    if (@($Plan.preconditions).Count -eq 0) { Write-Output '  - none' }
    foreach ($precondition in @($Plan.preconditions)) {
        Write-Output "  - $($precondition.name): $($precondition.status) (required by $($precondition.requiredBy -join ', '))"
    }
    Write-Output 'Skipped:'
    if (@($Plan.skipped).Count -eq 0) { Write-Output '  - none' }
    foreach ($item in @($Plan.skipped)) { Write-Output "  - [$($item.id)] $($item.reason)" }
    Write-Output 'Warnings:'
    if (@($Plan.warnings).Count -eq 0) { Write-Output '  - none' }
    foreach ($warning in @($Plan.warnings)) { Write-Output "  - $warning" }
    Write-Output 'Blockers:'
    if (@($Plan.blockers).Count -eq 0) { Write-Output '  - none' }
    foreach ($blocker in @($Plan.blockers)) { Write-Output "  - $blocker" }
    Write-Output ''
    if ($Plan.inspectionOnly) {
        Write-Output 'Planning only. No verification command was executed.'
    }
}

try {
    if ($null -ne $invocationError) {
        throw [System.ArgumentException]::new($invocationError)
    }
    if ($ContinueOnFailure -and (-not $Run)) {
        throw [System.ArgumentException]::new('-ContinueOnFailure requires -Run.')
    }

    $policyPath = Join-Path $PSScriptRoot 'trainer-policy.v1.json'
    $policy = Read-TrainerPolicy -Path $policyPath
    $scriptRepositoryRoot = Get-NormalizedPath -Path (Join-Path $PSScriptRoot '..\..')
    $repositoryProbe = Invoke-GitRead -WorkingDirectory $scriptRepositoryRoot -Arguments @('rev-parse', '--show-toplevel')
    $repositoryRoot = Get-NormalizedPath -Path $repositoryProbe.Output[0]
    $head = (Invoke-GitRead -WorkingDirectory $repositoryRoot -Arguments @('rev-parse', 'HEAD')).Output[0]
    $branchOutput = (Invoke-GitRead -WorkingDirectory $repositoryRoot -Arguments @('branch', '--show-current')).Output
    $branch = if (@($branchOutput).Count -eq 0) { $null } else { $branchOutput[0] }

    $manifest = $null
    $resolvedManifestPath = $null
    if (-not [string]::IsNullOrWhiteSpace($ManifestPath)) {
        $resolvedManifestPath = Get-NormalizedPath -Path $ManifestPath
        $manifest = Read-TaskManifest -Path $resolvedManifestPath
    }

    $hasExplicitPaths = @($ChangedPath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count -gt 0
    $useDefaultBase = (-not $baseRefSpecified) -and (-not $hasExplicitPaths) -and ($null -eq $manifest)
    $effectiveBaseRef = if ($useDefaultBase) { 'origin/master' } else { $BaseRef }
    $resolvedBase = $null
    $gitChanges = $null
    if (-not [string]::IsNullOrWhiteSpace($effectiveBaseRef)) {
        $baseProbe = Invoke-GitRead -WorkingDirectory $repositoryRoot -Arguments @(
            'rev-parse', '--verify', "$effectiveBaseRef^{commit}"
        ) -AllowFailure
        if ($baseProbe.ExitCode -ne 0 -or @($baseProbe.Output).Count -eq 0) {
            throw [System.ArgumentException]::new("Base ref does not resolve to a commit: $effectiveBaseRef")
        }
        $resolvedBase = $baseProbe.Output[0]
        $gitChanges = Get-GitChangedPaths -RepositoryRoot $repositoryRoot -ResolvedBase $resolvedBase
    }

    $changedRecords = @{}
    if ($null -ne $gitChanges) {
        foreach ($path in @($gitChanges.committed)) { Add-ChangedPathSource -Records $changedRecords -Path $path -Source 'git-committed' }
        foreach ($path in @($gitChanges.staged)) { Add-ChangedPathSource -Records $changedRecords -Path $path -Source 'git-staged' }
        foreach ($path in @($gitChanges.unstaged)) { Add-ChangedPathSource -Records $changedRecords -Path $path -Source 'git-unstaged' }
        foreach ($path in @($gitChanges.untracked)) { Add-ChangedPathSource -Records $changedRecords -Path $path -Source 'git-untracked' }
    }
    foreach ($path in @($ChangedPath)) {
        if (-not [string]::IsNullOrWhiteSpace($path)) { Add-ChangedPathSource -Records $changedRecords -Path $path -Source 'explicit' }
    }
    if ($null -ne $manifest) {
        foreach ($path in @($manifest.task.changedPaths)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$path)) { Add-ChangedPathSource -Records $changedRecords -Path ([string]$path) -Source 'manifest' }
        }
    }
    $changedPaths = @($changedRecords.Keys | Sort-Object | ForEach-Object {
        [pscustomobject][ordered]@{ path = $_; sources = @($changedRecords[$_]) }
    })

    $warnings = [System.Collections.Generic.List[string]]::new()
    $blockers = [System.Collections.Generic.List[string]]::new()
    $matchedRules = [System.Collections.Generic.List[object]]::new()
    $implementationSelection = @{}
    $releaseSelection = @{}

    if ($null -ne $manifest) {
        $classification = [string]$manifest.task.classification
        $classificationProperty = $policy.classifications.PSObject.Properties[$classification]
        if ($null -eq $classificationProperty) {
            throw [System.ArgumentException]::new("Manifest references unknown classification '$classification'.")
        }
        foreach ($id in @($classificationProperty.Value.implementationChecks)) {
            Add-SelectedCommand -Selection $implementationSelection -Id ([string]$id) -Type 'task-classification' -Source $resolvedManifestPath -Rule $classification
        }
        foreach ($id in @($classificationProperty.Value.releaseChecks)) {
            Add-SelectedCommand -Selection $releaseSelection -Id ([string]$id) -Type 'task-classification' -Source $resolvedManifestPath -Rule $classification
        }
        foreach ($id in @($manifest.verification.implementation.id)) {
            Add-SelectedCommand -Selection $implementationSelection -Id ([string]$id) -Type 'manifest-proposed-check' -Source $resolvedManifestPath -Rule 'trainer-task-manifest.v1'
        }
        foreach ($id in @($manifest.verification.release.id)) {
            Add-SelectedCommand -Selection $releaseSelection -Id ([string]$id) -Type 'manifest-proposed-check' -Source $resolvedManifestPath -Rule 'trainer-task-manifest.v1'
        }
        foreach ($path in $changedPaths) {
            if (@($manifest.pathPolicy.allowedPathRoots).Count -gt 0 -and
                (-not (Test-ManifestPathPolicy -Path $path.path -Roots @($manifest.pathPolicy.allowedPathRoots)))) {
                $blockers.Add("Manifest path policy does not allow '$($path.path)'.")
            }
            if (Test-ManifestPathPolicy -Path $path.path -Roots @($manifest.pathPolicy.forbiddenPathRoots)) {
                $blockers.Add("Manifest path policy forbids '$($path.path)'.")
            }
        }
    }

    foreach ($path in $changedPaths) {
        $matched = $false
        foreach ($rule in @($policy.verification.pathRules)) {
            $matchingPattern = @($rule.patterns | Where-Object {
                Test-TrainerPolicyPattern -Path $path.path -Pattern ([string]$_)
            }) | Select-Object -First 1
            if ($null -eq $matchingPattern) { continue }
            $matched = $true
            $matchedRules.Add([pscustomobject][ordered]@{
                name = [string]$rule.name
                path = $path.path
                pattern = [string]$matchingPattern
            })
            foreach ($id in @($rule.implementation)) {
                Add-SelectedCommand -Selection $implementationSelection -Id ([string]$id) -Type 'path-rule' -Source $path.path -Rule ([string]$rule.name)
            }
            foreach ($id in @($rule.release)) {
                Add-SelectedCommand -Selection $releaseSelection -Id ([string]$id) -Type 'path-rule' -Source $path.path -Rule ([string]$rule.name)
            }
        }
        if (-not $matched) {
            foreach ($id in @($policy.verification.fallback.implementation)) {
                Add-SelectedCommand -Selection $implementationSelection -Id ([string]$id) -Type 'fallback' -Source $path.path -Rule 'unmatched-path'
            }
            foreach ($id in @($policy.verification.fallback.release)) {
                Add-SelectedCommand -Selection $releaseSelection -Id ([string]$id) -Type 'fallback' -Source $path.path -Rule 'unmatched-path'
            }
            $warnings.Add("$($policy.verification.fallback.warning) Path: $($path.path)")
        }
    }

    $orderedIds = @($policy.verification.commandOrder | ForEach-Object { [string]$_ })
    $allSelectedIds = @($implementationSelection.Keys) + @($releaseSelection.Keys)
    foreach ($id in $allSelectedIds) {
        if ($id -notin $orderedIds) { throw "Selected command '$id' is absent from verification.commandOrder." }
    }
    $implementation = @($orderedIds | Where-Object { $implementationSelection.ContainsKey($_) } | ForEach-Object {
        Get-CommandPlanItem -Policy $policy -Id $_ -Reasons @($implementationSelection[$_]) -ReleaseOnly $false
    })
    $release = @($orderedIds | Where-Object { $releaseSelection.ContainsKey($_) } | ForEach-Object {
        Get-CommandPlanItem -Policy $policy -Id $_ -Reasons @($releaseSelection[$_]) -ReleaseOnly $true
    })
    $preconditions = @(Get-PrerequisitePlan -Commands $implementation)
    $skipped = [System.Collections.Generic.List[object]]::new()
    foreach ($command in @($implementation + $release)) {
        if (-not $command.executableInRunMode) {
            $reason = if (@($command.skipReasons).Count -gt 0) { $command.skipReasons -join ' ' } else { 'Not eligible for execution.' }
            $skipped.Add([pscustomobject][ordered]@{ id = $command.id; reason = $reason })
        }
    }

    $plan = [pscustomobject][ordered]@{
        schema = 'trainer-verification-plan'
        version = 1
        inspectionOnly = -not $Run
        runRequested = [bool]$Run
        repository = [pscustomobject][ordered]@{
            root = $repositoryRoot
            checkoutPath = $repositoryRoot
            branch = $branch
            head = $head
            policyPath = $policyPath
        }
        comparison = [pscustomobject][ordered]@{
            baseRef = $effectiveBaseRef
            baseSha = $resolvedBase
            includesCommitted = $null -ne $gitChanges
            includesStaged = $null -ne $gitChanges
            includesUnstaged = $null -ne $gitChanges
            includesUntracked = $null -ne $gitChanges
            explicitPathsCombined = $hasExplicitPaths
            manifestCombined = $null -ne $manifest
        }
        changedPaths = @($changedPaths)
        matchedRules = $matchedRules.ToArray()
        implementation = @($implementation)
        release = @($release)
        preconditions = @($preconditions)
        skipped = $skipped.ToArray()
        execution = [pscustomobject][ordered]@{
            requested = [bool]$Run
            continueOnFailure = [bool]$ContinueOnFailure
            status = if ($Run) { 'pending' } else { 'not-requested' }
            results = @()
        }
        warnings = $warnings.ToArray()
        blockers = $blockers.ToArray()
        success = $blockers.Count -eq 0
    }

    if ($Run) {
        if ($Json) {
            [Console]::Error.WriteLine('Pre-execution Trainer verification plan:')
            [Console]::Error.WriteLine(($plan | ConvertTo-Json -Depth 20))
        }
        else {
            Write-HumanPlan -Plan $plan
        }

        $doctorResult = Invoke-CapturedProcess -Executable 'pwsh' -Arguments @(
            '-NoProfile', '-File', (Join-Path $PSScriptRoot 'Invoke-TrainerDoctor.ps1'), '-Json'
        ) -WorkingDirectory $repositoryRoot
        if ($doctorResult.exitCode -notin @(0, 1)) {
            $plan.blockers = @($plan.blockers) + "Doctor prerequisite discovery failed with exit code $($doctorResult.exitCode)."
        }
        else {
            $doctor = $null
            try { $doctor = $doctorResult.stdout | ConvertFrom-Json -Depth 100 }
            catch { $plan.blockers = @($plan.blockers) + 'Doctor prerequisite report was not valid JSON.' }
            if ($null -ne $doctor) {
                Update-PrerequisitesFromDoctor -Preconditions $plan.preconditions -Doctor $doctor
                foreach ($precondition in @($plan.preconditions | Where-Object { $_.status -ne 'available' })) {
                    foreach ($commandId in @($precondition.requiredBy)) {
                        $selectedCommand = @($plan.implementation | Where-Object { $_.id -eq $commandId }) | Select-Object -First 1
                        if ($null -ne $selectedCommand -and $selectedCommand.executableInRunMode) {
                            $plan.blockers = @($plan.blockers) + "Command '$commandId' is blocked by prerequisite '$($precondition.name)': $($precondition.reason)"
                        }
                    }
                }
            }
        }

        $results = [System.Collections.Generic.List[object]]::new()
        $failed = $false
        $globalExecutionBlocked = @($plan.blockers | Where-Object {
            $_ -notlike "Command '*' is blocked by prerequisite*"
        }).Count -gt 0
        foreach ($command in $plan.implementation) {
            if (-not $command.executableInRunMode) { continue }
            $commandBlocked = @($plan.blockers | Where-Object { $_ -like "Command '$($command.id)' is blocked*" }).Count -gt 0
            if ($globalExecutionBlocked -or $commandBlocked) {
                $results.Add([pscustomobject][ordered]@{
                    id = $command.id; status = 'blocked'; exitCode = $null; durationMs = 0; stdout = ''; stderr = ''
                })
                continue
            }
            if ($failed -and (-not $ContinueOnFailure)) {
                $results.Add([pscustomobject][ordered]@{
                    id = $command.id; status = 'not-run-after-failure'; exitCode = $null; durationMs = 0; stdout = ''; stderr = ''
                })
                continue
            }

            $workingDirectory = if ($command.invocation.workingDirectory -eq 'trainer-app') {
                Join-Path $repositoryRoot 'trainer-app'
            }
            elseif ($command.invocation.workingDirectory -eq 'repository') {
                $repositoryRoot
            }
            else {
                throw "Command '$($command.id)' has an invalid invocation working directory."
            }
            $result = Invoke-CapturedProcess -Executable $command.invocation.executable -Arguments @($command.invocation.arguments) -WorkingDirectory $workingDirectory
            $status = if ($result.exitCode -eq 0) { 'passed' } else { 'failed' }
            $results.Add([pscustomobject][ordered]@{
                id = $command.id
                status = $status
                exitCode = $result.exitCode
                durationMs = $result.durationMs
                stdout = $result.stdout
                stderr = $result.stderr
            })
            if (-not $Json) {
                Write-Output "EXECUTED [$($command.id)] status=$status exit=$($result.exitCode) durationMs=$($result.durationMs)"
                if ($result.stdout) { Write-Output $result.stdout }
                if ($result.stderr) { [Console]::Error.WriteLine($result.stderr) }
            }
            if ($result.exitCode -ne 0) { $failed = $true }
        }
        $plan.execution.results = $results.ToArray()
        $plan.execution.status = if ($failed) { 'failed' } elseif (@($plan.blockers).Count -gt 0) { 'blocked' } else { 'completed' }
        $plan.success = (-not $failed) -and @($plan.blockers).Count -eq 0
    }

    if ($Json) {
        $plan | ConvertTo-Json -Depth 20
    }
    elseif (-not $Run) {
        Write-HumanPlan -Plan $plan
    }
    elseif (@($plan.blockers).Count -gt 0) {
        Write-Output 'Execution blockers:'
        foreach ($blocker in $plan.blockers) { Write-Output "  - $blocker" }
    }

    if (-not $plan.success) { exit $ExitBlocked }
    exit $ExitSuccess
}
catch [System.ArgumentException] {
    if ($Json) {
        [pscustomobject][ordered]@{
            schema = 'trainer-verification-plan-error'
            version = 1
            error = $_.Exception.Message
            success = $false
        } | ConvertTo-Json -Depth 4
    }
    else {
        [Console]::Error.WriteLine("Invalid Trainer verification invocation: $($_.Exception.Message)")
    }
    exit $ExitInvalid
}
catch {
    if ($Json) {
        [pscustomobject][ordered]@{
            schema = 'trainer-verification-plan-error'
            version = 1
            error = $_.Exception.Message
            success = $false
        } | ConvertTo-Json -Depth 4
    }
    else {
        [Console]::Error.WriteLine("Trainer verification failed: $($_.Exception.Message)")
    }
    exit $ExitUnexpected
}
