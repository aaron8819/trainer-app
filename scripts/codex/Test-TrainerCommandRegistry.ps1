[CmdletBinding()]
param([switch]$Json)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Trainer.Tooling.psm1') -Force

function Get-RepositoryRelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$Path
    )

    [System.IO.Path]::GetRelativePath($RepositoryRoot, $Path).Replace('\', '/')
}

function Resolve-RegistryProfile {
    param(
        [Parameter(Mandatory = $true)][object]$Policy,
        [Parameter(Mandatory = $true)][object]$Entry
    )

    $profileProperty = $Policy.commandProfiles.PSObject.Properties[$Entry.profile]
    if ($null -eq $profileProperty) {
        return $null
    }
    $profileProperty.Value
}

function Test-ExactFlagToken {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Flag
    )

    $pattern = '(?<![A-Za-z0-9-])' + [regex]::Escape($Flag) + '(?![A-Za-z0-9-])'
    [regex]::IsMatch($Text, $pattern)
}

try {
    $repositoryRoot = Get-NormalizedPath -Path (Join-Path $PSScriptRoot '..\..')
    $policy = Read-TrainerPolicy -Path (Join-Path $PSScriptRoot 'trainer-policy.v1.json')
    $errors = [System.Collections.Generic.List[string]]::new()
    $warnings = [System.Collections.Generic.List[string]]::new()
    $validClasses = @(
        'read-only',
        'local-artifact-write',
        'disposable-database-write',
        'production-write',
        'deploy',
        'destructive'
    )
    $mutatingClasses = @(
        'disposable-database-write',
        'production-write',
        'deploy',
        'destructive'
    )

    $entries = @($policy.commandRegistry)
    $ids = @($entries | ForEach-Object { [string]$_.id })
    $duplicateIds = @($ids | Group-Object | Where-Object { $_.Count -gt 1 } | ForEach-Object { $_.Name })
    foreach ($id in $duplicateIds) {
        $errors.Add("Duplicate command id: $id")
    }

    $requiredEntryProperties = @(
        'id',
        'command',
        'sourceLocation',
        'entrypoint',
        'profile',
        'flagEscalations',
        'notes'
    )
    foreach ($entry in $entries) {
        foreach ($propertyName in $requiredEntryProperties) {
            if ($entry.PSObject.Properties.Name -notcontains $propertyName) {
                $errors.Add("Command '$($entry.id)' is missing required property '$propertyName'.")
            }
        }

        $profile = Resolve-RegistryProfile -Policy $policy -Entry $entry
        if ($null -eq $profile) {
            $errors.Add("Command '$($entry.id)' references unknown profile '$($entry.profile)'.")
            continue
        }
        if ($profile.defaultSideEffectClass -notin $validClasses) {
            $errors.Add("Command '$($entry.id)' resolves invalid side-effect class '$($profile.defaultSideEffectClass)'.")
        }
        foreach ($field in @(
                'accessesNetwork',
                'accessesDatabase',
                'writesLocalArtifacts',
                'writesTrackedFiles',
                'mayMutateProduction',
                'authorizationRequirement'
            )) {
            if ($profile.PSObject.Properties.Name -notcontains $field) {
                $errors.Add("Profile '$($entry.profile)' is missing required field '$field'.")
            }
        }

        $sourcePathText = ([string]$entry.sourceLocation -split '#', 2)[0]
        $sourcePath = Join-Path $repositoryRoot $sourcePathText
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            $errors.Add("Command '$($entry.id)' source location does not exist: $sourcePathText")
        }
        if ($null -ne $entry.entrypoint -and -not [string]::IsNullOrWhiteSpace([string]$entry.entrypoint)) {
            $entrypointPath = Join-Path $repositoryRoot ([string]$entry.entrypoint)
            if (-not (Test-Path -LiteralPath $entrypointPath -PathType Leaf)) {
                $errors.Add("Command '$($entry.id)' entrypoint does not exist: $($entry.entrypoint)")
            }
        }
    }

    foreach ($profileProperty in $policy.commandProfiles.PSObject.Properties) {
        if ($profileProperty.Value.defaultSideEffectClass -notin $validClasses) {
            $errors.Add("Profile '$($profileProperty.Name)' has invalid side-effect class '$($profileProperty.Value.defaultSideEffectClass)'.")
        }
    }
    foreach ($verificationCommand in $policy.commands.PSObject.Properties) {
        $registryMatch = @($entries | Where-Object { $_.id -ceq $verificationCommand.Name })
        if ($registryMatch.Count -ne 1) {
            $errors.Add("Phase 1 verification command '$($verificationCommand.Name)' must map to exactly one registry entry.")
            continue
        }
        $profile = Resolve-RegistryProfile -Policy $policy -Entry $registryMatch[0]
        $expectedVerificationCommand = if (
            $registryMatch[0].PSObject.Properties.Name -contains 'packageScript' -and
            -not [string]::IsNullOrWhiteSpace([string]$registryMatch[0].packageScript)
        ) {
            "npm run $($registryMatch[0].packageScript)"
        }
        else {
            [string]$registryMatch[0].command
        }
        if ([string]$verificationCommand.Value.command -cne $expectedVerificationCommand) {
            $errors.Add("Phase 1 verification command '$($verificationCommand.Name)' differs from its registry command.")
        }
        if ([string]::IsNullOrWhiteSpace([string]$verificationCommand.Value.defaultSideEffectClass)) {
            $errors.Add("Phase 1 verification command '$($verificationCommand.Name)' is missing its backward-compatible side-effect class.")
        }

        $requiredVerificationProperties = @(
            'verificationTier',
            'executableInImplementationMode',
            'requiresCleanWorktree',
            'requiresDependencies',
            'requiresDocker',
            'requiresDatabase',
            'requiresNetwork',
            'requiresPrisma',
            'requiresNode',
            'requiresNpm',
            'requiresPowerShell',
            'invocation'
        )
        foreach ($propertyName in $requiredVerificationProperties) {
            if ($verificationCommand.Value.PSObject.Properties.Name -notcontains $propertyName) {
                $errors.Add("Verification command '$($verificationCommand.Name)' is missing required Phase 3 property '$propertyName'.")
            }
        }
        if ($verificationCommand.Value.verificationTier -notin @('implementation', 'release', 'both')) {
            $errors.Add("Verification command '$($verificationCommand.Name)' has invalid verification tier '$($verificationCommand.Value.verificationTier)'.")
        }
        if ($verificationCommand.Value.invocation.PSObject.Properties.Name -notcontains 'workingDirectory' -or
            $verificationCommand.Value.invocation.workingDirectory -notin @('repository', 'trainer-app')) {
            $errors.Add("Verification command '$($verificationCommand.Name)' has an invalid invocation working directory.")
        }
        if ([string]::IsNullOrWhiteSpace([string]$verificationCommand.Value.invocation.executable)) {
            $errors.Add("Verification command '$($verificationCommand.Name)' has no invocation executable.")
        }
        if ($verificationCommand.Value.invocation.PSObject.Properties.Name -notcontains 'arguments') {
            $errors.Add("Verification command '$($verificationCommand.Name)' has no invocation argument array.")
        }
        if ([bool]$verificationCommand.Value.executableInImplementationMode -and
            ([bool]$verificationCommand.Value.requiresDatabase -or [bool]$verificationCommand.Value.requiresNetwork)) {
            $errors.Add("Verification command '$($verificationCommand.Name)' cannot be implementation-executable while requiring database or network access.")
        }
        if ([bool]$verificationCommand.Value.executableInImplementationMode -and
            $profile.defaultSideEffectClass -in @('production-write', 'deploy', 'destructive')) {
            $errors.Add("Verification command '$($verificationCommand.Name)' cannot execute with forbidden side-effect class '$($profile.defaultSideEffectClass)'.")
        }
        if ([bool]$verificationCommand.Value.executableInImplementationMode -and
            $verificationCommand.Value.verificationTier -eq 'release') {
            $errors.Add("Verification command '$($verificationCommand.Name)' cannot be implementation-executable in the release verification tier.")
        }
        if ([bool]$verificationCommand.Value.executableInImplementationMode -and
            ([bool]$verificationCommand.Value.explicitAuthorizationRequired -or
                $profile.authorizationRequirement -ne 'none')) {
            $errors.Add("Verification command '$($verificationCommand.Name)' cannot be implementation-executable while requiring separate authorization.")
        }
        if ([bool]$verificationCommand.Value.executableInImplementationMode -and
            @($registryMatch[0].flagEscalations).Count -gt 0) {
            $errors.Add("Verification command '$($verificationCommand.Name)' cannot be implementation-executable while its registry entry has mutation escalations.")
        }
        if ([bool]$verificationCommand.Value.executableInImplementationMode -and
            (([bool]$profile.accessesDatabase -and (-not [bool]$verificationCommand.Value.requiresDatabase)) -or
                ([bool]$profile.accessesNetwork -and (-not [bool]$verificationCommand.Value.requiresNetwork)))) {
            $errors.Add("Verification command '$($verificationCommand.Name)' cannot hide registry-declared database or network prerequisites.")
        }
        if ([bool]$verificationCommand.Value.executableInImplementationMode -and
            [string]$verificationCommand.Value.command -match '(?i)(^|\s)(npm\s+(install|ci)|npx\s)') {
            $errors.Add("Verification command '$($verificationCommand.Name)' cannot use a package installation or download mechanism.")
        }
    }

    $verificationOrder = @($policy.verification.commandOrder)
    $verificationIds = @($policy.commands.PSObject.Properties.Name)
    foreach ($id in $verificationIds) {
        if (@($verificationOrder | Where-Object { $_ -ceq $id }).Count -ne 1) {
            $errors.Add("Verification command '$id' must appear exactly once in verification.commandOrder.")
        }
    }
    foreach ($id in $verificationOrder) {
        if ($id -notin $verificationIds) {
            $errors.Add("verification.commandOrder references unknown command '$id'.")
        }
    }

    $packagePath = Join-Path $repositoryRoot $policy.registryCoverage.packageManifest
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        $errors.Add("Package manifest does not exist: $($policy.registryCoverage.packageManifest)")
        $packageScripts = @()
    }
    else {
        $package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
        $packageScripts = @($package.scripts.PSObject.Properties)
    }
    $ignoredPackageScripts = @($policy.registryCoverage.ignoredPackageScripts)
    $registeredPackageEntries = @($entries | Where-Object {
        $_.PSObject.Properties.Name -contains 'packageScript' -and
        -not [string]::IsNullOrWhiteSpace([string]$_.packageScript)
    })
    foreach ($script in $packageScripts) {
        $matches = @($registeredPackageEntries | Where-Object { $_.packageScript -ceq $script.Name })
        if (($matches.Count -eq 0) -and ($script.Name -notin $ignoredPackageScripts)) {
            $errors.Add("Package script is not registered or ignored: $($script.Name)")
        }
        elseif ($matches.Count -gt 1) {
            $errors.Add("Package script has multiple registry entries: $($script.Name)")
        }
        elseif ($matches.Count -eq 1 -and ([string]$matches[0].command -cne [string]$script.Value)) {
            $errors.Add("Registered command does not match package.json for script '$($script.Name)'.")
        }
    }
    foreach ($ignored in $ignoredPackageScripts) {
        if (@($packageScripts | Where-Object { $_.Name -ceq $ignored }).Count -eq 0) {
            $errors.Add("Ignored package script does not exist: $ignored")
        }
    }
    foreach ($registered in $registeredPackageEntries) {
        if (@($packageScripts | Where-Object { $_.Name -ceq $registered.packageScript }).Count -eq 0) {
            $errors.Add("Registry references nonexistent package script: $($registered.packageScript)")
        }
    }

    $registeredEntrypoints = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($entry in $entries) {
        if ($null -ne $entry.entrypoint -and -not [string]::IsNullOrWhiteSpace([string]$entry.entrypoint)) {
            $registeredEntrypoints.Add(([string]$entry.entrypoint).Replace('\', '/')) | Out-Null
        }
    }
    $ignoredEntrypoints = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($directoryRule in @($policy.registryCoverage.entrypointDirectories)) {
        $directoryPath = Join-Path $repositoryRoot $directoryRule.path
        if (-not (Test-Path -LiteralPath $directoryPath -PathType Container)) {
            $errors.Add("Registry coverage directory does not exist: $($directoryRule.path)")
            continue
        }
        foreach ($ignored in @($directoryRule.ignored)) {
            $ignoredNormalized = ([string]$ignored).Replace('\', '/')
            $ignoredEntrypoints.Add($ignoredNormalized) | Out-Null
            if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot $ignoredNormalized) -PathType Leaf)) {
                $errors.Add("Ignored entrypoint does not exist: $ignoredNormalized")
            }
        }
        $getChildItemArguments = @{
            LiteralPath = $directoryPath
            File = $true
        }
        if ([bool]$directoryRule.recursive) {
            $getChildItemArguments.Recurse = $true
        }
        $files = @(Get-ChildItem @getChildItemArguments | Where-Object {
            $_.Extension -in @($directoryRule.extensions)
        })
        foreach ($file in $files) {
            $relative = Get-RepositoryRelativePath -RepositoryRoot $repositoryRoot -Path $file.FullName
            if ((-not $registeredEntrypoints.Contains($relative)) -and
                (-not $ignoredEntrypoints.Contains($relative))) {
                $errors.Add("Operational entrypoint is not registered or ignored: $relative")
            }
        }
    }

    $knownFlags = @($policy.registryCoverage.knownMutationFlags)
    foreach ($entry in $entries) {
        if ($null -eq $entry.entrypoint -or [string]::IsNullOrWhiteSpace([string]$entry.entrypoint)) {
            continue
        }
        $entrypointPath = Join-Path $repositoryRoot ([string]$entry.entrypoint)
        if (-not (Test-Path -LiteralPath $entrypointPath -PathType Leaf)) {
            continue
        }
        $sourceText = Get-Content -Raw -LiteralPath $entrypointPath
        $profile = Resolve-RegistryProfile -Policy $policy -Entry $entry
        $defaultIsMutating = $null -ne $profile -and $profile.defaultSideEffectClass -in $mutatingClasses
        foreach ($flag in $knownFlags) {
            if (-not (Test-ExactFlagToken -Text $sourceText -Flag $flag)) {
                continue
            }
            $covered = $defaultIsMutating -or @($entry.flagEscalations | Where-Object {
                ([string]$_.flag).StartsWith($flag, [System.StringComparison]::Ordinal)
            }).Count -gt 0
            if (-not $covered) {
                $errors.Add("Command '$($entry.id)' implementation uses mutation flag '$flag' without escalation metadata.")
            }
        }
        foreach ($escalation in @($entry.flagEscalations)) {
            if ($escalation.sideEffectClass -notin $validClasses) {
                $errors.Add("Command '$($entry.id)' escalation '$($escalation.flag)' has invalid side-effect class '$($escalation.sideEffectClass)'.")
            }
        }
    }

    $report = [pscustomobject][ordered]@{
        schema = 'trainer-command-registry-validation'
        version = 1
        inspectionOnly = $true
        commandsRegistered = $entries.Count
        packageScripts = $packageScripts.Count
        packageScriptsRegistered = $registeredPackageEntries.Count
        ignoredPackageScripts = @($ignoredPackageScripts)
        ignoredEntrypoints = @($ignoredEntrypoints | Sort-Object)
        errors = $errors.ToArray()
        warnings = $warnings.ToArray()
        success = $errors.Count -eq 0
    }

    if ($Json) {
        $report | ConvertTo-Json -Depth 8
    }
    else {
        Write-Output "Trainer command registry validation: success=$($report.success)"
        Write-Output "Commands registered: $($report.commandsRegistered)"
        Write-Output "Package scripts covered: $($report.packageScriptsRegistered)/$($report.packageScripts)"
        Write-Output "Ignored internal entrypoints: $(@($report.ignoredEntrypoints).Count)"
        if ($errors.Count -gt 0) {
            Write-Output 'Errors:'
            $errors | ForEach-Object { Write-Output "  - $_" }
        }
    }
    if ($errors.Count -gt 0) { exit 1 }
    exit 0
}
catch {
    if ($Json) {
        [pscustomobject][ordered]@{
            schema = 'trainer-command-registry-validation-error'
            version = 1
            inspectionOnly = $true
            error = $_.Exception.Message
            success = $false
        } | ConvertTo-Json -Depth 4
    }
    else {
        [Console]::Error.WriteLine("Trainer command registry validation failed: $($_.Exception.Message)")
    }
    exit 3
}
