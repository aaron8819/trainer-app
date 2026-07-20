Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-TrainerGitHubResult {
    param(
        [Parameter(Mandatory = $true)][object]$Expected,
        [Parameter(Mandatory = $true)][string]$BranchName
    )

    [pscustomobject][ordered]@{
        status = 'checked'
        freshness = 'live authenticated GitHub read'
        collectedAt = [DateTimeOffset]::UtcNow.ToString('o')
        authentication = [pscustomobject][ordered]@{
            status = 'not-checked'
            account = $null
        }
        identity = [pscustomobject][ordered]@{
            expected = [pscustomobject][ordered]@{
                owner = [string]$Expected.owner
                repository = [string]$Expected.repository
                defaultBranch = [string]$Expected.defaultBranch
            }
            observed = [pscustomobject][ordered]@{
                owner = $null
                repository = $null
                defaultBranch = $null
                repositoryId = $null
                repositoryNodeId = $null
            }
            match = $false
        }
        repository = [pscustomobject][ordered]@{
            id = $null
            nodeId = $null
            owner = $null
            name = $null
            fullName = $null
            visibility = 'unknown'
            defaultBranch = $null
        }
        branch = [pscustomobject][ordered]@{
            requested = $BranchName
            defaultBranch = [pscustomobject][ordered]@{ name = [string]$Expected.defaultBranch; sha = $null }
            local = [pscustomobject][ordered]@{ sha = $null; containedInDefaultBranch = $null; containmentStatus = 'not-checked' }
            remote = [pscustomobject][ordered]@{ exists = $null; sha = $null; comparisonToDefault = 'not-checked'; aheadBy = $null; behindBy = $null }
        }
        pullRequest = [pscustomobject][ordered]@{
            status = 'not-checked'
            found = $null
            number = $null
            state = $null
            draft = $null
            baseBranch = $null
            headBranch = $BranchName
            headSha = $null
            mergeability = 'unknown'
            mergeStateStatus = 'unknown'
            reviewDecision = 'unknown'
            requiredApprovals = $null
            unresolvedThreads = $null
            reviewThreadsComplete = $null
            url = $null
        }
        checks = [pscustomobject][ordered]@{
            status = 'not-checked'
            commitSha = $null
            statusRollup = 'unknown'
            checkRuns = [pscustomobject][ordered]@{ total = 0; successful = 0; failed = 0; pending = 0; cancelled = 0; skipped = 0; neutral = 0; other = 0 }
            statusContexts = [pscustomobject][ordered]@{ total = 0; successful = 0; failed = 0; pending = 0; other = 0 }
            failing = [object[]]@()
            pending = [object[]]@()
            requiredChecksResolution = 'not-checked'
            requiredChecks = [object[]]@()
            failingRequiredChecks = [object[]]@()
            pendingRequiredChecks = [object[]]@()
            allRequiredChecksPassed = $null
            workflows = [pscustomobject][ordered]@{ status = 'not-checked'; count = $null; names = [object[]]@() }
        }
        protection = [pscustomobject][ordered]@{
            status = 'not-checked'
            classicBranchProtection = 'not-checked'
            rulesets = [pscustomobject][ordered]@{ status = 'not-checked'; count = $null; names = [object[]]@() }
            requiredChecksResolution = 'not-checked'
            requiredChecks = [object[]]@()
            requiredApprovals = $null
        }
        deployments = [pscustomobject][ordered]@{
            status = 'not-checked'
            recordsPresent = $null
            count = $null
            records = [object[]]@()
            provesActiveVercelProduction = $false
        }
        evidence = [object[]]@()
        warnings = [object[]]@()
        blockers = [object[]]@()
    }
}

function Get-TrainerGitHubExecutable {
    foreach ($name in @('gh', 'gh.exe')) {
        $command = Get-Command $name -CommandType Application, ExternalScript -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $command) { return $command.Source }
    }
    $null
}

