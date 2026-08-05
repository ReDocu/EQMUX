# a3-latency-selfcheck.ps1 — 관문 A-3(키 입력 지연) 계측기의 **자가 검증** 3항을 재현한다.
#
# 이 스크립트가 재는 것은 앱이 아니라 **계측기**다.
#   ① 무부하        — work p99가 바닥(0.3~0.4 ms)인가. 재현되는가
#   ② 5 ms 주입     — 일부러 넣은 5 ms를 work가 **잡아내는가**
#                     (순진한 rAF 방식은 같은 조건에서 0.0으로 보고했다 — 회귀를 못 잡는 계측기였다)
#   ③ 프레임 지연   — 유효 주사율을 1/4로 낮췄을 때 wait만 늘고 work는 안 늘어야 한다
#
# 왜 있나: A-3 판정에 쓰기 전에 **계측기부터 의심했기 때문**이다.
#          숫자가 그럴듯해 보이는 것과 그 숫자가 회귀를 잡는 것은 다른 이야기다.
#          (docs/LATENCY-S1-3b.md · docs/GATE-A.md §4-2)
#
# 작성: 진세아 · 2026-08-05 (해원 요청)
#
# ⚠️ 창을 연다. n=500을 다 채우면 스스로 종료한다. 3회 도는 데 대략 1분.
# ⚠️ 다른 측정과 겹치면 안 된다 — 이 실행은 CPU와 GPU를 다 쓴다.

[CmdletBinding()]
param(
  [string]$OutDir  = (Join-Path $env:TEMP "eqmux-a3-$(Get-Random)"),
  [int]$Samples    = 500
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) '_paths.ps1')

$exe = Resolve-EqmuxExe
New-Item -ItemType Directory -Force $OutDir | Out-Null

Write-Host "=== A-3 계측기 자가 검증 ===" -ForegroundColor Cyan
Write-Host (Get-MachineLine)
Write-Host "exe : $exe"
Write-Host "out : $OutDir"
Write-Host "n   : $($Samples)회 × 3"
Write-Host ""

# 표본 수를 반드시 적는다. n=50에서 p99는 사실상 max라 74 ms가 나왔고,
# 같은 코드 n=500에서 12.7 ms였다. **n 없는 꼬리 백분위는 숫자가 아니다.**
$runs = @(
  [pscustomobject]@{ Name = '1-baseline';   Args = @();                                                   Note = '무부하 — work p99가 바닥이어야 한다' }
  [pscustomobject]@{ Name = '2-inject5ms';  Args = @('--latency-probe-inject-ms=5');                      Note = 'work p50이 +5 ms 근처로 올라야 한다' }
  [pscustomobject]@{ Name = '3-framehold';  Args = @('--latency-probe-gap-ms=21','--latency-probe-frame-hold=4'); Note = 'wait만 늘고 work는 그대로여야 한다' }
)

$iso = Join-Path $OutDir 'iso'
New-Item -ItemType Directory -Force $iso | Out-Null
$env:EQMUX_STATE_PATH     = Join-Path $iso 'state.json'
$env:EQMUX_DATA_DIR       = Join-Path $iso 'webview'
$env:EQMUX_WORKSPACE_ROOT = Join-Path $iso 'ws'

foreach ($r in $runs) {
  $out = Join-Path $OutDir "$($r.Name).jsonl"
  Write-Host "── [$($r.Name)] $($r.Note)"
  $argv = @("--latency-probe-run=$Samples", "--latency-probe-out=$out") + $r.Args
  $lines = & $exe @argv 2>&1 | ForEach-Object { "$_" }
  $lines | Where-Object { $_ -match '\[probe\]' } | ForEach-Object { Write-Host "   $_" }
  Write-Host ""
}

Write-Host "=== 읽는 법 ===" -ForegroundColor Cyan
Write-Host "판정선  A-3-① 실작업 p99 ≤ 8 ms · A-3-② 총지연 p99 ≤ 2프레임"
Write-Host "        2프레임은 주사율에 매인다 — 60 Hz면 33.4 ms, 120 Hz면 16.7 ms (issue #10 · #13)"
Write-Host ""
Write-Host "🔴 ③의 gate 를 판정에 인용하지 말 것."
Write-Host "   --latency-probe-frame-hold=4 는 유효 주사율을 1/4로 낮춰 A-3-② 상한을 4배로 벌린다."
Write-Host "   a3_2_pass:true 가 찍히는데 그건 **통과가 아니라 무의미**다."
Write-Host "   각 줄의 gate.verdict_valid 를 먼저 본다. false면 인용하지 않는다. (docs/LATENCY-S1-3b.md §10)"
Write-Host ""
Write-Host "결과 JSONL: $OutDir"
