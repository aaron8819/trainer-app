[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:TestsRun = 0
$script:TestsFailed = 0
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceScript = Join-Path $sourceRoot 'Start-TrainerTask.ps1'
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
    Copy-Item -LiteralPath $sourcePolicy -Destination (Join-Path $repository 'scripts\codex\trainer-policy.v1.json')
    Set-Content -LiteralPath (Join-Path $repository 'trainer-app\package.json') -Value '{"name":"fixture"}' -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $repository 'trainer-app\package-lock.json') -Value '{"lockfileVersion":3}' -Encoding utf8NoBOM
    Invoke-GitFixture -Repository $repository -Arguments @('init', '-b', 'master') | Out-Null
    Invoke-GitFixture -Repository $repository -Arguments @('config', 'user.email', 'trainer-tests@example.invalid') | Out-Null
    Invoke-GitFixture -Repository $repository -Arguments @('config', 'user.name', 'Trainer Tests') | Out-Null
    Invoke-GitFixture -Repository $repository -Arguments @('add', '.') | Out-Null
    Invoke-GitFixture -Repository $repository -Arguments @('commit', '-m', 'fixture') | Out-Null

    [pscustomobject]@{
        Sandbox = $sandbox
        Repository = $repository
        Script = Join-Path $repository 'scripts\codex\Start-TrainerTask.ps1'
        Policy = Join-Path $repository 'scripts\codex\trainer-policy.v1.json'
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

Write-Output "Tests run: $script:TestsRun"
Write-Output "Tests failed: $script:TestsFailed"
if ($script:TestsFailed -gt 0) { exit 1 }
exit 0
