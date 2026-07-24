[CmdletBinding()]
param([string]$Filter)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:TestsRun = 0
$script:TestsFailed = 0
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceScript = Join-Path $sourceRoot 'Start-TrainerTask.ps1'
$sourceModule = Join-Path $sourceRoot 'Trainer.Tooling.psm1'
$sourceDoctor = Join-Path $sourceRoot 'Invoke-TrainerDoctor.ps1'
$sourceRemoteStatus = Join-Path $sourceRoot 'Invoke-TrainerRemoteStatus.ps1'
$sourceGitHubModule = Join-Path $sourceRoot 'Trainer.GitHubStatus.psm1'
$sourceVercelModule = Join-Path $sourceRoot 'Trainer.VercelStatus.psm1'
$sourceRemoteIdentity = Join-Path $sourceRoot 'trainer-remote.v1.json'
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
    param([switch]$PathWithSpaces)

    $sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("trainer-task-tests-" + [guid]::NewGuid().ToString('N'))
    $repository = Join-Path $sandbox $(if ($PathWithSpaces) { 'repo with spaces' } else { 'repo' })
    New-Item -ItemType Directory -Path (Join-Path $repository 'scripts\codex') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $repository 'trainer-app') -Force | Out-Null
    Copy-Item -LiteralPath $sourceScript -Destination (Join-Path $repository 'scripts\codex\Start-TrainerTask.ps1')
    Copy-Item -LiteralPath $sourceModule -Destination (Join-Path $repository 'scripts\codex\Trainer.Tooling.psm1')
    Copy-Item -LiteralPath $sourceDoctor -Destination (Join-Path $repository 'scripts\codex\Invoke-TrainerDoctor.ps1')
    Copy-Item -LiteralPath $sourceRemoteStatus -Destination (Join-Path $repository 'scripts\codex\Invoke-TrainerRemoteStatus.ps1')
    Copy-Item -LiteralPath $sourceGitHubModule -Destination (Join-Path $repository 'scripts\codex\Trainer.GitHubStatus.psm1')
    Copy-Item -LiteralPath $sourceVercelModule -Destination (Join-Path $repository 'scripts\codex\Trainer.VercelStatus.psm1')
    Copy-Item -LiteralPath $sourceRemoteIdentity -Destination (Join-Path $repository 'scripts\codex\trainer-remote.v1.json')
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
        RemoteStatus = Join-Path $repository 'scripts\codex\Invoke-TrainerRemoteStatus.ps1'
        RemoteIdentity = Join-Path $repository 'scripts\codex\trainer-remote.v1.json'
        Verification = Join-Path $repository 'scripts\codex\Invoke-TrainerVerification.ps1'
        Module = Join-Path $repository 'scripts\codex\Trainer.Tooling.psm1'
        Policy = $fixturePolicyPath
    }
}

function New-RemoteTestRepository {
    param([switch]$PathWithSpaces)

    $fixture = New-TestRepository -PathWithSpaces:$PathWithSpaces
    Invoke-GitFixture -Repository $fixture.Repository -Arguments @(
        'remote', 'add', 'origin', 'https://github.com/aaron8819/trainer-app.git'
    ) | Out-Null
    Invoke-GitFixture -Repository $fixture.Repository -Arguments @(
        'update-ref', 'refs/remotes/origin/master', 'HEAD'
    ) | Out-Null
    Invoke-GitFixture -Repository $fixture.Repository -Arguments @(
        'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master'
    ) | Out-Null
    $fixture
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

function Invoke-RemoteStatus {
    param(
        [Parameter(Mandatory = $true)][object]$Fixture,
        [switch]$Json,
        [switch]$GitHub,
        [switch]$Deployment,
        [string]$Branch,
        [string]$PathPrefix,
        [switch]$ReplacePath,
        [switch]$ClearVercelToken
    )

    $arguments = @('-NoProfile', '-File', $Fixture.RemoteStatus)
    if ($Json) { $arguments += '-Json' }
    if ($GitHub) { $arguments += '-GitHub' }
    if ($Deployment) { $arguments += '-Deployment' }
    if ($PSBoundParameters.ContainsKey('Branch')) { $arguments += @('-Branch', $Branch) }
    $previousPath = $env:PATH
    $previousVercelToken = [Environment]::GetEnvironmentVariable('VERCEL_TOKEN', [EnvironmentVariableTarget]::Process)
    try {
        if ($ClearVercelToken) { [Environment]::SetEnvironmentVariable('VERCEL_TOKEN', $null, [EnvironmentVariableTarget]::Process) }
        if ($PathPrefix) {
            $env:PATH = if ($ReplacePath) { $PathPrefix } else { $PathPrefix + [System.IO.Path]::PathSeparator + $env:PATH }
        }
        $output = @(& pwsh @arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $env:PATH = $previousPath
        [Environment]::SetEnvironmentVariable('VERCEL_TOKEN', $previousVercelToken, [EnvironmentVariableTarget]::Process)
    }
    [pscustomobject]@{
        ExitCode = $exitCode
        Text = $output -join "`n"
        Lines = $output
    }
}

function New-FakeGitHubCli {
    param(
        [Parameter(Mandatory = $true)][object]$Fixture,
        [Parameter(Mandatory = $true)][object]$Scenario
    )

    $directory = Join-Path $Fixture.Sandbox 'fake-gh'
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $scenarioPath = Join-Path $directory 'scenario.json'
    $logPath = Join-Path $directory 'calls.jsonl'
    $Scenario | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $scenarioPath -Encoding utf8NoBOM
    $scriptPath = Join-Path $directory 'gh.ps1'
    @'
$ErrorActionPreference = 'Continue'
$scenario = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'scenario.json') | ConvertFrom-Json -Depth 100
@($args) | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $PSScriptRoot 'calls.jsonl') -Encoding utf8NoBOM
function Invoke-FakeGitHub {
    if ($args.Count -ge 2 -and $args[0] -eq 'auth' -and $args[1] -eq 'status') {
        if ([int]$scenario.authExit -ne 0) { Write-Error 'not authenticated'; $script:FakeExitCode = [int]$scenario.authExit; return }
        Write-Output 'authenticated'
        $script:FakeExitCode = 0
        return
    }
    if ($args.Count -ge 2 -and $args[0] -eq 'api' -and $args[1] -eq 'graphql') {
        $cursor = 'first'
        foreach ($argument in $args) { if ($argument -like 'cursor=*') { $cursor = $argument.Substring(7) } }
        $key = "graphql:$cursor"
    }
    elseif ($args.Count -ge 4 -and $args[0] -eq 'api' -and $args[1] -eq '--method' -and $args[2] -eq 'GET') {
        $key = [string]$args[3]
    }
    else {
        Write-Error 'HTTP 405'
        $script:FakeExitCode = 9
        return
    }
    $property = $scenario.responses.PSObject.Properties[$key]
    if ($null -eq $property) { Write-Error 'HTTP 500 unmapped fixture call'; $script:FakeExitCode = 8; return }
    $response = $property.Value
    if ([int]$response.exitCode -ne 0) {
        Write-Error "HTTP $($response.httpStatus)"
        $script:FakeExitCode = [int]$response.exitCode
        return
    }
    $response.body | ConvertTo-Json -Depth 100 -Compress
    $script:FakeExitCode = 0
}
$script:FakeExitCode = 0
Invoke-FakeGitHub @args
$global:LASTEXITCODE = $script:FakeExitCode
'@ | Set-Content -LiteralPath $scriptPath -Encoding utf8NoBOM
    [pscustomobject]@{ Directory = $directory; LogPath = $logPath; ScenarioPath = $scenarioPath }
}

function Add-FakeVercelResponse {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Responses,
        [Parameter(Mandatory = $true)][string]$Key,
        [AllowNull()]$Body,
        [int]$HttpStatus = 200,
        [string]$ContentType = 'application/json',
        [AllowNull()][string]$JsonText,
        [string]$RedirectLocation,
        [switch]$TimedOut,
        [switch]$TransportError
    )
    $Responses[$Key] = [pscustomobject][ordered]@{
        statusCode = $HttpStatus
        contentType = $ContentType
        data = $Body
        jsonText = $JsonText
        redirectLocation = $RedirectLocation
        timedOut = [bool]$TimedOut
        transportError = [bool]$TransportError
    }
}

function Invoke-VercelProviderFixture {
    param(
        [Parameter(Mandatory = $true)][object]$Scenario,
        [AllowNull()][string]$Token = 'fixture-token-that-must-never-appear',
        [AllowNull()]$Expected,
        [AllowNull()]$GitHubLive,
        [AllowNull()][string]$LocalHead = '1111111111111111111111111111111111111111',
        [AllowNull()][string]$CachedDefaultSha = '1111111111111111111111111111111111111111'
    )
    $policy = Get-Content -Raw -LiteralPath $sourcePolicy | ConvertFrom-Json -Depth 100
    $identity = Get-Content -Raw -LiteralPath $sourceRemoteIdentity | ConvertFrom-Json -Depth 100
    if ($null -eq $Expected) { $Expected = $identity.vercel }
    $calls = [System.Collections.Generic.List[object]]::new()
    $responses = $Scenario.responses
    $expectedToken = $Token
    $requestInvoker = {
        param($Request, $Headers)
        if ($Headers.Authorization -cne "Bearer $expectedToken" -or $Headers.Accept -cne 'application/json') {
            throw 'Fake HTTP transport received invalid internal headers.'
        }
        $key = $Request.uri.PathAndQuery
        $calls.Add([pscustomobject][ordered]@{ endpointId = $Request.endpointId; method = $Request.method; pathAndQuery = $key })
        $response = $responses[$key]
        if ($null -eq $response) {
            return [pscustomobject]@{ statusCode = 500; contentType = 'application/json'; data = $null; timedOut = $false; transportError = $false }
        }
        $response
    }.GetNewClosure()
    $priorToken = [Environment]::GetEnvironmentVariable('VERCEL_TOKEN', [EnvironmentVariableTarget]::Process)
    try {
        [Environment]::SetEnvironmentVariable('VERCEL_TOKEN', $Token, [EnvironmentVariableTarget]::Process)
        Import-Module $sourceVercelModule -Force
        $result = Invoke-TrainerVercelStatus `
            -Expected $Expected `
            -LocalLinkage ([pscustomobject]@{ committedVercelJsonPresent = $false; committedProjectLinkPresent = $false; localProjectLinkFilenamePresent = $false }) `
            -EndpointRegistry @($policy.vercelReadOnly.endpointRegistry) `
            -LocalHead $LocalHead `
            -CachedDefaultSha $CachedDefaultSha `
            -GitHubLive $GitHubLive `
            -RequestInvoker $requestInvoker
        [pscustomobject][ordered]@{ Result = $result; Calls = [object[]]$calls.ToArray() }
    }
    finally {
        [Environment]::SetEnvironmentVariable('VERCEL_TOKEN', $priorToken, [EnvironmentVariableTarget]::Process)
    }
}

function New-VercelSuccessScenario {
    param(
        [string]$Account = 'aaron8819',
        [string]$TeamId = 'team_YPrwp64VBrZbh9mEcwGQV8D4',
        [string]$TeamSlug = 'aaron8819s-projects',
        [string]$ProjectId = 'prj_XtOD3yvnH76X62LEDKi2qKV7XFaj',
        [string]$ProjectName = 'trainer-app',
        [string]$Alias = 'trainer-app-indol.vercel.app',
        [string]$ActiveState = 'READY',
        [string]$ActiveSha = '1111111111111111111111111111111111111111',
        [switch]$NoPrevious
    )

    $activeId = 'dpl_activefixture'
    $previousId = 'dpl_previousfixture'
    $responses = @{}
    Add-FakeVercelResponse -Responses $responses -Key '/v2/user' -Body ([pscustomobject]@{ user = [pscustomobject]@{ username = $Account } })
    Add-FakeVercelResponse -Responses $responses -Key '/v2/teams?limit=100' -Body ([pscustomobject]@{
        teams = @([pscustomobject]@{ id = $TeamId; slug = $TeamSlug; name = 'Trainer Team' })
        pagination = [pscustomobject]@{ next = $null }
    })
    Add-FakeVercelResponse -Responses $responses -Key "/v2/teams/$TeamId" -Body ([pscustomobject]@{ id = $TeamId; slug = $TeamSlug; name = 'Trainer Team' })
    Add-FakeVercelResponse -Responses $responses -Key "/v9/projects/$ProjectId`?teamId=team_YPrwp64VBrZbh9mEcwGQV8D4" -Body ([pscustomobject]@{
        id = $ProjectId; name = $ProjectName; accountId = $TeamId
        link = [pscustomobject]@{ type = 'github'; repo = 'trainer-app' }
        targets = [pscustomobject]@{ production = [pscustomobject]@{ id = $activeId } }
    })
    Add-FakeVercelResponse -Responses $responses -Key "/v9/projects/$ProjectId/domains?limit=100&teamId=team_YPrwp64VBrZbh9mEcwGQV8D4" -Body ([pscustomobject]@{
        domains = @([pscustomobject]@{ name = $Alias; projectId = $ProjectId; verified = $true })
        pagination = [pscustomobject]@{ next = $null }
    })
    $active = [pscustomobject]@{
        id = $activeId; uid = $activeId; projectId = $ProjectId; name = $ProjectName; target = 'production'
        url = 'trainer-app-active-fixture.vercel.app'; readyState = $ActiveState
        createdAt = 1760000000000; ready = 1760000060000
        meta = [pscustomobject]@{ githubCommitSha = $ActiveSha; githubCommitRef = 'master'; githubRepo = 'trainer-app' }
        gitSource = [pscustomobject]@{ type = 'github'; sha = $ActiveSha }
        creator = [pscustomobject]@{ username = $Account }
    }
    Add-FakeVercelResponse -Responses $responses -Key "/v4/aliases/$Alias`?projectId=$ProjectId&teamId=team_YPrwp64VBrZbh9mEcwGQV8D4" -Body ([pscustomobject]@{
        alias = $Alias; projectId = $ProjectId; deploymentId = $activeId; deployment = [pscustomobject]@{ id = $activeId; url = $active.url }
    })
    Add-FakeVercelResponse -Responses $responses -Key "/v13/deployments/$activeId`?teamId=team_YPrwp64VBrZbh9mEcwGQV8D4" -Body $active
    $deploymentRows = @($active)
    if (-not $NoPrevious) {
        $deploymentRows += [pscustomobject]@{
            uid = $previousId; id = $previousId; state = 'READY'; target = 'production'; created = 1750000000000; ready = 1750000060000
            alias = @(); meta = [pscustomobject]@{ githubCommitSha = '2222222222222222222222222222222222222222'; githubCommitRef = 'master'; githubRepo = 'trainer-app' }
            gitSource = [pscustomobject]@{ type = 'github' }
        }
    }
    Add-FakeVercelResponse -Responses $responses -Key "/v7/deployments?projectId=$ProjectId&target=production&limit=100&teamId=team_YPrwp64VBrZbh9mEcwGQV8D4" -Body ([pscustomobject]@{
        deployments = $deploymentRows; pagination = [pscustomobject]@{ next = $null }
    })
    [pscustomobject][ordered]@{ responses = $responses; activeId = $activeId; previousId = $previousId; activeSha = $ActiveSha }
}

