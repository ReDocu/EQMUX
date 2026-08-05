# spike-a4.ps1 — SPIKE-A4: 유휴 RAM 482 분해 (세아 / 2026-08-05)
#
# 판정용이 아니다 (BRIEF-2026-08-05-SPIKE-A4 §1) — 상대 비교용 진단이라
# 규격은 "유휴 60초 후 단일 스냅샷"이다. #6 규격(10표본 중앙값)은 해원의 판정 측정 몫.
#
# 변형(variant)마다: 격리 기동 → 준비 확인 → 유휴 60초 → 스냅샷(프로세스별 + --type별) → 종료.
# 해원 하니스(a2-idle-ram-eqmux.ps1)의 분류 규칙을 그대로 따른다:
#   앱 전용 = eqmux + msedgewebview2 · 셸(pwsh/conhost/OpenConsole)은 제외하되 기록.
# 압력(#15 할 일 3)은 변형마다 시작·종료를 같이 남긴다 — 비교니까 조건이 맞아야 한다.
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\..\..\tools\perf\_paths.ps1"

$exe  = Resolve-EqmuxExe
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outCsv = Join-Path $PSScriptRoot 'spike-a4.csv'
$IDLE_SEC = 60

$commit = try { (git -C $root rev-parse --short HEAD 2>$null) } catch { '?' }
$exeInfo = Get-Item -LiteralPath $exe
"기계: $(Get-MachineLine)"
"빌드: 커밋 $commit · exe $($exeInfo.Length) B · 수정 $($exeInfo.LastWriteTime.ToString('HH:mm:ss'))"
""

$liveEq = @(Get-Process eqmux -ErrorAction SilentlyContinue)
if ($liveEq.Count) { throw "eqmux가 이미 떠 있다 (pid $($liveEq.Id -join ',')) — 중단" }

function Get-Descendants([int]$rootPid) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
  $byParent = @{}
  foreach ($p in $all) {
    $k = [int]$p.ParentProcessId
    if (-not $byParent.ContainsKey($k)) { $byParent[$k] = @() }
    $byParent[$k] += $p
  }
  $out = @(); $queue = @($rootPid); $seen = @{}
  while ($queue.Count -gt 0) {
    $cur = $queue[0]; $queue = @($queue | Select-Object -Skip 1)
    if ($seen.ContainsKey($cur)) { continue }
    $seen[$cur] = $true
    $me = $all | Where-Object { [int]$_.ProcessId -eq [int]$cur } | Select-Object -First 1
    if ($me) { $out += $me }
    if ($byParent.ContainsKey([int]$cur)) { foreach ($c in $byParent[[int]$cur]) { $queue += [int]$c.ProcessId } }
  }
  return $out
}

