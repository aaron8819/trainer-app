param(
    [Parameter(Mandatory = $true)][ValidateSet('capture', 'observe', 'terminate')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$OwnershipBase64,
    [Parameter(Mandatory = $true)][long]$DeadlineUnixMs
)

$ErrorActionPreference = 'Stop'
$ownership = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($OwnershipBase64)) | ConvertFrom-Json
$deadline = [DateTimeOffset]::FromUnixTimeMilliseconds($DeadlineUnixMs).UtcDateTime
$known = @{}
$handles = @{}
$terminated = @{}
$nativeAbsent = @{}

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
function Pin-Handle($Row) {
    $key = Identity-Key $Row
    if ($handles.ContainsKey($key)) {
        if ($handles[$key].HasExited) { $nativeAbsent[$key] = $true }
        return
    }
    $process = $null
    try {
        $process = [Diagnostics.Process]::GetProcessById($Row.pid)
        # Materialize/cache the handle before checking StartTime. A StartTime
        # read alone may use a temporary handle; Kill must use this pinned one.
        $null = $process.Handle
        if ($process.HasExited) { $nativeAbsent[$key] = $true; $process.Dispose(); return }
        if ((Creation-Key $process.StartTime) -ne $Row.created) { $process.Dispose(); return }
        $handles[$key] = $process
    } catch [ArgumentException] {
        # CIM can retain an exited row while native process handles are held.
        # GetProcessById's no-process result qualifies that captured identity's
        # absence; a stale CIM row must not become an unkillable survivor.
        $nativeAbsent[$key] = $true
        if ($process) { $process.Dispose() }
    }
    catch [InvalidOperationException] { if ($process) { $process.Dispose() } }
}
function Remember($Row, [long]$Seen) {
    if ($Row.pid -le 0 -or $Row.pid -eq $PID -or $Row.pid -eq $ownership.runnerPid -or
        !$Row.created -or ![IO.Path]::IsPathRooted($Row.executable)) { throw 'Invalid browser process identity' }
    $key = Identity-Key $Row
    if (!$known.ContainsKey($key)) {
        $known[$key] = [pscustomobject]@{ pid=$Row.pid; parentPid=$Row.parentPid;
            created=$Row.created; executable=$Row.executable; lastSeen=$Seen.ToString() }
    } else { $known[$key].lastSeen = $Seen.ToString() }
    Pin-Handle $Row
}
function Refresh-Tree {
    $rows = Inventory
    $seen = [DateTime]::UtcNow.Ticks
    $byPid = @{}
    foreach ($row in $rows) { $byPid[$row.pid] = $row }
    # A seed remains evidence for its original identity, never for a reused PID.
    foreach ($entry in @($known.Values)) {
        if ($byPid.ContainsKey($entry.pid) -and (Same-Identity $entry $byPid[$entry.pid])) {
            Remember $byPid[$entry.pid] $seen
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
                if ($handles.ContainsKey($parentKey) -and $handles[$parentKey].HasExited) {
                    $until = $handles[$parentKey].ExitTime.ToUniversalTime().Ticks
                }
                # A child of the replacement parent cannot belong to the old tree.
                if ($byPid.ContainsKey($parent.pid) -and !$parentLive -and
                    [long]$row.created -ge [long]$byPid[$parent.pid].created) { continue }
                if (!$parentLive -and [long]$row.created -gt $until) {
                    throw "Ambiguous browser descendant ownership: $($row.pid)"
                }
                Remember $row $seen
                $changed = $true
                break
            }
        }
    } while ($changed)
    return @($rows | Where-Object {
        $key = Identity-Key $_
        $known.ContainsKey($key) -and (Same-Identity $known[$key] $_) -and !$nativeAbsent.ContainsKey($key)
    })
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
        $previousRoot = @($known.Values | Where-Object { $_.pid -eq $ownership.rootPid })
        if ($previousRoot.Count -and !(@($previousRoot | Where-Object { Same-Identity $_ $root[0] }).Count)) {
            throw 'Launched browser root PID was reused'
        }
        $match = [regex]::Match($root[0].command, '--user-data-dir=(?:"([^"]+)"|([^\s]+))')
        $profile = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
        $expected = [IO.Path]::GetFullPath($ownership.profile).TrimEnd('\')
        $actual = if ($match.Success) { [IO.Path]::GetFullPath($profile) } else { '' }
        if (![string]::Equals($actual, $expected, [StringComparison]::OrdinalIgnoreCase) -and
            !$actual.StartsWith($expected + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Launched browser root does not own the task profile'
        }
        Remember $root[0] ([DateTime]::UtcNow.Ticks)
    } else {
        if (!@($ownership.processes).Count) { throw 'Missing qualified browser tree' }
    }
    do {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Browser tree deadline exceeded' }
        $survivors = @(Refresh-Tree)
        $ownership.processes = @($known.Values | Sort-Object pid, created)
        @{ ownership=$ownership; survivors=$survivors; terminated=@($terminated.Values); nativeAbsent=@($nativeAbsent.Keys);
            at=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress -Depth 8
        if ($Mode -eq 'capture' -or !$survivors.Count) { break }
        if ($Mode -eq 'terminate') {
            # Descendants first, root last. Retained native handles protect the
            # interval between the identity check and termination from PID reuse.
            foreach ($row in @($survivors | Sort-Object @{Expression={ $_.pid -eq $ownership.rootPid }})) {
                $key = Identity-Key $row
                if (!$handles.ContainsKey($key)) { continue }
                $process = $handles[$key]
                if (!$process.HasExited) {
                    $process.Kill()
                    $terminated[$key] = $known[$key]
                }
            }
        }
        if ([DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($Mode -ne 'capture' -and $survivors.Count) { throw 'Qualified browser tree survived shutdown' }
} finally {
    foreach ($process in $handles.Values) { $process.Dispose() }
}