function Add-FakeGitHubResponse {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Responses,
        [Parameter(Mandatory = $true)][string]$Key,
        [AllowNull()]$Body,
        [int]$ExitCode = 0,
        [int]$HttpStatus = 200
    )
    $Responses[$Key] = [pscustomobject][ordered]@{ exitCode = $ExitCode; httpStatus = $HttpStatus; body = $Body }
}

function New-GitHubSuccessScenario {
    param(
        [Parameter(Mandatory = $true)][object]$Fixture,
        [string]$Account = 'aaron8819',
        [string]$ObservedOwner = 'aaron8819',
        [string]$ObservedRepository = 'trainer-app',
        [string]$DefaultBranch = 'master',
        [string]$TaskBranch = 'codex/remote-github-status',
        [bool]$TaskBranchExists = $false,
        [object[]]$PullRequests = @(),
        [object[]]$Workflows = @(),
        [object[]]$Statuses = @(),
        [object[]]$CheckRuns = @(),
        [object[]]$Deployments = @(),
        [AllowNull()]$Protection = $null,
        [object[]]$Rulesets = @()
    )

    $localHead = [string](Invoke-GitFixture -Repository $Fixture.Repository -Arguments @('rev-parse', 'HEAD'))
    $defaultSha = '1111111111111111111111111111111111111111'
    $taskSha = '2222222222222222222222222222222222222222'
    $responses = @{}
    Add-FakeGitHubResponse -Responses $responses -Key '/user' -Body ([pscustomobject]@{ login = $Account })
    Add-FakeGitHubResponse -Responses $responses -Key '/repos/aaron8819/trainer-app' -Body ([pscustomobject]@{
        id = 12345; node_id = 'R_fixture'; name = $ObservedRepository; full_name = "$ObservedOwner/$ObservedRepository"
        owner = [pscustomobject]@{ login = $ObservedOwner }; visibility = 'private'; private = $true; default_branch = $DefaultBranch
    })
    Add-FakeGitHubResponse -Responses $responses -Key '/repos/aaron8819/trainer-app/branches/master' -Body ([pscustomobject]@{ commit = [pscustomobject]@{ sha = $defaultSha } })
    Add-FakeGitHubResponse -Responses $responses -Key "/repos/aaron8819/trainer-app/compare/$localHead...$defaultSha" -Body ([pscustomobject]@{ status = 'ahead'; ahead_by = 1; behind_by = 0 })
    $branchKey = '/repos/aaron8819/trainer-app/branches/' + [uri]::EscapeDataString($TaskBranch)
    if ($TaskBranchExists) {
        Add-FakeGitHubResponse -Responses $responses -Key $branchKey -Body ([pscustomobject]@{ commit = [pscustomobject]@{ sha = $taskSha } })
        Add-FakeGitHubResponse -Responses $responses -Key "/repos/aaron8819/trainer-app/compare/$defaultSha...$taskSha" -Body ([pscustomobject]@{ status = 'ahead'; ahead_by = 2; behind_by = 0 })
    }
    else {
        Add-FakeGitHubResponse -Responses $responses -Key $branchKey -Body $null -ExitCode 1 -HttpStatus 404
    }
    $head = [uri]::EscapeDataString("aaron8819:$TaskBranch")
    Add-FakeGitHubResponse -Responses $responses -Key "/repos/aaron8819/trainer-app/pulls?state=all&head=$head&per_page=100&page=1" -Body @($PullRequests)
    Add-FakeGitHubResponse -Responses $responses -Key '/repos/aaron8819/trainer-app/actions/workflows?per_page=100&page=1' -Body ([pscustomobject]@{ workflows = @($Workflows) })
    Add-FakeGitHubResponse -Responses $responses -Key "/repos/aaron8819/trainer-app/commits/$defaultSha/statuses?per_page=100&page=1" -Body @($Statuses)
    Add-FakeGitHubResponse -Responses $responses -Key "/repos/aaron8819/trainer-app/commits/$defaultSha/check-runs?per_page=100&page=1" -Body ([pscustomobject]@{ total_count = $CheckRuns.Count; check_runs = @($CheckRuns) })
    if ($null -eq $Protection) {
        Add-FakeGitHubResponse -Responses $responses -Key '/repos/aaron8819/trainer-app/branches/master/protection' -Body $null -ExitCode 1 -HttpStatus 404
    }
    else {
        Add-FakeGitHubResponse -Responses $responses -Key '/repos/aaron8819/trainer-app/branches/master/protection' -Body $Protection
    }
    Add-FakeGitHubResponse -Responses $responses -Key '/repos/aaron8819/trainer-app/rulesets?includes_parents=true&targets=branch&per_page=100&page=1' -Body @($Rulesets)
    Add-FakeGitHubResponse -Responses $responses -Key "/repos/aaron8819/trainer-app/deployments?sha=$defaultSha&per_page=100&page=1" -Body @($Deployments)
    foreach ($deployment in @($Deployments)) {
        Add-FakeGitHubResponse -Responses $responses -Key "/repos/aaron8819/trainer-app/deployments/$($deployment.id)/statuses?per_page=100&page=1" -Body @([pscustomobject]@{ state = 'success' })
    }
    [pscustomobject][ordered]@{ authExit = 0; responses = $responses; localHead = $localHead; defaultSha = $defaultSha; taskSha = $taskSha }
}

