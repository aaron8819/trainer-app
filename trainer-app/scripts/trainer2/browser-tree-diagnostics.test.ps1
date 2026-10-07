$ErrorActionPreference = 'Stop'

# Load only the production functions under test, not top-level inventory/native setup.
$tokens = $null; $parseErrors = $null
$source = Join-Path $PSScriptRoot 'browser-tree.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile(
    $source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Production PowerShell parse failed' }
$names = @('Diagnostic-Number', 'Diagnostic-Identity', 'New-IdentityRejectionDiagnostic',
    'Write-IdentityRejection', 'Identity-Key', 'Same-Identity', 'Remember', 'Refresh-Tree')
foreach ($name in $names) {
    $definition = @($ast.FindAll({ param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst]
    }, $true) | Where-Object { $_.Name -eq $name })
    if ($definition.Count -ne 1) { throw "Missing unique production function: $name" }
    . ([scriptblock]::Create($definition[0].Extent.Text))
}

# All operating-system boundaries are synthetic. No native type is loaded.
function Pin-Handle($Row) { $script:pinCalls++ }
function Inventory { return @($script:syntheticRows) }
function Native-Exited($Key) { return $true }
function Assert-Equal($Actual, $Expected, [string]$Label) {
    if ($Actual -ne $Expected) { throw "Assertion failed: $Label" }
}
function Entry([long]$Number, [string]$Created = '900002', [string]$Executable = 'C:\fake.exe') {
    return [pscustomobject]@{ pid=$Number; parentPid=101; created=$Created
        executable=$Executable; lastSeen='900003'; command='PRIVATE COMMAND token=secret'
        environment='PRIVATE ENV password=secret' }
}
function Capture-Rejection([scriptblock]$Action) {
    $writer = [IO.StringWriter]::new()
    $previous = [Console]::Error
    try {
        [Console]::SetError($writer)
        $rejected = $false
        try { & $Action | Out-Null } catch {
            Assert-Equal $_.Exception.Message 'Invalid browser process identity' 'original error'
            $rejected = $true
        }
        Assert-Equal $rejected $true 'fail closed'
    } finally { [Console]::SetError($previous) }
    $text = $writer.ToString()
    if ($text -match 'PRIVATE|token|password|fake.exe|environment|command') {
        throw 'Diagnostic leaked non-ownership data'
    }
    return $text | ConvertFrom-Json
}

$ownership = @{ runnerPid=2000000000; rootPid=101 }
$handles = @{}; $nativeAbsent = @{}; $Mode = 'capture'; $identityPhase = 'capture'
$cases = @(
    @{ row=(Entry 0); predicate='invalid-pid' },
    @{ row=(Entry $PID); predicate='observer-pid' },
    @{ row=(Entry $ownership.runnerPid); predicate='runner-pid' },
    @{ row=(Entry 202 ''); predicate='missing-created' },
    @{ row=(Entry 202 '900002' 'relative.exe'); predicate='non-rooted-executable' }
)
foreach ($case in $cases) {
    $known = @{}; $pinCalls = 0
    $diagnostic = Capture-Rejection { Remember $case.row 900003 (Entry 101 '900001') }
    Assert-Equal $diagnostic.schemaVersion 1 'schema'
    Assert-Equal $diagnostic.predicate $case.predicate 'predicate'
    Assert-Equal $diagnostic.phase 'capture' 'capture phase'
    Assert-Equal $diagnostic.operation 'capture' 'operation'
    Assert-Equal $diagnostic.candidate.pid $case.row.pid 'candidate PID'
    Assert-Equal $diagnostic.candidate.parentPid 101 'candidate parent PID'
    Assert-Equal $diagnostic.parent.created '900001' 'qualified parent birth'
    Assert-Equal $diagnostic.observerPid $PID 'observer PID'
    Assert-Equal $known.Count 0 'rejected identity never remembered'
    Assert-Equal $pinCalls 0 'rejected identity never pinned'
    Write-Output "PASS $($case.predicate) sanitized capture rejection"
}
foreach ($operation in @('capture', 'observe', 'terminate')) {
    $Mode = $operation
    $root = Entry 101 '900001'
    $root.parentPid = $ownership.runnerPid
    $known = @{ '101/900001'=$root }; $pinCalls = 0
    $syntheticRows = @($root, (Entry 202 '900002' 'relative.exe'))
    $diagnostic = Capture-Rejection { Refresh-Tree }
    $phase = if ($operation -eq 'terminate') { 'termination-observation' } else { 'refresh' }
    Assert-Equal $diagnostic.phase $phase 'refresh phase'
    Assert-Equal $diagnostic.operation $operation 'refresh operation'
    Assert-Equal $diagnostic.predicate 'non-rooted-executable' 'descendant predicate'
    Assert-Equal $diagnostic.parent.pid 101 'descendant parent'
    Assert-Equal $known.Count 1 'descendant not remembered'
    Write-Output "PASS $operation synthetic descendant diagnostics"
}
$known = @{}; $pinCalls = 0
Remember (Entry 202) 900003
Assert-Equal $known.Count 1 'valid identity still remembered'
Assert-Equal $pinCalls 1 'valid identity still pinned'
Write-Output 'PASS valid identity retains original semantics'
$privateBirth = Diagnostic-Identity (Entry 202 'PRIVATE token=secret')
Assert-Equal $privateBirth.created $null 'non-numeric birth redacted'
Assert-Equal $privateBirth.creationIdentityPresent $true 'presence retained'
Assert-Equal (Diagnostic-Identity $null) $null 'unavailable parent remains null'
Write-Output 'PASS malformed birth redacted and unavailable parent explicit'
Write-Output '10 pure synthetic regressions passed; no OS inventory, handles or termination invoked.'
