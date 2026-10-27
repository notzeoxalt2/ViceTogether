param(
  [Parameter(Mandatory=$true)][string]$GameRoot,
  [Parameter(Mandatory=$true)][string]$LibraryRoot,
  [Parameter(Mandatory=$true)][string]$OutputRoot,
  [int[]]$Models = @(130,135,141,145,159,155,217,166,191,192,193,176,182,203,190),
  [int]$DurationSeconds = 50
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $repo 'node_modules\.bin\electron.cmd'
$scratch = Join-Path $OutputRoot 'scratch'
if (!(Test-Path -LiteralPath $GameRoot)) { throw "Game files were not found: $GameRoot" }
if (!(Test-Path -LiteralPath $LibraryRoot)) { throw "Test library was not found: $LibraryRoot" }
if (!(Test-Path -LiteralPath $electron)) { throw "Electron is not installed in this checkout: $electron" }
New-Item -ItemType Directory -Force -Path $OutputRoot,$scratch,'E:\CodexData\ViceTogetherTestTemp' | Out-Null

$env:TEMP = 'E:\CodexData\ViceTogetherTestTemp'
$env:TMP = $env:TEMP
$env:VT_TEST_LIBRARY = (Resolve-Path -LiteralPath $LibraryRoot).Path
$env:VT_TEST_GAME_ROOT = (Resolve-Path -LiteralPath $GameRoot).Path
$env:VT_TEST_UI_GAME = '1'
$env:VT_TEST_GUEST_DRIVE = '1'
$env:VT_TEST_DURATION = [string]$DurationSeconds
Remove-Item Env:VT_TEST_SHOW -ErrorAction SilentlyContinue
Remove-Item Env:VT_TEST_COMBAT -ErrorAction SilentlyContinue

$results = [System.Collections.Generic.List[object]]::new()
$firstFailure = $null
foreach ($model in $Models) {
  $name = "vehicle-$model"
  $out = Join-Path $OutputRoot $name
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  $env:VT_TEST_PROFILE = Join-Path $scratch "profile-$model"
  $env:VT_TEST_OUTPUT = $out
  $env:VT_TEST_VEHICLE = [string]$model

  & $electron $repo --self-test --native-test --disable-gpu *> (Join-Path $out 'console.log')
  $launcherStatus = $LASTEXITCODE
  $desktop = $null
  if (Test-Path (Join-Path $out 'desktop-tests.json')) {
    $desktop = Get-Content (Join-Path $out 'desktop-tests.json') -Raw | ConvertFrom-Json
  }
  $native = $desktop.nativeGame
  $hasNative = $null -ne $native
  $carPerformance = if ($hasNative) { @($native.carPerformance) } else { @() }
  $remoteSeatStates = if ($hasNative) { @($native.remoteSeatStates) } else { @() }
  $failure = if ($desktop.error) { $desktop.error } elseif ($native.error) { $native.error } else { $null }
  $row = [pscustomobject]@{
    model = $model
    launcherStatus = $launcherStatus
    success = [bool]($desktop.success -and $hasNative -and $native.success)
    error = $failure
    class = if ($hasNative) { $native.vehicleClass } else { $null }
    positionErrorP95Metres = if ($hasNative) { $native.carReplication.positionErrorP95Metres } else { $null }
    driverArrivalP95Ms = if ($hasNative) { $native.carReplication.driverIntervalP95Ms } else { $null }
    hostMedianFps = if ($carPerformance.Count -gt 0) { $carPerformance[0].medianFps } else { $null }
    guestMedianFps = if ($carPerformance.Count -gt 1) { $carPerformance[1].medianFps } else { $null }
    passengerVisibleRatio = if ($remoteSeatStates.Count -gt 1) { $remoteSeatStates[1].visibleRatio } else { $null }
    exitedPlayers = if ($hasNative) { @($native.exits | Where-Object { $_.exited }).Count } else { 0 }
    doorSamples = if ($hasNative) { $native.openDoorSamples } else { $null }
    wheelMotion = if ($hasNative) { $native.wheelMotion } else { $null }
    rotorMotion = if ($hasNative) { $native.rotorMotion } else { $null }
  }
  $results.Add($row)
  $results | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $OutputRoot 'summary.json')
  Write-Output ($row | ConvertTo-Json -Compress -Depth 5)
  if (!$row.success -and !$firstFailure) { $firstFailure = $row }
}

if ($firstFailure) { throw "Vehicle matrix completed with failures; first was model $($firstFailure.model). See summary.json and each vehicle's console.log/desktop-tests.json." }
