# s211-idle-ram-panes8.ps1 — S2-11: 8분할 유휴 RAM **참고치** (세아 / 2026-08-05)
#
# 왜 재나: 배치 프리셋이 들어오면 사용자가 8개를 한 번에 연다. A-4 판정선 219.8 MB는
#          **터미널 4개 기준**(issue.md #11)이라, 8분할이 그 선 위로 가는지 숫자가 필요하다.
#          브리프 BRIEF-2026-08-05-S2-11 §3 — **숫자만 낸다. 기준 재검토 여부는 이안이 판단한다.**
#
# 🔴 판정이 아니다. `#6` 규격(터미널 4개)이 아니라 8개로 재는 **비규격 참고치**다.
#    A-4 판정은 해원의 `#6` 규격 재측정으로만 한다.
#
# 대상: **핀 exe**(BUILD-PIN-2026-08-05.md) — 트리에서 개발이 병행돼도 재는 바이트가 안 흔들린다.
#       S2-10 ④(4분할 ≈175.7 MB)와 같은 제품 소스(71ca09b)다.
#       (S2-11 코드는 이 숫자에 안 들어간다 — 프리셋은 8분할을 *만드는* 기능이지 8분할의 비용이 아니다)
#
# 🔴 기계가 다르면 비교하지 않는다 (`#15`). S2-10 ④는 **M2**에서 쟀다. 이 하니스를 M1에서 돌리면
#    그 값과 직접 비교할 수 없다 — **같은 기계에서 `-Panes 4`를 한 번 더 돌려 대조군을 만든다.**
#
# 방법: a2-idle-ram-eqmux.ps1과 같다 — 격리 env 3종 · 유휴 정책 켠 채 · WorkingSet64 ·
#       안정화 30초 후 30초 간격. 표본만 20개(10분)로 늘렸다:
#         · 표본 1~10 중앙값  → `#6` 창과 같은 계산 (A-4 판정과 같은 자)
#         · 표본 20 (≈600초)  → S2-10 ④의 "10분 시점"과 같은 자리
param([int]$Panes = 8)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_paths.ps1"

$SAMPLES  = 20
$FIRST_AT = 30
$INTERVAL = 30
$PANES    = $Panes

# ---- 핀 검증 (BUILD-PIN-2026-08-05.md §3) — 재는 바이트를 직접 지목한다 ----
$pinDir = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))) '_pins\eqmux-71ca09b'
if ($env:EQMUX_PIN_DIR) { $pinDir = $env:EQMUX_PIN_DIR }
$exe  = Join-Path $pinDir 'eqmux.exe'
$man  = Join-Path $pinDir 'MANIFEST.json'
if (-not (Test-Path -LiteralPath $exe)) { throw "핀 exe 없음: $exe (EQMUX_PIN_DIR로 지정할 수 있다)" }
$want = (Get-Content -LiteralPath $man -Raw | ConvertFrom-Json).sha256
$got  = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
if ($got -ne $want) { throw "핀이 변조됐다 — 멈춘다`n  기대 $want`n  실제 $got" }
"핀 확인: $exe"
"  $((Get-Item $exe).Length) B · sha256 $got"

$memAtStart = Assert-MemoryHeadroom -MinFreeGb 3.0

$iso    = Join-Path $env:TEMP "eqmux-s211-panes$PANES"
$outCsv = Join-Path $PSScriptRoot "s211-idle-ram-panes$PANES.csv"

$liveEq = @(Get-Process eqmux -ErrorAction SilentlyContinue)
if ($liveEq.Count) { throw "eqmux 프로세스가 이미 떠 있다 (pid $($liveEq.Id -join ', ')) — 중단" }

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

