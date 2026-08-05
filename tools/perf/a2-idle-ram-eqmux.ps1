# a2-idle-ram-eqmux.ps1 — 관문 A2: EQMUX 유휴 RAM 판정 측정 (해원 / 2026-08-05)
# 규격: issue.md #6 그대로 — 터미널 4개 · 안정화 30초 후 · 30초 간격 · 10표본 · 중앙값 · WorkingSet64
# 대상: "앱 전용" = eqmux.exe + WebView2(msedgewebview2) 프로세스군. 셸(pwsh·conhost)은 제외하되 기록한다
# 재현: LAYOUT-S2-2.md §6 — 격리 env 3종 + --panes=4 (2×2 셸 4개 자동. 손 조작 금지)
# 판정선: 앱 전용 중앙값 ≤ 219.8 MB (BASELINE §3.6 기준선 549.6 × 40% · #6) — 숫자만 낸다. 판정은 이안
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_paths.ps1"

# 🔴 착수 게이트 — 여유 ≥ 3 GB (이안 지시 2026-08-05 · A-4-M2 브리프 §0과 동일)
#    판정 "대상" 측정에서는 압력이 유리한 쪽으로 작용한다 — 압력이 높으면 EQMUX 워킹셋이 잘려
#    낮게 측정되고 판정(≤219.8)이 쉬워진다. 기준선(보수적)과 방향이 반대다. 미달이면 중단이다.
$memAtStart = Assert-MemoryHeadroom -MinFreeGb 3.0

$exe    = Resolve-EqmuxExe
$root   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$iso    = Join-Path $env:TEMP 'eqmux-a2-iso'
$outCsv = Join-Path $PSScriptRoot 'a2-idle-ram-eqmux.csv'
$SAMPLES  = 10
$FIRST_AT = 30    # 초 — 첫 표본 시각 (T0 기준 · #6 안정화 30초)
$INTERVAL = 30    # 초

# 빌드 신원 — 트리가 더러우면 여기서 멈춘다 (이안 ③ · 2026-08-05 세 번 잡힌 함정)
$build = Assert-CleanBuildForVerdict -ExePath $exe

# 라이브 eqmux가 있으면 중단 — 도그푸딩 전이라 없어야 정상. 있다면 산 세션을 죽일 수 있다
$liveEq = @(Get-Process eqmux -ErrorAction SilentlyContinue)
if ($liveEq.Count) { throw "eqmux 프로세스가 이미 떠 있다 (pid $($liveEq.Id -join ', ')) — 라이브/격리 판단이 필요하다. 중단" }

# ---- 격리 환경 (LAYOUT-S2-2.md §6 그대로) ----
Remove-Item -LiteralPath $iso -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $iso | Out-Null
$env:EQMUX_STATE_PATH     = Join-Path $iso 'state.json'
$env:EQMUX_WORKSPACE_ROOT = Join-Path $iso 'workspace'
$env:EQMUX_DATA_DIR       = Join-Path $iso 'webview'
$errLog = Join-Path $iso 'stderr.log'
$outLog = Join-Path $iso 'stdout.log'

