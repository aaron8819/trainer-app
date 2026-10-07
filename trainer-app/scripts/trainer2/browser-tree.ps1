param(
    [Parameter(Mandatory = $true)][ValidateSet('capture', 'inventory', 'observe', 'terminate')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$OwnershipBase64,
    [Parameter(Mandatory = $true)][long]$DeadlineUnixMs
)

$ErrorActionPreference = 'Stop'
$ownership = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($OwnershipBase64)) | ConvertFrom-Json
$deadline = [DateTimeOffset]::FromUnixTimeMilliseconds($DeadlineUnixMs).UtcDateTime
$known = @{}
$handles = @{}
$terminated = @{}
$terminationErrors = @{}
$nativeAbsent = @{}
$identityPhase = 'capture'

# Diagnostics contain only ownership coordinates and path validity, never inventory
# command lines, full executable paths, profile paths or environment values.
function Diagnostic-Number($Value) {
    [long]$number = 0
    if ([long]::TryParse([string]$Value, [ref]$number)) { return $number }
    return $null
}
function Diagnostic-Identity($Row) {
    if ($null -eq $Row) { return $null }
    $creation = [string]$Row.created
    return @{
        pid=(Diagnostic-Number $Row.pid); parentPid=(Diagnostic-Number $Row.parentPid)
        created=$(if ($creation -match '^\d{1,20}$') { $creation } else { $null })
        creationIdentityPresent=[bool]$Row.created
        executableRooted=[IO.Path]::IsPathRooted([string]$Row.executable)
    }
}
function New-IdentityRejectionDiagnostic($Row, [string]$Predicate, $Parent) {
    return @{
        schemaVersion=1; event='ownership-identity-rejected'; operation=$Mode
        phase=$identityPhase; predicate=$Predicate
        candidate=(Diagnostic-Identity $Row); parent=(Diagnostic-Identity $Parent)
        observerPid=$PID; runnerPid=(Diagnostic-Number $ownership.runnerPid)
        rootPid=(Diagnostic-Number $ownership.rootPid)
    }
}
function Write-IdentityRejection($Row, [string]$Predicate, $Parent) {
    $diagnostic = New-IdentityRejectionDiagnostic $Row $Predicate $Parent
    [Console]::Error.WriteLine(($diagnostic | ConvertTo-Json -Compress -Depth 5))
}