function Write-FixtureRemoteIdentity {
    param(
        [Parameter(Mandatory = $true)][object]$Fixture,
        [Parameter(Mandatory = $true)][object]$Identity
    )

    $Identity | ConvertTo-Json -Depth 20 |
        Set-Content -LiteralPath $Fixture.RemoteIdentity -Encoding utf8NoBOM
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

    if (-not [string]::IsNullOrWhiteSpace($Filter) -and $Name -notlike $Filter) { return }
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

Invoke-Test 'remote identity JSON parses and default offline status matches HTTPS origin' {
    $fixture = New-RemoteTestRepository
    try {
        $identity = Get-Content -Raw -LiteralPath $fixture.RemoteIdentity | ConvertFrom-Json -Depth 100
        Assert-Equal $identity.schema 'trainer-remote-identity' 'Identity schema mismatch.'
        Assert-Equal $identity.version 1 'Identity version mismatch.'
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json -Depth 100
        Assert-Equal $result.ExitCode 0 'Default remote status should succeed.'
        Assert-Equal $report.schema 'trainer-remote-status' 'Remote status schema mismatch.'
        Assert-True $report.inspectionOnly 'Remote status must be inspection-only.'
        Assert-True $report.success 'Default offline fixture should succeed.'
        Assert-Equal $report.providers.github.status 'match' 'HTTPS GitHub origin should match.'
        Assert-Equal $report.identity.foundationStatus 'partially configured' 'Incomplete provider identity classification changed.'
        Assert-Equal $report.identity.configuration.github 'configured' 'Configured GitHub identity status changed.'
        Assert-True $report.identity.productionDefinition.intendedEnvironment 'Intended production environment should be defined.'
        Assert-True $report.identity.productionDefinition.intendedVercelProject 'Configured Vercel project was not treated as defined.'
        Assert-True (-not $report.identity.productionDefinition.intendedSupabaseProject) 'Unknown Supabase project was treated as defined.'
        Assert-Equal @($report.blockers).Count 0 'Default blockers must remain an empty array.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'remote status human output is explicit and offline only' {
    $fixture = New-RemoteTestRepository
    try {
        $result = Invoke-RemoteStatus -Fixture $fixture
        Assert-Equal $result.ExitCode 0 'Human remote status should succeed.'
        Assert-True ($result.Text.Contains('Trainer offline remote status')) 'Human heading missing.'
        Assert-True ($result.Text.Contains('GitHub local comparison: match')) 'Human Git comparison missing.'
        Assert-True ($result.Text.Contains('does not authenticate, contact providers, inspect deployments, connect to databases, or prove production state')) 'Offline-only disclaimer missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'remote JSON retains no-access and no-live-state claims' {
    $fixture = New-RemoteTestRepository
    try {
        $report = (Invoke-RemoteStatus -Fixture $fixture -Json).Text | ConvertFrom-Json -Depth 100
        Assert-True (-not $report.networkAccessed) 'Remote status claimed network access.'
        Assert-True (-not $report.databaseAccessed) 'Remote status claimed database access.'
        Assert-Equal $report.providers.github.liveState 'not-checked' 'GitHub live state claim changed.'
        Assert-Equal $report.providers.deployment.liveState 'not-checked' 'Deployment live state claim changed.'
        Assert-Equal $report.providers.database.liveState 'not-checked' 'Database live state claim changed.'
        Assert-True (-not $report.traceability.endToEndProductionVerified) 'Offline traceability claimed production verification.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'GitHub SSH remote matches without network access' {
    $fixture = New-RemoteTestRepository
    try {
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @(
            'remote', 'set-url', 'origin', 'git@github.com:aaron8819/trainer-app.git'
        ) | Out-Null
        $report = (Invoke-RemoteStatus -Fixture $fixture -Json).Text | ConvertFrom-Json -Depth 100
        Assert-Equal $report.providers.github.status 'match' 'SSH GitHub origin should match.'
        Assert-Equal $report.localEvidence.git.observed.transport 'ssh-scp' 'SSH transport classification mismatch.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'GitHub owner mismatch is a blocker' {
    $fixture = New-RemoteTestRepository
    try {
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @(
            'remote', 'set-url', 'origin', 'https://github.com/not-aaron/trainer-app.git'
        ) | Out-Null
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json -Depth 100
        Assert-Equal $result.ExitCode 1 'Owner mismatch must exit 1.'
        Assert-Equal $report.providers.github.ownerComparison 'mismatch' 'Owner mismatch classification missing.'
        Assert-True (@($report.blockers).Count -gt 0) 'Owner mismatch blocker missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'GitHub repository mismatch is a blocker' {
    $fixture = New-RemoteTestRepository
    try {
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @(
            'remote', 'set-url', 'origin', 'https://github.com/aaron8819/not-trainer.git'
        ) | Out-Null
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json -Depth 100
        Assert-Equal $result.ExitCode 1 'Repository mismatch must exit 1.'
        Assert-Equal $report.providers.github.repositoryComparison 'mismatch' 'Repository mismatch classification missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'cached default branch mismatch is a blocker' {
    $fixture = New-RemoteTestRepository
    try {
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @(
            'update-ref', 'refs/remotes/origin/develop', 'HEAD'
        ) | Out-Null
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @(
            'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop'
        ) | Out-Null
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json -Depth 100
        Assert-Equal $result.ExitCode 1 'Default-branch mismatch must exit 1.'
        Assert-Equal $report.providers.github.defaultBranchComparison 'mismatch' 'Branch mismatch classification missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'missing origin is reported without guessing' {
    $fixture = New-TestRepository
    try {
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json -Depth 100
        Assert-Equal $result.ExitCode 1 'Missing expected origin must exit 1.'
        Assert-Equal $report.providers.github.status 'missing' 'Missing origin classification mismatch.'
        Assert-True (-not $report.localEvidence.git.originPresent) 'Missing origin was reported present.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'unknown GitHub identity is not treated as match' {
    $fixture = New-RemoteTestRepository
    try {
        $identity = Get-Content -Raw -LiteralPath $fixture.RemoteIdentity | ConvertFrom-Json -Depth 100
        $identity.github.owner = $null
        $identity.github.repository = $null
        $identity.github.defaultBranch = $null
        Write-FixtureRemoteIdentity -Fixture $fixture -Identity $identity
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json -Depth 100
        Assert-Equal $result.ExitCode 0 'Intentionally unknown GitHub identity should warn, not fail.'
        Assert-Equal $report.providers.github.status 'unknown' 'Unknown GitHub identity was not preserved.'
        Assert-True (@($report.warnings | Where-Object { $_ -match 'GitHub expected identity' }).Count -eq 1) 'Unknown GitHub warning missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'unknown Vercel and Supabase identities remain explicit gaps' {
    $fixture = New-RemoteTestRepository
    try {
        $identity = Get-Content -Raw -LiteralPath $fixture.RemoteIdentity | ConvertFrom-Json -Depth 100
        foreach ($name in @('teamId', 'teamSlug', 'projectId', 'projectName', 'productionAlias')) { $identity.vercel.$name = $null }
        Write-FixtureRemoteIdentity -Fixture $fixture -Identity $identity
        $report = (Invoke-RemoteStatus -Fixture $fixture -Json).Text | ConvertFrom-Json -Depth 100
        Assert-Equal $report.providers.deployment.expectedIdentityStatus 'unknown' 'Unknown Vercel status changed.'
        Assert-Equal $report.providers.database.expectedIdentityStatus 'unknown' 'Unknown Supabase status changed.'
        Assert-True ($report.identity.requiredOperatorValues -contains 'vercel.teamId') 'Vercel team ID gap missing.'
        Assert-True ($report.identity.requiredOperatorValues -contains 'supabase.projectRef') 'Supabase project ref gap missing.'
        Assert-Equal $report.identity.foundationStatus 'partially configured' 'Incomplete contract status mismatch.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'unsafe secret-like identity value is rejected' {
    $fixture = New-RemoteTestRepository
    try {
        $identity = Get-Content -Raw -LiteralPath $fixture.RemoteIdentity | ConvertFrom-Json -Depth 100
        $identity.vercel.teamId = 'https://example.invalid/?token=do-not-report'
        Write-FixtureRemoteIdentity -Fixture $fixture -Identity $identity
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json -Depth 100
        Assert-Equal $result.ExitCode 1 'Unsafe identity value must exit 1.'
        Assert-True (@($report.blockers | Where-Object { $_ -match 'Unsafe' }).Count -gt 0) 'Unsafe identity blocker missing.'
        Assert-True (-not $result.Text.Contains('do-not-report')) 'Unsafe identity value leaked into output.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'credential-bearing Git remote is blocked and redacted' {
    $fixture = New-RemoteTestRepository
    try {
        Invoke-GitFixture -Repository $fixture.Repository -Arguments @(
            'remote', 'set-url', 'origin', 'https://remote-secret@github.com/aaron8819/trainer-app.git'
        ) | Out-Null
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json -Depth 100
        Assert-Equal $result.ExitCode 1 'Credential-bearing origin must exit 1.'
        Assert-True $report.localEvidence.git.originCredentialBearing 'Credential-bearing classification missing.'
        Assert-True (-not $result.Text.Contains('remote-secret')) 'Credential-bearing remote leaked into output.'
        Assert-True (-not $report.localEvidence.git.rawRemoteReported) 'Raw remote reporting must stay false.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'missing identity file exits 3' {
    $fixture = New-RemoteTestRepository
    try {
        Remove-Item -LiteralPath $fixture.RemoteIdentity -Force
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json -Depth 100
        Assert-Equal $result.ExitCode 3 'Missing identity must exit 3.'
        Assert-Equal $report.schema 'trainer-remote-status-error' 'Missing identity error schema mismatch.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'invalid identity schema and version exit 3' {
    foreach ($mutation in @('schema', 'version')) {
        $fixture = New-RemoteTestRepository
        try {
            $identity = Get-Content -Raw -LiteralPath $fixture.RemoteIdentity | ConvertFrom-Json -Depth 100
            if ($mutation -eq 'schema') { $identity.schema = 'wrong-schema' } else { $identity.version = 99 }
            Write-FixtureRemoteIdentity -Fixture $fixture -Identity $identity
            $result = Invoke-RemoteStatus -Fixture $fixture -Json
            Assert-Equal $result.ExitCode 3 "Invalid $mutation must exit 3."
            Assert-Equal (($result.Text | ConvertFrom-Json).schema) 'trainer-remote-status-error' "Invalid $mutation error schema mismatch."
        }
        finally { Remove-TestRepository -Fixture $fixture }
    }
}

Invoke-Test 'empty connection-class arrays serialize as arrays' {
    $fixture = New-RemoteTestRepository
    try {
        $identity = Get-Content -Raw -LiteralPath $fixture.RemoteIdentity | ConvertFrom-Json -Depth 100
        $identity.supabase.allowedConnectionClasses = @()
        $identity.supabase.forbiddenConnectionClasses = @()
        Write-FixtureRemoteIdentity -Fixture $fixture -Identity $identity
        $report = (Invoke-RemoteStatus -Fixture $fixture -Json).Text | ConvertFrom-Json -Depth 100
        Assert-Equal @($report.identity.expected.supabase.allowedConnectionClasses).Count 0 'Allowed empty array changed shape.'
        Assert-Equal @($report.identity.expected.supabase.forbiddenConnectionClasses).Count 0 'Forbidden empty array changed shape.'
        Assert-Equal @($report.blockers).Count 0 'Empty arrays created a blocker.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'contradictory connection classes are blocked' {
    $fixture = New-RemoteTestRepository
    try {
        $identity = Get-Content -Raw -LiteralPath $fixture.RemoteIdentity | ConvertFrom-Json -Depth 100
        $identity.supabase.forbiddenConnectionClasses = @('direct')
        Write-FixtureRemoteIdentity -Fixture $fixture -Identity $identity
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        Assert-Equal $result.ExitCode 1 'Contradictory classes must exit 1.'
        Assert-True (@(($result.Text | ConvertFrom-Json).blockers | Where-Object { $_ -match 'both allowed and forbidden' }).Count -eq 1) 'Connection contradiction blocker missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'remote status supports repository paths containing spaces' {
    $fixture = New-RemoteTestRepository -PathWithSpaces
    try {
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        Assert-Equal $result.ExitCode 0 'Spaced repository path failed.'
        Assert-Equal (($result.Text | ConvertFrom-Json).providers.github.status) 'match' 'Spaced-path Git comparison mismatch.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'ignored Vercel linkage presence is reported without reading values' {
    $fixture = New-RemoteTestRepository
    try {
        $linkDirectory = Join-Path $fixture.Repository 'trainer-app\.vercel'
        New-Item -ItemType Directory -Path $linkDirectory -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $linkDirectory 'project.json') -Value '{"secret":"ignored-link-secret"}' -Encoding utf8NoBOM
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        $report = $result.Text | ConvertFrom-Json -Depth 100
        Assert-True $report.localEvidence.vercel.localProjectLinkFilenamePresent 'Ignored linkage filename presence missing.'
        Assert-True (-not $report.localEvidence.vercel.localProjectLinkValuesInspected) 'Ignored linkage values were claimed as inspected.'
        Assert-True (-not $result.Text.Contains('ignored-link-secret')) 'Ignored linkage value leaked into output.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'remote status never invokes provider HTTP or database tools' {
    $fixture = New-RemoteTestRepository
    try {
        $bin = Join-Path $fixture.Sandbox 'guarded tools'
        New-Item -ItemType Directory -Path $bin -Force | Out-Null
        $sentinel = Join-Path $fixture.Sandbox 'forbidden-tool-called.txt'
        foreach ($name in @('gh.cmd', 'vercel.cmd', 'supabase.cmd', 'psql.cmd', 'curl.cmd')) {
            Set-Content -LiteralPath (Join-Path $bin $name) -Value ('@echo called>>"{0}"' -f $sentinel) -Encoding ascii
        }
        $result = Invoke-RemoteStatus -Fixture $fixture -Json -PathPrefix $bin
        Assert-Equal $result.ExitCode 0 'Guarded offline status failed.'
        Assert-True (-not (Test-Path -LiteralPath $sentinel)) 'Remote status invoked a forbidden provider, HTTP, or database tool.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'remote status source does not read environment values or invoke network APIs' {
    $source = Get-Content -Raw -LiteralPath $sourceRemoteStatus
    $githubSource = Get-Content -Raw -LiteralPath $sourceGitHubModule
    Assert-True (-not [regex]::IsMatch($source, '(?i)\$env:|GetEnvironmentVariable|Get-ChildItem\s+Env:')) 'Remote status reads environment values.'
    Assert-True (-not [regex]::IsMatch($githubSource, '(?i)\$env:|GetEnvironmentVariable|Get-ChildItem\s+Env:')) 'GitHub provider reads environment values.'
    Assert-True (-not [regex]::IsMatch($source, '(?i)Invoke-WebRequest|Invoke-RestMethod|HttpClient|WebClient')) 'Remote status contains an HTTP API invocation.'
    Assert-True (-not [regex]::IsMatch($githubSource, '(?i)Invoke-WebRequest|Invoke-RestMethod|HttpClient|WebClient')) 'GitHub provider bypasses the registered gh boundary.'
    Assert-True (-not [regex]::IsMatch($source, '(?im)^\s*(?:&\s*)?(?:gh|vercel|supabase|psql|curl)(?:\.exe|\.cmd)?(?:[ \t]+(?![ \t]*=)|$)')) 'Remote status contains a provider, HTTP, or database executable invocation.'
    Assert-True (-not [regex]::IsMatch($source + $githubSource, "(?i)'(?:fetch|pull|push|merge|checkout|switch)'")) 'Remote status contains a forbidden Git mutation argument.'
}

Invoke-Test 'incomplete or unsafe GitHub expected identity blocks before provider access' {
    foreach ($case in @(
            [pscustomobject]@{ field = 'owner'; value = $null; label = 'missing owner'; blocker = 'github.owner' },
            [pscustomobject]@{ field = 'repository'; value = $null; label = 'missing repository'; blocker = 'github.repository' },
            [pscustomobject]@{ field = 'defaultBranch'; value = $null; label = 'missing default branch'; blocker = 'github.defaultBranch' },
            [pscustomobject]@{ field = 'owner'; value = 'https://example.invalid/?token=do-not-report'; label = 'unsafe owner'; blocker = 'Unsafe' }
        )) {
        $fixture = New-RemoteTestRepository
        try {
            $identity = Get-Content -Raw -LiteralPath $fixture.RemoteIdentity | ConvertFrom-Json -Depth 100
            $identity.github.PSObject.Properties[$case.field].Value = $case.value
            Write-FixtureRemoteIdentity -Fixture $fixture -Identity $identity
            $fake = New-FakeGitHubCli -Fixture $fixture -Scenario ([pscustomobject]@{ authExit = 0; responses = @{} })

            $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -PathPrefix $fake.Directory
            $report = $result.Text | ConvertFrom-Json -Depth 100
            Assert-Equal $result.ExitCode 1 "$($case.label) must return a valid blocked report."
            Assert-Equal $report.schema 'trainer-remote-status' "$($case.label) report schema mismatch."
            Assert-Equal $report.version 1 "$($case.label) report version mismatch."
            Assert-True $report.inspectionOnly "$($case.label) report must remain inspection-only."
            Assert-True (-not $report.networkAccessed) "$($case.label) must stop before network access."
            Assert-True (-not $report.databaseAccessed) "$($case.label) must remain database-free."
            Assert-Equal $report.providers.github.liveState 'blocked' "$($case.label) provider state mismatch."
            Assert-Equal $report.providers.github.live $null "$($case.label) must not report authentication or repository state."
            Assert-True (@($report.blockers | Where-Object { $_ -match [regex]::Escape($case.blocker) }).Count -eq 1) "$($case.label) blocker missing."
            Assert-True (-not $result.Text.Contains('do-not-report')) "$($case.label) leaked an unsafe identity value."

            if ($case.field -eq 'owner') {
                $human = Invoke-RemoteStatus -Fixture $fixture -GitHub -PathPrefix $fake.Directory
                Assert-Equal $human.ExitCode 1 'Incomplete GitHub identity human report must exit 1.'
                Assert-True $human.Text.Contains('Trainer GitHub remote status (blocked before provider access)') 'Pre-provider human heading missing.'
                Assert-True $human.Text.Contains('No GitHub tool discovery, authentication, or network request was attempted.') 'Pre-provider human guarantee missing.'
            }

            $callCount = if (Test-Path -LiteralPath $fake.LogPath) { @(Get-Content -LiteralPath $fake.LogPath).Count } else { 0 }
            Assert-Equal $callCount 0 "$($case.label) invoked fake gh."
        }
        finally { Remove-TestRepository -Fixture $fixture }
    }
}

Invoke-Test 'GitHub scope requires an available gh executable' {
    $fixture = New-RemoteTestRepository
    try {
        $pathParts = @(
            Split-Path -Parent (Get-Command pwsh -CommandType Application).Source
            Split-Path -Parent (Get-Command git -CommandType Application).Source
            "$env:SystemRoot\System32"
        ) | Select-Object -Unique
        $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix ($pathParts -join [System.IO.Path]::PathSeparator) -ReplacePath
        $report = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 1 'Missing gh must return a valid blocked report.'
        Assert-Equal $report.providers.github.live.authentication.status 'tool-missing' 'Missing gh category mismatch.'
        Assert-True $report.networkAccessed 'Explicit GitHub scope must report networkAccessed even when capability is blocked.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'GitHub authentication failure is blocked without remediation' {
    $fixture = New-RemoteTestRepository
    try {
        $fake = New-FakeGitHubCli -Fixture $fixture -Scenario ([pscustomobject]@{ authExit = 1; responses = @{} })
        $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
        $report = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 1 "Unauthenticated GitHub status must be blocked. Output: $($result.Text)"
        Assert-Equal $report.providers.github.live.authentication.status 'not-authenticated' 'Authentication category mismatch.'
        Assert-Equal @($report.providers.github.live.evidence).Count 1 'Authentication failure must stop before repository reads.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'GitHub identity match returns live repository branch checks and deployment absence' {
    $fixture = New-RemoteTestRepository
    try {
        $scenario = New-GitHubSuccessScenario -Fixture $fixture
        $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
        $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
        $report = $result.Text | ConvertFrom-Json
        $callLog = if (Test-Path -LiteralPath $fake.LogPath) { Get-Content -Raw -LiteralPath $fake.LogPath } else { 'no calls' }
        Assert-Equal $result.ExitCode 0 "Valid GitHub read should succeed. Output: $($result.Text) Calls: $callLog"
        $github = $report.providers.github.live
        Assert-Equal $github.authentication.status 'authenticated' 'Authenticated category mismatch.'
        Assert-True $github.identity.match 'Expected and observed identity should match.'
        Assert-Equal $github.repository.id 12345 'Immutable repository ID missing.'
        Assert-Equal $github.branch.defaultBranch.sha $scenario.defaultSha 'Default-branch SHA mismatch.'
        Assert-True $github.branch.local.containedInDefaultBranch 'Local containment should be true.'
        Assert-Equal $github.branch.remote.exists $false 'Absent task branch mismatch.'
        Assert-Equal $github.pullRequest.status 'absent' 'Absent PR mismatch.'
        Assert-Equal $github.checks.statusRollup 'no-checks-configured' 'No-workflow check status mismatch.'
        Assert-Equal $github.deployments.recordsPresent $false 'Deployment absence mismatch.'
        Assert-True (-not $github.deployments.provesActiveVercelProduction) 'GitHub deployments must not imply Vercel production.'
        Assert-True $report.inspectionOnly 'GitHub report must remain inspection-only.'
        Assert-True $report.networkAccessed 'GitHub report must record network access.'
        Assert-True (-not $report.databaseAccessed) 'GitHub report must remain database-free.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'unpushed local commit containment 404 is non-blocking and explicit' {
    $fixture = New-RemoteTestRepository
    try {
        $scenario = New-GitHubSuccessScenario -Fixture $fixture
        Add-FakeGitHubResponse -Responses $scenario.responses -Key "/repos/aaron8819/trainer-app/compare/$($scenario.localHead)...$($scenario.defaultSha)" -Body $null -ExitCode 1 -HttpStatus 404
        $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
        $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
        $report = $result.Text | ConvertFrom-Json -Depth 100
        $github = $report.providers.github.live

        Assert-Equal $result.ExitCode 0 "Unpushed containment 404 must remain a valid successful status read. Output: $($result.Text)"
        Assert-True $github.identity.match 'Containment 404 must not change repository identity matching.'
        Assert-Equal $github.branch.local.containmentStatus 'not-remotely-addressable' 'Containment 404 classification mismatch.'
        Assert-Equal $github.branch.local.containedInDefaultBranch $null 'Containment must remain unknown for an unpushed commit.'
        Assert-True (@($github.warnings | Where-Object { $_ -match 'unpushed candidate' }).Count -eq 1) 'Unpushed-candidate warning missing.'
        Assert-Equal @($github.blockers | Where-Object { $_ -match 'Containment' }).Count 0 'Containment 404 was incorrectly treated as a blocker.'
        Assert-Equal @($github.evidence | Where-Object { $_.operation -eq 'Actions workflows page 1' }).Count 1 'Broader collection did not continue after containment 404.'
        Assert-Equal @($github.evidence | Where-Object { $_.operation -eq 'GitHub deployments page 1' }).Count 1 'Deployment evidence was not collected after containment 404.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'wrong authenticated GitHub account fails before repository lookup' {
    $fixture = New-RemoteTestRepository
    try {
        $scenario = New-GitHubSuccessScenario -Fixture $fixture -Account 'someone-else'
        $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
        $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
        $report = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 1 'Wrong account must be blocked.'
        Assert-Equal $report.providers.github.live.authentication.status 'wrong-account' 'Wrong-account category mismatch.'
        Assert-Equal @($report.providers.github.live.evidence).Count 2 'Wrong account must stop before repository identity lookup.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'observed GitHub owner repository and default branch mismatches fail closed' {
    foreach ($case in @(
            [pscustomobject]@{ owner = 'other-owner'; repository = 'trainer-app'; branch = 'master'; label = 'owner' },
            [pscustomobject]@{ owner = 'aaron8819'; repository = 'other-repo'; branch = 'master'; label = 'repository' },
            [pscustomobject]@{ owner = 'aaron8819'; repository = 'trainer-app'; branch = 'main'; label = 'default branch' }
        )) {
        $fixture = New-RemoteTestRepository
        try {
            $scenario = New-GitHubSuccessScenario -Fixture $fixture -ObservedOwner $case.owner -ObservedRepository $case.repository -DefaultBranch $case.branch
            $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
            $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
            $report = $result.Text | ConvertFrom-Json
            Assert-Equal $result.ExitCode 1 "$($case.label) mismatch must be blocked."
            Assert-True (-not $report.providers.github.live.identity.match) "$($case.label) mismatch must not be reported as a match."
            Assert-Equal @($report.providers.github.live.evidence).Count 3 "$($case.label) mismatch must stop after repository identity."
        }
        finally { Remove-TestRepository -Fixture $fixture }
    }
}

Invoke-Test 'inaccessible expected repository is an insufficient-access blocker' {
    $fixture = New-RemoteTestRepository
    try {
        $scenario = New-GitHubSuccessScenario -Fixture $fixture
        Add-FakeGitHubResponse -Responses $scenario.responses -Key '/repos/aaron8819/trainer-app' -Body $null -ExitCode 1 -HttpStatus 404
        $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
        $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
        $report = $result.Text | ConvertFrom-Json
        Assert-Equal $result.ExitCode 1 'Inaccessible repository must be blocked.'
        Assert-Equal $report.providers.github.live.authentication.status 'insufficient-access' 'Repository access category mismatch.'
        Assert-Equal @($report.providers.github.live.evidence).Count 3 'Inaccessible repository must stop at identity lookup.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'remote task branch presence and divergence are reported' {
    $fixture = New-RemoteTestRepository
    try {
        $scenario = New-GitHubSuccessScenario -Fixture $fixture -TaskBranchExists $true
        $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
        $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
        $github = ($result.Text | ConvertFrom-Json).providers.github.live
        Assert-Equal $result.ExitCode 0 'Remote branch fixture should succeed.'
        Assert-True $github.branch.remote.exists 'Remote branch should be present.'
        Assert-Equal $github.branch.remote.sha $scenario.taskSha 'Remote branch SHA mismatch.'
        Assert-Equal $github.branch.remote.comparisonToDefault 'ahead' 'Remote branch comparison mismatch.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'pull request draft mergeability review decision and unresolved threads are reported' {
    foreach ($case in @(
            [pscustomobject]@{ draft = $true; mergeable = 'UNKNOWN'; mergeState = 'UNKNOWN'; review = $null; unresolved = 0; label = 'draft' },
            [pscustomobject]@{ draft = $false; mergeable = 'MERGEABLE'; mergeState = 'CLEAN'; review = 'APPROVED'; unresolved = 1; label = 'mergeable' },
            [pscustomobject]@{ draft = $false; mergeable = 'CONFLICTING'; mergeState = 'DIRTY'; review = 'CHANGES_REQUESTED'; unresolved = 2; label = 'conflicting' }
        )) {
        $fixture = New-RemoteTestRepository
        try {
            $branch = 'codex/remote-github-status'
            $pull = [pscustomobject]@{
                number = 17; state = 'open'; draft = $case.draft; html_url = 'https://github.com/aaron8819/trainer-app/pull/17'
                base = [pscustomobject]@{ ref = 'master' }
                head = [pscustomobject]@{ ref = $branch; sha = '2222222222222222222222222222222222222222'; repo = [pscustomobject]@{ full_name = 'aaron8819/trainer-app' } }
            }
            $scenario = New-GitHubSuccessScenario -Fixture $fixture -TaskBranchExists $true -PullRequests @($pull)
            $threads = @()
            for ($index = 0; $index -lt $case.unresolved; $index++) { $threads += [pscustomobject]@{ isResolved = $false } }
            Add-FakeGitHubResponse -Responses $scenario.responses -Key 'graphql:first' -Body ([pscustomobject]@{
                data = [pscustomobject]@{ repository = [pscustomobject]@{ pullRequest = [pscustomobject]@{
                    isDraft = $case.draft; mergeable = $case.mergeable; mergeStateStatus = $case.mergeState; reviewDecision = $case.review
                    reviewThreads = [pscustomobject]@{ nodes = $threads; pageInfo = [pscustomobject]@{ hasNextPage = $false; endCursor = $null } }
                } } }
            })
            $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
            $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch $branch -PathPrefix $fake.Directory
            $callLog = if (Test-Path -LiteralPath $fake.LogPath) { Get-Content -Raw -LiteralPath $fake.LogPath } else { 'no calls' }
            Assert-Equal $result.ExitCode 0 "$($case.label) PR fixture should succeed. Output: $($result.Text) Calls: $callLog"
            $github = ($result.Text | ConvertFrom-Json).providers.github.live
            Assert-Equal $github.pullRequest.number 17 "$($case.label) PR number mismatch."
            Assert-Equal $github.pullRequest.draft $case.draft "$($case.label) draft state mismatch."
            Assert-Equal $github.pullRequest.mergeability $case.mergeable.ToLowerInvariant() "$($case.label) mergeability mismatch."
            Assert-Equal $github.pullRequest.unresolvedThreads $case.unresolved "$($case.label) unresolved-thread count mismatch."
            Assert-True $github.pullRequest.reviewThreadsComplete "$($case.label) thread read should be complete."
        }
        finally { Remove-TestRepository -Fixture $fixture }
    }
}

Invoke-Test 'review-thread GraphQL pagination and partial errors are explicit' {
    $fixture = New-RemoteTestRepository
    try {
        $branch = 'codex/remote-github-status'
        $pull = [pscustomobject]@{
            number = 21; state = 'open'; draft = $false; html_url = 'https://github.com/aaron8819/trainer-app/pull/21'
            base = [pscustomobject]@{ ref = 'master' }
            head = [pscustomobject]@{ ref = $branch; sha = '2'; repo = [pscustomobject]@{ full_name = 'aaron8819/trainer-app' } }
        }
        $scenario = New-GitHubSuccessScenario -Fixture $fixture -PullRequests @($pull)
        Add-FakeGitHubResponse -Responses $scenario.responses -Key 'graphql:first' -Body ([pscustomobject]@{
            data = [pscustomobject]@{ repository = [pscustomobject]@{ pullRequest = [pscustomobject]@{
                isDraft = $false; mergeable = 'UNKNOWN'; mergeStateStatus = 'UNKNOWN'; reviewDecision = $null
                reviewThreads = [pscustomobject]@{ nodes = @([pscustomobject]@{ isResolved = $false }); pageInfo = [pscustomobject]@{ hasNextPage = $true; endCursor = 'page2' } }
            } } }
        })
        Add-FakeGitHubResponse -Responses $scenario.responses -Key 'graphql:page2' -Body ([pscustomobject]@{
            data = [pscustomobject]@{ repository = [pscustomobject]@{ pullRequest = [pscustomobject]@{
                isDraft = $false; mergeable = 'UNKNOWN'; mergeStateStatus = 'UNKNOWN'; reviewDecision = $null
                reviewThreads = [pscustomobject]@{ nodes = @([pscustomobject]@{ isResolved = $true }); pageInfo = [pscustomobject]@{ hasNextPage = $false; endCursor = $null } }
            } } }
            errors = @([pscustomobject]@{ type = 'FORBIDDEN'; message = 'redacted fixture error' })
        })
        $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
        $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch $branch -PathPrefix $fake.Directory
        $callLog = if (Test-Path -LiteralPath $fake.LogPath) { Get-Content -Raw -LiteralPath $fake.LogPath } else { 'no calls' }
        Assert-Equal $result.ExitCode 0 "Partial review-thread data should be a valid report with a warning. Output: $($result.Text) Calls: $callLog"
        $github = ($result.Text | ConvertFrom-Json).providers.github.live
        Assert-Equal $github.pullRequest.unresolvedThreads 1 'Paginated unresolved-thread count mismatch.'
        Assert-True (-not $github.pullRequest.reviewThreadsComplete) 'GraphQL errors must mark thread data partial.'
        Assert-True (@($github.warnings | Where-Object { $_ -match 'partial' }).Count -gt 0) 'GraphQL partial-data warning missing.'
        Assert-Equal @($github.evidence | Where-Object { $_.operation -eq 'pull request review threads' }).Count 2 'GraphQL pagination call count mismatch.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'checks distinguish not-run pending failed passed and required configuration' {
    foreach ($case in @(
            [pscustomobject]@{ label = 'not-run'; workflows = @([pscustomobject]@{ name = 'CI' }); runs = @(); statuses = @(); expected = 'checks-not-run'; exit = 0 },
            [pscustomobject]@{ label = 'pending'; workflows = @([pscustomobject]@{ name = 'CI' }); runs = @([pscustomobject]@{ name = 'build'; status = 'in_progress'; conclusion = $null }); statuses = @(); expected = 'pending'; exit = 0 },
            [pscustomobject]@{ label = 'failed'; workflows = @([pscustomobject]@{ name = 'CI' }); runs = @([pscustomobject]@{ name = 'build'; status = 'completed'; conclusion = 'failure' }); statuses = @(); expected = 'failed'; exit = 1 },
            [pscustomobject]@{ label = 'categories'; workflows = @([pscustomobject]@{ name = 'CI' }); runs = @([pscustomobject]@{ name = 'build'; status = 'completed'; conclusion = 'cancelled' }, [pscustomobject]@{ name = 'skipped'; status = 'completed'; conclusion = 'skipped' }, [pscustomobject]@{ name = 'neutral'; status = 'completed'; conclusion = 'neutral' }); statuses = @(); expected = 'failed'; exit = 1 },
            [pscustomobject]@{ label = 'passed'; workflows = @([pscustomobject]@{ name = 'CI' }); runs = @([pscustomobject]@{ name = 'build'; status = 'completed'; conclusion = 'success' }); statuses = @([pscustomobject]@{ context = 'legacy'; state = 'success' }); expected = 'passed'; exit = 0 }
        )) {
        $fixture = New-RemoteTestRepository
        try {
            $protection = [pscustomobject]@{
                required_status_checks = [pscustomobject]@{ contexts = @('build') }
                required_pull_request_reviews = [pscustomobject]@{ required_approving_review_count = 2 }
            }
            $scenario = New-GitHubSuccessScenario -Fixture $fixture -Workflows $case.workflows -CheckRuns $case.runs -Statuses $case.statuses -Protection $protection
            $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
            $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
            $github = ($result.Text | ConvertFrom-Json).providers.github.live
            Assert-Equal $result.ExitCode $case.exit "$($case.label) check exit mismatch."
            Assert-Equal $github.checks.statusRollup $case.expected "$($case.label) rollup mismatch."
            Assert-Equal $github.checks.requiredChecksResolution 'available' "$($case.label) required-check resolution mismatch."
            Assert-Equal $github.protection.requiredApprovals 2 "$($case.label) required approvals mismatch."
            if ($case.label -eq 'passed') { Assert-True $github.checks.allRequiredChecksPassed 'Passed required check must be reported true.' }
            if ($case.label -eq 'failed') { Assert-Equal @($github.checks.failingRequiredChecks).Count 1 'Failing required check missing.' }
            if ($case.label -eq 'categories') {
                Assert-Equal $github.checks.checkRuns.cancelled 1 'Cancelled check count mismatch.'
                Assert-Equal $github.checks.checkRuns.skipped 1 'Skipped check count mismatch.'
                Assert-Equal $github.checks.checkRuns.neutral 1 'Neutral check count mismatch.'
            }
        }
        finally { Remove-TestRepository -Fixture $fixture }
    }
}

Invoke-Test 'required checks remain unresolved when rulesets may add requirements' {
    foreach ($case in @(
            [pscustomobject]@{ label = 'ruleset-present'; rulesetResponse = @([pscustomobject]@{ name = 'default-branch-policy' }); exitCode = 0; httpStatus = 200 },
            [pscustomobject]@{ label = 'ruleset-permission-gap'; rulesetResponse = $null; exitCode = 1; httpStatus = 403 }
        )) {
        $fixture = New-RemoteTestRepository
        try {
            $protection = [pscustomobject]@{
                required_status_checks = [pscustomobject]@{ contexts = @('build') }
            }
            $scenario = New-GitHubSuccessScenario -Fixture $fixture -Protection $protection -CheckRuns @(
                [pscustomobject]@{ name = 'build'; status = 'completed'; conclusion = 'success' }
            )
            Add-FakeGitHubResponse -Responses $scenario.responses -Key '/repos/aaron8819/trainer-app/rulesets?includes_parents=true&targets=branch&per_page=100&page=1' -Body $case.rulesetResponse -ExitCode $case.exitCode -HttpStatus $case.httpStatus
            $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
            $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
            $github = ($result.Text | ConvertFrom-Json).providers.github.live
            Assert-Equal $result.ExitCode 0 "$($case.label) should remain a valid partial report."
            Assert-Equal $github.checks.requiredChecksResolution 'unavailable' "$($case.label) required-check resolution mismatch."
            Assert-Equal $github.checks.allRequiredChecksPassed $null "$($case.label) must not claim required-check success."
        }
        finally { Remove-TestRepository -Fixture $fixture }
    }
}

Invoke-Test 'workflow pagination protection permission gap and deployment records are explicit' {
    $fixture = New-RemoteTestRepository
    try {
        $deployment = [pscustomobject]@{ id = 88; environment = 'Preview'; sha = '1111111111111111111111111111111111111111' }
        $scenario = New-GitHubSuccessScenario -Fixture $fixture -Deployments @($deployment)
        $firstPage = @(1..100 | ForEach-Object { [pscustomobject]@{ name = "workflow-$_" } })
        Add-FakeGitHubResponse -Responses $scenario.responses -Key '/repos/aaron8819/trainer-app/actions/workflows?per_page=100&page=1' -Body ([pscustomobject]@{ workflows = $firstPage })
        Add-FakeGitHubResponse -Responses $scenario.responses -Key '/repos/aaron8819/trainer-app/actions/workflows?per_page=100&page=2' -Body ([pscustomobject]@{ workflows = @([pscustomobject]@{ name = 'workflow-101' }) })
        $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
        $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
        $github = ($result.Text | ConvertFrom-Json).providers.github.live
        Assert-Equal $result.ExitCode 0 'Pagination/deployment fixture should succeed.'
        Assert-Equal $github.checks.workflows.count 101 'Workflow pagination count mismatch.'
        Assert-Equal $github.protection.classicBranchProtection 'unavailable' 'Protection permission gap mismatch.'
        Assert-Equal $github.checks.requiredChecksResolution 'unavailable' 'Unavailable required-check configuration mismatch.'
        Assert-Equal $github.checks.allRequiredChecksPassed $null 'Required-check pass claim must remain null when unavailable.'
        Assert-True $github.deployments.recordsPresent 'GitHub deployment record should be present.'
        Assert-Equal $github.deployments.records[0].latestStatus 'success' 'Deployment latest status mismatch.'
        Assert-True (-not $github.deployments.provesActiveVercelProduction) 'Deployment record must not imply active Vercel state.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'GitHub rate limits and required check API failures produce valid blocked reports' {
    foreach ($target in @('repository', 'checks')) {
        $fixture = New-RemoteTestRepository
        try {
            $scenario = New-GitHubSuccessScenario -Fixture $fixture
            if ($target -eq 'repository') {
                Add-FakeGitHubResponse -Responses $scenario.responses -Key '/repos/aaron8819/trainer-app' -Body $null -ExitCode 1 -HttpStatus 429
            }
            else {
                Add-FakeGitHubResponse -Responses $scenario.responses -Key "/repos/aaron8819/trainer-app/commits/$($scenario.defaultSha)/check-runs?per_page=100&page=1" -Body $null -ExitCode 1 -HttpStatus 500
            }
            $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
            $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Json -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
            $report = $result.Text | ConvertFrom-Json
            Assert-Equal $result.ExitCode 1 "$target API failure must return a valid blocked report."
            Assert-True (@($report.blockers).Count -gt 0) "$target API failure blocker missing."
        }
        finally { Remove-TestRepository -Fixture $fixture }
    }
}

Invoke-Test 'GitHub human output is sanitized and fake command audit is read-only' {
    $fixture = New-RemoteTestRepository
    try {
        $scenario = New-GitHubSuccessScenario -Fixture $fixture
        $fake = New-FakeGitHubCli -Fixture $fixture -Scenario $scenario
        $before = @(& git -C $fixture.Repository status --porcelain=v1 --untracked-files=all) -join "`n"
        $result = Invoke-RemoteStatus -Fixture $fixture -GitHub -Branch 'codex/remote-github-status' -PathPrefix $fake.Directory
        $after = @(& git -C $fixture.Repository status --porcelain=v1 --untracked-files=all) -join "`n"
        Assert-Equal $result.ExitCode 0 'Human GitHub report should succeed.'
        Assert-True $result.Text.Contains('Trainer authenticated GitHub remote status') 'Human GitHub heading missing.'
        Assert-True $result.Text.Contains('not Vercel production proof') 'Vercel distinction missing from human output.'
        Assert-Equal $after $before 'Authenticated read changed fixture repository state.'
        $calls = Get-Content -Raw -LiteralPath $fake.LogPath
        Assert-True (-not [regex]::IsMatch($calls, '(?i)\b(push|pull|fetch|merge|mutation|POST|PUT|PATCH|DELETE|rerun|dispatch|secret|variable)\b')) 'Fake gh audit observed a mutation-capable token.'
        Assert-True (-not [regex]::IsMatch($result.Text, '(?i)(bearer|authorization:|token=|password=)')) 'Human output exposed a credential-like value.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'Vercel expected identity blockers stop before token or HTTP access' {
    $cases = @('teamId', 'teamSlug', 'projectId', 'projectName', 'productionAlias', 'unsafe')
    foreach ($case in $cases) {
        $fixture = New-RemoteTestRepository
        try {
            $identity = Get-Content -Raw -LiteralPath $fixture.RemoteIdentity | ConvertFrom-Json -Depth 100
            if ($case -eq 'unsafe') { $identity.vercel.productionAlias = 'https://token@example.invalid/?secret=value' }
            else { $identity.vercel.$case = $null }
            Write-FixtureRemoteIdentity -Fixture $fixture -Identity $identity
            $sentinel = Join-Path $fixture.Sandbox 'provider-invoked.txt'
            @'
function Invoke-TrainerVercelStatus {
    Set-Content -LiteralPath (Join-Path $PSScriptRoot 'provider-invoked.txt') -Value invoked
    throw 'provider must not be invoked'
}
Export-ModuleMember -Function Invoke-TrainerVercelStatus
'@ | Set-Content -LiteralPath (Join-Path $fixture.Repository 'scripts\codex\Trainer.VercelStatus.psm1') -Encoding utf8NoBOM
            $result = Invoke-RemoteStatus -Fixture $fixture -Deployment -Json -ClearVercelToken
            $report = $result.Text | ConvertFrom-Json -Depth 100
            Assert-Equal $result.ExitCode 1 "$case identity blocker must exit 1."
            Assert-True (-not $report.networkAccessed) "$case identity blocker claimed network access."
            Assert-True (-not $report.databaseAccessed) "$case identity blocker claimed database access."
            Assert-Equal $report.providers.deployment.live $null "$case identity blocker exposed live evidence."
            Assert-True (-not (Test-Path -LiteralPath $sentinel)) "$case identity blocker invoked the provider."
            Assert-True (-not $result.Text.Contains('token@example.invalid')) "$case unsafe identity leaked."
        }
        finally { Remove-TestRepository -Fixture $fixture }
    }
}

Invoke-Test 'missing VERCEL_TOKEN returns a valid zero-request blocked report' {
    $fixture = New-RemoteTestRepository
    try {
        $result = Invoke-RemoteStatus -Fixture $fixture -Deployment -Json -ClearVercelToken
        $report = $result.Text | ConvertFrom-Json -Depth 100
        Assert-Equal $result.ExitCode 1 'Missing token must exit 1.'
        Assert-True $report.inspectionOnly 'Missing token report must remain inspection-only.'
        Assert-True (-not $report.networkAccessed) 'Missing token must make zero HTTP requests.'
        Assert-True (-not $report.databaseAccessed) 'Missing token must remain database-free.'
        Assert-Equal $report.providers.deployment.authentication.status 'missing-token' 'Missing-token category mismatch.'
        Assert-Equal $report.providers.deployment.live $null 'Missing token must leave live evidence null.'
        Assert-True $report.providers.deployment.authentication.prerequisite.Contains('Read-Host -MaskInput') 'Manual token prerequisite missing.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'Vercel REST success proves exact identity alias deployment and rollback candidate' {
    $scenario = New-VercelSuccessScenario
    $fixtureResult = Invoke-VercelProviderFixture -Scenario $scenario
    $live = $fixtureResult.Result
    Assert-True $live.networkAccessed 'Successful provider did not record network access.'
    Assert-Equal $live.authentication.status 'authenticated' 'Authenticated user success mismatch.'
    Assert-Equal $live.authentication.transport 'official-vercel-rest-api' 'REST transport label mismatch.'
    Assert-True $live.identity.match 'Exact Vercel identity did not match.'
    Assert-Equal $live.identity.observed.teamId 'team_YPrwp64VBrZbh9mEcwGQV8D4' 'Team identity mismatch.'
    Assert-Equal $live.identity.observed.projectId 'prj_XtOD3yvnH76X62LEDKi2qKV7XFaj' 'Project identity mismatch.'
    Assert-True $live.productionAlias.pointsToActiveDeployment 'Alias did not establish active production truth.'
    Assert-Equal $live.activeDeployment.id $scenario.activeId 'Active deployment ID mismatch.'
    Assert-Equal $live.activeDeployment.target 'production' 'Active deployment target mismatch.'
    Assert-Equal $live.activeDeployment.gitCommitSha $scenario.activeSha 'Deployment SHA mismatch.'
    Assert-Equal $live.previousHealthyDeployment.status 'present' 'Rollback candidate missing.'
    Assert-True (-not $live.previousHealthyDeployment.safeToRollback) 'Rollback candidate was called safe.'
    Assert-Equal $live.previousHealthyDeployment.schemaCompatibility 'unknown' 'Schema compatibility was overclaimed.'
    Assert-True (@($live.evidence).Count -eq @($fixtureResult.Calls).Count) 'Evidence and HTTP call counts differ.'
    Assert-True (@($live.evidence | Where-Object { $_.method -cne 'GET' }).Count -eq 0) 'A non-GET evidence row was emitted.'
}

Invoke-Test 'VERCEL_TOKEN never appears in provider result or sanitized failures' {
    $token = 'fixture-super-secret-token-value'
    $success = Invoke-VercelProviderFixture -Scenario (New-VercelSuccessScenario) -Token $token
    $successText = $success.Result | ConvertTo-Json -Depth 100
    Assert-True (-not $successText.Contains($token)) 'Token appeared in successful provider output.'
    $scenario = New-VercelSuccessScenario
    Add-FakeVercelResponse -Responses $scenario.responses -Key '/v2/user' -Body $null -HttpStatus 401
    $failure = Invoke-VercelProviderFixture -Scenario $scenario -Token $token
    $failureText = $failure.Result | ConvertTo-Json -Depth 100
    Assert-True (-not $failureText.Contains($token)) 'Token appeared in authentication failure output.'
    Assert-True (-not [regex]::IsMatch($failureText, '(?i)authorization|bearer')) 'Raw authorization material appeared in output.'
}

Invoke-Test 'Vercel authentication HTTP categories fail closed' {
    foreach ($case in @(
        [pscustomobject]@{ status = 401; expected = 'not-authenticated' },
        [pscustomobject]@{ status = 403; expected = 'insufficient-access' }
    )) {
        $scenario = New-VercelSuccessScenario
        Add-FakeVercelResponse -Responses $scenario.responses -Key '/v2/user' -Body $null -HttpStatus $case.status
        $fixtureResult = Invoke-VercelProviderFixture -Scenario $scenario
        Assert-Equal $fixtureResult.Result.authentication.status $case.expected "HTTP $($case.status) authentication category mismatch."
        Assert-True @($fixtureResult.Result.blockers).Count -gt 0 "HTTP $($case.status) blocker missing."
        Assert-Equal @($fixtureResult.Calls).Count 1 "HTTP $($case.status) continued collection."
    }
}

Invoke-Test 'Vercel team identity and pagination are exact and fail closed' {
    foreach ($case in @(
        [pscustomobject]@{ label = 'absent'; teamId = 'team_other'; teamSlug = 'other-team'; expectedBlocker = 'not available' },
        [pscustomobject]@{ label = 'id mismatch'; teamId = 'team_other'; teamSlug = 'aaron8819s-projects'; expectedBlocker = 'team ID differs' }
    )) {
        $scenario = New-VercelSuccessScenario -TeamId $case.teamId -TeamSlug $case.teamSlug
        $fixtureResult = Invoke-VercelProviderFixture -Scenario $scenario
        Assert-Equal $fixtureResult.Result.authentication.status 'wrong-team' "$($case.label) team category mismatch."
        Assert-True (($fixtureResult.Result.blockers -join ' ').Contains($case.expectedBlocker)) "$($case.label) team blocker mismatch."
        Assert-True (@($fixtureResult.Calls | Where-Object endpointId -eq 'project').Count -eq 0) "$($case.label) continued to project lookup."
    }

    $scenario = New-VercelSuccessScenario
    $scenario.responses['/v2/teams?limit=100'].data.teams = @([pscustomobject]@{ id = 'team_other'; slug = 'other-team' })
    $scenario.responses['/v2/teams?limit=100'].data.pagination.next = 123
    Add-FakeVercelResponse -Responses $scenario.responses -Key '/v2/teams?limit=100&until=123' -Body ([pscustomobject]@{
        teams = @([pscustomobject]@{ id = 'team_YPrwp64VBrZbh9mEcwGQV8D4'; slug = 'aaron8819s-projects' })
        pagination = [pscustomobject]@{ next = $null }
    })
    $fixtureResult = Invoke-VercelProviderFixture -Scenario $scenario
    Assert-True $fixtureResult.Result.identity.match 'Paginated team lookup failed.'
    Assert-True (@($fixtureResult.Calls | Where-Object { $_.pathAndQuery -eq '/v2/teams?limit=100&until=123' }).Count -eq 1) 'Team pagination request missing.'
}

Invoke-Test 'Vercel team slug mismatch stops before project lookup' {
    $scenario = New-VercelSuccessScenario
    $scenario.responses['/v2/teams/team_YPrwp64VBrZbh9mEcwGQV8D4'].data.slug = 'other-team'
    $fixtureResult = Invoke-VercelProviderFixture -Scenario $scenario
    Assert-Equal $fixtureResult.Result.authentication.status 'wrong-team' 'Team slug mismatch category mismatch.'
    Assert-True (($fixtureResult.Result.blockers -join ' ').Contains('team slug differs')) 'Team slug blocker missing.'
    Assert-True (@($fixtureResult.Calls | Where-Object endpointId -eq 'project').Count -eq 0) 'Team slug mismatch continued to project lookup.'
}

Invoke-Test 'Vercel project identity and access failures stop before alias lookup' {
    foreach ($case in @('id', 'name', 'owner', 'inaccessible')) {
        $scenario = New-VercelSuccessScenario
        $projectKey = '/v9/projects/prj_XtOD3yvnH76X62LEDKi2qKV7XFaj?teamId=team_YPrwp64VBrZbh9mEcwGQV8D4'
        if ($case -eq 'id') { $scenario.responses[$projectKey].data.id = 'prj_other' }
        if ($case -eq 'name') { $scenario.responses[$projectKey].data.name = 'other-project' }
        if ($case -eq 'owner') { $scenario.responses[$projectKey].data.accountId = 'team_other' }
        if ($case -eq 'inaccessible') { Add-FakeVercelResponse -Responses $scenario.responses -Key $projectKey -Body $null -HttpStatus 404 }
        $fixtureResult = Invoke-VercelProviderFixture -Scenario $scenario
        Assert-True @($fixtureResult.Result.blockers).Count -gt 0 "$case project blocker missing."
        Assert-True (@($fixtureResult.Calls | Where-Object endpointId -eq 'alias').Count -eq 0) "$case project failure continued to alias lookup."
    }
}

Invoke-Test 'Vercel project-domain evidence handles empty arrays but blocks unavailable evidence' {
    $key = '/v9/projects/prj_XtOD3yvnH76X62LEDKi2qKV7XFaj/domains?limit=100&teamId=team_YPrwp64VBrZbh9mEcwGQV8D4'
    $scenario = New-VercelSuccessScenario
    $scenario.responses[$key].data.domains = @()
    $fixtureResult = Invoke-VercelProviderFixture -Scenario $scenario
    Assert-True $fixtureResult.Result.identity.match 'Empty project-domain list should not override exact alias evidence.'
    Assert-True (-not $fixtureResult.Result.project.productionAliasListedAsProjectDomain) 'Empty project-domain list serialized incorrectly.'

    $scenario = New-VercelSuccessScenario
    Add-FakeVercelResponse -Responses $scenario.responses -Key $key -Body $null -HttpStatus 403
    $fixtureResult = Invoke-VercelProviderFixture -Scenario $scenario
    Assert-True (($fixtureResult.Result.blockers -join ' ').Contains('project-domain evidence')) 'Unavailable domain evidence did not block.'
    Assert-True (@($fixtureResult.Calls | Where-Object endpointId -eq 'alias').Count -eq 0) 'Domain evidence failure continued to alias lookup.'
}

Invoke-Test 'Vercel alias assignment mismatches fail closed before deployment details' {
    $aliasKey = '/v4/aliases/trainer-app-indol.vercel.app?projectId=prj_XtOD3yvnH76X62LEDKi2qKV7XFaj&teamId=team_YPrwp64VBrZbh9mEcwGQV8D4'
    foreach ($case in @('absent', 'wrong-alias', 'other-project', 'ambiguous')) {
        $scenario = New-VercelSuccessScenario
        if ($case -eq 'absent') { Add-FakeVercelResponse -Responses $scenario.responses -Key $aliasKey -Body $null -HttpStatus 404 }
        if ($case -eq 'wrong-alias') { $scenario.responses[$aliasKey].data.alias = 'other.vercel.app' }
        if ($case -eq 'other-project') { $scenario.responses[$aliasKey].data.projectId = 'prj_other' }
        if ($case -eq 'ambiguous') { $scenario.responses[$aliasKey].data.deployment.id = 'dpl_conflict' }
        $fixtureResult = Invoke-VercelProviderFixture -Scenario $scenario
        Assert-True @($fixtureResult.Result.blockers).Count -gt 0 "$case alias blocker missing."
        Assert-True (@($fixtureResult.Calls | Where-Object endpointId -eq 'deployment').Count -eq 0) "$case alias failure continued to deployment details."
    }
}

Invoke-Test 'Vercel active deployment states and target enforcement are explicit' {
    foreach ($state in @('READY', 'BUILDING', 'ERROR')) {
        $fixtureResult = Invoke-VercelProviderFixture -Scenario (New-VercelSuccessScenario -ActiveState $state)
        Assert-Equal $fixtureResult.Result.activeDeployment.state $state.ToLowerInvariant() "$state active deployment state mismatch."
        Assert-True $fixtureResult.Result.identity.match "$state active deployment should be a valid completed read."
    }
    $scenario = New-VercelSuccessScenario
    $key = '/v13/deployments/dpl_activefixture?teamId=team_YPrwp64VBrZbh9mEcwGQV8D4'
    $scenario.responses[$key].data.target = 'preview'
    $fixtureResult = Invoke-VercelProviderFixture -Scenario $scenario
    Assert-True (($fixtureResult.Result.blockers -join ' ').Contains('does not target production')) 'Preview target did not block.'
    Assert-True (-not $fixtureResult.Result.productionAlias.pointsToActiveDeployment) 'Preview deployment was called active production.'
}

Invoke-Test 'Vercel deployment SHA traceability is identical different or unavailable without fetching Git' {
    $sha = '1111111111111111111111111111111111111111'
    $identical = Invoke-VercelProviderFixture -Scenario (New-VercelSuccessScenario -ActiveSha $sha) -LocalHead $sha -CachedDefaultSha $sha
    Assert-Equal $identical.Result.commitTraceability.localHead.status 'identical' 'Local identical SHA mismatch.'
    Assert-Equal $identical.Result.commitTraceability.cachedOriginDefault.status 'identical' 'Cached identical SHA mismatch.'
    $different = Invoke-VercelProviderFixture -Scenario (New-VercelSuccessScenario -ActiveSha $sha) -LocalHead '2222222222222222222222222222222222222222'
    Assert-Equal $different.Result.commitTraceability.localHead.status 'different' 'Different SHA mismatch.'
    $unavailable = Invoke-VercelProviderFixture -Scenario (New-VercelSuccessScenario -ActiveSha '') -LocalHead $sha
    Assert-Equal $unavailable.Result.commitTraceability.localHead.status 'unavailable' 'Unavailable SHA mismatch.'
}

Invoke-Test 'combined GitHub and Deployment traceability reuses live GitHub evidence' {
    $sha = '1111111111111111111111111111111111111111'
    $github = [pscustomobject]@{
        branch = [pscustomobject]@{ defaultBranch = [pscustomobject]@{ sha = $sha } }
        checks = [pscustomobject]@{ pending = @('Vercel') }
    }
    $ready = Invoke-VercelProviderFixture -Scenario (New-VercelSuccessScenario -ActiveState READY -ActiveSha $sha) -GitHubLive $github
    Assert-Equal $ready.Result.commitTraceability.githubDefault.status 'identical' 'Live GitHub identical SHA mismatch.'
    Assert-Equal $ready.Result.commitTraceability.pendingGitHubVercelContext.correspondence 'stale-for-active-production' 'Pending ready context interpretation mismatch.'
    $building = Invoke-VercelProviderFixture -Scenario (New-VercelSuccessScenario -ActiveState BUILDING -ActiveSha $sha) -GitHubLive $github
    Assert-Equal $building.Result.commitTraceability.pendingGitHubVercelContext.correspondence 'active-production-building' 'Pending building context interpretation mismatch.'
    $other = Invoke-VercelProviderFixture -Scenario (New-VercelSuccessScenario -ActiveSha '2222222222222222222222222222222222222222') -GitHubLive $github
    Assert-Equal $other.Result.commitTraceability.pendingGitHubVercelContext.correspondence 'different-commit-or-preview' 'Different commit context interpretation mismatch.'
}

Invoke-Test 'Vercel rollback candidate absence presence and pagination remain conservative' {
    $absent = Invoke-VercelProviderFixture -Scenario (New-VercelSuccessScenario -NoPrevious)
    Assert-Equal $absent.Result.previousHealthyDeployment.status 'absent' 'Absent rollback candidate mismatch.'
    Assert-True (-not $absent.Result.previousHealthyDeployment.safeToRollback) 'Absent candidate was called safe.'

    $scenario = New-VercelSuccessScenario -NoPrevious
    $listKey = '/v7/deployments?projectId=prj_XtOD3yvnH76X62LEDKi2qKV7XFaj&target=production&limit=100&teamId=team_YPrwp64VBrZbh9mEcwGQV8D4'
    $scenario.responses[$listKey].data.pagination.next = 456
    Add-FakeVercelResponse -Responses $scenario.responses -Key '/v7/deployments?projectId=prj_XtOD3yvnH76X62LEDKi2qKV7XFaj&target=production&limit=100&until=456&teamId=team_YPrwp64VBrZbh9mEcwGQV8D4' -Body ([pscustomobject]@{
        deployments = @([pscustomobject]@{ uid = 'dpl_previouspage'; state = 'READY'; target = 'production'; created = 1750000000000; ready = 1750000060000; meta = [pscustomobject]@{ githubCommitSha = '2222222222222222222222222222222222222222' } })
        pagination = [pscustomobject]@{ next = $null }
    })
    $paged = Invoke-VercelProviderFixture -Scenario $scenario
    Assert-Equal $paged.Result.previousHealthyDeployment.id 'dpl_previouspage' 'Paginated rollback candidate missing.'
    Assert-True (-not $paged.Result.previousHealthyDeployment.safeToRollback) 'Paginated rollback candidate was called safe.'
}

Invoke-Test 'Vercel HTTP parsing timeout and redirect failures are sanitized execution failures' {
    foreach ($case in @('429', '500', 'timeout', 'redirect', 'non-json', 'invalid-json')) {
        $scenario = New-VercelSuccessScenario
        if ($case -eq '429') { Add-FakeVercelResponse -Responses $scenario.responses -Key '/v2/user' -Body $null -HttpStatus 429 }
        if ($case -eq '500') { Add-FakeVercelResponse -Responses $scenario.responses -Key '/v2/user' -Body $null -HttpStatus 500 }
        if ($case -eq 'timeout') { Add-FakeVercelResponse -Responses $scenario.responses -Key '/v2/user' -Body $null -HttpStatus 0 -TimedOut -TransportError }
        if ($case -eq 'redirect') { Add-FakeVercelResponse -Responses $scenario.responses -Key '/v2/user' -Body $null -HttpStatus 302 -RedirectLocation 'https://evil.example.invalid/steal' }
        if ($case -eq 'non-json') { Add-FakeVercelResponse -Responses $scenario.responses -Key '/v2/user' -Body $null -HttpStatus 200 -ContentType 'text/plain' -JsonText 'not-json' }
        if ($case -eq 'invalid-json') { Add-FakeVercelResponse -Responses $scenario.responses -Key '/v2/user' -Body $null -HttpStatus 200 -JsonText '{invalid' }
        $threw = $false
        try { [void](Invoke-VercelProviderFixture -Scenario $scenario) } catch {
            $threw = $true
            Assert-True (-not $_.Exception.Message.Contains('fixture-token')) "$case failure leaked token material."
            Assert-True (-not $_.Exception.Message.Contains('evil.example.invalid')) "$case failure exposed redirect URL."
        }
        Assert-True $threw "$case provider failure did not throw."
    }
}

Invoke-Test 'Vercel endpoint registry rejects arbitrary IDs methods hosts schemes and query keys' {
    $policy = Get-Content -Raw -LiteralPath $sourcePolicy | ConvertFrom-Json -Depth 100
    Import-Module $sourceVercelModule -Force
    $module = Get-Module Trainer.VercelStatus
    $registry = @($policy.vercelReadOnly.endpointRegistry)
    foreach ($case in @('unregistered', 'query', 'method', 'host', 'scheme')) {
        $threw = $false
        try {
            if ($case -eq 'unregistered') {
                & $module { param($r) New-TrainerVercelRequest -EndpointRegistry $r -EndpointId 'not-registered' } $registry
            }
            elseif ($case -eq 'query') {
                & $module { param($r) New-TrainerVercelRequest -EndpointRegistry $r -EndpointId 'authenticated-user' -QueryParameters @{ token = 'forbidden' } } $registry
            }
            elseif ($case -eq 'method') {
                $copy = $registry | ConvertTo-Json -Depth 20 | ConvertFrom-Json -Depth 20
                (@($copy | Where-Object id -eq 'authenticated-user'))[0].method = 'POST'
                & $module { param($r) New-TrainerVercelRequest -EndpointRegistry $r -EndpointId 'authenticated-user' } @($copy)
            }
            elseif ($case -eq 'host') {
                $copy = $registry | ConvertTo-Json -Depth 20 | ConvertFrom-Json -Depth 20
                (@($copy | Where-Object id -eq 'authenticated-user'))[0].host = 'evil.example.invalid'
                & $module { param($r) New-TrainerVercelRequest -EndpointRegistry $r -EndpointId 'authenticated-user' } @($copy)
            }
            else {
                & $module {
                    param($r)
                    $priorOrigin = $script:VercelApiOrigin
                    try {
                        $script:VercelApiOrigin = 'http://api.vercel.com'
                        New-TrainerVercelRequest -EndpointRegistry $r -EndpointId 'authenticated-user'
                    }
                    finally { $script:VercelApiOrigin = $priorOrigin }
                } $registry
            }
        }
        catch { $threw = $true }
        Assert-True $threw "$case endpoint policy case did not reject."
    }
}

Invoke-Test 'Vercel hostile provider metadata URLs and control characters are sanitized' {
    $scenario = New-VercelSuccessScenario
    $key = '/v13/deployments/dpl_activefixture?teamId=team_YPrwp64VBrZbh9mEcwGQV8D4'
    $scenario.responses[$key].data.url = 'https://credential@example.invalid/path?token=do-not-report'
    $scenario.responses[$key].data.creator.username = 'unsafe' + [char]10 + 'control'
    $scenario.responses[$key].data.meta.githubCommitRef = 'https://example.invalid/?token=do-not-report'
    $scenario.responses[$key].data.meta.githubRepo = 'secret=do-not-report'
    $fixtureResult = Invoke-VercelProviderFixture -Scenario $scenario
    $text = $fixtureResult.Result | ConvertTo-Json -Depth 100
    Assert-Equal $fixtureResult.Result.activeDeployment.hostname $null 'Credential-bearing deployment URL was reported.'
    Assert-Equal $fixtureResult.Result.activeDeployment.creator '[unsafe-redacted]' 'Control-character creator was not redacted.'
    Assert-Equal $fixtureResult.Result.activeDeployment.gitBranch '[unsafe-redacted]' 'Unsafe Git branch was not redacted.'
    Assert-Equal $fixtureResult.Result.activeDeployment.gitRepository '[unsafe-redacted]' 'Unsafe Git repository was not redacted.'
    Assert-True (-not $text.Contains('do-not-report')) 'Hostile provider value leaked.'
}

Invoke-Test 'Vercel human and JSON missing-token reports are stable and repository-safe' {
    $fixture = New-RemoteTestRepository
    try {
        $beforeStatus = @(& git -C $fixture.Repository status --porcelain=v1 --untracked-files=all) -join [Environment]::NewLine
        $beforeRefs = @(& git -C $fixture.Repository show-ref) -join [Environment]::NewLine
        $beforeConfig = @(& git -C $fixture.Repository config --local --list) -join [Environment]::NewLine
        $json = Invoke-RemoteStatus -Fixture $fixture -Deployment -Json -ClearVercelToken
        $human = Invoke-RemoteStatus -Fixture $fixture -Deployment -ClearVercelToken
        Assert-Equal $json.ExitCode 1 'Missing-token JSON exit mismatch.'
        Assert-Equal $human.ExitCode 1 'Missing-token human exit mismatch.'
        Assert-True $human.Text.Contains('Trainer Vercel deployment status') 'Vercel human heading missing.'
        Assert-True $human.Text.Contains('Read-Host -MaskInput') 'Human token prerequisite missing.'
        Assert-True (-not [regex]::IsMatch($json.Text + $human.Text, '(?i)authorization:|bearer\s|token=')) 'Credential-like material appeared in output.'
        Assert-Equal (@(& git -C $fixture.Repository status --porcelain=v1 --untracked-files=all) -join [Environment]::NewLine) $beforeStatus 'Vercel read changed repository status.'
        Assert-Equal (@(& git -C $fixture.Repository show-ref) -join [Environment]::NewLine) $beforeRefs 'Vercel read changed refs.'
        Assert-Equal (@(& git -C $fixture.Repository config --local --list) -join [Environment]::NewLine) $beforeConfig 'Vercel read changed Git config.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'Vercel production source uses only built-in GET-only REST and process VERCEL_TOKEN' {
    $source = Get-Content -Raw -LiteralPath $sourceVercelModule
    Assert-True $source.Contains('Invoke-WebRequest') 'Built-in PowerShell HTTP transport missing.'
    Assert-True $source.Contains('https://api.vercel.com') 'Official Vercel API origin missing.'
    Assert-True (-not [regex]::IsMatch($source, '(?i)\bvercel(?:\.exe|\.cmd)?\b\s+(?:api|deploy|login|link)')) 'Production provider retains a Vercel CLI dependency.'
    Assert-True (-not [regex]::IsMatch($source, '(?i)\b(?:curl|wget|Start-Process|Invoke-Expression)\b')) 'Production provider contains a forbidden transport.'
    Assert-True (-not [regex]::IsMatch($source, '(?i)-Method\s+(?:Post|Put|Patch|Delete)\b')) 'Production provider contains a mutation HTTP method.'
    $environmentReads = @([regex]::Matches($source, "GetEnvironmentVariable\('([^']+)'") | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    Assert-Equal $environmentReads.Count 1 'Provider reads unrelated environment variables.'
    Assert-Equal $environmentReads[0] 'VERCEL_TOKEN' 'Provider environment read is not VERCEL_TOKEN.'
    Assert-True (-not [regex]::IsMatch($source, '(?i)(?:Write-(?:Output|Host|Verbose|Debug)|Console\]::Write).*Authorization')) 'Provider can print raw authorization headers.'
}

Invoke-Test 'unsupported later provider scopes and branch without GitHub exit 2' {
    $fixture = New-RemoteTestRepository
    try {
        foreach ($arguments in @(@('-Database'), @('-All'), @('-Branch', 'master'), @('-GitHub', '-Branch', 'bad..branch'))) {
            $output = @(& pwsh -NoProfile -File $fixture.RemoteStatus @arguments -Json 2>&1)
            Assert-Equal $LASTEXITCODE 2 'Unsupported or incompatible scope must exit 2.'
            $report = ($output -join "`n") | ConvertFrom-Json
            Assert-Equal $report.schema 'trainer-remote-status-error' 'Unsupported-scope error schema mismatch.'
        }
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'offline remote status does not mutate repository state' {
    $fixture = New-RemoteTestRepository
    try {
        $beforeStatus = @(& git -C $fixture.Repository status --porcelain=v1 --untracked-files=all) -join "`n"
        $beforeRefs = @(& git -C $fixture.Repository show-ref) -join "`n"
        $beforeConfig = @(& git -C $fixture.Repository config --local --list) -join "`n"
        $result = Invoke-RemoteStatus -Fixture $fixture -Json
        $afterStatus = @(& git -C $fixture.Repository status --porcelain=v1 --untracked-files=all) -join "`n"
        $afterRefs = @(& git -C $fixture.Repository show-ref) -join "`n"
        $afterConfig = @(& git -C $fixture.Repository config --local --list) -join "`n"
        Assert-Equal $result.ExitCode 0 'Mutation-safety remote status failed.'
        Assert-Equal $afterStatus $beforeStatus 'Remote status changed working-tree state.'
        Assert-Equal $afterRefs $beforeRefs 'Remote status changed refs.'
        Assert-Equal $afterConfig $beforeConfig 'Remote status changed local Git config.'
    }
    finally { Remove-TestRepository -Fixture $fixture }
}

Invoke-Test 'remote command registry metadata preserves offline default and explicit provider read escalations' {
    $policy = Get-Content -Raw -LiteralPath $sourcePolicy | ConvertFrom-Json -Depth 100
    $entry = @($policy.commandRegistry | Where-Object { $_.id -eq 'codex-remote-status' })
    Assert-Equal $entry.Count 1 'Remote status registry entry missing.'
    Assert-Equal $entry[0].profile 'read-only' 'Remote status profile mismatch.'
    $profile = $policy.commandProfiles.($entry[0].profile)
    Assert-True (-not $profile.accessesNetwork) 'Remote status metadata allows network access.'
    Assert-True (-not $profile.accessesDatabase) 'Remote status metadata allows database access.'
    Assert-True (-not $profile.writesLocalArtifacts) 'Remote status metadata allows local writes.'
    Assert-True (-not $profile.writesTrackedFiles) 'Remote status metadata allows tracked writes.'
    Assert-Equal $profile.authorizationRequirement 'none' 'Remote status should not require authorization.'
    $githubEscalation = @($entry[0].flagEscalations | Where-Object { $_.flag -eq '-GitHub' })
    Assert-Equal $githubEscalation.Count 1 'Explicit GitHub escalation missing.'
    Assert-Equal $githubEscalation[0].profile 'network-read-only' 'GitHub escalation profile mismatch.'
    Assert-True $policy.githubReadOnly.networkAccess 'GitHub provider network access must be declared.'
    Assert-True (-not $policy.githubReadOnly.databaseAccess) 'GitHub provider must not declare database access.'
    $deploymentEscalation = @($entry[0].flagEscalations | Where-Object { $_.flag -eq '-Deployment' })
    Assert-Equal $deploymentEscalation.Count 1 'Explicit Deployment escalation missing.'
    Assert-Equal $deploymentEscalation[0].profile 'network-read-only' 'Deployment escalation profile mismatch.'
    Assert-True $policy.vercelReadOnly.networkAccess 'Vercel provider network access must be declared.'
    Assert-True (-not $policy.vercelReadOnly.databaseAccess) 'Vercel provider must not declare database access.'
    Assert-True (-not $policy.vercelReadOnly.localArtifactWrites) 'Vercel provider must not declare local artifact writes.'
    Assert-True (-not $policy.vercelReadOnly.trackedFileWrites) 'Vercel provider must not declare tracked writes.'
    Assert-Equal $policy.vercelReadOnly.authorizationRequired 'explicit-scope' 'Vercel provider authorization metadata mismatch.'
}

Invoke-Test 'registry parses and covers committed command surfaces' {
    $result = Invoke-RegistryValidator
    $report = $result.Text | ConvertFrom-Json
    Assert-Equal $result.ExitCode 0 'Registry validator exit code mismatch.'
    Assert-True $report.success 'Registry validator should succeed.'
    Assert-Equal $report.packageScriptsRegistered $report.packageScripts 'Every package script must be registered.'
    Assert-Equal @($report.errors).Count 0 'Registry validator reported errors.'
    Assert-True ($report.commandsRegistered -ge $report.packageScripts) 'Registry command count is unexpectedly small.'
    Assert-Equal @($report.ignoredEntrypoints).Count 7 'Documented internal-entrypoint ignore count mismatch.'
    Assert-True $report.remoteIdentityContractValid 'Registry did not validate the remote identity contract.'
    Assert-True $report.remoteStatusRegistered 'Registry did not validate the remote status command.'
}

Write-Output "Tests run: $script:TestsRun"
Write-Output "Tests failed: $script:TestsFailed"
if ($script:TestsFailed -gt 0) { exit 1 }
exit 0
