# coldstart-n10.ps1 — AgentCommender 콜드스타트 n=10 (윤해원 / S0-1 보강)
# BASELINE.md §1 격리 규칙 준수. 라이브 인스턴스를 건드리지 않는다.
#
# BASELINE §2의 T1 정의 결함을 고쳐 두 값을 각각 잰다:
#   T_create = session.log 첫 바이트 = PtyManager.create()의 '세션 시작' 헤더 (셸 출력 아님)
#   T_prompt = 헤더 '────' 줄 뒤에 처음으로 비지 않은 내용이 붙은 시각 = 셸 첫 출력(프롬프트)
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_paths.ps1"                    # 경로는 하드코딩하지 않고 찾는다 (README §경로)

# 🔴 착수 조건 — 여유 ≥ 3 GB (BRIEF-2026-08-05-KR3-M2.md §2-1 ②)
#    KR3은 압력이 "유리한 쪽"으로 작용한다 — 압력이 높으면 기동이 느려져 기준선이 부풀고
#    목표가 느슨해진다. A-4(워킹셋 잘림 → 보수적)와 방향이 반대다.
#    그래서 게이트 미달은 경고가 아니라 중단이다 — 그 조건에서 잰 기준선은 판정을 유리하게 만든다.
$memAtStart = Assert-MemoryHeadroom -MinFreeGb 3.0

$ops      = Resolve-AcmuxOps
$electron = Resolve-AcmuxElectron -Ops $ops
$base     = Join-Path $env:TEMP 'acmux-coldstart'
$udata    = Join-Path $base 'udata'
$ws       = Join-Path $base 'ws'
$statePath= Join-Path $base 'state.json'
$outCsv   = Join-Path $PSScriptRoot 'coldstart-n10.csv'
$WARMUP   = 1
$RUNS     = 10
$TIMEOUT  = 20      # 초
$POLL     = 20      # ms

if (-not (Test-Path $electron)) { throw "electron.exe 없음: $electron" }

# ---- 격리 규칙 1·3: 라이브가 떠 있어야 하고, 전후로 라이브 세션을 확인한다 ----
function Get-LiveSessions {
  try { $j = & node (Join-Path $ops 'dist\cli\acmux.js') list 2>&1; return ($j | Out-String).Trim() }
  catch { return "acmux 실패: $_" }
}
$liveBefore = Get-LiveSessions
"=== 측정 전 라이브 세션 ==="; $liveBefore
if ($liveBefore -match '앱이 실행 중이 아닙니다') {
  throw "라이브 인스턴스가 없다. 격리 인스턴스를 먼저 띄우면 파이프를 뺏는다 (BASELINE §1 규칙 1). 중단."
}

# ---- 시드: 팀 1개 × 세션 4개, mode=terminal, 세로 4분할 ----
$pane = { param($n) [ordered]@{ type='pane'; session=$n } }
$layout = [ordered]@{
  type='split'; dir='col'; ratio=0.5
  a = [ordered]@{ type='split'; dir='col'; ratio=0.5; a=(& $pane 't1'); b=(& $pane 't2') }
  b = [ordered]@{ type='split'; dir='col'; ratio=0.5; a=(& $pane 't3'); b=(& $pane 't4') }
}
$state = [ordered]@{
  version = 1
  teams   = @([ordered]@{ name='BASE'; mode='terminal'; preset='grid-col'; layout=$layout })
  settings= [ordered]@{ fontSize=14; shell=''; panelSide='right' }
}
$stateJson = $state | ConvertTo-Json -Depth 20

function Reset-Isolation {
  Remove-Item $ws -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $ws, $udata | Out-Null
  Set-Content -Path $statePath -Value $stateJson -Encoding UTF8
}
New-Item -ItemType Directory -Force -Path $base | Out-Null

$env:ACMUX_STATE_PATH     = $statePath
$env:ACMUX_WORKSPACE_ROOT = $ws

# 앱이 쓰는 중인 파일을 읽는다 — 반드시 공유 모드로 연다.
# ReadAllText는 독점 열기라 앱이 쥐고 있는 동안 '공유 위반'으로 100% 실패한다 (v1 하니스의 결함).
function Read-Shared([string]$path) {
  try {
    $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read,
                          ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
    $t = $sr.ReadToEnd(); $sr.Close(); $fs.Close(); return $t
  } catch { return $null }
}

# 헤더 줄 뒤에 셸 출력이 붙었는가
function Test-PromptWritten([string]$path) {
  try {
    $raw = Read-Shared $path
    if ([string]::IsNullOrEmpty($raw)) { return $false }
    $i = $raw.IndexOf('────')
    if ($i -lt 0) { return $true }                      # 헤더가 아닌 내용이 이미 있다
    $j = $raw.IndexOf("`n", $i)
    if ($j -lt 0) { return $false }                     # 헤더 줄이 아직 안 끝났다
    return ($raw.Substring($j + 1).Trim().Length -gt 0) # 헤더 뒤에 실내용
  } catch { return $false }
}