function Invoke-TrainerGh {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments
    )

    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $Executable @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }

    $text = @($output | ForEach-Object { [string]$_ })
    $joined = $text -join "`n"
    $httpStatus = $null
    if ($joined -match '(?i)(?:HTTP\s+|status(?: code)?\s*[:=]?\s*)(?<status>[1-5][0-9]{2})') {
        $httpStatus = [int]$Matches.status
    }
    elseif ($joined -match '(?i)\b(?<status>401|403|404|409|422|429)\b') {
        $httpStatus = [int]$Matches.status
    }

    [pscustomobject][ordered]@{
        exitCode = [int]$exitCode
        output = [object[]]$text
        text = $joined
        httpStatus = $httpStatus
    }
}

function ConvertFrom-TrainerGhJson {
    param(
        [Parameter(Mandatory = $true)][object]$Invocation,
        [Parameter(Mandatory = $true)][string]$Operation
    )

    if ($Invocation.exitCode -ne 0) { return $null }
    try {
        $Invocation.text | ConvertFrom-Json -Depth 100
    }
    catch {
        throw "GitHub returned invalid JSON for $Operation."
    }
}

function Add-TrainerGitHubEvidence {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$Evidence,
        [Parameter(Mandatory = $true)][string]$Operation,
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][object]$Invocation
    )

    $Evidence.Add([pscustomobject][ordered]@{
        operation = $Operation
        source = $Source
        freshness = 'live authenticated GitHub read'
        success = $Invocation.exitCode -eq 0
        exitCode = $Invocation.exitCode
        httpStatus = $Invocation.httpStatus
    })
}

function Invoke-TrainerGitHubApi {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string]$Endpoint,
        [Parameter(Mandatory = $true)][string]$Operation,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$Evidence
    )

    $invocation = Invoke-TrainerGh -Executable $Executable -Arguments @('api', '--method', 'GET', $Endpoint)
    Add-TrainerGitHubEvidence -Evidence $Evidence -Operation $Operation -Source "GET $Endpoint" -Invocation $invocation
    [pscustomobject][ordered]@{
        invocation = $invocation
        data = ConvertFrom-TrainerGhJson -Invocation $invocation -Operation $Operation
    }
}

function Invoke-TrainerGitHubPagedApi {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string]$Endpoint,
        [Parameter(Mandatory = $true)][string]$Operation,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$Evidence,
        [AllowNull()][string]$CollectionProperty
    )

    $items = [System.Collections.Generic.List[object]]::new()
    $page = 1
    do {
        $separator = if ($Endpoint.Contains('?')) { '&' } else { '?' }
        $pageEndpoint = "$Endpoint${separator}per_page=100&page=$page"
        $response = Invoke-TrainerGitHubApi -Executable $Executable -Endpoint $pageEndpoint -Operation "$Operation page $page" -Evidence $Evidence
        if ($response.invocation.exitCode -ne 0) {
            return [pscustomobject][ordered]@{ success = $false; invocation = $response.invocation; items = [object[]]$items.ToArray() }
        }
        [object[]]$pageItems = if ([string]::IsNullOrWhiteSpace($CollectionProperty)) {
            @($response.data)
        }
        else {
            @($response.data.$CollectionProperty)
        }
        foreach ($item in $pageItems) { $items.Add($item) }
        $page++
    } while (@($pageItems).Count -eq 100)

    [pscustomobject][ordered]@{ success = $true; invocation = $null; items = [object[]]$items.ToArray() }
}

function Invoke-TrainerGitHubReviewQuery {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string]$Owner,
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][int]$Number,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$Evidence
    )

    $query = @'
