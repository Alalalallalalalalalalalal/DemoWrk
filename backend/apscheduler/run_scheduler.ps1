# run_scheduler.ps1 — keeps scheduler.py running.
#
# scheduler.py itself has no way to restart itself if it crashes or the
# machine reboots. This wrapper does that: it restarts scheduler.py
# automatically on any non-clean exit, with a short backoff so a persistent
# failure (e.g. bad credentials) doesn't spin the CPU in a tight loop.
# A clean stop (Ctrl+C, or scheduler.py catching KeyboardInterrupt and
# exiting 0) ends the loop instead of restarting.
#
# To also survive a machine reboot / user logoff, register this with
# Windows Task Scheduler:
#   Action:  powershell.exe
#   Arguments: -ExecutionPolicy Bypass -File "<full path to this file>"
#   Trigger: At startup (or At log on)
#   General: "Run whether user is logged on or not"

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$restartCount = 0
while ($true) {
    $restartCount++
    Write-Host "[$(Get-Date -Format o)] Starting scheduler.py (attempt $restartCount)"

    python scheduler.py
    $exitCode = $LASTEXITCODE

    Write-Host "[$(Get-Date -Format o)] scheduler.py exited with code $exitCode"

    if ($exitCode -eq 0) {
        Write-Host "Clean exit — not restarting."
        break
    }

    Write-Host "Crashed — restarting in 30 seconds (Ctrl+C to cancel)..."
    Start-Sleep -Seconds 30
}