function Invoke-OneRun([int]$idx, [bool]$isWarmup) {
  Reset-Isolation
  $logs = 1..4 | ForEach-Object { Join-Path $ws "BASE\t$_\session.log" }

  $p  = Start-Process -FilePath $electron -ArgumentList $ops, "--user-data-dir=`"$udata`"" -PassThru
  Start-Sleep -Milliseconds 60
  $t0 = (Get-Process -Id $p.Id).StartTime

  $tCreate = $null; $tPrompt = $null; $tAll = $null
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TIMEOUT) {
    $now = Get-Date
    if (-not $tCreate -and (Test-Path $logs[0]) -and ((Read-Shared $logs[0]).Length -gt 0)) { $tCreate = $now }
    if (-not $tPrompt -and (Test-Path $logs[0]) -and (Test-PromptWritten $logs[0]))      { $tPrompt = $now }
    if (-not $tAll) {
      $ready = @($logs | Where-Object { (Test-Path $_) -and (Test-PromptWritten $_) }).Count
      if ($ready -eq 4) { $tAll = $now }
    }
    if ($tCreate -and $tPrompt -and $tAll) { break }
    Start-Sleep -Milliseconds $POLL
  }

  # 격리 인스턴스만 골라 종료한다 (라이브와 같은 바이너리이므로 커맨드라인으로 가른다)
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.CommandLine -like '*acmux-coldstart*' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { } }
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*acmux-coldstart*' -or $_.ExecutablePath -eq $null } |
    Where-Object { $_.ProcessId -ne $PID } | ForEach-Object { }   # pwsh 자손은 electron 종료로 함께 정리된다
  Start-Sleep -Milliseconds 2500

  $ms = { param($t) if ($t) { [math]::Round(($t - $t0).TotalMilliseconds) } else { $null } }
  $row = [pscustomobject]@{
    run       = $(if ($isWarmup) { 'warmup' } else { $idx })
    create_ms = (& $ms $tCreate)
    prompt_ms = (& $ms $tPrompt)
    all4_ms   = (& $ms $tAll)
    pid       = $p.Id
    t0        = $t0.ToString('HH:mm:ss.fff')
  }
  "{0,-6} create={1,6} prompt={2,6} all4={3,6}" -f $row.run, $row.create_ms, $row.prompt_ms, $row.all4_ms | Write-Host
  return $row
}

"=== 워밍업 $WARMUP회 (버림) ==="
for ($i = 1; $i -le $WARMUP; $i++) { Invoke-OneRun -idx $i -isWarmup $true | Out-Null }

"=== 본 측정 $RUNS회 ==="
$rows = @()
for ($i = 1; $i -le $RUNS; $i++) { $rows += (Invoke-OneRun -idx $i -isWarmup $false) }

$rows | Export-Csv -Path $outCsv -NoTypeInformation -Encoding UTF8

function Stat([int[]]$v, [string]$label) {
  if (-not $v -or $v.Count -eq 0) { return "$label : 표본 없음" }
  $s = $v | Sort-Object
  $n = $s.Count
  $med = if ($n % 2) { $s[[int](($n-1)/2)] } else { [math]::Round(($s[$n/2 - 1] + $s[$n/2]) / 2) }
  $p95 = $s[[math]::Min($n-1, [int][math]::Ceiling(0.95 * $n) - 1)]
  $avg = [math]::Round(($s | Measure-Object -Average).Average)
  "{0} : n={1} 중앙값={2} p95={3} 최소={4} 최대={5} 평균={6}" -f $label, $n, $med, $p95, $s[0], $s[-1], $avg
}

$memAtEnd = Get-MemoryPressure   # 시작·종료 압력을 같은 형식으로 남긴다 (KR3-M2 브리프 §2-1 ③)

""
"=== 결과 ($(Get-MachineCode) · ms) ==="
"기계: $(Get-MachineLine)"
"측정 시작 시 메모리: 여유 $($memAtStart.free_gb) GB · 사용률 $($memAtStart.used_pct)%"
"측정 종료 시 메모리: 여유 $($memAtEnd.free_gb) GB · 사용률 $($memAtEnd.used_pct)%"
Stat ($rows.create_ms | Where-Object { $_ -ne $null }) 'T0→세션생성 '
Stat ($rows.prompt_ms | Where-Object { $_ -ne $null }) 'T0→첫프롬프트'
Stat ($rows.all4_ms   | Where-Object { $_ -ne $null }) 'T0→4개준비  '
""
"CSV: $outCsv"

# ---- 정리 + 격리 규칙 3 ----
Get-Process electron -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $electron -and $_.StartTime -gt (Get-Date).AddMinutes(-30) } |
  ForEach-Object { }   # 라이브와 같은 바이너리이므로 자동 종료하지 않는다 — 아래 확인만 한다

"=== 측정 후 라이브 세션 ==="
$liveAfter = Get-LiveSessions
$liveAfter
if ($liveAfter -match '앱이 실행 중이 아닙니다') { Write-Warning '라이브 제어 서버 응답 없음 — 확인 필요' }