function Get-Descendants([int]$rootPid) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
  $byParent = @{}
  foreach ($p in $all) {
    if (-not $byParent.ContainsKey([int]$p.ParentProcessId)) { $byParent[[int]$p.ParentProcessId] = @() }
    $byParent[[int]$p.ParentProcessId] += $p
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

# ---- 기동 — 2×2 셸 4개 자동 ----
"기계: $(Get-MachineLine)"
$p = Start-Process -FilePath $exe -ArgumentList '--panes=4' -PassThru `
       -RedirectStandardError $errLog -RedirectStandardOutput $outLog
Start-Sleep -Milliseconds 60
$t0 = (Get-Process -Id $p.Id).StartTime
"기동: pid=$($p.Id) · T0=$($t0.ToString('HH:mm:ss.fff'))"

# 준비 확인 — 셸 4개가 붙을 때까지 (최대 30초. #6의 안정화 30초 안에 끝나야 한다)
$sw = [Diagnostics.Stopwatch]::StartNew()
$shells = 0
while ($sw.Elapsed.TotalSeconds -lt 30) {
  $d = Get-Descendants $p.Id
  $shells = @($d | Where-Object { $_.Name -in 'pwsh.exe','powershell.exe','cmd.exe' }).Count
  if ($shells -eq 4) { break }
  Start-Sleep -Milliseconds 250
}
$readyMs = [math]::Round(((Get-Date) - $t0).TotalMilliseconds)
if ($shells -ne 4) {
  try { Stop-Process -Id $p.Id -Force } catch { }
  throw "셸이 4개가 아니다 ($shells 개, ${readyMs}ms 경과) — '터미널 4개' 조건 불성립. 중단"
}
"터미널 4개 준비: ${readyMs} ms — 이후 아무 입력도 하지 않는다 (유휴)"

# 격리 확인 — 배지를 눈으로 못 보는 대신 stderr의 격리 경로 출력을 확인한다 (README §측정용 격리 실행)
Start-Sleep -Milliseconds 500
$errTxt = try { Get-Content -LiteralPath $errLog -Raw -ErrorAction Stop } catch { '' }
if ($errTxt -and ($errTxt -match '격리|EQMUX_STATE_PATH|isolat')) { "격리 인스턴스 확인: stderr에 격리 경로 출력 ✅" }
else { Write-Warning "stderr에서 격리 표식을 못 찾았다 — 측정 후 stderr.log를 직접 확인할 것" }
""
"경과   앱MB(판정)   eqmux   webview   셸MB   기타   트리MB   프로세스수"

$rows = @()
for ($i = 1; $i -le $SAMPLES; $i++) {
  $targetSec = $FIRST_AT + ($i - 1) * $INTERVAL
  while (((Get-Date) - $t0).TotalSeconds -lt $targetSec) { Start-Sleep -Milliseconds 200 }

  $procs = Get-Descendants $p.Id
  $sum = @{ eqmux=0; webview=0; shell=0; other=0 }
  $n = 0
  foreach ($pr in $procs) {
    $ws64 = try { (Get-Process -Id $pr.ProcessId -ErrorAction Stop).WorkingSet64 } catch { 0 }
    if ($ws64 -le 0) { continue }
    $n++
    switch -Wildcard ($pr.Name) {
      'eqmux.exe'          { $sum.eqmux   += $ws64 }
      'msedgewebview2.exe' { $sum.webview += $ws64 }
      'pwsh.exe'           { $sum.shell   += $ws64 }
      'powershell.exe'     { $sum.shell   += $ws64 }
      'cmd.exe'            { $sum.shell   += $ws64 }
      'conhost.exe'        { $sum.shell   += $ws64 }
      'OpenConsole.exe'    { $sum.shell   += $ws64 }
      default              { $sum.other   += $ws64 }
    }
  }
  $mb = { param($b) [math]::Round($b / 1MB, 1) }
  $row = [pscustomobject]@{
    elapsed_s  = [math]::Round(((Get-Date) - $t0).TotalSeconds)
    app_mb     = (& $mb ($sum.eqmux + $sum.webview))
    eqmux_mb   = (& $mb $sum.eqmux)
    webview_mb = (& $mb $sum.webview)
    shell_mb   = (& $mb $sum.shell)
    other_mb   = (& $mb $sum.other)
    tree_mb    = (& $mb ($sum.eqmux + $sum.webview + $sum.shell + $sum.other))
    procs      = $n
  }
  $rows += $row
  "{0,4}s  {1,10}  {2,6}  {3,8}  {4,6}  {5,5}  {6,7}  {7,9}" -f $row.elapsed_s, $row.app_mb, $row.eqmux_mb, $row.webview_mb, $row.shell_mb, $row.other_mb, $row.tree_mb, $row.procs | Write-Host
}

$rows | Export-Csv -LiteralPath $outCsv -NoTypeInformation -Encoding UTF8

function Med([double[]]$v) {
  $s = $v | Sort-Object; $n = $s.Count
  if ($n % 2) { return $s[[int](($n-1)/2)] }
  return [math]::Round(($s[$n/2 - 1] + $s[$n/2]) / 2, 1)
}
$appMed   = Med ($rows.app_mb)
$treeMed  = Med ($rows.tree_mb)
$shellMed = Med ($rows.shell_mb)
$memAtEnd = Get-MemoryPressure

# ---- 정리 — 격리 인스턴스만 종료 ----
try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { }
Start-Sleep -Milliseconds 1500
$leftover = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
              Where-Object { $_.CommandLine -like "*eqmux-a2-iso*" })
$leftover | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch { } }
Start-Sleep -Milliseconds 500
$remain = @(Get-Process eqmux -ErrorAction SilentlyContinue).Count +
          @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
            Where-Object { $_.CommandLine -like "*eqmux-a2-iso*" }).Count

""
"=== 결과 ($(Get-MachineCode) · n=$SAMPLES · WorkingSet64 중앙값) ==="
"측정 시작 시 메모리: 여유 $($memAtStart.free_gb) GB · 사용률 $($memAtStart.used_pct)%"
"측정 종료 시 메모리: 여유 $($memAtEnd.free_gb) GB · 사용률 $($memAtEnd.used_pct)%"
"앱 전용 (eqmux+WebView2) : $appMed MB   [범위 $(($rows.app_mb | Measure-Object -Min).Minimum) ~ $(($rows.app_mb | Measure-Object -Max).Maximum)]"
"트리 전체                : $treeMed MB"
"셸 페이로드 (제외 대상)   : $shellMed MB"
"진동 폭 (앱)             : $([math]::Round((($rows.app_mb | Measure-Object -Max).Maximum - ($rows.app_mb | Measure-Object -Min).Minimum),1)) MB"
""
"A-4 판정선 (#6·#11): 앱 전용 중앙값 ≤ 219.8 MB  →  실측 $appMed MB  (판정은 이안)"
"격리 잔여: $remain 개"
"CSV: $outCsv"
