# a4-idle-ram-m1.ps1 — AgentCommender 유휴 RAM 기준선 재측정 (M1)
# 규격: issue.md #6 — 터미널 4개 · 안정화 30초 후 · 30초 간격 · 10표본 · 중앙값
# 격리: BASELINE.md §1 규칙 준수 (라이브 선행 확인 · 전후 acmux list · 격리 인스턴스만 종료)
# 지표: WorkingSet64 (BASELINE §3.4와 동일 — 바꾸면 비교 불가)
$ErrorActionPreference = 'Stop'

$ops      = 'D:\ClaudeCockpit\root\AgentCommender\ops'
$electron = Join-Path $ops 'node_modules\electron\dist\electron.exe'
$base     = Join-Path $env:TEMP 'acmux-a4'
$udata    = Join-Path $base 'udata'
$ws       = Join-Path $base 'ws'
$statePath= Join-Path $base 'state.json'
$outCsv   = Join-Path $PSScriptRoot 'a4-idle-ram-m1.csv'
$SAMPLES  = 10
$FIRST_AT = 30    # 초 — 첫 표본 시각 (T0 기준)
$INTERVAL = 30    # 초

function Kill-Isolated {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.CommandLine -like '*acmux-a4*' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { } }
}
function Read-Shared([string]$path) {
  try {
    $fs = [IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,
                          ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $sr = New-Object IO.StreamReader($fs,[Text.Encoding]::UTF8)
    $t = $sr.ReadToEnd(); $sr.Close(); $fs.Close(); return $t
  } catch { return $null }
}
function Test-PromptWritten([string]$path) {
  $raw = Read-Shared $path
  if ([string]::IsNullOrEmpty($raw)) { return $false }
  $i = $raw.IndexOf('────'); if ($i -lt 0) { return $true }
  $j = $raw.IndexOf("`n", $i); if ($j -lt 0) { return $false }
  return ($raw.Substring($j + 1).Trim().Length -gt 0)
}
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
function Get-LiveSessions {
  try { return ((& node (Join-Path $ops 'dist\cli\acmux.js') list 2>&1) | Out-String).Trim() }
  catch { return "acmux 실패: $_" }
}

# ---- 격리 규칙 1·3 ----
$liveBefore = Get-LiveSessions
"=== 측정 전 라이브 세션 ==="; $liveBefore
if ($liveBefore -match '앱이 실행 중이 아닙니다') { throw '라이브 인스턴스 없음 — 중단 (BASELINE §1 규칙 1)' }

# ---- 시드: 팀 1 × 세션 4, mode=terminal ----
$pane = { param($n) [ordered]@{ type='pane'; session=$n } }
$state = [ordered]@{
  version = 1
  teams = @([ordered]@{
    name='BASE'; mode='terminal'; preset='grid-col'
    layout=[ordered]@{ type='split'; dir='col'; ratio=0.5
      a=[ordered]@{ type='split'; dir='col'; ratio=0.5; a=(& $pane 't1'); b=(& $pane 't2') }
      b=[ordered]@{ type='split'; dir='col'; ratio=0.5; a=(& $pane 't3'); b=(& $pane 't4') } } })
  settings = [ordered]@{ fontSize=14; shell=''; panelSide='right' }
}
Kill-Isolated; Start-Sleep -Milliseconds 800
Remove-Item -LiteralPath $ws -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $base, $ws, $udata | Out-Null
Set-Content -LiteralPath $statePath -Value ($state | ConvertTo-Json -Depth 20) -Encoding UTF8
$env:ACMUX_STATE_PATH = $statePath
$env:ACMUX_WORKSPACE_ROOT = $ws

# ---- 기동 ----
$p  = Start-Process -FilePath $electron -ArgumentList $ops, "--user-data-dir=`"$udata`"" -PassThru
Start-Sleep -Milliseconds 60
$t0 = (Get-Process -Id $p.Id).StartTime
"기동: pid=$($p.Id) · T0=$($t0.ToString('HH:mm:ss.fff'))"

$logs = 1..4 | ForEach-Object { Join-Path $ws "BASE\t$_\session.log" }
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 30) {
  if (@($logs | Where-Object { (Test-Path $_) -and (Test-PromptWritten $_) }).Count -eq 4) { break }
  Start-Sleep -Milliseconds 50
}
$readyMs = [math]::Round(((Get-Date) - $t0).TotalMilliseconds)
"터미널 4개 준비: ${readyMs} ms — 이후 아무 입력도 하지 않는다 (유휴)"
""
"경과   트리MB   electron   pwsh   conhost   기타   프로세스수"

$rows = @()
for ($i = 1; $i -le $SAMPLES; $i++) {
  $targetSec = $FIRST_AT + ($i - 1) * $INTERVAL
  while (((Get-Date) - $t0).TotalSeconds -lt $targetSec) { Start-Sleep -Milliseconds 200 }

  $procs = Get-Descendants $p.Id
  $sum = @{ electron=0; powershell=0; conhost=0; other=0 }
  $n = 0
  foreach ($pr in $procs) {
    $ws64 = try { (Get-Process -Id $pr.ProcessId -ErrorAction Stop).WorkingSet64 } catch { 0 }
    if ($ws64 -le 0) { continue }
    $n++
    switch -Wildcard ($pr.Name) {
      'electron.exe'   { $sum.electron   += $ws64 }
      'powershell.exe' { $sum.powershell += $ws64 }
      'pwsh.exe'       { $sum.powershell += $ws64 }
      'conhost.exe'    { $sum.conhost    += $ws64 }
      default          { $sum.other      += $ws64 }
    }
  }
  $mb = { param($b) [math]::Round($b / 1MB, 1) }
  $tree = (& $mb ($sum.electron + $sum.powershell + $sum.conhost + $sum.other))
  $row = [pscustomobject]@{
    elapsed_s = [math]::Round(((Get-Date) - $t0).TotalSeconds)
    tree_mb   = $tree
    app_mb    = (& $mb $sum.electron)
    pwsh_mb   = (& $mb $sum.powershell)
    conhost_mb= (& $mb $sum.conhost)
    other_mb  = (& $mb $sum.other)
    procs     = $n
  }
  $rows += $row
  "{0,4}s  {1,8}  {2,9}  {3,6}  {4,8}  {5,6}  {6,8}" -f $row.elapsed_s, $row.tree_mb, $row.app_mb, $row.pwsh_mb, $row.conhost_mb, $row.other_mb, $row.procs | Write-Host
}

$rows | Export-Csv -LiteralPath $outCsv -NoTypeInformation -Encoding UTF8

function Med([double[]]$v) {
  $s = $v | Sort-Object; $n = $s.Count
  if ($n % 2) { return $s[[int](($n-1)/2)] }
  return [math]::Round(($s[$n/2 - 1] + $s[$n/2]) / 2, 1)
}
$appMed  = Med ($rows.app_mb)
$treeMed = Med ($rows.tree_mb)
$shell   = Med (@(0..($rows.Count-1) | ForEach-Object { $rows[$_].pwsh_mb + $rows[$_].conhost_mb }))

""
"=== 결과 (M1 · n=$SAMPLES · WorkingSet64 중앙값) ==="
"앱 전용 (electron)   : $appMed MB   [범위 $(($rows.app_mb | Measure-Object -Min).Minimum) ~ $(($rows.app_mb | Measure-Object -Max).Maximum)]"
"트리 전체            : $treeMed MB  [범위 $(($rows.tree_mb | Measure-Object -Min).Minimum) ~ $(($rows.tree_mb | Measure-Object -Max).Maximum)]"
"셸 페이로드(pwsh+conhost): $shell MB"
"진동 폭 (앱)         : $([math]::Round((($rows.app_mb | Measure-Object -Max).Maximum - ($rows.app_mb | Measure-Object -Min).Minimum),1)) MB"
""
"A-4 기준 (issue #6·#11): 앱 전용 ≤ 기준선의 40%  →  목표 = $([math]::Round($appMed * 0.4, 1)) MB"
"CSV: $outCsv"

Kill-Isolated
Start-Sleep -Milliseconds 1500
"=== 측정 후 라이브 세션 ==="
Get-LiveSessions
"격리 잔여: $(@(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*acmux-a4*' }).Count) 개"
