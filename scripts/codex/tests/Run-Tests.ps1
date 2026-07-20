[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:TestsRun = 0
$script:TestsFailed = 0
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceScript = Join-Path $sourceRoot 'Start-TrainerTask.ps1'
$sourceModule = Join-Path $sourceRoot 'Trainer.Tooling.psm1'
$sourceDoctor = Join-Path $sourceRoot 'Invoke-TrainerDoctor.ps1'
$sourceRegistryValidator = Join-Path $sourceRoot 'Test-TrainerCommandRegistry.ps1'
$sourceVerification = Join-Path $sourceRoot 'Invoke-TrainerVerification.ps1'
$sourcePolicy = Join-Path $sourceRoot 'trainer-policy.v1.json'

function Invoke-GitFixture {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $output = @(& git -C $Repository @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Fixture git command failed: git $($Arguments -join ' ')`n$($output -join "`n")"
    }
    $output
}

function New-TestRepository {
    $sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("trainer-task-tests-" + [guid]::NewGuid().ToString('N'))
    $repository = Join-Path $sandbox 'repo'
    New-Item -ItemType Directory -Path (Join-Path $repository 'scripts\codex') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $repository 'trainer-app') -Force | Out-Null
    Copy-Item -LiteralPath $sourceScript -Destination (Join-Path $repository 'scripts\codex\Start-TrainerTask.ps1')
    Copy-Item -LiteralPath $sourceModule -Destination (Join-Path $repository 'scripts\codex\Trainer.Tooling.psm1')
    Copy-Item -LiteralPath $sourceDoctor -Destination (Join-Path $repository 'scripts\codex\Invoke-TrainerDoctor.ps1')
    Copy-Item -LiteralPath $sourceRegistryValidator -Destination (Join-Path $repository 'scripts\codex\Test-TrainerCommandRegistry.ps1')
    Copy-Item -LiteralPath $sourceVerification -Destination (Join-Path $repository 'scripts\codex\Invoke-TrainerVerification.ps1')
    Copy-Item -LiteralPath $sourcePolicy -Destination (Join-Path $repository 'scripts\codex\trainer-policy.v1.json')
    $fixturePolicyPath = Join-Path $repository 'scripts\codex\trainer-policy.v1.json'
    $fixturePolicy = Get-Content -Raw -LiteralPath $fixturePolicyPath | ConvertFrom-Json
    $fixturePolicy.repository.canonicalWorktreeRoot = Join-Path $sandbox 'canonical'
    $fixturePolicy.doctor.tools = @(
        [pscustomobject][ordered]@{
            id = 'git'
            name = 'Git'
            commandNames = @('git')
            requiredFor = @('application-implementation')
            missingHint = 'Expose Git to PATH.'
            presenceOnly = $false
        }
    )
    $fixturePolicy | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $fixturePolicyPath -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $repository 'trainer-app\package.json') -Value '{"name":"fixture","scripts":{}}' -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $repository 'trainer-app\package-lock.json') -Value '{"lockfileVersion":3}' -Encoding utf8NoBOM
    New-Item -ItemType Directory -Path (Join-Path $repository 'trainer-app\prisma\migrations\fixture') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $repository 'trainer-app\prisma\schema.prisma') -Value 'generator client { provider = "prisma-client-js" }' -Encoding utf8NoBOM
    Invoke-GitFixture -Repository $repository -Arguments @('init', '-b', 'master') | Out-Null
    Invoke-GitFixture -Repository $repository -Arguments @('config', 'user.email', 'trainer-tests@example.invalid') | Out-Null
    Invoke-GitFixture -Repository $repository -Arguments @('config', 'user.name', 'Trainer Tests') | Out-Null
    Invoke-GitFixture -Repository $repository -Arguments @('add', '.') | Out-Null
    Invoke-GitFixture -Repository $repository -Arguments @('commit', '-m', 'fixture') | Out-Null

    [pscustomobject]@{
        Sandbox = $sandbox
        Repository = $repository
        Script = Join-Path $repository 'scripts\codex\Start-TrainerTask.ps1'
        Doctor = Join-Path $repository 'scripts\codex\Invoke-TrainerDoctor.ps1'
        Verification = Join-Path $repository 'scripts\codex\Invoke-TrainerVerification.ps1'
        Module = Join-Path $repository 'scripts\codex\Trainer.Tooling.psm1'
        Policy = $fixturePolicyPath
    }
}