function Run-Variant {
  param(
    [string]$Name,
    [string[]]$AppArgs,
    [int]$ExpectShells,
    [hashtable]$ExtraEnv = @{}
  )
  $iso = Join-Path $env:TEMP "eqmux-spike-$Name"
  Remove-Item -LiteralPath $iso -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $iso | Out-Null
  $env:EQMUX_STATE_PATH     = Join-Path $iso 'state.json'
  $env:EQMUX_WORKSPACE_ROOT = Join-Path $iso 'workspace'
  $env:EQMUX_DATA_DIR       = Join-Path $iso 'webview'
  foreach ($k in $ExtraEnv.Keys) { Set-Item -Path "env:$k" -Value $ExtraEnv[$k] }

  $memStart = Get-MemoryPressure
  $errLog = Join-Path $iso 'stderr.log'
  $p = Start-Process -FilePath $exe -ArgumentList $AppArgs -PassThru `
         -RedirectStandardError $errLog -RedirectStandardOutput (Join-Path $iso 'stdout.log')
  Start-Sleep -Milliseconds 100
  $t0 = (Get-Process -Id $p.Id).StartTime

  # 준비: 셸 수가 기대치에 닿을 때까지 (빈 화면이면 웹뷰 자손이 생길 때까지)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 30) {
    $d = Get-Descendants $p.Id
    $shells = @($d | Where-Object { $_.Name -in 'pwsh.exe','powershell.exe','cmd.exe' }).Count
    $wv     = @($d | Where-Object { $_.Name -eq 'msedgewebview2.exe' }).Count
    if ($shells -ge $ExpectShells -and $wv -ge 3) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($shells -lt $ExpectShells) {
    try { Stop-Process -Id $p.Id -Force -Confirm:$false } catch {}
    throw "[$Name] 셸 $shells/$ExpectShells — 준비 실패, 중단"
  }
  $readyMs = [math]::Round(((Get-Date) - $t0).TotalMilliseconds)

  # 유휴 — 기동 시점부터 60초를 채운다
  while (((Get-Date) - $t0).TotalSeconds -lt $IDLE_SEC) { Start-Sleep -Milliseconds 300 }

  # 스냅샷 — 프로세스별 WorkingSet + webview --type
  $procs = Get-Descendants $p.Id
  $rows = @()
  foreach ($pr in $procs) {
    $ws = try { (Get-Process -Id $pr.ProcessId -ErrorAction Stop).WorkingSet64 } catch { 0 }
    if ($ws -le 0) { continue }
    $type = ''
    if ($pr.Name -eq 'msedgewebview2.exe') {
      $type = if ($pr.CommandLine -match '--type=(\S+?)(\s|$)') { $Matches[1] } else { 'browser' }
      if ($pr.CommandLine -match '--utility-sub-type=(\S+?)(\s|$)') { $type += "/" + ($Matches[1] -replace '.*\.','') }
    }
    $rows += [pscustomobject]@{
      variant = $Name; name = $pr.Name; type = $type
      ws_mb = [math]::Round($ws / 1MB, 1); pid = $pr.ProcessId
    }
  }
  $app    = ($rows | Where-Object { $_.name -in 'eqmux.exe','msedgewebview2.exe' } | Measure-Object ws_mb -Sum).Sum
  $eq     = ($rows | Where-Object { $_.name -eq 'eqmux.exe' } | Measure-Object ws_mb -Sum).Sum
  $wvSum  = ($rows | Where-Object { $_.name -eq 'msedgewebview2.exe' } | Measure-Object ws_mb -Sum).Sum
  $shell  = ($rows | Where-Object { $_.name -in 'pwsh.exe','powershell.exe','cmd.exe','conhost.exe','OpenConsole.exe' } | Measure-Object ws_mb -Sum).Sum
  $other  = ($rows | Where-Object { $_.name -notin 'eqmux.exe','msedgewebview2.exe','pwsh.exe','powershell.exe','cmd.exe','conhost.exe','OpenConsole.exe' } | Measure-Object ws_mb -Sum).Sum
  $memEnd = Get-MemoryPressure

  # 레버 적용 확인 — stderr 표식. "걸었다고 믿는 것"과 실제를 가른다
  $errTxt = try { Get-Content -LiteralPath $errLog -Raw } catch { '' }
  $leverMark = if ($errTxt -match 'MemoryUsageTargetLevel = Low 적용') { 'lever:ok' }
               elseif ($errTxt -match 'MemoryUsageTargetLevel 적용 실패') { 'lever:FAIL' } else { '' }

  ""
  "== [$Name] 앱 $([math]::Round($app,1)) MB (eqmux $eq + webview $wvSum) · 셸 $shell · 기타 $other · 준비 ${readyMs}ms $leverMark"
  "   압력: 시작 여유 $($memStart.free_gb)GB($($memStart.used_pct)%) → 종료 $($memEnd.free_gb)GB($($memEnd.used_pct)%)"
  $rows | Where-Object { $_.name -eq 'msedgewebview2.exe' } | Sort-Object ws_mb -Descending |
    ForEach-Object { "   webview[$($_.type)] $($_.ws_mb) MB (pid $($_.pid))" }

  # 종료 + 잔여 정리
  try { Stop-Process -Id $p.Id -Force -Confirm:$false } catch {}
  Start-Sleep -Milliseconds 1500
  Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -like "*eqmux-spike-$Name*" } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -Confirm:$false } catch {} }
  foreach ($k in $ExtraEnv.Keys) { Remove-Item -Path "env:$k" -ErrorAction SilentlyContinue }

  return [pscustomobject]@{
    variant = $Name; app_mb = [math]::Round($app,1); eqmux_mb = $eq; webview_mb = $wvSum
    shell_mb = $shell; other_mb = $other; ready_ms = $readyMs; lever = $leverMark
    mem_start = "$($memStart.free_gb)GB/$($memStart.used_pct)%"; mem_end = "$($memEnd.free_gb)GB/$($memEnd.used_pct)%"
    detail = ($rows | Where-Object { $_.name -eq 'msedgewebview2.exe' } |
              Sort-Object ws_mb -Descending | ForEach-Object { "$($_.type)=$($_.ws_mb)" }) -join ' '
  }
}

$results = @()
$results += Run-Variant -Name 'bare'    -AppArgs @('--panes=0') -ExpectShells 0
$results += Run-Variant -Name 'p1'      -AppArgs @('--panes=1') -ExpectShells 1
$results += Run-Variant -Name 'p4'      -AppArgs @('--panes=4') -ExpectShells 4
$results += Run-Variant -Name 'p4-low'  -AppArgs @('--panes=4','--memory-target=low') -ExpectShells 4

$results | Export-Csv -LiteralPath $outCsv -NoTypeInformation -Encoding UTF8
""
"=== 요약 (유휴 ${IDLE_SEC}s 단일값 · WorkingSet · $(Get-MachineCode)) ==="
$results | Format-Table variant, app_mb, eqmux_mb, webview_mb, ready_ms, lever -AutoSize
$B  = ($results | Where-Object variant -eq 'bare').app_mb
$P1 = ($results | Where-Object variant -eq 'p1').app_mb
$P4 = ($results | Where-Object variant -eq 'p4').app_mb
$P  = [math]::Round(($P4 - $P1) / 3, 1)
"B(바닥)=$B MB · 1패널=$P1 · 4패널=$P4 · P(패널당)=$P MB · B+4P=$([math]::Round($B + 4*$P,1)) MB"
"CSV: $outCsv"
