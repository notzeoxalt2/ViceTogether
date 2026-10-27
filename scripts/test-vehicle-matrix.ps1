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
  $row = [pscustomobject]@{
    model = $model
    launcherStatus = $launcherStatus
    success = [bool]($desktop.success -and $native.success)
    error = $desktop.error
    class = $native.vehicleClass
    positionErrorP95Metres = $native.carReplication.positionErrorP95Metres
    driverArrivalP95Ms = $native.carReplication.driverIntervalP95Ms
    hostMedianFps = $native.carPerformance[0].medianFps
    guestMedianFps = $native.carPerformance[1].medianFps
    passengerVisibleRatio = $native.remoteSeatStates[1].visibleRatio
    exitedPlayers = @($native.exits | Where-Object { $_.exited }).Count
    doorSamples = $native.openDoorSamples
    wheelMotion = $native.wheelMotion
    rotorMotion = $native.rotorMotion
  }
  $results.Add($row)
  $results | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $OutputRoot 'summary.json')
  Write-Output ($row | ConvertTo-Json -Compress -Depth 5)
  if (!$row.success) { $firstFailure = $row; break }
}

if ($firstFailure) { throw "Vehicle matrix stopped at model $($firstFailure.model). See its console.log and desktop-tests.json." }