function Remove-TestRepository {
    param([Parameter(Mandatory = $true)][object]$Fixture)

    $sandbox = [System.IO.Path]::GetFullPath($Fixture.Sandbox)
    $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
    $sandboxName = Split-Path -Leaf $sandbox
    if ((-not $sandbox.StartsWith($temporaryRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) -or
        (-not $sandboxName.StartsWith('trainer-task-tests-', [System.StringComparison]::Ordinal))) {
        throw "Refusing to remove unexpected test sandbox: $sandbox"
    }
    if (Test-Path -LiteralPath $sandbox) {
        Remove-Item -LiteralPath $sandbox -Recurse -Force
    }
}

function Invoke-Inspector {
    param(
        [Parameter(Mandatory = $true)][object]$Fixture,
        [string]$Name = 'phase-one-test',
        [string]$Classification = 'shared-seam-write',
        [string]$BaseBranch = 'master',
        [switch]$Json,
        [string[]]$ChangedPath = @()
    )

    $quote = {
        param([string]$Value)
        "'" + $Value.Replace("'", "''") + "'"
    }
    $command = "& $(& $quote $Fixture.Script) -Name $(& $quote $Name) -Classification $(& $quote $Classification) -BaseBranch $(& $quote $BaseBranch)"
    if ($Json) { $command += ' -Json' }
    if ($ChangedPath.Count -gt 0) {
        $changedArguments = @($ChangedPath | ForEach-Object { & $quote $_ }) -join ', '
        $command += " -ChangedPath @($changedArguments)"
    }
    $command += '; exit $LASTEXITCODE'

    $output = @(& pwsh -NoProfile -Command $command 2>&1)
    $exitCode = $LASTEXITCODE
    [pscustomobject]@{
        ExitCode = $exitCode
        Text = $output -join "`n"
        Lines = $output
    }
}

function Invoke-Doctor {
    param(
        [Parameter(Mandatory = $true)][object]$Fixture,
        [switch]$Json,
        [string]$Scope,
        [string]$PathPrefix
    )

    $arguments = @('-NoProfile', '-File', $Fixture.Doctor)
    if ($Json) { $arguments += '-Json' }
    if ($PSBoundParameters.ContainsKey('Scope')) { $arguments += @('-Scope', $Scope) }

    $previousPath = $env:PATH
    try {
        if ($PathPrefix) {
            $env:PATH = $PathPrefix + [System.IO.Path]::PathSeparator + $env:PATH
        }
        $output = @(& pwsh @arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $env:PATH = $previousPath
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Text = $output -join "`n"
        Lines = $output
    }
}

function Invoke-Verification {
    param(
        [Parameter(Mandatory = $true)][object]$Fixture,
        [string]$BaseRef,
        [string[]]$ChangedPath = @(),
        [string]$ManifestPath,
        [switch]$Json,
        [switch]$Run,
        [switch]$ContinueOnFailure,
        [string[]]$ExtraArguments = @()
    )

    $arguments = [System.Collections.Generic.List[string]]::new()
    $arguments.Add('-NoProfile')
    $arguments.Add('-File')
    $arguments.Add($Fixture.Verification)
    if ($PSBoundParameters.ContainsKey('BaseRef')) { $arguments.Add('-BaseRef'); $arguments.Add($BaseRef) }
    foreach ($path in $ChangedPath) { $arguments.Add('-ChangedPath'); $arguments.Add($path) }
    if ($PSBoundParameters.ContainsKey('ManifestPath')) { $arguments.Add('-ManifestPath'); $arguments.Add($ManifestPath) }
    if ($Json) { $arguments.Add('-Json') }
    if ($Run) { $arguments.Add('-Run') }
    if ($ContinueOnFailure) { $arguments.Add('-ContinueOnFailure') }
    foreach ($argument in $ExtraArguments) { $arguments.Add($argument) }

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Get-Command pwsh -CommandType Application).Source
    $startInfo.WorkingDirectory = $Fixture.Repository
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $arguments) { $startInfo.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $process.Start() | Out-Null
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()

    [pscustomobject]@{
        ExitCode = $process.ExitCode
        Text = $stdoutTask.GetAwaiter().GetResult().TrimEnd("`r", "`n")
        ErrorText = $stderrTask.GetAwaiter().GetResult().TrimEnd("`r", "`n")
    }
}

function Set-FixtureVerificationCommand {
    param(
        [Parameter(Mandatory = $true)][object]$Fixture,
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Executable,
        [string[]]$Arguments = @(),
        [string]$Profile = 'read-only',
        [bool]$ExecutableInImplementationMode = $true,
        [hashtable]$Requirements = @{},
        [object[]]$FlagEscalations = @()
    )

    $policy = Get-Content -Raw -LiteralPath $Fixture.Policy | ConvertFrom-Json -Depth 100
    $command = $policy.commands.PSObject.Properties[$Id].Value
    $command.command = "$Executable $($Arguments -join ' ')".Trim()
    $command.executableInImplementationMode = $ExecutableInImplementationMode
    $command.invocation.executable = $Executable
    $command.invocation.arguments = @($Arguments)
    $command.invocation.workingDirectory = 'repository'
    foreach ($property in @('requiresCleanWorktree', 'requiresDependencies', 'requiresDocker', 'requiresDatabase', 'requiresNetwork', 'requiresPrisma', 'requiresNode', 'requiresNpm', 'requiresPowerShell')) {
        $command.$property = if ($Requirements.ContainsKey($property)) { [bool]$Requirements[$property] } else { $false }
    }
    $entry = @($policy.commandRegistry | Where-Object { $_.id -eq $Id }) | Select-Object -First 1
    $entry.command = $command.command
    $entry.profile = $Profile
    $entry.flagEscalations = @($FlagEscalations)
    $policy.verification.pathRules = @(
        [pscustomobject][ordered]@{ name = 'fixture-execution'; patterns = @('execute/**'); implementation = @($Id); release = @() }
    )
    $policy | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $Fixture.Policy -Encoding utf8NoBOM
}

function Invoke-RegistryValidator {
    $output = @(& pwsh -NoProfile -File $sourceRegistryValidator -Json 2>&1)
    [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Text = $output -join "`n"
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message Expected '$Expected', got '$Actual'."
    }
}

function Invoke-Test {
    param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][scriptblock]$Body)

    $script:TestsRun++
    try {
        & $Body
        Write-Output "PASS $Name"
    }
    catch {
        $script:TestsFailed++
        Write-Output "FAIL $Name"
        Write-Output "  $($_.Exception.Message)"
    }
}

Invoke-Test 'valid task inspection' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Inspector -Fixture $fixture -Json
        $manifest = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 0 'Valid inspection exit code mismatch.'
        Assert-True $manifest.success 'Valid inspection should succeed.'
        Assert-True $manifest.inspectionOnly 'Inspection-only flag should be true.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'human-readable output' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Inspector -Fixture $fixture
        Assert-Equal $result.ExitCode 0 'Human inspection exit code mismatch.'
        Assert-True ($result.Text.Contains('Trainer task inspection: phase-one-test')) 'Human heading missing.'
        Assert-True ($result.Text.Contains('Inspection only. No worktree, branch, package, database, deployment, or repository state was modified.')) 'Inspect-only guarantee missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'JSON task-manifest.v1 contract' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Inspector -Fixture $fixture -Json
        $manifest = $result.Text | ConvertFrom-Json
        Assert-Equal $manifest.schema 'trainer-task-manifest' 'Manifest schema mismatch.'
        Assert-Equal $manifest.version 1 'Manifest version mismatch.'
        Assert-True ($null -ne $manifest.task) 'Task object missing.'
        Assert-True ($null -ne $manifest.repository) 'Repository object missing.'
        Assert-True ($null -ne $manifest.worktrees) 'Worktrees array missing.'
        Assert-True ($null -ne $manifest.pathPolicy) 'Path policy missing.'
        Assert-True ($null -ne $manifest.databasePolicy) 'Database policy missing.'
        Assert-True ($null -ne $manifest.verification.implementation) 'Implementation checks missing.'
        Assert-True ($null -ne $manifest.verification.release) 'Release checks missing.'
        Assert-True ($null -ne $manifest.warnings) 'Warnings missing.'
        Assert-True ($null -ne $manifest.blockers) 'Blockers missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'Phase 1 side-effect labels remain backward compatible' {
    $policy = Get-Content -Raw -LiteralPath $sourcePolicy | ConvertFrom-Json
    $expected = [ordered]@{
        'codex-tooling-tests' = 'temporary-local-test-fixtures'
        'git-diff-check' = 'read-only'
        'test-fast' = 'local-test'
        'verify-contracts' = 'local-verification'
        'verify' = 'local-verification'
        'prisma-generate' = 'local-code-generation'
        'test-migration-integrity' = 'database-test'
        'test-audit-matrix' = 'local-test'
        'audit-future-week' = 'database-read'
    }

    foreach ($entry in $expected.GetEnumerator()) {
        Assert-Equal $policy.commands.($entry.Key).defaultSideEffectClass $entry.Value "Phase 1 side-effect class changed for '$($entry.Key)'."
    }
}

