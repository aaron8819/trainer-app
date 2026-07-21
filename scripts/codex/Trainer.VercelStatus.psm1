Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Trainer.Tooling.psm1')

$script:VercelApiOrigin = 'https://api.vercel.com'
$script:VercelApiHost = 'api.vercel.com'
$script:VercelTimeoutSeconds = 20
$script:VercelUserAgent = 'trainer-remote-status/1 (read-only)'

function Get-TrainerVercelProperty {
    param([AllowNull()]$Object, [Parameter(Mandatory = $true)][string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    $property.Value
}

function Get-TrainerVercelPath {
    param([AllowNull()]$Object, [Parameter(Mandatory = $true)][string[]]$Names)
    $value = $Object
    foreach ($name in $Names) {
        $value = Get-TrainerVercelProperty -Object $value -Name $name
        if ($null -eq $value) { return $null }
    }
    $value
}

function ConvertTo-TrainerVercelHostname {
    param([AllowNull()]$Value)
    if ($null -eq $Value) { return $null }
    $text = ([string]$Value).Trim()
    if ($text -cmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$') {
        return $text
    }
    $uri = $null
    if ([uri]::TryCreate($text, [System.UriKind]::Absolute, [ref]$uri) -and
        $uri.Scheme -ceq 'https' -and [string]::IsNullOrEmpty($uri.UserInfo) -and
        $uri.AbsolutePath -ceq '/' -and [string]::IsNullOrEmpty($uri.Query) -and
        [string]::IsNullOrEmpty($uri.Fragment)) {
        return $uri.Host.ToLowerInvariant()
    }
    $null
}

function ConvertTo-TrainerVercelSafeText {
    param([AllowNull()]$Value, [string]$Pattern = '^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,199}$')
    if ($null -eq $Value) { return $null }
    $text = ([string]$Value).Trim()
    if ($text -cmatch $Pattern) { return $text }
    '[unsafe-redacted]'
}

function ConvertTo-TrainerVercelTimestamp {
    param([AllowNull()]$Value)
    if ($null -eq $Value) { return $null }
    $milliseconds = 0L
    if ([long]::TryParse([string]$Value, [ref]$milliseconds)) {
        try { return [DateTimeOffset]::FromUnixTimeMilliseconds($milliseconds).ToString('o') } catch { return $null }
    }
    $parsed = [DateTimeOffset]::MinValue
    if ([DateTimeOffset]::TryParse([string]$Value, [ref]$parsed)) { return $parsed.ToUniversalTime().ToString('o') }
    $null
}

function Get-TrainerVercelEndpointDefinition {
    param(
        [Parameter(Mandatory = $true)][object[]]$EndpointRegistry,
        [Parameter(Mandatory = $true)][string]$EndpointId
    )
    $matches = @($EndpointRegistry | Where-Object { [string]$_.id -ceq $EndpointId })
    if ($matches.Count -ne 1) {
        throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' is not registered exactly once.")
    }
    $definition = $matches[0]
    if ([string]$definition.method -cne 'GET' -or [string]$definition.host -cne $script:VercelApiHost -or
        [string]$definition.pathTemplate -cnotmatch '^/v[0-9]+/[A-Za-z0-9{}._/-]+$' -or
        [string]$definition.pathTemplate -match '(?:\.\.|\\|\?|#|@)' -or
        [string]$definition.expectedResponseType -cne 'json-object' -or
        [string]$definition.scope -notin @('user', 'team', 'project', 'deployment')) {
        throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' violates the read-only endpoint policy.")
    }
    $definition
}

function New-TrainerVercelRequest {
    param(
        [Parameter(Mandatory = $true)][object[]]$EndpointRegistry,
        [Parameter(Mandatory = $true)][string]$EndpointId,
        [hashtable]$PathParameters = @{},
        [hashtable]$QueryParameters = @{}
    )
    $definition = Get-TrainerVercelEndpointDefinition -EndpointRegistry $EndpointRegistry -EndpointId $EndpointId
    $path = [string]$definition.pathTemplate
    $placeholders = @([regex]::Matches($path, '\{([A-Za-z][A-Za-z0-9]*)\}') | ForEach-Object { $_.Groups[1].Value })
    foreach ($key in @($PathParameters.Keys)) {
        if ([string]$key -notin $placeholders) {
            throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' rejected an undeclared path parameter.")
        }
    }
    foreach ($placeholder in $placeholders) {
        if (-not $PathParameters.ContainsKey($placeholder) -or [string]::IsNullOrWhiteSpace([string]$PathParameters[$placeholder])) {
            throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' is missing a required path parameter.")
        }
        $path = $path.Replace("{$placeholder}", [uri]::EscapeDataString([string]$PathParameters[$placeholder]))
    }
    if ($path -match '[{}]' -or $path -notmatch '^/v[0-9]+/' -or $path -match '(?:\.\.|\\|\?|#|@)') {
        throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' produced an unsafe path.")
    }

    $allowedQueryKeys = @($definition.allowedQueryKeys | ForEach-Object { [string]$_ })
    foreach ($key in @($QueryParameters.Keys)) {
        if ([string]$key -notin $allowedQueryKeys) {
            throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' rejected an undeclared query parameter.")
        }
    }
    $queryParts = [System.Collections.Generic.List[string]]::new()
    foreach ($key in $allowedQueryKeys) {
        if ($QueryParameters.ContainsKey($key) -and $null -ne $QueryParameters[$key] -and
            -not [string]::IsNullOrWhiteSpace([string]$QueryParameters[$key])) {
            $queryParts.Add("$([uri]::EscapeDataString($key))=$([uri]::EscapeDataString([string]$QueryParameters[$key]))")
        }
    }
    if ([bool]$definition.teamIdRequired -and -not ($PathParameters.ContainsKey('teamId') -or $QueryParameters.ContainsKey('teamId'))) {
        throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' requires team identity.")
    }
    if ([bool]$definition.projectIdRequired -and -not ($PathParameters.ContainsKey('projectId') -or $QueryParameters.ContainsKey('projectId'))) {
        throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' requires project identity.")
    }

    $builder = [System.UriBuilder]::new($script:VercelApiOrigin)
    $builder.Path = $path
    $builder.Query = $queryParts -join '&'
    $uri = $builder.Uri
    if ($uri.Scheme -cne 'https' -or $uri.Host -cne $script:VercelApiHost -or
        -not [string]::IsNullOrEmpty($uri.UserInfo) -or $uri.Port -ne 443 -or
        -not [string]::IsNullOrEmpty($uri.Fragment)) {
        throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' produced an unsafe URI.")
    }
    [pscustomobject][ordered]@{
        endpointId = $EndpointId
        method = 'GET'
        uri = $uri
        timeoutSeconds = $script:VercelTimeoutSeconds
        userAgent = $script:VercelUserAgent
        expectedResponseType = [string]$definition.expectedResponseType
    }
}

function Invoke-TrainerVercelPowerShellRequest {
    param(
        [Parameter(Mandatory = $true)][object]$Request,
        [Parameter(Mandatory = $true)][string]$Token
    )
    try {
        $response = Invoke-WebRequest `
            -Uri $Request.uri `
            -Method Get `
            -Headers @{ Authorization = "Bearer $Token"; Accept = 'application/json' } `
            -UserAgent $Request.userAgent `
            -TimeoutSec $Request.timeoutSeconds `
            -MaximumRedirection 0 `
            -SkipHttpErrorCheck `
            -ErrorAction Stop
        [pscustomobject][ordered]@{
            statusCode = [int]$response.StatusCode
            contentType = [string]$response.Headers['Content-Type']
            jsonText = [string]$response.Content
            redirectLocation = [string]$response.Headers['Location']
            timedOut = $false
            transportError = $false
        }
    }
    catch {
        $statusCode = 0
        if ($null -ne $_.Exception.Response -and $null -ne $_.Exception.Response.StatusCode) {
            try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { $statusCode = 0 }
        }
        [pscustomobject][ordered]@{
            statusCode = $statusCode
            contentType = $null
            jsonText = $null
            redirectLocation = $null
            timedOut = $_.Exception -is [System.TimeoutException] -or $_.Exception.InnerException -is [System.TimeoutException]
            transportError = $true
        }
    }
}

function Add-TrainerVercelEvidence {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$Evidence,
        [Parameter(Mandatory = $true)][object]$Request,
        [Parameter(Mandatory = $true)][object]$Response,
        [Parameter(Mandatory = $true)][string]$RequestedAt
    )
    $Evidence.Add([pscustomobject][ordered]@{
        endpointId = $Request.endpointId
        method = 'GET'
        requestedAt = $RequestedAt
        httpStatus = [int]$Response.statusCode
        succeeded = [int]$Response.statusCode -ge 200 -and [int]$Response.statusCode -lt 300
        responseBodyReported = $false
    })
}

function Invoke-TrainerVercelApi {
    param(
        [Parameter(Mandatory = $true)][object[]]$EndpointRegistry,
        [Parameter(Mandatory = $true)][string]$EndpointId,
        [Parameter(Mandatory = $true)][string]$Token,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$Evidence,
        [hashtable]$PathParameters = @{},
        [hashtable]$QueryParameters = @{},
        [AllowNull()][scriptblock]$RequestInvoker
    )
    $request = New-TrainerVercelRequest -EndpointRegistry $EndpointRegistry -EndpointId $EndpointId -PathParameters $PathParameters -QueryParameters $QueryParameters
    $requestedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $headers = @{ Authorization = "Bearer $Token"; Accept = 'application/json' }
    $response = if ($null -ne $RequestInvoker) {
        & $RequestInvoker $request $headers
    }
    else {
        Invoke-TrainerVercelPowerShellRequest -Request $request -Token $Token
    }
    if ($null -eq $response -or $null -eq (Get-TrainerVercelProperty -Object $response -Name 'statusCode')) {
        throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' returned an invalid transport result.")
    }
    Add-TrainerVercelEvidence -Evidence $Evidence -Request $request -Response $response -RequestedAt $requestedAt
    $statusCode = [int]$response.statusCode
    if ($statusCode -ge 300 -and $statusCode -lt 400) {
        throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' returned a redirect, which is forbidden.")
    }
    if ([bool](Get-TrainerVercelProperty -Object $response -Name 'timedOut')) {
        throw [System.TimeoutException]::new("Vercel endpoint '$EndpointId' timed out.")
    }
    if ([bool](Get-TrainerVercelProperty -Object $response -Name 'transportError') -and $statusCode -eq 0) {
        throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' failed before an HTTP response was received.")
    }
    if ($statusCode -eq 429 -or $statusCode -ge 500) {
        throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' returned a transient provider failure (HTTP $statusCode).")
    }
    if ($statusCode -lt 200 -or $statusCode -ge 300) {
        return [pscustomobject][ordered]@{ succeeded = $false; statusCode = $statusCode; data = $null }
    }
    $data = Get-TrainerVercelProperty -Object $response -Name 'data'
    if ($null -eq $data) {
        $contentType = [string](Get-TrainerVercelProperty -Object $response -Name 'contentType')
        if ($contentType -notmatch '(?i)^application/(?:[A-Za-z0-9.+-]*\+)?json(?:\s*;|$)') {
            throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' did not return JSON.")
        }
        try { $data = [string]$response.jsonText | ConvertFrom-Json -Depth 100 }
        catch { throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' returned invalid JSON.") }
    }
    if ($null -eq $data -or $data -is [string] -or $data -is [System.Array]) {
        throw [System.InvalidOperationException]::new("Vercel endpoint '$EndpointId' returned an unexpected response type.")
    }
    [pscustomobject][ordered]@{ succeeded = $true; statusCode = $statusCode; data = $data }
}

function New-TrainerVercelResult {
    param([Parameter(Mandatory = $true)][object]$Expected, [Parameter(Mandatory = $true)][object]$LocalLinkage)
    [pscustomobject][ordered]@{
        status = 'checked'
        freshness = 'live authenticated Vercel REST API read'
        collectedAt = [DateTimeOffset]::UtcNow.ToString('o')
        networkAccessed = $false
        authentication = [pscustomobject][ordered]@{
            status = 'not-checked'
            account = $null
            teamId = $null
            teamSlug = $null
            cliVersion = $null
            transport = 'official-vercel-rest-api'
            prerequisite = $null
        }
        identity = [pscustomobject][ordered]@{
            expected = [pscustomobject][ordered]@{
                teamId = [string]$Expected.teamId
                teamSlug = [string]$Expected.teamSlug
                projectId = [string]$Expected.projectId
                projectName = [string]$Expected.projectName
                productionAlias = [string]$Expected.productionAlias
            }
            observed = [pscustomobject][ordered]@{ teamId = $null; teamSlug = $null; projectId = $null; projectName = $null; productionAlias = $null }
            match = $false
        }
        project = [pscustomobject][ordered]@{
            id = $null; name = $null; accountId = $null; gitProvider = $null; gitRepository = $null
            productionTargetDeploymentId = $null; domainsChecked = $false; productionAliasListedAsProjectDomain = $null
        }
        productionAlias = [pscustomobject][ordered]@{
            hostname = [string]$Expected.productionAlias
            present = $null; belongsToExpectedProject = $null; resolvesUnambiguously = $null
            deploymentId = $null; pointsToProduction = $null; pointsToActiveDeployment = $null
        }
        activeDeployment = [pscustomobject][ordered]@{
            id = $null; hostname = $null; state = 'unavailable'; target = $null
            createdAt = $null; readyAt = $null; gitProvider = $null; gitRepository = $null
            gitBranch = $null; gitCommitSha = $null; creator = $null
            isCurrentActiveProduction = $null; productionAliasPointsHere = $null
        }
        previousHealthyDeployment = [pscustomobject][ordered]@{
            status = 'absent'; label = 'rollback candidate'; safeToRollback = $false
            schemaCompatibility = 'unknown'; id = $null; gitCommitSha = $null; state = $null
            createdAt = $null; readyAt = $null; previouslyServedProduction = $null
        }
        commitTraceability = [pscustomobject][ordered]@{
            githubDefault = [pscustomobject][ordered]@{ status = 'not-checked'; sha = $null }
            cachedOriginDefault = [pscustomobject][ordered]@{ status = 'unavailable'; sha = $null }
            localHead = [pscustomobject][ordered]@{ status = 'unavailable'; sha = $null }
            pendingGitHubVercelContext = [pscustomobject][ordered]@{ status = 'not-checked'; correspondence = 'not-checked' }
        }
        localLinkage = [pscustomobject][ordered]@{
            committedVercelJsonPresent = [bool]$LocalLinkage.committedVercelJsonPresent
            committedProjectLinkPresent = [bool]$LocalLinkage.committedProjectLinkPresent
            ignoredProjectLinkFilenamePresent = [bool]$LocalLinkage.localProjectLinkFilenamePresent
            ignoredProjectLinkValuesInspected = $false
            providerIdentityMatchedExpected = $false
        }
        evidence = [object[]]@(); warnings = [object[]]@(); blockers = [object[]]@()
    }
}

function Set-TrainerVercelCollections {
    param(
        [Parameter(Mandatory = $true)][object]$Result,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$Evidence,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Warnings,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Blockers
    )
    $Result.evidence = [object[]]$Evidence.ToArray()
    $Result.warnings = [object[]]$Warnings.ToArray()
    $Result.blockers = [object[]]$Blockers.ToArray()
}

function Get-TrainerVercelGitFields {
    param([Parameter(Mandatory = $true)][object]$Deployment)
    $meta = Get-TrainerVercelProperty -Object $Deployment -Name 'meta'
    $gitSource = Get-TrainerVercelProperty -Object $Deployment -Name 'gitSource'
    [pscustomobject][ordered]@{
        provider = ConvertTo-TrainerVercelSafeText -Value (Get-TrainerVercelProperty -Object $gitSource -Name 'type') -Pattern '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'
        repository = ConvertTo-TrainerVercelSafeText -Value (Get-TrainerVercelProperty -Object $meta -Name 'githubRepo') -Pattern '^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?$'
        branch = ConvertTo-TrainerVercelSafeText -Value (Get-TrainerVercelProperty -Object $meta -Name 'githubCommitRef') -Pattern '^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$'
        sha = if ($null -ne (Get-TrainerVercelProperty -Object $meta -Name 'githubCommitSha')) {
            ConvertTo-TrainerVercelSafeText -Value (Get-TrainerVercelProperty -Object $meta -Name 'githubCommitSha') -Pattern '^[0-9A-Fa-f]{7,64}$'
        } else {
            ConvertTo-TrainerVercelSafeText -Value (Get-TrainerVercelProperty -Object $gitSource -Name 'sha') -Pattern '^[0-9A-Fa-f]{7,64}$'
        }
    }
}

function Get-TrainerVercelComparison {
    param([AllowNull()]$DeploymentSha, [AllowNull()]$ComparisonSha)
    if ([string]::IsNullOrWhiteSpace([string]$DeploymentSha) -or [string]::IsNullOrWhiteSpace([string]$ComparisonSha)) { return 'unavailable' }
    if ([string]$DeploymentSha -eq '[unsafe-redacted]' -or [string]$ComparisonSha -eq '[unsafe-redacted]') { return 'unavailable' }
    if ([string]$DeploymentSha -ceq [string]$ComparisonSha) { return 'identical' }
    'different'
}

function Complete-TrainerVercelResult {
    param(
        [Parameter(Mandatory = $true)][object]$Result,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$Evidence,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Warnings,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Blockers
    )
    Set-TrainerVercelCollections -Result $Result -Evidence $Evidence -Warnings $Warnings -Blockers $Blockers
    $Result
}

function Invoke-TrainerVercelStatus {
    param(
        [Parameter(Mandatory = $true)][object]$Expected,
        [Parameter(Mandatory = $true)][object]$LocalLinkage,
        [Parameter(Mandatory = $true)][object[]]$EndpointRegistry,
        [AllowNull()][string]$LocalHead,
        [AllowNull()][string]$CachedDefaultSha,
        [AllowNull()]$GitHubLive,
        [AllowNull()][scriptblock]$RequestInvoker
    )

    $result = New-TrainerVercelResult -Expected $Expected -LocalLinkage $LocalLinkage
    $evidence = [System.Collections.Generic.List[object]]::new()
    $warnings = [System.Collections.Generic.List[string]]::new()
    $blockers = [System.Collections.Generic.List[string]]::new()
    $token = [Environment]::GetEnvironmentVariable('VERCEL_TOKEN', [EnvironmentVariableTarget]::Process)
    if ([string]::IsNullOrWhiteSpace($token)) {
        $result.authentication.status = 'missing-token'
        $result.authentication.prerequisite = 'Set process-scoped VERCEL_TOKEN with Read-Host -MaskInput, run the command, then remove the process variable.'
        $blockers.Add('Vercel authentication is blocked because process-scoped VERCEL_TOKEN is not set. No HTTP request was attempted.')
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }

    $invokeEndpoint = {
        param([string]$Id, [hashtable]$Path = @{}, [hashtable]$Query = @{})
        $result.networkAccessed = $true
        Invoke-TrainerVercelApi -EndpointRegistry $EndpointRegistry -EndpointId $Id -Token $token -Evidence $evidence -PathParameters $Path -QueryParameters $Query -RequestInvoker $RequestInvoker
    }

    $userResponse = & $invokeEndpoint 'authenticated-user'
    if (-not $userResponse.succeeded) {
        $result.authentication.status = if ($userResponse.statusCode -eq 401) { 'not-authenticated' } else { 'insufficient-access' }
        $blockers.Add($(if ($userResponse.statusCode -eq 401) { 'VERCEL_TOKEN was rejected by Vercel.' } else { 'VERCEL_TOKEN could not access the authenticated Vercel account.' }))
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }
    $user = Get-TrainerVercelProperty -Object $userResponse.data -Name 'user'
    if ($null -eq $user) { $user = $userResponse.data }
    $account = Get-TrainerVercelProperty -Object $user -Name 'username'
    if ($null -eq $account) { $account = Get-TrainerVercelProperty -Object $user -Name 'name' }
    if ([string]::IsNullOrWhiteSpace([string]$account)) {
        $result.authentication.status = 'not-authenticated'
        $blockers.Add('The authenticated Vercel account identity is unavailable.')
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }
    $result.authentication.account = ConvertTo-TrainerVercelSafeText -Value $account -Pattern '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'

    $teams = [System.Collections.Generic.List[object]]::new()
    $until = $null
    for ($page = 0; $page -lt 20; $page++) {
        $query = @{ limit = 100 }
        if ($null -ne $until) { $query.until = $until }
        $teamsResponse = & $invokeEndpoint 'teams' @{} $query
        if (-not $teamsResponse.succeeded) {
            $result.authentication.status = 'insufficient-access'
            $blockers.Add('Authenticated Vercel team membership could not be resolved reliably.')
            return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
        }
        foreach ($team in @((Get-TrainerVercelProperty -Object $teamsResponse.data -Name 'teams'))) {
            if ($null -ne $team) { $teams.Add($team) }
        }
        $next = Get-TrainerVercelPath -Object $teamsResponse.data -Names @('pagination', 'next')
        if ($null -eq $next) { break }
        if ([string]$next -notmatch '^[0-9]+$') {
            throw [System.InvalidOperationException]::new('Vercel team pagination returned an unsafe continuation token.')
        }
        $until = [string]$next
    }
    $idMatches = @($teams | Where-Object { [string](Get-TrainerVercelProperty -Object $_ -Name 'id') -ceq [string]$Expected.teamId })
    if ($idMatches.Count -ne 1) {
        $slugMatches = @($teams | Where-Object { [string](Get-TrainerVercelProperty -Object $_ -Name 'slug') -ceq [string]$Expected.teamSlug })
        $result.authentication.status = 'wrong-team'
        $blockers.Add($(if ($slugMatches.Count -gt 0) { 'Observed Vercel team ID differs from committed expected identity.' } else { 'The expected Vercel team is not available to the authenticated account.' }))
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }
    $teamResponse = & $invokeEndpoint 'team' @{ teamId = [string]$Expected.teamId }
    if (-not $teamResponse.succeeded) {
        $result.authentication.status = 'insufficient-access'
        $blockers.Add('The expected Vercel team could not be retrieved exactly.')
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }
    $observedTeamId = [string](Get-TrainerVercelProperty -Object $teamResponse.data -Name 'id')
    $observedTeamSlug = [string](Get-TrainerVercelProperty -Object $teamResponse.data -Name 'slug')
    $result.authentication.teamId = ConvertTo-TrainerVercelSafeText -Value $observedTeamId -Pattern '^team_[A-Za-z0-9]+$'
    $result.authentication.teamSlug = ConvertTo-TrainerVercelSafeText -Value $observedTeamSlug -Pattern '^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$'
    $result.identity.observed.teamId = $result.authentication.teamId
    $result.identity.observed.teamSlug = $result.authentication.teamSlug
    if ($observedTeamId -cne [string]$Expected.teamId) { $blockers.Add('Observed Vercel team ID differs from committed expected identity.') }
    if ($observedTeamSlug -cne [string]$Expected.teamSlug) { $blockers.Add('Observed Vercel team slug differs from committed expected identity.') }
    if ($blockers.Count -gt 0) {
        $result.authentication.status = 'wrong-team'
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }
    $result.authentication.status = 'authenticated'

    $teamQuery = @{ teamId = [string]$Expected.teamId }
    $projectPath = @{ projectId = [string]$Expected.projectId }
    $projectResponse = & $invokeEndpoint 'project' $projectPath $teamQuery
    if (-not $projectResponse.succeeded) {
        if ($projectResponse.statusCode -in @(403, 404)) { $result.authentication.status = 'insufficient-access' }
        $blockers.Add('The authenticated account could not access the expected Vercel project reliably.')
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }
    $project = $projectResponse.data
    $observedProjectId = [string](Get-TrainerVercelProperty -Object $project -Name 'id')
    $observedProjectName = [string](Get-TrainerVercelProperty -Object $project -Name 'name')
    $accountId = [string](Get-TrainerVercelProperty -Object $project -Name 'accountId')
    $result.identity.observed.projectId = ConvertTo-TrainerVercelSafeText -Value $observedProjectId -Pattern '^prj_[A-Za-z0-9]+$'
    $result.identity.observed.projectName = ConvertTo-TrainerVercelSafeText -Value $observedProjectName -Pattern '^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$'
    $result.project.id = $result.identity.observed.projectId
    $result.project.name = $result.identity.observed.projectName
    $result.project.accountId = ConvertTo-TrainerVercelSafeText -Value $accountId -Pattern '^team_[A-Za-z0-9]+$'
    if ($observedProjectId -cne [string]$Expected.projectId) { $blockers.Add('Observed Vercel project ID differs from committed expected identity.') }
    if ($observedProjectName -cne [string]$Expected.projectName) { $blockers.Add('Observed Vercel project name differs from committed expected identity.') }
    if ($accountId -cne [string]$Expected.teamId) { $blockers.Add('Observed Vercel project owner differs from the expected team.') }
    $link = Get-TrainerVercelProperty -Object $project -Name 'link'
    $result.project.gitProvider = ConvertTo-TrainerVercelSafeText -Value (Get-TrainerVercelProperty -Object $link -Name 'type') -Pattern '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'
    $result.project.gitRepository = ConvertTo-TrainerVercelSafeText -Value (Get-TrainerVercelProperty -Object $link -Name 'repo') -Pattern '^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?$'
    $result.project.productionTargetDeploymentId = ConvertTo-TrainerVercelSafeText -Value (Get-TrainerVercelPath -Object $project -Names @('targets', 'production', 'id'))
    if ($blockers.Count -gt 0) {
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }

    $domainsResponse = & $invokeEndpoint 'project-domains' $projectPath @{ limit = 100; teamId = [string]$Expected.teamId }
    if (-not $domainsResponse.succeeded) {
        $blockers.Add('Vercel project-domain evidence could not be retrieved reliably.')
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }
    $result.project.domainsChecked = $true
    $domainNames = @((Get-TrainerVercelProperty -Object $domainsResponse.data -Name 'domains') | ForEach-Object {
        ConvertTo-TrainerVercelHostname -Value (Get-TrainerVercelProperty -Object $_ -Name 'name')
    } | Where-Object { $null -ne $_ })
    $result.project.productionAliasListedAsProjectDomain = [string]$Expected.productionAlias -cin $domainNames

    $aliasResponse = & $invokeEndpoint 'alias' @{ productionAlias = [string]$Expected.productionAlias } @{ projectId = [string]$Expected.projectId; teamId = [string]$Expected.teamId }
    if (-not $aliasResponse.succeeded) {
        $result.productionAlias.present = $false
        $blockers.Add('The expected Vercel production alias is missing or inaccessible.')
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }
    $alias = $aliasResponse.data
    $observedAlias = ConvertTo-TrainerVercelHostname -Value (Get-TrainerVercelProperty -Object $alias -Name 'alias')
    $aliasProjectId = [string](Get-TrainerVercelProperty -Object $alias -Name 'projectId')
    $aliasDeploymentId = [string](Get-TrainerVercelProperty -Object $alias -Name 'deploymentId')
    $nestedDeploymentId = [string](Get-TrainerVercelPath -Object $alias -Names @('deployment', 'id'))
    $aliasUnambiguous = -not [string]::IsNullOrWhiteSpace($aliasDeploymentId) -and
        ([string]::IsNullOrWhiteSpace($nestedDeploymentId) -or $nestedDeploymentId -ceq $aliasDeploymentId)
    $result.productionAlias.present = $observedAlias -ceq [string]$Expected.productionAlias
    $result.productionAlias.belongsToExpectedProject = $aliasProjectId -ceq [string]$Expected.projectId
    $result.productionAlias.resolvesUnambiguously = $aliasUnambiguous
    $result.productionAlias.deploymentId = ConvertTo-TrainerVercelSafeText -Value $aliasDeploymentId -Pattern '^dpl_[A-Za-z0-9]+$'
    $result.identity.observed.productionAlias = $observedAlias
    if (-not $result.productionAlias.present) { $blockers.Add('Observed Vercel alias differs from committed expected identity.') }
    if (-not $result.productionAlias.belongsToExpectedProject) { $blockers.Add('The production alias belongs to another Vercel project.') }
    if (-not $aliasUnambiguous) { $blockers.Add('The production alias did not resolve to one unambiguous deployment ID.') }
    if ($blockers.Count -gt 0) {
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }

    $deploymentResponse = & $invokeEndpoint 'deployment' @{ deploymentId = $aliasDeploymentId } $teamQuery
    if (-not $deploymentResponse.succeeded) {
        $blockers.Add('The deployment serving the expected production alias is inaccessible.')
        return Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
    }
    $deployment = $deploymentResponse.data
    $deploymentId = [string](Get-TrainerVercelProperty -Object $deployment -Name 'id')
    if ([string]::IsNullOrWhiteSpace($deploymentId)) { $deploymentId = [string](Get-TrainerVercelProperty -Object $deployment -Name 'uid') }
    $deploymentProjectId = [string](Get-TrainerVercelProperty -Object $deployment -Name 'projectId')
    $deploymentName = [string](Get-TrainerVercelProperty -Object $deployment -Name 'name')
    $deploymentTarget = [string](Get-TrainerVercelProperty -Object $deployment -Name 'target')
    $targetId = [string]$result.project.productionTargetDeploymentId
    $targetMatches = [string]::IsNullOrWhiteSpace($targetId) -or $targetId -ceq $deploymentId
    $result.productionAlias.pointsToProduction = $deploymentTarget -ceq 'production'
    $result.productionAlias.pointsToActiveDeployment = $deploymentId -ceq $aliasDeploymentId -and $targetMatches -and $result.productionAlias.pointsToProduction
    if ($deploymentId -cne $aliasDeploymentId) { $blockers.Add('Alias assignment and deployment detail returned contradictory deployment IDs.') }
    if ($deploymentProjectId -cne [string]$Expected.projectId -or $deploymentName -cne [string]$Expected.projectName) { $blockers.Add('The alias deployment is associated with another Vercel project.') }
    if ($deploymentTarget -cne 'production') { $blockers.Add('The alias deployment does not target production.') }
    if (-not $targetMatches) { $blockers.Add('The alias deployment differs from the project active production target.') }

    $git = Get-TrainerVercelGitFields -Deployment $deployment
    $result.activeDeployment.id = ConvertTo-TrainerVercelSafeText -Value $deploymentId -Pattern '^dpl_[A-Za-z0-9]+$'
    $result.activeDeployment.hostname = ConvertTo-TrainerVercelHostname -Value (Get-TrainerVercelProperty -Object $deployment -Name 'url')
    $state = Get-TrainerVercelProperty -Object $deployment -Name 'readyState'
    if ($null -eq $state) { $state = Get-TrainerVercelProperty -Object $deployment -Name 'state' }
    $result.activeDeployment.state = if ($null -eq $state) { 'unavailable' } else { ([string]$state).ToLowerInvariant() }
    $result.activeDeployment.target = ConvertTo-TrainerVercelSafeText -Value $deploymentTarget -Pattern '^(?:production|preview)$'
    $result.activeDeployment.createdAt = ConvertTo-TrainerVercelTimestamp -Value (Get-TrainerVercelProperty -Object $deployment -Name 'createdAt')
    if ($null -eq $result.activeDeployment.createdAt) { $result.activeDeployment.createdAt = ConvertTo-TrainerVercelTimestamp -Value (Get-TrainerVercelProperty -Object $deployment -Name 'created') }
    $result.activeDeployment.readyAt = ConvertTo-TrainerVercelTimestamp -Value (Get-TrainerVercelProperty -Object $deployment -Name 'ready')
    $result.activeDeployment.gitProvider = $git.provider
    $result.activeDeployment.gitRepository = $git.repository
    $result.activeDeployment.gitBranch = $git.branch
    $result.activeDeployment.gitCommitSha = $git.sha
    $creator = Get-TrainerVercelProperty -Object $deployment -Name 'creator'
    $result.activeDeployment.creator = ConvertTo-TrainerVercelSafeText -Value (Get-TrainerVercelProperty -Object $creator -Name 'username') -Pattern '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'
    $result.activeDeployment.productionAliasPointsHere = $result.productionAlias.pointsToActiveDeployment
    $result.activeDeployment.isCurrentActiveProduction = $result.productionAlias.pointsToActiveDeployment

    $allDeployments = [System.Collections.Generic.List[object]]::new()
    $until = $null
    for ($page = 0; $page -lt 20; $page++) {
        $query = @{ projectId = [string]$Expected.projectId; target = 'production'; limit = 100; teamId = [string]$Expected.teamId }
        if ($null -ne $until) { $query.until = $until }
        $listResponse = & $invokeEndpoint 'production-deployments' @{} $query
        if (-not $listResponse.succeeded) {
            $warnings.Add('Previous production deployment candidates are unavailable.')
            break
        }
        foreach ($item in @((Get-TrainerVercelProperty -Object $listResponse.data -Name 'deployments'))) {
            if ($null -ne $item) { $allDeployments.Add($item) }
        }
        $next = Get-TrainerVercelPath -Object $listResponse.data -Names @('pagination', 'next')
        if ($null -eq $next) { break }
        if ([string]$next -notmatch '^[0-9]+$') {
            $warnings.Add('Deployment pagination continuation was unsafe; rollback-candidate collection stopped.')
            break
        }
        $until = [string]$next
    }
    $previous = @($allDeployments | Where-Object {
        $candidateId = [string](Get-TrainerVercelProperty -Object $_ -Name 'uid')
        if ([string]::IsNullOrWhiteSpace($candidateId)) { $candidateId = [string](Get-TrainerVercelProperty -Object $_ -Name 'id') }
        $candidateState = Get-TrainerVercelProperty -Object $_ -Name 'readyState'
        if ($null -eq $candidateState) { $candidateState = Get-TrainerVercelProperty -Object $_ -Name 'state' }
        $candidateId -cne $deploymentId -and [string]$candidateState -ceq 'READY'
    } | Sort-Object {
        $created = Get-TrainerVercelProperty -Object $_ -Name 'created'
        if ($null -eq $created) { $created = Get-TrainerVercelProperty -Object $_ -Name 'createdAt' }
        [long]$created
    } -Descending | Select-Object -First 1)
    if ($previous.Count -eq 1) {
        $previousGit = Get-TrainerVercelGitFields -Deployment $previous[0]
        $previousId = Get-TrainerVercelProperty -Object $previous[0] -Name 'uid'
        if ($null -eq $previousId) { $previousId = Get-TrainerVercelProperty -Object $previous[0] -Name 'id' }
        $previousState = Get-TrainerVercelProperty -Object $previous[0] -Name 'readyState'
        if ($null -eq $previousState) { $previousState = Get-TrainerVercelProperty -Object $previous[0] -Name 'state' }
        $result.previousHealthyDeployment.status = 'present'
        $result.previousHealthyDeployment.id = ConvertTo-TrainerVercelSafeText -Value $previousId -Pattern '^dpl_[A-Za-z0-9]+$'
        $result.previousHealthyDeployment.gitCommitSha = $previousGit.sha
        $result.previousHealthyDeployment.state = ([string]$previousState).ToLowerInvariant()
        $result.previousHealthyDeployment.createdAt = ConvertTo-TrainerVercelTimestamp -Value (Get-TrainerVercelProperty -Object $previous[0] -Name 'created')
        $result.previousHealthyDeployment.readyAt = ConvertTo-TrainerVercelTimestamp -Value (Get-TrainerVercelProperty -Object $previous[0] -Name 'ready')
        $result.previousHealthyDeployment.previouslyServedProduction = $true
    }

    $result.commitTraceability.localHead.sha = $LocalHead
    $result.commitTraceability.localHead.status = Get-TrainerVercelComparison -DeploymentSha $git.sha -ComparisonSha $LocalHead
    $result.commitTraceability.cachedOriginDefault.sha = $CachedDefaultSha
    $result.commitTraceability.cachedOriginDefault.status = Get-TrainerVercelComparison -DeploymentSha $git.sha -ComparisonSha $CachedDefaultSha
    if ($null -ne $GitHubLive) {
        $githubSha = Get-TrainerVercelPath -Object $GitHubLive -Names @('branch', 'defaultBranch', 'sha')
        $result.commitTraceability.githubDefault.sha = $githubSha
        $result.commitTraceability.githubDefault.status = Get-TrainerVercelComparison -DeploymentSha $git.sha -ComparisonSha $githubSha
        $pending = @((Get-TrainerVercelPath -Object $GitHubLive -Names @('checks', 'pending')) | Where-Object { [string]$_ -match '(?i)vercel' })
        if ($pending.Count -gt 0) {
            $result.commitTraceability.pendingGitHubVercelContext.status = 'present'
            $result.commitTraceability.pendingGitHubVercelContext.correspondence = if ($githubSha -ceq $git.sha) {
                if ($result.activeDeployment.state -in @('building', 'queued', 'initializing')) { 'active-production-building' }
                elseif ($result.activeDeployment.state -eq 'ready') { 'stale-for-active-production' }
                else { 'active-production-state-mismatch' }
            } else { 'different-commit-or-preview' }
        }
        else {
            $result.commitTraceability.pendingGitHubVercelContext.status = 'absent'
            $result.commitTraceability.pendingGitHubVercelContext.correspondence = 'not-applicable'
        }
    }

    $result.identity.match = $blockers.Count -eq 0
    $result.localLinkage.providerIdentityMatchedExpected = $result.identity.match
    Complete-TrainerVercelResult -Result $result -Evidence $evidence -Warnings $warnings -Blockers $blockers
}

Export-ModuleMember -Function Invoke-TrainerVercelStatus