query TrainerPullRequestReviewStatus($owner: String!, $repository: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repository) {
    pullRequest(number: $number) {
      isDraft
      mergeable
      mergeStateStatus
      reviewDecision
      reviewThreads(first: 100, after: $cursor) {
        nodes { isResolved }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
'@
    $threads = [System.Collections.Generic.List[object]]::new()
    $cursor = $null
    $pullRequest = $null
    $complete = $true
    $graphqlErrors = [System.Collections.Generic.List[object]]::new()
    do {
        $arguments = @(
            'api', 'graphql',
            '-f', "query=$query",
            '-F', "owner=$Owner",
            '-F', "repository=$Repository",
            '-F', "number=$Number"
        )
        if ($null -ne $cursor) { $arguments += @('-F', "cursor=$cursor") }
        $invocation = Invoke-TrainerGh -Executable $Executable -Arguments $arguments
        Add-TrainerGitHubEvidence -Evidence $Evidence -Operation 'pull request review threads' -Source 'GraphQL query TrainerPullRequestReviewStatus' -Invocation $invocation
        if ($invocation.exitCode -ne 0) {
            return [pscustomobject][ordered]@{ success = $false; complete = $false; invocation = $invocation; pullRequest = $pullRequest; threads = [object[]]$threads.ToArray(); errors = [object[]]@() }
        }
        $data = ConvertFrom-TrainerGhJson -Invocation $invocation -Operation 'pull request review threads'
        if ($data.PSObject.Properties.Name -contains 'errors') {
            foreach ($graphqlError in @($data.errors)) {
                if ($null -ne $graphqlError) { $graphqlErrors.Add($graphqlError) }
            }
        }
        if ($graphqlErrors.Count -gt 0) { $complete = $false }
        if ($null -ne $data.data.repository.pullRequest) {
            $pullRequest = $data.data.repository.pullRequest
            foreach ($thread in @($pullRequest.reviewThreads.nodes)) { $threads.Add($thread) }
            $cursor = if ($pullRequest.reviewThreads.pageInfo.hasNextPage) { [string]$pullRequest.reviewThreads.pageInfo.endCursor } else { $null }
        }
        else {
            $cursor = $null
            $complete = $false
        }
    } while ($null -ne $cursor)

    [pscustomobject][ordered]@{
        success = $null -ne $pullRequest
        complete = $complete
        invocation = $null
        pullRequest = $pullRequest
        threads = [object[]]$threads.ToArray()
        errors = [object[]]$graphqlErrors.ToArray()
    }
}

function Get-TrainerCheckRunCounts {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Runs)

    $counts = [ordered]@{ total = $Runs.Count; successful = 0; failed = 0; pending = 0; cancelled = 0; skipped = 0; neutral = 0; other = 0 }
    foreach ($run in $Runs) {
        $status = [string]$run.status
        $conclusion = [string]$run.conclusion
        if ($status -ne 'completed' -or [string]::IsNullOrWhiteSpace($conclusion)) { $counts.pending++; continue }
        switch ($conclusion.ToLowerInvariant()) {
            'success' { $counts.successful++ }
            { $_ -in @('failure', 'timed_out', 'action_required', 'startup_failure', 'stale') } { $counts.failed++ }
            'cancelled' { $counts.cancelled++ }
            'skipped' { $counts.skipped++ }
            'neutral' { $counts.neutral++ }
            default { $counts.other++ }
        }
    }
    [pscustomobject]$counts
}

function Get-TrainerStatusContextCounts {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Statuses)

    $counts = [ordered]@{ total = $Statuses.Count; successful = 0; failed = 0; pending = 0; other = 0 }
    foreach ($status in $Statuses) {
        switch (([string]$status.state).ToLowerInvariant()) {
            'success' { $counts.successful++ }
            { $_ -in @('failure', 'error') } { $counts.failed++ }
            'pending' { $counts.pending++ }
            default { $counts.other++ }
        }
    }
    [pscustomobject]$counts
}