"기계: $(Get-MachineLine)"
$p = Start-Process -FilePath $exe -ArgumentList "--panes=$PANES" -PassThru `
       -RedirectStandardError $errLog -RedirectStandardOutput $outLog
Start-Sleep -Milliseconds 60
$t0 = (Get-Process -Id $p.Id).StartTime
"기동: pid=$($p.Id) · T0=$($t0.ToString('HH:mm:ss.fff')) · --panes=$PANES"

# 셸 8개가 다 붙을 때까지 (안정화 30초 안에 끝나야 한다)
$sw = [Diagnostics.Stopwatch]::StartNew()
$shells = 0
while ($sw.Elapsed.TotalSeconds -lt 30) {
  $d = Get-Descendants $p.Id
  $shells = @($d | Where-Object { $_.Name -in 'pwsh.exe','powershell.exe','cmd.exe' }).Count
  if ($shells -eq $PANES) { break }
  Start-Sleep -Milliseconds 250
}
$readyMs = [math]::Round(((Get-Date) - $t0).TotalMilliseconds)
if ($shells -ne $PANES) {
  try { Stop-Process -Id $p.Id -Force } catch { }
  throw "셸이 $PANES 개가 아니다 ($shells 개, ${readyMs}ms) — 8분할 조건 불성립. 중단"
}
"터미널 $PANES 개 준비: ${readyMs} ms — 이후 아무 입력도 하지 않는다 (유휴)"
""
"경과   앱MB      eqmux   webview   셸MB   기타   트리MB   프로세스수"

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
    sample     = $i
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
  "{0,4}s  {1,7}  {2,6}  {3,8}  {4,6}  {5,5}  {6,7}  {7,9}" -f $row.elapsed_s, $row.app_mb, $row.eqmux_mb, $row.webview_mb, $row.shell_mb, $row.other_mb, $row.tree_mb, $row.procs | Write-Host
}

$rows | Export-Csv -LiteralPath $outCsv -NoTypeInformation -Encoding UTF8

function Med([double[]]$v) {
  $s = $v | Sort-Object; $n = $s.Count
  if ($n % 2) { return $s[[int](($n-1)/2)] }
  return [math]::Round(($s[$n/2 - 1] + $s[$n/2]) / 2, 1)
}
$win6     = Med (($rows | Select-Object -First 10).app_mb)   # `#6` 창과 같은 계산
$allMed   = Med ($rows.app_mb)
$tail     = $rows[-1]
$shellMed = Med ($rows.shell_mb)
$memAtEnd = Get-MemoryPressure

# 유휴 정책이 실제로 돌았는가 — 진동/재진입이 있으면 숫자의 뜻이 달라진다 (MEMLEVEL §5)
$errTxt  = try { Get-Content -LiteralPath $errLog -Raw -ErrorAction Stop } catch { '' }
$memLines = @($errTxt -split "`r?`n" | Where-Object { $_ -match '\[memlevel\]' })

try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { }
Start-Sleep -Milliseconds 1500
$leftover = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
              Where-Object { $_.CommandLine -like "*eqmux-s211-panes$PANES*" })
$leftover | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch { } }
Start-Sleep -Milliseconds 500
$remain = @(Get-Process eqmux -ErrorAction SilentlyContinue).Count

""
"=== 결과 ($(Get-MachineCode) · --panes=$PANES · 유휴 · WorkingSet64) — 🔴 비규격 참고치 ==="
"측정 시작 메모리: 여유 $($memAtStart.free_gb) GB · 사용률 $($memAtStart.used_pct)%"
"측정 종료 메모리: 여유 $($memAtEnd.free_gb) GB · 사용률 $($memAtEnd.used_pct)%"
"앱 전용 (eqmux+WebView2)"
"  표본 1~10 중앙값 : $win6 MB   ← `#6` 창과 같은 계산 (4분할 판정선 219.8과 같은 자)"
"  표본 1~20 중앙값 : $allMed MB"
"  표본 20 (~600초) : $($tail.app_mb) MB   ← S2-10 ④의 '10분 시점 ≈175.7 MB(4분할)'와 같은 자리"
"  범위             : $(($rows.app_mb | Measure-Object -Min).Minimum) ~ $(($rows.app_mb | Measure-Object -Max).Maximum) MB"
"셸 페이로드 (제외) : $shellMed MB"
"유휴 정책 전이 $($memLines.Count) 줄:"
$memLines | ForEach-Object { "  $_" }
"격리 잔여: $remain 개"
"CSV: $outCsv"
""
"🔴 이 숫자는 판정이 아니다. A-4 기준 재검토 여부는 이안이 판단한다 (BRIEF S2-11 §3)."
