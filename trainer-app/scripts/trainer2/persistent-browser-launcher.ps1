param(
    [Parameter(Mandatory=$true)][string]$Executable,
    [Parameter(Mandatory=$true)][string]$Profile
)
$ErrorActionPreference = 'Stop'
if (![IO.Path]::IsPathRooted($Executable) -or !(Test-Path -LiteralPath $Executable) -or
    ![IO.Path]::IsPathRooted($Profile) -or !(Test-Path -LiteralPath $Profile)) { throw 'Invalid native browser launch paths' }
$browser = $null
try {
    $arguments = @('--headless', '--disable-gpu', '--disable-background-mode', '--disable-crash-reporter',
        '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
        '--remote-debugging-address=127.0.0.1', ('--user-data-dir="' + $Profile + '"'), 'about:blank')
    $browser = Start-Process -FilePath $Executable -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $null = $browser.Handle
    @{ event='native-launch'; rootPid=$browser.Id; runnerPid=$PID; executable=$Executable; profile=$Profile;
        created=$browser.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
    # The originally returned Windows handle can remain unsignaled after native
    # process enumeration confirms absence. Observe independently, with creation
    # identity, rather than waiting indefinitely on that stale launch handle.
    $created = $browser.StartTime.ToUniversalTime().Ticks
    $deadline = [DateTime]::UtcNow.AddMinutes(15)
    $absent = $false
    do {
        $probe = $null
        try {
            $probe = [Diagnostics.Process]::GetProcessById($browser.Id)
            $absent = $probe.HasExited -or $probe.StartTime.ToUniversalTime().Ticks -ne $created
        } catch [ArgumentException] { $absent = $true }
        finally { if ($probe) { $probe.Dispose() } }
        if (!$absent) { Start-Sleep -Milliseconds 50 }
    } while (!$absent -and [DateTime]::UtcNow -lt $deadline)
    if (!$absent) { throw 'Native browser lifetime deadline exceeded' }
    $signaled = $browser.HasExited
    $exitCode = if ($signaled) { $browser.ExitCode } else { $null }
    @{ event='native-exit'; rootPid=$browser.Id; exitCode=$exitCode;
        exited=$absent; originalHandleSignaled=$signaled; observation='independent-native-process-absence';
        at=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress
} finally { if ($browser) { $browser.Dispose() } }