function Invoke-TrainerGitHubStatus {
    param(
        [Parameter(Mandatory = $true)][object]$Expected,
        [Parameter(Mandatory = $true)][string]$LocalHead,
        [Parameter(Mandatory = $true)][string]$BranchName
    )

    $result = New-TrainerGitHubResult -Expected $Expected -BranchName $BranchName
    $warnings = [System.Collections.Generic.List[string]]::new()
    $blockers = [System.Collections.Generic.List[string]]::new()
    $evidence = [System.Collections.Generic.List[object]]::new()
    $result.branch.local.sha = $LocalHead

    $gh = Get-TrainerGitHubExecutable
    if ($null -eq $gh) {
        $result.authentication.status = 'tool-missing'
        $blockers.Add('GitHub CLI is unavailable; authenticated GitHub status was not collected.')
        $result.evidence = [object[]]$evidence.ToArray()
        $result.warnings = [object[]]$warnings.ToArray()
        $result.blockers = [object[]]$blockers.ToArray()
        return $result
    }

    $auth = Invoke-TrainerGh -Executable $gh -Arguments @('auth', 'status', '--hostname', 'github.com', '--active')
    Add-TrainerGitHubEvidence -Evidence $evidence -Operation 'authentication status' -Source 'gh auth status --hostname github.com --active' -Invocation $auth
    if ($auth.exitCode -ne 0) {
        $result.authentication.status = 'not-authenticated'
        $blockers.Add('GitHub CLI is not authenticated for an active github.com account. No login or account change was attempted.')
        $result.evidence = [object[]]$evidence.ToArray()
        $result.warnings = [object[]]$warnings.ToArray()
        $result.blockers = [object[]]$blockers.ToArray()
        return $result
    }

    $userResponse = Invoke-TrainerGitHubApi -Executable $gh -Endpoint '/user' -Operation 'authenticated account' -Evidence $evidence
    if ($userResponse.invocation.exitCode -ne 0 -or $null -eq $userResponse.data.login) {
        $result.authentication.status = if ($userResponse.invocation.httpStatus -in @(401, 403)) { 'insufficient-access' } else { 'not-authenticated' }
        $blockers.Add('The authenticated GitHub account could not be resolved reliably.')
        $result.evidence = [object[]]$evidence.ToArray()
        $result.warnings = [object[]]$warnings.ToArray()
        $result.blockers = [object[]]$blockers.ToArray()
        return $result
    }
    $account = [string]$userResponse.data.login
    $result.authentication.account = $account
    if ($account -ine [string]$Expected.owner) {
        $result.authentication.status = 'wrong-account'
        $blockers.Add("Authenticated GitHub account does not match expected repository owner '$($Expected.owner)'. No account switch was attempted.")
        $result.evidence = [object[]]$evidence.ToArray()
        $result.warnings = [object[]]$warnings.ToArray()
        $result.blockers = [object[]]$blockers.ToArray()
        return $result
    }
    $result.authentication.status = 'authenticated'

    $owner = [uri]::EscapeDataString([string]$Expected.owner)
    $repository = [uri]::EscapeDataString([string]$Expected.repository)
    $repositoryResponse = Invoke-TrainerGitHubApi -Executable $gh -Endpoint "/repos/$owner/$repository" -Operation 'repository identity' -Evidence $evidence
    if ($repositoryResponse.invocation.exitCode -ne 0) {
        $result.authentication.status = if ($repositoryResponse.invocation.httpStatus -in @(403, 404)) { 'insufficient-access' } else { 'authenticated' }
        $blockers.Add('The authenticated account could not access the expected GitHub repository reliably.')
        $result.evidence = [object[]]$evidence.ToArray()
        $result.warnings = [object[]]$warnings.ToArray()
        $result.blockers = [object[]]$blockers.ToArray()
        return $result
    }
    $observed = $repositoryResponse.data
    $observedOwner = [string]$observed.owner.login
    $observedRepository = [string]$observed.name
    $observedDefaultBranch = [string]$observed.default_branch
    $result.identity.observed.owner = $observedOwner
    $result.identity.observed.repository = $observedRepository
    $result.identity.observed.defaultBranch = $observedDefaultBranch
    $result.identity.observed.repositoryId = $observed.id
    $result.identity.observed.repositoryNodeId = $observed.node_id
    $result.repository.id = $observed.id
    $result.repository.nodeId = $observed.node_id
    $result.repository.owner = $observedOwner
    $result.repository.name = $observedRepository
    $result.repository.fullName = [string]$observed.full_name
    $result.repository.visibility = if ($null -ne $observed.visibility) { [string]$observed.visibility } elseif ($observed.private) { 'private' } else { 'public' }
    $result.repository.defaultBranch = $observedDefaultBranch

    if ($observedOwner -ine [string]$Expected.owner) { $blockers.Add('Observed GitHub repository owner differs from committed expected identity.') }
    if ($observedRepository -ine [string]$Expected.repository) { $blockers.Add('Observed GitHub repository name differs from committed expected identity.') }
    if ($observedDefaultBranch -cne [string]$Expected.defaultBranch) { $blockers.Add('Observed GitHub default branch differs from committed expected policy.') }
    $result.identity.match = $blockers.Count -eq 0
    if (-not $result.identity.match) {
        $result.evidence = [object[]]$evidence.ToArray()
        $result.warnings = [object[]]$warnings.ToArray()
        $result.blockers = [object[]]$blockers.ToArray()
        return $result
    }

    $defaultEncoded = [uri]::EscapeDataString([string]$Expected.defaultBranch)
    $defaultResponse = Invoke-TrainerGitHubApi -Executable $gh -Endpoint "/repos/$owner/$repository/branches/$defaultEncoded" -Operation 'default branch' -Evidence $evidence
    if ($defaultResponse.invocation.exitCode -ne 0 -or $null -eq $defaultResponse.data.commit.sha) {
        $blockers.Add('The live default-branch head could not be retrieved reliably.')
        $result.evidence = [object[]]$evidence.ToArray()
        $result.warnings = [object[]]$warnings.ToArray()
        $result.blockers = [object[]]$blockers.ToArray()
        return $result
    }
    $defaultSha = [string]$defaultResponse.data.commit.sha
    $result.branch.defaultBranch.sha = $defaultSha
    $containment = Invoke-TrainerGitHubApi -Executable $gh -Endpoint "/repos/$owner/$repository/compare/$LocalHead...$defaultSha" -Operation 'local commit containment' -Evidence $evidence
    if ($containment.invocation.exitCode -eq 0) {
        $result.branch.local.containmentStatus = [string]$containment.data.status
        $result.branch.local.containedInDefaultBranch = [string]$containment.data.status -in @('ahead', 'identical')
    }
    elseif ($containment.invocation.httpStatus -eq 404) {
        $result.branch.local.containmentStatus = 'not-remotely-addressable'
        $warnings.Add('The locally inspected commit is not remotely addressable by GitHub; containment was not evaluated. This is expected for an unpushed candidate.')
    }
    else {
        $result.branch.local.containmentStatus = 'unavailable'
        $blockers.Add('Containment of the locally inspected commit in the live default branch could not be established.')
    }

    $branchEncoded = [uri]::EscapeDataString($BranchName)
    $branchResponse = Invoke-TrainerGitHubApi -Executable $gh -Endpoint "/repos/$owner/$repository/branches/$branchEncoded" -Operation 'task branch' -Evidence $evidence
    if ($branchResponse.invocation.exitCode -eq 0) {
        $result.branch.remote.exists = $true
        $result.branch.remote.sha = [string]$branchResponse.data.commit.sha
        $branchComparison = Invoke-TrainerGitHubApi -Executable $gh -Endpoint "/repos/$owner/$repository/compare/$defaultSha...$($result.branch.remote.sha)" -Operation 'task branch divergence' -Evidence $evidence
        if ($branchComparison.invocation.exitCode -eq 0) {
            $result.branch.remote.comparisonToDefault = [string]$branchComparison.data.status
            $result.branch.remote.aheadBy = $branchComparison.data.ahead_by
            $result.branch.remote.behindBy = $branchComparison.data.behind_by
        }
        else {
            $result.branch.remote.comparisonToDefault = 'unavailable'
            $warnings.Add('Remote task-branch divergence could not be retrieved.')
        }
    }
    elseif ($branchResponse.invocation.httpStatus -eq 404) {
        $result.branch.remote.exists = $false
        $result.branch.remote.comparisonToDefault = 'branch-absent'
    }
    else {
        $result.branch.remote.exists = $null
        $result.branch.remote.comparisonToDefault = 'unavailable'
        $blockers.Add('Remote task-branch existence could not be determined reliably.')
    }

    $headQuery = [uri]::EscapeDataString("$($Expected.owner):$BranchName")
    $pulls = Invoke-TrainerGitHubPagedApi -Executable $gh -Endpoint "/repos/$owner/$repository/pulls?state=all&head=$headQuery" -Operation 'pull requests' -Evidence $evidence
    if (-not $pulls.success) {
        $result.pullRequest.status = 'unavailable'
        $warnings.Add('Pull-request state is unavailable.')
    }
    else {
        [object[]]$matchingPulls = @($pulls.items | Where-Object {
            $null -ne $_.head -and $null -ne $_.head.repo -and
            $_.head.ref -ceq $BranchName -and
            $_.head.repo.full_name -ieq "$($Expected.owner)/$($Expected.repository)"
        })
        [object[]]$openPulls = @($matchingPulls | Where-Object { $_.state -eq 'open' })
        if (@($openPulls).Count -gt 1) {
            $result.pullRequest.status = 'ambiguous'
            $blockers.Add('Multiple open pull requests resolve to the requested branch.')
        }
        elseif (@($matchingPulls).Count -eq 0) {
            $result.pullRequest.status = 'absent'
            $result.pullRequest.found = $false
        }
        else {
            $pull = if (@($openPulls).Count -eq 1) { $openPulls[0] } else { $matchingPulls[0] }
            $result.pullRequest.status = 'found'
            $result.pullRequest.found = $true
            $result.pullRequest.number = [int]$pull.number
            $result.pullRequest.state = [string]$pull.state
            $result.pullRequest.draft = [bool]$pull.draft
            $result.pullRequest.baseBranch = [string]$pull.base.ref
            $result.pullRequest.headBranch = [string]$pull.head.ref
            $result.pullRequest.headSha = [string]$pull.head.sha
            if ([string]$pull.html_url -match '^https://github\.com/') { $result.pullRequest.url = [string]$pull.html_url }
            $review = Invoke-TrainerGitHubReviewQuery -Executable $gh -Owner ([string]$Expected.owner) -Repository ([string]$Expected.repository) -Number ([int]$pull.number) -Evidence $evidence
            if ($review.success) {
                $result.pullRequest.draft = [bool]$review.pullRequest.isDraft
                $result.pullRequest.mergeability = ([string]$review.pullRequest.mergeable).ToLowerInvariant()
                $result.pullRequest.mergeStateStatus = ([string]$review.pullRequest.mergeStateStatus).ToLowerInvariant()
                $result.pullRequest.reviewDecision = if ($null -eq $review.pullRequest.reviewDecision) { 'none' } else { ([string]$review.pullRequest.reviewDecision).ToLowerInvariant() }
                $result.pullRequest.unresolvedThreads = @($review.threads | Where-Object { -not $_.isResolved }).Count
                $result.pullRequest.reviewThreadsComplete = [bool]$review.complete
                if (-not $review.complete) { $warnings.Add("Pull-request review-thread data is partial because GitHub returned GraphQL errors (errorCount=$(@($review.errors).Count)).") }
            }
            else {
                $result.pullRequest.reviewThreadsComplete = $false
                $warnings.Add('Pull-request review and unresolved-thread state is unavailable.')
            }
        }
    }

    $workflows = Invoke-TrainerGitHubPagedApi -Executable $gh -Endpoint "/repos/$owner/$repository/actions/workflows" -Operation 'Actions workflows' -Evidence $evidence -CollectionProperty 'workflows'
    if ($workflows.success) {
        $result.checks.workflows.status = 'available'
        $result.checks.workflows.count = $workflows.items.Count
        $result.checks.workflows.names = [object[]]@($workflows.items | ForEach-Object { [string]$_.name } | Sort-Object -Unique)
    }
    else {
        $result.checks.workflows.status = 'unavailable'
        $blockers.Add('Committed GitHub Actions workflow inventory could not be retrieved.')
    }

    $statuses = Invoke-TrainerGitHubPagedApi -Executable $gh -Endpoint "/repos/$owner/$repository/commits/$defaultSha/statuses" -Operation 'commit statuses' -Evidence $evidence
    $checkRuns = Invoke-TrainerGitHubPagedApi -Executable $gh -Endpoint "/repos/$owner/$repository/commits/$defaultSha/check-runs" -Operation 'check runs' -Evidence $evidence -CollectionProperty 'check_runs'
    if (-not $statuses.success -or -not $checkRuns.success) {
        $result.checks.status = 'unavailable'
        $blockers.Add('Commit checks and status rollup could not be retrieved reliably.')
    }
    else {
        $result.checks.commitSha = $defaultSha
        $result.checks.checkRuns = Get-TrainerCheckRunCounts -Runs @($checkRuns.items)
        $result.checks.statusContexts = Get-TrainerStatusContextCounts -Statuses @($statuses.items)
        $failingRuns = @($checkRuns.items | Where-Object { $_.conclusion -in @('failure', 'timed_out', 'action_required', 'startup_failure', 'stale', 'cancelled') } | ForEach-Object { [string]$_.name })
        $pendingRuns = @($checkRuns.items | Where-Object { $_.status -ne 'completed' -or [string]::IsNullOrWhiteSpace([string]$_.conclusion) } | ForEach-Object { [string]$_.name })
        $failingStatuses = @($statuses.items | Where-Object { $_.state -in @('failure', 'error') } | ForEach-Object { [string]$_.context })
        $pendingStatuses = @($statuses.items | Where-Object { $_.state -eq 'pending' } | ForEach-Object { [string]$_.context })
        $result.checks.failing = [object[]]@($failingRuns + $failingStatuses | Sort-Object -Unique)
        $result.checks.pending = [object[]]@($pendingRuns + $pendingStatuses | Sort-Object -Unique)
        $result.checks.statusRollup = if ($result.checks.failing.Count -gt 0) {
            'failed'
        }
        elseif ($result.checks.pending.Count -gt 0) {
            'pending'
        }
        elseif (($result.checks.checkRuns.total + $result.checks.statusContexts.total) -gt 0) {
            'passed'
        }
        elseif ($result.checks.workflows.status -eq 'available' -and $result.checks.workflows.count -eq 0) {
            'no-checks-configured'
        }
        else {
            'checks-not-run'
        }
        $result.checks.status = $result.checks.statusRollup
        if ($result.checks.statusRollup -eq 'failed') { $blockers.Add('One or more checks on the live default-branch head are failing.') }
    }

    $protection = Invoke-TrainerGitHubApi -Executable $gh -Endpoint "/repos/$owner/$repository/branches/$defaultEncoded/protection" -Operation 'branch protection' -Evidence $evidence
    if ($protection.invocation.exitCode -eq 0) {
        $result.protection.classicBranchProtection = 'available'
        $requiredChecks = if ($protection.data.PSObject.Properties.Name -contains 'required_status_checks' -and
            $null -ne $protection.data.required_status_checks -and
            $protection.data.required_status_checks.PSObject.Properties.Name -contains 'contexts') {
            @($protection.data.required_status_checks.contexts | ForEach-Object { [string]$_ })
        }
        else {
            @()
        }
        $result.protection.requiredChecksResolution = 'available'
        $result.protection.requiredChecks = [object[]]@($requiredChecks | Sort-Object -Unique)
        if ($protection.data.PSObject.Properties.Name -contains 'required_pull_request_reviews' -and
            $null -ne $protection.data.required_pull_request_reviews -and
            $protection.data.required_pull_request_reviews.PSObject.Properties.Name -contains 'required_approving_review_count' -and
            $null -ne $protection.data.required_pull_request_reviews.required_approving_review_count) {
            $result.protection.requiredApprovals = [int]$protection.data.required_pull_request_reviews.required_approving_review_count
            $result.pullRequest.requiredApprovals = $result.protection.requiredApprovals
        }
    }
    else {
        $result.protection.classicBranchProtection = 'unavailable'
        $result.protection.requiredChecksResolution = 'unavailable'
        $warnings.Add('Classic branch-protection requirements are unavailable or not configured; required-check success is not claimed.')
    }
    $rulesets = Invoke-TrainerGitHubPagedApi -Executable $gh -Endpoint "/repos/$owner/$repository/rulesets?includes_parents=true&targets=branch" -Operation 'repository rulesets' -Evidence $evidence
    if ($rulesets.success) {
        $result.protection.rulesets.status = 'available'
        $result.protection.rulesets.count = $rulesets.items.Count
        $result.protection.rulesets.names = [object[]]@($rulesets.items | ForEach-Object { [string]$_.name } | Sort-Object -Unique)
    }
    else {
        $result.protection.rulesets.status = 'unavailable'
        $warnings.Add('Repository rulesets are unavailable with the current permissions.')
    }
    if ($result.protection.classicBranchProtection -eq 'available' -and
        ($result.protection.rulesets.status -ne 'available' -or $result.protection.rulesets.count -gt 0)) {
        $result.protection.requiredChecksResolution = 'unavailable'
        $warnings.Add('Required checks cannot be resolved completely because applicable ruleset details were not collected.')
    }
    $result.protection.status = if ($result.protection.classicBranchProtection -eq 'available' -and $result.protection.rulesets.status -eq 'available') { 'available' } elseif ($result.protection.classicBranchProtection -eq 'available' -or $result.protection.rulesets.status -eq 'available') { 'partial' } else { 'unavailable' }
    $result.checks.requiredChecksResolution = $result.protection.requiredChecksResolution
    $result.checks.requiredChecks = [object[]]@($result.protection.requiredChecks)
    if ($result.protection.requiredChecksResolution -eq 'available') {
        $result.checks.failingRequiredChecks = [object[]]@($result.checks.failing | Where-Object { $_ -in $result.protection.requiredChecks })
        $result.checks.pendingRequiredChecks = [object[]]@($result.checks.pending | Where-Object { $_ -in $result.protection.requiredChecks })
        $observedNames = @($checkRuns.items | ForEach-Object { [string]$_.name }) +
            @($statuses.items | ForEach-Object { [string]$_.context })
        $missingRequired = @($result.protection.requiredChecks | Where-Object { $_ -notin $observedNames })
        $result.checks.allRequiredChecksPassed = $result.checks.failingRequiredChecks.Count -eq 0 -and $result.checks.pendingRequiredChecks.Count -eq 0 -and $missingRequired.Count -eq 0
    }

    $deployments = Invoke-TrainerGitHubPagedApi -Executable $gh -Endpoint "/repos/$owner/$repository/deployments?sha=$defaultSha" -Operation 'GitHub deployments' -Evidence $evidence
    if ($deployments.success) {
        $records = [System.Collections.Generic.List[object]]::new()
        foreach ($deployment in @($deployments.items)) {
            $statusesResponse = Invoke-TrainerGitHubPagedApi -Executable $gh -Endpoint "/repos/$owner/$repository/deployments/$($deployment.id)/statuses" -Operation "deployment $($deployment.id) statuses" -Evidence $evidence
            $latest = if ($statusesResponse.success -and $statusesResponse.items.Count -gt 0) { $statusesResponse.items[0] } else { $null }
            $records.Add([pscustomobject][ordered]@{
                id = $deployment.id
                environment = [string]$deployment.environment
                sha = [string]$deployment.sha
                state = if ($null -eq $latest) { 'unknown' } else { [string]$latest.state }
                latestStatus = if ($null -eq $latest) { $null } else { [string]$latest.state }
            })
            if (-not $statusesResponse.success) { $warnings.Add("Statuses for GitHub deployment $($deployment.id) are unavailable.") }
        }
        $result.deployments.status = 'available'
        $result.deployments.recordsPresent = $records.Count -gt 0
        $result.deployments.count = $records.Count
        $result.deployments.records = [object[]]$records.ToArray()
    }
    else {
        $result.deployments.status = 'unavailable'
        $warnings.Add('GitHub deployment records are unavailable.')
    }

    $result.evidence = [object[]]$evidence.ToArray()
    $result.warnings = [object[]]$warnings.ToArray()
    $result.blockers = [object[]]$blockers.ToArray()
    $result
}

Export-ModuleMember -Function Invoke-TrainerGitHubStatus