# CIM reports microseconds; compare the native handle's creation time at that
# precision. Never kill by a PID fetched earlier from a different process.
function Creation-Key([DateTime]$Time) {
    return ([long]($Time.ToUniversalTime().Ticks - ($Time.ToUniversalTime().Ticks % 10))).ToString()
}
function Identity-Key($Row) { return "$($Row.pid)/$($Row.created)" }
function Same-Identity($Left, $Right) {
    return $Left.pid -eq $Right.pid -and $Left.created -eq $Right.created -and
        [string]::Equals($Left.executable, $Right.executable, [StringComparison]::OrdinalIgnoreCase)
}
function Inventory {
    return @(Get-CimInstance Win32_Process | ForEach-Object {
        [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId;
            created=(Creation-Key $_.CreationDate); executable=[string]$_.ExecutablePath;
            name=[string]$_.Name; command=[string]$_.CommandLine }
    })
}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OwnedProcessNative {
 [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr h, uint code);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
"@
function Pin-Handle($Row) {
    $key = Identity-Key $Row
    if ($handles.ContainsKey($key) -or $nativeAbsent.ContainsKey($key)) { return }
    $handle = [OwnedProcessNative]::OpenProcess(0x101001, $false, $Row.pid)
    if ($handle -eq [IntPtr]::Zero) {
        $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($code -eq 87) { $nativeAbsent[$key] = $true; return }
        throw "OpenProcess failed: pid=$($Row.pid) win32=$code"
    }
    [long]$creation=0; [long]$exit=0; [long]$kernel=0; [long]$user=0
    if (![OwnedProcessNative]::GetProcessTimes($handle,[ref]$creation,[ref]$exit,[ref]$kernel,[ref]$user)) {
        $null=[OwnedProcessNative]::CloseHandle($handle); throw 'GetProcessTimes failed'
    }
    if ((Creation-Key ([DateTime]::FromFileTimeUtc($creation))) -ne $Row.created) {
        $null=[OwnedProcessNative]::CloseHandle($handle)
        $nativeAbsent[$key]=$true # Original generation is gone; replacement is never touched.
        return
    }
    $handles[$key]=$handle
}
function Native-Exited($Key) {
    if ($nativeAbsent.ContainsKey($Key)) { return $true }
    if (!$handles.ContainsKey($Key)) { Pin-Handle $known[$Key] }
    if ($nativeAbsent.ContainsKey($Key)) { return $true }
    $wait=[OwnedProcessNative]::WaitForSingleObject($handles[$Key],0)
    if ($wait -eq 0) { return $true }
    if ($wait -eq 258) { return $false }
    throw "Native process wait failed: $wait"
}
function Native-ExitTime($Key) {
    if (!$handles.ContainsKey($Key)) { return 0 }
    [long]$creation=0; [long]$exit=0; [long]$kernel=0; [long]$user=0
    if (![OwnedProcessNative]::GetProcessTimes($handles[$Key],[ref]$creation,[ref]$exit,[ref]$kernel,[ref]$user)) { throw 'Process times unavailable' }
    return $exit
}
function Request-Termination($Handle, [int]$TargetPid) {
    if ([OwnedProcessNative]::TerminateProcess($Handle, 1)) { return 0 }
    return [Runtime.InteropServices.Marshal]::GetLastWin32Error()
}
function Remember($Row, [long]$Seen, $Parent = $null) {
    # Retain the guard's original order and fail-closed predicates.
    $predicate = if ($Row.pid -le 0) { 'invalid-pid' }
        elseif ($Row.pid -eq $PID) { 'observer-pid' }
        elseif ($Row.pid -eq $ownership.runnerPid) { 'runner-pid' }
        elseif (!$Row.created) { 'missing-created' }
        elseif (![IO.Path]::IsPathRooted($Row.executable)) { 'non-rooted-executable' }
        else { $null }
    if ($predicate) {
        Write-IdentityRejection $Row $predicate $Parent
        throw 'Invalid browser process identity'
    }
    $key = Identity-Key $Row
    if (!$known.ContainsKey($key)) {
        $known[$key] = [pscustomobject]@{ pid=$Row.pid; parentPid=$Row.parentPid;
            created=$Row.created; executable=$Row.executable; lastSeen=$Seen.ToString() }
    } else { $known[$key].lastSeen = $Seen.ToString() }
    Pin-Handle $Row
}
function Refresh-Tree {
    $script:identityPhase = if ($Mode -eq 'terminate') { 'termination-observation' }
        else { 'refresh' }
    $rows = Inventory
    $seen = [DateTime]::UtcNow.Ticks
    $byPid = @{}
    foreach ($row in $rows) { $byPid[$row.pid] = $row }
    # A seed remains evidence for its original identity, never for a reused PID.
    foreach ($entry in @($known.Values)) {
        if ($byPid.ContainsKey($entry.pid) -and (Same-Identity $entry $byPid[$entry.pid])) {
            $parentRow = if ($byPid.ContainsKey($entry.parentPid)) {
                $byPid[$entry.parentPid]
            } else { $null }
            Remember $byPid[$entry.pid] $seen $parentRow
        }
    }
    do {
        $changed = $false
        foreach ($row in $rows) {
            if ($known.ContainsKey((Identity-Key $row))) { continue }
            $parents = @($known.Values | Where-Object { $_.pid -eq $row.parentPid })
            foreach ($parent in $parents) {
                if ([long]$row.created -lt [long]$parent.created) { continue }
                $parentLive = $byPid.ContainsKey($parent.pid) -and (Same-Identity $parent $byPid[$parent.pid])
                $until = [long]$parent.lastSeen
                $parentKey = Identity-Key $parent
                if ($handles.ContainsKey($parentKey)) {
                    [long]$birth=0; [long]$exit=0; [long]$kernel=0; [long]$user=0
                    if (![OwnedProcessNative]::GetProcessTimes($handles[$parentKey],[ref]$birth,[ref]$exit,[ref]$kernel,[ref]$user)) { throw 'Parent times unavailable' }
                    if ($exit -gt 0) { $until = [DateTime]::FromFileTimeUtc($exit).Ticks }
                }
                # A child of the replacement parent cannot belong to the old tree.
                if ($byPid.ContainsKey($parent.pid) -and !$parentLive -and
                    [long]$row.created -ge [long]$byPid[$parent.pid].created) { continue }
                if (!$parentLive -and [long]$row.created -gt $until) {
                    throw "Ambiguous browser descendant ownership: $($row.pid)"
                }
                Remember $row $seen $parent
                $changed = $true
                break
            }
        }
    } while ($changed)
    # Enumeration absence and ExitTime are insufficient: every captured generation
    # must signal its kernel handle, including rows that vanished from CIM.
    return @($known.Values | Where-Object { !(Native-Exited (Identity-Key $_)) })
}

try {
    foreach ($entry in $ownership.processes) { $known[(Identity-Key $entry)] = $entry }
    if ($Mode -eq 'capture') {
        $rows = Inventory
        $root = @($rows | Where-Object { $_.pid -eq $ownership.rootPid })
        if ($root.Count -ne 1 -or $root[0].parentPid -ne $ownership.runnerPid -or
            ![string]::Equals($root[0].executable, $ownership.executable, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Launched browser root identity could not be established'
        }
        $runner = @($rows | Where-Object { $_.pid -eq $ownership.runnerPid })
        if ($runner.Count -ne 1 -or [long]$root[0].created -lt [long]$runner[0].created) { throw 'Root predates its captured creator' }
        $previousRoot = @($known.Values | Where-Object { $_.pid -eq $ownership.rootPid })
        if ($previousRoot.Count -and !(@($previousRoot | Where-Object { Same-Identity $_ $root[0] }).Count)) {
            throw 'Launched browser root PID was reused'
        }
        if ($ownership.profile) {
        $match = [regex]::Match($root[0].command, '--user-data-dir=(?:"([^"]+)"|([^\s]+))')
        $profile = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
        $expected = [IO.Path]::GetFullPath($ownership.profile).TrimEnd('\')
        $actual = if ($match.Success) { [IO.Path]::GetFullPath($profile) } else { '' }
        if (![string]::Equals($actual, $expected, [StringComparison]::OrdinalIgnoreCase) -and
            !$actual.StartsWith($expected + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Launched browser root does not own the task profile'
        }
        }
        Remember $root[0] ([DateTime]::UtcNow.Ticks) $runner[0]
    } else {
        if (!@($ownership.processes).Count) { throw 'Missing qualified browser tree' }
    }
    do {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Browser tree deadline exceeded' }
        $survivors = @(Refresh-Tree)
        $ownership.processes = @($known.Values | Sort-Object pid, created)
        $pending = @($survivors | Where-Object { (Native-ExitTime (Identity-Key $_)) -gt 0 -or $terminationErrors.ContainsKey((Identity-Key $_)) })
        @{ ownership=$ownership; survivors=$survivors; terminated=@($terminated.Values); pendingTermination=$pending; terminationErrors=@($terminationErrors.Values); nativeAbsent=@($nativeAbsent.Keys);
            at=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress -Depth 8
        if ($Mode -eq 'capture' -or $Mode -eq 'inventory' -or !$survivors.Count) { break }
        if ($Mode -eq 'terminate') {
            # Descendants first, root last. Retained native handles protect the
            # interval between the identity check and termination from PID reuse.
            foreach ($row in @($survivors | Sort-Object @{Expression={ $_.pid -eq $ownership.rootPid }})) {
                $key = Identity-Key $row
                if (!$handles.ContainsKey($key)) { continue }
                $process = $handles[$key]
                if (!(Native-Exited $key) -and !$terminated.ContainsKey($key) -and !$terminationErrors.ContainsKey($key) -and (Native-ExitTime $key) -eq 0) {
                    $code=Request-Termination $process $row.pid
                    if($code -ne 0){
                        # Retain the request error and continue every other qualified
                        # member. Native completion remains a separate kernel wait.
                        $terminationErrors[$key]=@{pid=$row.pid;created=$row.created;win32=$code;api='TerminateProcess'}
                        continue
                    }
                    $terminated[$key]=$known[$key]
                }
            }
        }
        if ([DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($Mode -ne 'capture' -and $Mode -ne 'inventory' -and $survivors.Count) { throw 'Qualified browser tree survived shutdown' }
} finally {
    foreach ($handle in $handles.Values) { $null=[OwnedProcessNative]::CloseHandle($handle) }
}