Invoke-Test 'invalid task name' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Inspector -Fixture $fixture -Name 'Invalid Name' -Json
        $manifest = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 2 'Invalid name must exit 2.'
        Assert-True (-not $manifest.task.nameValid) 'Invalid name should be reported.'
        Assert-True ($manifest.blockers.Count -gt 0) 'Invalid name blocker missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'invalid classification' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Inspector -Fixture $fixture -Classification 'unknown' -Json
        $manifest = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 2 'Invalid classification must exit 2.'
        Assert-True (@($manifest.blockers | Where-Object { $_ -match 'Invalid classification' }).Count -gt 0) 'Invalid classification blocker missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'existing branch conflict' {
    $fixture = New-TestRepository
    try {
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @('branch', 'codex/branch-conflict') | Out-Null
        $result = Invoke-Inspector -Fixture $fixture -Name 'branch-conflict' -Json
        $manifest = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 1 'Branch conflict must exit 1.'
        Assert-True $manifest.task.branchConflict 'Branch conflict flag missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'existing worktree path conflict' {
    $fixture = New-TestRepository
    try {
        $canonicalRoot = Join-Path $fixture.Sandbox 'canonical'
        $policy = Get-Content -Raw -LiteralPath $fixture.Policy | ConvertFrom-Json
        $policy.repository.canonicalWorktreeRoot = $canonicalRoot
        $policy | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $fixture.Policy -Encoding utf8NoBOM
        $conflictPath = Join-Path $canonicalRoot 'path-conflict'
        New-Item -ItemType Directory -Path $canonicalRoot -Force | Out-Null
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @('worktree', 'add', '-b', 'fixture/path-conflict', $conflictPath, 'master') | Out-Null
        $result = Invoke-Inspector -Fixture $fixture -Name 'path-conflict' -Json
        $manifest = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 1 'Worktree path conflict must exit 1.'
        Assert-True $manifest.task.worktreePathConflict 'Worktree path conflict flag missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'dirty primary checkout reporting' {
    $fixture = New-TestRepository
    try {
        Set-Content -LiteralPath (Join-Path $fixture.Repository 'dirty.txt') -Value 'dirty' -Encoding utf8NoBOM
        $result = Invoke-Inspector -Fixture $fixture -Json
        $manifest = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 0 'Dirty unrelated primary checkout should warn, not block.'
        Assert-True $manifest.repository.primaryDirty 'Primary dirty flag missing.'
        Assert-True ($manifest.repository.primaryDirtyPaths -contains 'dirty.txt') 'Exact primary dirty path missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'non-canonical worktree reporting' {
    $fixture = New-TestRepository
    try {
        $outsidePath = Join-Path $fixture.Sandbox 'outside-root'
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @('worktree', 'add', '-b', 'fixture/outside', $outsidePath, 'master') | Out-Null
        $result = Invoke-Inspector -Fixture $fixture -Json
        $manifest = $result.Text | ConvertFrom-Json
        $outside = @($manifest.worktrees | Where-Object { $_.branch -eq 'fixture/outside' })
        Assert-Equal $outside.Count 1 'Non-canonical worktree missing.'
        Assert-True ($outside[0].canonicalPathCompliant -eq $false) 'Non-canonical worktree should be false.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'path verification selection and deduplication' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Inspector -Fixture $fixture -Json -ChangedPath @('trainer-app/src/lib/validation.ts', 'trainer-app/src/lib/api/workout-context.ts')
        $manifest = $result.Text | ConvertFrom-Json
        $ids = @($manifest.verification.implementation.id)
        Assert-True ($ids -contains 'verify-contracts') 'Contract verification was not selected.'
        Assert-True ($ids -contains 'test-fast') 'Shared seam verification was not selected.'
        Assert-Equal $ids.Count (@($ids | Select-Object -Unique).Count) 'Implementation commands were not deduplicated.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'implementation and release checks remain separate' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Inspector -Fixture $fixture -Classification 'audit' -Json -ChangedPath @('trainer-app/src/lib/audit/workout-audit/example.ts')
        $manifest = $result.Text | ConvertFrom-Json
        Assert-True ($manifest.verification.implementation.id -contains 'test-audit-matrix') 'Audit implementation check missing.'
        Assert-True ($manifest.verification.release.id -contains 'audit-future-week') 'Audit release check missing.'
        Assert-True (-not ($manifest.verification.implementation.id -contains 'audit-future-week')) 'Release check leaked into implementation checks.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'unknown path conservative fallback' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Inspector -Fixture $fixture -Classification 'audit' -Json -ChangedPath @('unknown/location.txt')
        $manifest = $result.Text | ConvertFrom-Json
        Assert-True ($manifest.verification.implementation.id -contains 'verify') 'Fallback verification missing.'
        Assert-True ($manifest.verification.unmatchedChangedPaths -contains 'unknown/location.txt') 'Unmatched path missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'inspection does not mutate repository state' {
    $fixture = New-TestRepository
    try {
        $beforeStatus = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('status', '--porcelain=v1', '--untracked-files=all')) -join "`n"
        $beforeRefs = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('show-ref')) -join "`n"
        $beforeWorktrees = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('worktree', 'list', '--porcelain')) -join "`n"
        $beforeConfig = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('config', '--local', '--list')) -join "`n"
        $result = Invoke-Inspector -Fixture $fixture -Json -ChangedPath @('scripts/codex/Start-TrainerTask.ps1')
        Assert-Equal $result.ExitCode 0 'Mutation safety inspection failed unexpectedly.'
        $afterStatus = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('status', '--porcelain=v1', '--untracked-files=all')) -join "`n"
        $afterRefs = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('show-ref')) -join "`n"
        $afterWorktrees = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('worktree', 'list', '--porcelain')) -join "`n"
        $afterConfig = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('config', '--local', '--list')) -join "`n"
        Assert-Equal $afterStatus $beforeStatus 'Inspection changed working-tree state.'
        Assert-Equal $afterRefs $beforeRefs 'Inspection changed refs.'
        Assert-Equal $afterWorktrees $beforeWorktrees 'Inspection changed registered worktrees.'
        Assert-Equal $afterConfig $beforeConfig 'Inspection changed local Git config.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'doctor human-readable output' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Doctor -Fixture $fixture
        Assert-Equal $result.ExitCode 0 "Human doctor exit code mismatch. Output: $($result.Text)"
        Assert-True ($result.Text.Contains('Trainer local environment doctor')) 'Doctor human heading missing.'
        Assert-True ($result.Text.Contains('Inspection only. No package installation, authentication, repair, database connection, migration, deployment, or recommended command was performed.')) 'Doctor inspect-only guarantee missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'doctor JSON contract and array stability' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Doctor -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 0 "JSON doctor exit code mismatch. Output: $($result.Text)"
        Assert-Equal $report.schema 'trainer-doctor-report' 'Doctor schema mismatch.'
        Assert-Equal $report.version 1 'Doctor version mismatch.'
        Assert-True $report.inspectionOnly 'Doctor inspectionOnly must be true.'
        Assert-True $report.success 'Doctor fixture should succeed.'
        Assert-Equal @($report.project.envFileNames).Count 0 'Empty env filename array did not remain an array.'
        $gitTool = @($report.tools | Where-Object { $_.id -eq 'git' })
        Assert-Equal $gitTool.Count 1 'Expected exactly one Git capability.'
        Assert-Equal @($gitTool[0].requiredFor).Count 1 'Single-item requiredFor array did not remain an array.'
        Assert-True ($null -ne $report.warnings) 'Warnings array missing.'
        Assert-True ($null -ne $report.blockers) 'Blockers array missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'doctor default scopes remain local-only' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Doctor -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json
        Assert-Equal $report.scopes.local.status 'checked' 'Local scope should be checked.'
        Assert-Equal $report.scopes.database.status 'not-checked' 'Database scope must not be checked by default.'
        Assert-Equal $report.scopes.github.status 'not-checked' 'GitHub scope must not be checked by default.'
        Assert-Equal $report.scopes.deployment.status 'not-checked' 'Deployment scope must not be checked by default.'
        Assert-True ($report.scopes.database.reason -match 'no connection was attempted') 'Database no-access reason missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'missing optional doctor tool warns without blocking' {
    $fixture = New-TestRepository
    try {
        $policy = Get-Content -Raw -LiteralPath $fixture.Policy | ConvertFrom-Json
        $policy.doctor.tools = @(
            [pscustomobject][ordered]@{
                id = 'optional-missing'
                name = 'Optional missing fixture tool'
                commandNames = @('trainer-doctor-guaranteed-missing-command')
                requiredFor = @()
                missingHint = 'Fixture remediation only.'
                presenceOnly = $true
            }
        )
        $policy | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $fixture.Policy -Encoding utf8NoBOM
        $result = Invoke-Doctor -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 0 'Missing optional tool must not block doctor completion.'
        Assert-True $report.success 'Missing optional tool should preserve success.'
        $tool = @($report.tools | Where-Object { $_.id -eq 'optional-missing' })
        Assert-Equal $tool.Count 1 'Missing optional tool result absent.'
        Assert-Equal $tool[0].status 'missing' 'Missing optional tool status mismatch.'
        Assert-True (@($report.warnings | Where-Object { $_ -match 'Optional missing fixture tool' }).Count -eq 1) 'Missing optional warning absent.'
        Assert-Equal @($report.blockers).Count 0 'Missing optional tool must not create a blocker.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'doctor missing policy exits 3' {
    $fixture = New-TestRepository
    try {
        Remove-Item -LiteralPath $fixture.Policy -Force
        $result = Invoke-Doctor -Fixture $fixture -Json
        $errorReport = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 3 'Missing policy must exit 3.'
        Assert-Equal $errorReport.schema 'trainer-doctor-report-error' 'Missing-policy error schema mismatch.'
        Assert-True (-not $errorReport.success) 'Missing-policy report must fail.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'doctor invalid scope exits 2' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Doctor -Fixture $fixture -Json -Scope 'invalid-scope'
        $report = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 2 'Invalid scope must exit 2.'
        Assert-Equal $report.schema 'trainer-doctor-report' 'Invalid-scope report schema mismatch.'
        Assert-True (@($report.blockers).Count -eq 1) 'Invalid-scope blocker missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'doctor dirty checkout and worktree summary reporting' {
    $fixture = New-TestRepository
    try {
        Set-Content -LiteralPath (Join-Path $fixture.Repository 'doctor-dirty.txt') -Value 'dirty' -Encoding utf8NoBOM
        $result = Invoke-Doctor -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json
        Assert-True $report.repository.dirty 'Doctor dirty flag missing.'
        Assert-True ($report.repository.dirtyPaths -contains 'doctor-dirty.txt') 'Doctor dirty path missing.'
        Assert-Equal $report.repository.worktreeCount 1 'Fixture worktree count mismatch.'
        Assert-Equal $report.repository.checkoutType 'primary' 'Fixture checkout type mismatch.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'tool version detection preserves paths with spaces' {
    $fixture = New-TestRepository
    try {
        $toolDirectory = Join-Path $fixture.Sandbox 'tools with spaces'
        New-Item -ItemType Directory -Path $toolDirectory -Force | Out-Null
        $toolPath = Join-Path $toolDirectory 'fixture-tool.cmd'
        Set-Content -LiteralPath $toolPath -Value '@echo fixture-tool 9.8.7' -Encoding ascii
        Import-Module $fixture.Module -Force
        $capability = Get-ExecutableCapability `
            -Id 'fixture-tool' `
            -Name 'Fixture Tool' `
            -CommandNames @($toolPath) `
            -RequiredFor @('application-implementation') `
            -MissingHint 'Fixture hint.'
        Assert-Equal $capability.status 'available' 'Tool in spaced path should be available.'
        Assert-Equal $capability.version 'fixture-tool 9.8.7' 'Tool version mismatch.'
        Assert-True ($capability.path.Contains('tools with spaces')) 'Tool path with spaces was not preserved.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'doctor never invokes npx download GitHub Vercel or database access' {
    $fixture = New-TestRepository
    try {
        $toolDirectory = Join-Path $fixture.Sandbox 'guarded-tools'
        New-Item -ItemType Directory -Path $toolDirectory -Force | Out-Null
        $githubSentinel = Join-Path $fixture.Sandbox 'github-invoked.txt'
        $vercelSentinel = Join-Path $fixture.Sandbox 'vercel-invoked.txt'
        $databaseSentinel = Join-Path $fixture.Sandbox 'database-invoked.txt'
        $npxSentinel = Join-Path $fixture.Sandbox 'npx-non-version-invoked.txt'
        Set-Content -LiteralPath (Join-Path $toolDirectory 'gh.cmd') -Value ('@echo invoked>"{0}"' -f $githubSentinel) -Encoding ascii
        Set-Content -LiteralPath (Join-Path $toolDirectory 'vercel.cmd') -Value ('@echo invoked>"{0}"' -f $vercelSentinel) -Encoding ascii
        Set-Content -LiteralPath (Join-Path $toolDirectory 'psql.cmd') -Value ('@if "%1"=="--version" (echo psql fixture 1.0) else (echo invoked>"{0}")' -f $databaseSentinel) -Encoding ascii
        Set-Content -LiteralPath (Join-Path $toolDirectory 'npx.cmd') -Value ('@if "%1"=="--version" (echo 1.0.0) else (echo invoked>"{0}")' -f $npxSentinel) -Encoding ascii
        $policy = Get-Content -Raw -LiteralPath $fixture.Policy | ConvertFrom-Json
        $policy.doctor.tools = @(
            [pscustomobject][ordered]@{ id = 'npx'; name = 'npx'; commandNames = @('npx.cmd', 'npx'); requiredFor = @(); missingHint = 'fixture'; presenceOnly = $false },
            [pscustomobject][ordered]@{ id = 'psql'; name = 'psql'; commandNames = @('psql.cmd', 'psql'); requiredFor = @(); missingHint = 'fixture'; presenceOnly = $false },
            [pscustomobject][ordered]@{ id = 'vercel'; name = 'Vercel'; commandNames = @('vercel.cmd', 'vercel'); requiredFor = @(); missingHint = 'fixture'; presenceOnly = $true },
            [pscustomobject][ordered]@{ id = 'gh'; name = 'GitHub'; commandNames = @('gh.cmd', 'gh'); requiredFor = @(); missingHint = 'fixture'; presenceOnly = $true }
        )
        $policy | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $fixture.Policy -Encoding utf8NoBOM
        $result = Invoke-Doctor -Fixture $fixture -Json -PathPrefix $toolDirectory
        Assert-Equal $result.ExitCode 0 'Guarded-tool doctor run failed.'
        Assert-True (-not (Test-Path -LiteralPath $githubSentinel)) 'Doctor invoked GitHub CLI.'
        Assert-True (-not (Test-Path -LiteralPath $vercelSentinel)) 'Doctor invoked Vercel CLI.'
        Assert-True (-not (Test-Path -LiteralPath $databaseSentinel)) 'Doctor attempted database access.'
        Assert-True (-not (Test-Path -LiteralPath $npxSentinel)) 'Doctor invoked npx beyond local version detection.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'doctor does not mutate repository state' {
    $fixture = New-TestRepository
    try {
        $beforeStatus = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('status', '--porcelain=v1', '--untracked-files=all')) -join "`n"
        $beforeRefs = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('show-ref')) -join "`n"
        $beforeWorktrees = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('worktree', 'list', '--porcelain')) -join "`n"
        $beforeConfig = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('config', '--local', '--list')) -join "`n"
        $result = Invoke-Doctor -Fixture $fixture -Json
        Assert-Equal $result.ExitCode 0 'Doctor mutation-safety run failed.'
        $afterStatus = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('status', '--porcelain=v1', '--untracked-files=all')) -join "`n"
        $afterRefs = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('show-ref')) -join "`n"
        $afterWorktrees = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('worktree', 'list', '--porcelain')) -join "`n"
        $afterConfig = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('config', '--local', '--list')) -join "`n"
        Assert-Equal $afterStatus $beforeStatus 'Doctor changed working-tree state.'
        Assert-Equal $afterRefs $beforeRefs 'Doctor changed refs.'
        Assert-Equal $afterWorktrees $beforeWorktrees 'Doctor changed registered worktrees.'
        Assert-Equal $afterConfig $beforeConfig 'Doctor changed local Git config.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'verification human plan output' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Verification -Fixture $fixture -ChangedPath @('scripts/codex/example.ps1')
        Assert-Equal $result.ExitCode 0 "Human verification plan failed. $($result.ErrorText)"
        Assert-True ($result.Text.Contains('Trainer verification plan')) 'Verification human heading missing.'
        Assert-True ($result.Text.Contains('Planning only. No verification command was executed.')) 'Planning-only guarantee missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'verification JSON contract and explicit paths' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Verification -Fixture $fixture -Json -ChangedPath @(
            'trainer-app/src/lib/validation.ts',
            'trainer-app/prisma/schema.prisma'
        )
        $plan = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 0 'Explicit-path verification plan failed.'
        Assert-Equal $plan.schema 'trainer-verification-plan' 'Verification schema mismatch.'
        Assert-Equal $plan.version 1 'Verification version mismatch.'
        Assert-True $plan.inspectionOnly 'Planning JSON must be inspection-only.'
        Assert-True (-not $plan.runRequested) 'Planning JSON runRequested must be false.'
        Assert-Equal @($plan.changedPaths).Count 2 'Repeatable changed paths were not retained.'
        Assert-True ($plan.implementation.id -contains 'verify-contracts') 'Contract check missing.'
        Assert-True ($plan.implementation.id -contains 'prisma-generate') 'Prisma check missing.'
        Assert-True ($plan.release.id -contains 'test-migration-integrity') 'Release migration check missing.'
        foreach ($property in @('matchedRules', 'implementation', 'release', 'skipped', 'warnings', 'blockers')) {
            Assert-True ($null -ne $plan.$property) "Stable plan array '$property' missing."
        }
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'multiple rules preserve reasons order and deterministic deduplication' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Verification -Fixture $fixture -Json -ChangedPath @(
            'trainer-app/docs/contracts/example.json',
            'trainer-app/src/lib/validation.ts'
        )
        $plan = $result.Text | ConvertFrom-Json
        $ids = @($plan.implementation.id)
        Assert-Equal $ids.Count (@($ids | Select-Object -Unique).Count) 'Verification commands were not deduplicated.'
        Assert-Equal $ids[0] 'git-diff-check' 'Policy command order was not preserved.'
        Assert-Equal $ids[1] 'verify-contracts' 'Policy command order was not preserved.'
        $contract = @($plan.implementation | Where-Object { $_.id -eq 'verify-contracts' })[0]
        Assert-Equal @($contract.reasons).Count 2 'All path selection reasons were not retained.'
        $docRules = @($plan.matchedRules | Where-Object { $_.path -eq 'trainer-app/docs/contracts/example.json' })
        Assert-Equal $docRules.Count 2 'All applicable path rules were not matched.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'Git diff includes tracked and untracked path provenance' {
    $fixture = New-TestRepository
    try {
        Set-Content -LiteralPath (Join-Path $fixture.Repository 'trainer-app\tracked change.txt') -Value 'tracked' -Encoding utf8NoBOM
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @('add', 'trainer-app/tracked change.txt') | Out-Null
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @('commit', '-m', 'tracked fixture') | Out-Null
        Set-Content -LiteralPath (Join-Path $fixture.Repository 'trainer-app\tracked change.txt') -Value 'unstaged' -Encoding utf8NoBOM
        Set-Content -LiteralPath (Join-Path $fixture.Repository 'trainer-app\staged file.txt') -Value 'staged' -Encoding utf8NoBOM
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @('add', 'trainer-app/staged file.txt') | Out-Null
        Set-Content -LiteralPath (Join-Path $fixture.Repository 'trainer-app\untracked file.txt') -Value 'untracked' -Encoding utf8NoBOM
        $result = Invoke-Verification -Fixture $fixture -BaseRef 'master~1' -Json
        $plan = $result.Text | ConvertFrom-Json
        $tracked = @($plan.changedPaths | Where-Object { $_.path -eq 'trainer-app/tracked change.txt' })[0]
        $staged = @($plan.changedPaths | Where-Object { $_.path -eq 'trainer-app/staged file.txt' })[0]
        $untracked = @($plan.changedPaths | Where-Object { $_.path -eq 'trainer-app/untracked file.txt' })[0]
        Assert-True ($tracked.sources -contains 'git-committed') 'Committed path provenance missing.'
        Assert-True ($tracked.sources -contains 'git-unstaged') 'Unstaged path provenance missing.'
        Assert-True ($staged.sources -contains 'git-staged') 'Staged path provenance missing.'
        Assert-True ($untracked.sources -contains 'git-untracked') 'Untracked path provenance missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'unmatched path uses conservative fallback' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Verification -Fixture $fixture -ChangedPath @('unknown/location.txt') -Json
        $plan = $result.Text | ConvertFrom-Json
        Assert-True ($plan.implementation.id -contains 'verify') 'Conservative fallback check missing.'
        Assert-True (@($plan.warnings).Count -gt 0) 'Fallback warning missing.'
        Assert-Equal @($plan.implementation[0].reasons).Count 1 'Fallback reason missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'valid Phase 1 manifest is consumed without contract drift' {
    $fixture = New-TestRepository
    try {
        $manifestResult = Invoke-Inspector -Fixture $fixture -Json -ChangedPath @('scripts/codex/example.ps1')
        $manifestPath = Join-Path $fixture.Sandbox 'task manifest.json'
        Set-Content -LiteralPath $manifestPath -Value $manifestResult.Text -Encoding utf8NoBOM
        $result = Invoke-Verification -Fixture $fixture -ManifestPath $manifestPath -Json
        $plan = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 0 "Valid manifest plan failed. $($result.ErrorText)"
        Assert-True $plan.comparison.manifestCombined 'Manifest source was not recorded.'
        Assert-True (@($plan.implementation.reasons | Where-Object { $_.type -eq 'task-classification' }).Count -gt 0) 'Task classification was not applied.'
        Assert-True (@($plan.implementation.reasons | Where-Object { $_.type -eq 'manifest-proposed-check' }).Count -gt 0) 'Manifest proposed checks were not retained.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'invalid manifest schema and invalid base exit 2' {
    $fixture = New-TestRepository
    try {
        $manifestPath = Join-Path $fixture.Sandbox 'invalid.json'
        Set-Content -LiteralPath $manifestPath -Value '{"schema":"wrong","version":2}' -Encoding utf8NoBOM
        $manifestResult = Invoke-Verification -Fixture $fixture -ManifestPath $manifestPath -Json
        Assert-Equal $manifestResult.ExitCode 2 'Invalid manifest must exit 2.'
        $baseResult = Invoke-Verification -Fixture $fixture -BaseRef 'missing-ref' -Json
        Assert-Equal $baseResult.ExitCode 2 'Invalid base ref must exit 2.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'empty Git diff returns a valid empty plan' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Verification -Fixture $fixture -BaseRef 'master' -Json
        $plan = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 0 'Empty diff plan failed.'
        Assert-Equal @($plan.changedPaths).Count 0 'Empty diff should contain no changed paths.'
        Assert-Equal @($plan.implementation).Count 0 'Empty diff should select no implementation checks.'
        Assert-Equal @($plan.release).Count 0 'Empty diff should select no release checks.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'spaces and Windows separators are normalized' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-Verification -Fixture $fixture -ChangedPath @(
            'trainer-app\src\lib\validation.ts',
            'folder with spaces\file name.txt'
        ) -Json
        $plan = $result.Text | ConvertFrom-Json
        Assert-True ($plan.changedPaths.path -contains 'trainer-app/src/lib/validation.ts') 'Windows separators were not normalized.'
        Assert-True ($plan.changedPaths.path -contains 'folder with spaces/file name.txt') 'Spaced path was not preserved.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'verification missing policy exits 3 and invalid option combination exits 2' {
    $fixture = New-TestRepository
    try {
        $invalid = Invoke-Verification -Fixture $fixture -ChangedPath @('example.txt') -ContinueOnFailure -Json
        Assert-Equal $invalid.ExitCode 2 '-ContinueOnFailure without -Run must exit 2.'
        Remove-Item -LiteralPath $fixture.Policy -Force
        $missing = Invoke-Verification -Fixture $fixture -ChangedPath @('example.txt') -Json
        Assert-Equal $missing.ExitCode 3 'Missing verification policy must exit 3.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'planning mode executes nothing and does not mutate repository' {
    $fixture = New-TestRepository
    try {
        $sentinel = Join-Path $fixture.Sandbox 'planning-executed.txt'
        $tool = Join-Path $fixture.Sandbox 'planning-tool.cmd'
        Set-Content -LiteralPath $tool -Value ('@echo executed>"{0}"' -f $sentinel) -Encoding ascii
        Set-FixtureVerificationCommand -Fixture $fixture -Id 'git-diff-check' -Executable $tool
        $beforeStatus = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('status', '--porcelain=v1', '--untracked-files=all')) -join "`n"
        $beforeRefs = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('show-ref')) -join "`n"
        $result = Invoke-Verification -Fixture $fixture -ChangedPath @('execute/example.txt') -Json
        $afterStatus = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('status', '--porcelain=v1', '--untracked-files=all')) -join "`n"
        $afterRefs = (Invoke-GitFixture -Repository $fixture.Repository -Arguments @('show-ref')) -join "`n"
        Assert-Equal $result.ExitCode 0 'Planning mode failed unexpectedly.'
        Assert-True (-not (Test-Path -LiteralPath $sentinel)) 'Planning mode executed a command.'
        Assert-Equal $afterStatus $beforeStatus 'Planning mode changed repository status.'
        Assert-Equal $afterRefs $beforeRefs 'Planning mode changed refs.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'Run executes only an approved local implementation command' {
    $fixture = New-TestRepository
    try {
        $sentinel = Join-Path $fixture.Sandbox 'approved-executed.txt'
        $tool = Join-Path $fixture.Sandbox 'approved-tool.cmd'
        Set-Content -LiteralPath $tool -Value ('@echo approved>"{0}"' -f $sentinel) -Encoding ascii
        Set-FixtureVerificationCommand -Fixture $fixture -Id 'git-diff-check' -Executable $tool
        $result = Invoke-Verification -Fixture $fixture -ChangedPath @('execute/example.txt') -Run -Json
        $plan = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 0 "Approved execution failed. stdout=$($result.Text) stderr=$($result.ErrorText)"
        Assert-True (Test-Path -LiteralPath $sentinel) 'Approved command did not execute.'
        Assert-Equal $plan.execution.results[0].status 'passed' 'Approved command result missing.'
        Assert-Equal $plan.execution.results[0].exitCode 0 'Approved command exit code mismatch.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'unsafe production-write and mutation-escalated commands are skipped' {
    $fixture = New-TestRepository
    try {
        $sentinel = Join-Path $fixture.Sandbox 'unsafe-executed.txt'
        $tool = Join-Path $fixture.Sandbox 'unsafe-tool.cmd'
        Set-Content -LiteralPath $tool -Value ('@echo unsafe>"{0}"' -f $sentinel) -Encoding ascii
        Set-FixtureVerificationCommand -Fixture $fixture -Id 'git-diff-check' -Executable $tool -Profile 'production-write'
        $production = Invoke-Verification -Fixture $fixture -ChangedPath @('execute/example.txt') -Run -Json
        $productionPlan = $production.Text | ConvertFrom-Json
        Assert-True (-not (Test-Path -LiteralPath $sentinel)) 'Production-write command executed.'
        Assert-True ($productionPlan.skipped[0].reason -match 'production-write') 'Production-write skip reason missing.'

        Set-FixtureVerificationCommand -Fixture $fixture -Id 'git-diff-check' -Executable $tool -FlagEscalations @(
            [pscustomobject]@{ flag = 'fixture-mutation'; sideEffectClass = 'production-write'; authorizationRequirement = 'fixture' }
        )
        $mutation = Invoke-Verification -Fixture $fixture -ChangedPath @('execute/example.txt') -Run -Json
        $mutationPlan = $mutation.Text | ConvertFrom-Json
        Assert-True (-not (Test-Path -LiteralPath $sentinel)) 'Mutation-escalated command executed.'
        Assert-True ($mutationPlan.skipped[0].reason -match 'mutation-escalation') 'Mutation-escalation skip reason missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'release command is always skipped' {
    $fixture = New-TestRepository
    try {
        $sentinel = Join-Path $fixture.Sandbox 'release-executed.txt'
        $tool = Join-Path $fixture.Sandbox 'release-tool.cmd'
        Set-Content -LiteralPath $tool -Value ('@echo release>"{0}"' -f $sentinel) -Encoding ascii
        Set-FixtureVerificationCommand -Fixture $fixture -Id 'git-diff-check' -Executable $tool
        $policy = Get-Content -Raw -LiteralPath $fixture.Policy | ConvertFrom-Json -Depth 100
        $policy.verification.pathRules[0].implementation = @()
        $policy.verification.pathRules[0].release = @('git-diff-check')
        $policy | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $fixture.Policy -Encoding utf8NoBOM
        $result = Invoke-Verification -Fixture $fixture -ChangedPath @('execute/example.txt') -Run -Json
        $plan = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 0 'A skipped release command should not fail execution.'
        Assert-True (-not (Test-Path -LiteralPath $sentinel)) 'Release command executed.'
        Assert-True ($plan.skipped[0].reason -match 'Release-only') 'Release skip reason missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'release-tier command miswired as implementation is skipped' {
    $fixture = New-TestRepository
    try {
        $sentinel = Join-Path $fixture.Sandbox 'release-tier-executed.txt'
        $tool = Join-Path $fixture.Sandbox 'release-tier-tool.cmd'
        Set-Content -LiteralPath $tool -Value ('@echo release-tier>"{0}"' -f $sentinel) -Encoding ascii
        Set-FixtureVerificationCommand -Fixture $fixture -Id 'git-diff-check' -Executable $tool
        $policy = Get-Content -Raw -LiteralPath $fixture.Policy | ConvertFrom-Json -Depth 100
        $policy.commands.'git-diff-check'.verificationTier = 'release'
        $policy | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $fixture.Policy -Encoding utf8NoBOM

        $result = Invoke-Verification -Fixture $fixture -ChangedPath @('execute/example.txt') -Run -Json
        $plan = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 0 'A release-tier implementation selection should be safely skipped.'
        Assert-True (-not (Test-Path -LiteralPath $sentinel)) 'Release-tier command executed from implementation selection.'
        Assert-True ($plan.skipped[0].reason -match 'release verification tier') 'Release-tier skip reason missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'missing prerequisite blocks execution but not planning' {
    $fixture = New-TestRepository
    try {
        $sentinel = Join-Path $fixture.Sandbox 'prerequisite-executed.txt'
        $tool = Join-Path $fixture.Sandbox 'prerequisite-tool.cmd'
        Set-Content -LiteralPath $tool -Value ('@echo executed>"{0}"' -f $sentinel) -Encoding ascii
        Set-FixtureVerificationCommand -Fixture $fixture -Id 'git-diff-check' -Executable $tool -Requirements @{ requiresNode = $true }
        $planning = Invoke-Verification -Fixture $fixture -ChangedPath @('execute/example.txt') -Json
        Assert-Equal $planning.ExitCode 0 'Missing prerequisites must not block planning.'
        $execution = Invoke-Verification -Fixture $fixture -ChangedPath @('execute/example.txt') -Run -Json
        $plan = $execution.Text | ConvertFrom-Json
        Assert-Equal $execution.ExitCode 1 'Missing prerequisite must block execution.'
        Assert-True (-not (Test-Path -LiteralPath $sentinel)) 'Prerequisite-blocked command executed.'
        Assert-True (@($plan.blockers | Where-Object { $_ -match 'Node.js' }).Count -gt 0) 'Prerequisite blocker missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'child exit propagates and execution stops on first failure' {
    $fixture = New-TestRepository
    try {
        $secondSentinel = Join-Path $fixture.Sandbox 'second-executed.txt'
        $firstTool = Join-Path $fixture.Sandbox 'first-fail.cmd'
        $secondTool = Join-Path $fixture.Sandbox 'second-pass.cmd'
        Set-Content -LiteralPath $firstTool -Value '@echo first failed&@exit /b 7' -Encoding ascii
        Set-Content -LiteralPath $secondTool -Value ('@echo second>"{0}"' -f $secondSentinel) -Encoding ascii
        Set-FixtureVerificationCommand -Fixture $fixture -Id 'git-diff-check' -Executable $firstTool
        $policy = Get-Content -Raw -LiteralPath $fixture.Policy | ConvertFrom-Json -Depth 100
        $second = $policy.commands.'test-fast'
        $second.executableInImplementationMode = $true
        $second.invocation.executable = $secondTool
        $second.invocation.arguments = @()
        $second.invocation.workingDirectory = 'repository'
        foreach ($property in @('requiresCleanWorktree', 'requiresDependencies', 'requiresDocker', 'requiresDatabase', 'requiresNetwork', 'requiresPrisma', 'requiresNode', 'requiresNpm', 'requiresPowerShell')) { $second.$property = $false }
        $entry = @($policy.commandRegistry | Where-Object { $_.id -eq 'test-fast' })[0]
        $entry.command = [string]$secondTool
        $entry.profile = 'read-only'
        $entry.flagEscalations = @()
        $policy.verification.pathRules[0].implementation = @('git-diff-check', 'test-fast')
        $policy | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $fixture.Policy -Encoding utf8NoBOM

        $result = Invoke-Verification -Fixture $fixture -ChangedPath @('execute/example.txt') -Run -Json
        $plan = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 1 "Failed child must fail guarded execution. stdout=$($result.Text) stderr=$($result.ErrorText)"
        Assert-Equal $plan.execution.results[0].exitCode 7 'Exact child exit code was not recorded.'
        Assert-Equal $plan.execution.results[1].status 'not-run-after-failure' 'Second command was not stopped.'
        Assert-True (-not (Test-Path -LiteralPath $secondSentinel)) 'Second command executed after failure.'

        $continued = Invoke-Verification -Fixture $fixture -ChangedPath @('execute/example.txt') -Run -ContinueOnFailure -Json
        $continuedPlan = $continued.Text | ConvertFrom-Json
        Assert-Equal $continued.ExitCode 1 'Continue-on-failure must retain failed exit status.'
        Assert-Equal $continuedPlan.execution.results[1].status 'passed' 'Continue-on-failure did not run the second command.'
        Assert-True (Test-Path -LiteralPath $secondSentinel) 'Continue-on-failure second command did not execute.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'Trainer skills route through Phase 1-3 without duplicating policy' {
    $repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $sourceRoot '..\..'))
    $skillsRoot = Join-Path $repositoryRoot '.codex\skills'
    $policy = Get-Content -Raw -LiteralPath $sourcePolicy | ConvertFrom-Json
    $skillFiles = @(Get-ChildItem -LiteralPath $skillsRoot -Recurse -Filter 'SKILL.md' -File)
    $skillTextByName = @{}
    foreach ($skillFile in $skillFiles) {
        $skillTextByName[$skillFile.Directory.Name] = Get-Content -Raw -LiteralPath $skillFile.FullName
    }
    $allSkillText = ($skillTextByName.Values -join "`n")

    foreach ($commandName in @(
            'Start-TrainerTask.ps1',
            'Invoke-TrainerDoctor.ps1',
            'Invoke-TrainerVerification.ps1'
        )) {
        Assert-True (Test-Path -LiteralPath (Join-Path $sourceRoot $commandName) -PathType Leaf) "Referenced Trainer command does not exist: $commandName"
    }

    $orchestrationReferencesBySkill = @{
        'trainer-loop-triage'         = @('Start-TrainerTask.ps1', 'Invoke-TrainerDoctor.ps1', 'Invoke-TrainerVerification.ps1')
        'implementation-planner'      = @('Start-TrainerTask.ps1', 'Invoke-TrainerDoctor.ps1', 'Invoke-TrainerVerification.ps1')
        'architecture-guard'          = @('Start-TrainerTask.ps1', 'Invoke-TrainerDoctor.ps1', 'Invoke-TrainerVerification.ps1')
        'test-impact-triage'          = @('Invoke-TrainerDoctor.ps1', 'Invoke-TrainerVerification.ps1')
        'audit-workflow'              = @('Start-TrainerTask.ps1', 'Invoke-TrainerDoctor.ps1', 'Invoke-TrainerVerification.ps1')
        'workout-generation-audit'    = @('Start-TrainerTask.ps1', 'Invoke-TrainerDoctor.ps1', 'Invoke-TrainerVerification.ps1')
        'receipt-integrity'           = @('Start-TrainerTask.ps1', 'Invoke-TrainerDoctor.ps1', 'Invoke-TrainerVerification.ps1')
        'seed-runtime-source-of-truth' = @('Start-TrainerTask.ps1', 'Invoke-TrainerDoctor.ps1', 'Invoke-TrainerVerification.ps1')
        'v2-planner-migration-guard'  = @('Start-TrainerTask.ps1', 'Invoke-TrainerDoctor.ps1', 'Invoke-TrainerVerification.ps1')
    }
    foreach ($skillName in $orchestrationReferencesBySkill.Keys) {
        foreach ($commandName in $orchestrationReferencesBySkill[$skillName]) {
            Assert-True ($skillTextByName[$skillName].Contains(".\scripts\codex\$commandName")) "$skillName does not reference the canonical command path: $commandName"
        }
    }

    $commandReferences = [regex]::Matches(
        $allSkillText,
        '(?i)\.\\scripts\\codex\\(?<name>[A-Za-z0-9.-]+\.ps1)'
    )
    foreach ($reference in $commandReferences) {
        $commandName = $reference.Groups['name'].Value
        Assert-True (Test-Path -LiteralPath (Join-Path $sourceRoot $commandName) -PathType Leaf) "Skill references a missing command: $commandName"
    }

    $triageText = $skillTextByName['trainer-loop-triage']
    foreach ($classification in @('audit', 'application-write', 'shared-seam-write', 'db-migration', 'release-incident')) {
        Assert-True ($null -ne $policy.classifications.PSObject.Properties[$classification]) "Policy classification is missing: $classification"
        Assert-True ($triageText.Contains("``$classification``")) "Trainer triage does not reference policy classification: $classification"
    }

    foreach ($staleName in @('Invoke-TrainerTask.ps1', 'Test-TrainerDoctor.ps1', 'Plan-TrainerVerification.ps1')) {
        Assert-True (-not $allSkillText.Contains($staleName)) "Skill contains stale Trainer command name: $staleName"
    }

    foreach ($requiredPhrase in @(
            'does not install',
            'Planning is the default',
            'Use `-Run` only',
            'Phase 1–3 do not orchestrate a release or incident response'
        )) {
        Assert-True ($allSkillText.Contains($requiredPhrase)) "Skill integration safety language is missing: $requiredPhrase"
    }

    foreach ($forbiddenPolicyCopy in @(
            'allowedPathRoots',
            'forbiddenPathRoots',
            'commandRegistry',
            'flagEscalations',
            'executableInImplementationMode'
        )) {
        Assert-True (-not $allSkillText.Contains($forbiddenPolicyCopy)) "Skills duplicate policy structure: $forbiddenPolicyCopy"
    }

    Assert-True (-not [regex]::IsMatch($allSkillText, '(?im)^\s*npx\s+')) 'Skills contain a stale npx execution assumption.'
    Assert-True (-not [regex]::IsMatch($allSkillText, '(?i)doctor.{0,40}\b(installs|repairs|authenticates|connects|migrates|deploys)\b')) 'A skill claims the doctor mutates or remediates the environment.'
    Assert-True (-not [regex]::IsMatch($allSkillText, '(?i)verification.{0,80}(runs|executes)\s+by\s+default')) 'A skill claims verification executes by default.'
    Assert-True (-not [regex]::IsMatch($allSkillText, '(?i)Phase\s+1.?3\s+(authorizes|performs|orchestrates)\b')) 'A skill claims Phase 1-3 authorizes or performs release/production work.'
    Assert-True (-not [regex]::IsMatch($allSkillText, '(?i)(task inspector|verification planner)\s+(authorizes|deploys|migrates|writes)\b')) 'A skill claims local tooling authorizes or performs a protected action.'

    $routeReferences = [regex]::Matches(
        $allSkillText,
        '(?im)\broute[^\r\n`]*\bto\s+`(?<name>[a-z][a-z0-9-]+)`'
    )
    foreach ($reference in $routeReferences) {
        $skillName = $reference.Groups['name'].Value
        Assert-True ($skillTextByName.ContainsKey($skillName)) "Skill routing references a missing skill: $skillName"
    }
}

Invoke-Test 'registry parses and covers committed command surfaces' {
    $result = Invoke-RegistryValidator
    $report = $result.Text | ConvertFrom-Json
    Assert-Equal $result.ExitCode 0 'Registry validator exit code mismatch.'
    Assert-True $report.success 'Registry validator should succeed.'
    Assert-Equal $report.packageScriptsRegistered $report.packageScripts 'Every package script must be registered.'
    Assert-Equal @($report.errors).Count 0 'Registry validator reported errors.'
    Assert-True ($report.commandsRegistered -ge $report.packageScripts) 'Registry command count is unexpectedly small.'
    Assert-Equal @($report.ignoredEntrypoints).Count 4 'Documented internal-entrypoint ignore count mismatch.'
}

Write-Output "Tests run: $script:TestsRun"
Write-Output "Tests failed: $script:TestsFailed"
if ($script:TestsFailed -gt 0) { exit 1 }
exit 0
