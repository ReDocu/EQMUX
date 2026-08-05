# a2-font-probe.ps1 — 관문 A-2(CJK 폭) 계측을 재현한다.
#
# 무엇을 재나:
#   한글 글리프의 advance가 ASCII의 정확히 2배인가. 판정선은 기기 픽셀 0.5/1.0.
#   규칙 한 줄 — CJK는 거의 모든 폰트에서 1.0em이라, 비율이 2가 되려면
#   **ASCII advance가 정확히 0.5em이어야 한다.** (docs/FONT-A2.md §2)
#
# 육안을 대체하지 않는다. 육안 전에 싸게 거르는 자리다.
#
# 작성: 진세아 · 2026-08-05 (해원 요청 — 스크래치패드에 흩어져 있던 실행을 파일로 고정)
#
# ⚠️ 이 스크립트는 **창을 연다.** 재고 바로 스스로 종료한다(--font-probe).
#    라이브 세션과 섞이지 않게 항상 격리 인스턴스로 돈다.

[CmdletBinding()]
param(
  # 결과 JSON을 둘 폴더. 기본은 임시 폴더 — tools/perf 에는 결과를 두지 않는다(README 규칙).
  [string]$OutDir = (Join-Path $env:TEMP "eqmux-a2-$(Get-Random)"),
  # 폰트 스택을 직접 주고 싶을 때. 안 주면 아래 기본 4종을 다 돈다.
  [string[]]$Stack = @()
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) '_paths.ps1')

$exe = Resolve-EqmuxExe
New-Item -ItemType Directory -Force $OutDir | Out-Null

Write-Host "=== A-2 폭 계측 ===" -ForegroundColor Cyan
Write-Host (Get-MachineLine)
Write-Host "exe : $exe"
Write-Host "out : $OutDir"
Write-Host ""

# 기본 대조군.
#   ① 현행     — 강제 없음. 동봉 D2Coding이 잡혀야 한다 (통과 기대)
#   ② 동봉 배제 — D2Coding **두 이름을 다** 뺀다. 하나만 빼면 사용자 설치본이 잡혀
#                 대조군이 통과로 바뀐다 — 그러면 동봉이 무엇을 막는지가 안 보인다
#   ③ 굴림체   — ASCII 0.5em이라 비율은 통과하지만 → · ■ 가 2칸이라 표가 깨진다
#   ④ Consolas — 0.55em. 미달 쪽 대표
$plans = if ($Stack.Count -gt 0) {
  $i = 0; $Stack | ForEach-Object { $i++; [pscustomobject]@{ Name = "custom$i"; Value = $_ } }
} else {
  @(
    [pscustomobject]@{ Name = 'current';     Value = $null }
    [pscustomobject]@{ Name = 'no-bundled';  Value = '"Cascadia Mono", "굴림체", "돋움체", Consolas, monospace' }
    [pscustomobject]@{ Name = 'gulim';       Value = '"굴림체", monospace' }
    [pscustomobject]@{ Name = 'consolas';    Value = 'Consolas, monospace' }
  )
}

$results = @()
foreach ($p in $plans) {
  $iso = Join-Path $OutDir "iso-$($p.Name)"
  New-Item -ItemType Directory -Force $iso | Out-Null
  $json = Join-Path $OutDir "font-$($p.Name).json"

  # 격리 — 라이브 상태·WebView2 캐시를 건드리지 않는다 (config.rs 스위치)
  $env:EQMUX_STATE_PATH     = Join-Path $iso 'state.json'
  $env:EQMUX_DATA_DIR       = Join-Path $iso 'webview'
  $env:EQMUX_WORKSPACE_ROOT = Join-Path $iso 'ws'

  # 스택 강제는 **환경변수로** 준다. 플래그(--font-stack)로 주면 값 안의 따옴표가
  # 셸을 한 번 더 거치면서 깨진다 — 같은 일을 하고 깨지지 않는 쪽을 쓴다(플래그가 우선순위는 높다).
  if ($null -eq $p.Value) {
    Remove-Item Env:\EQMUX_FONT_STACK -ErrorAction SilentlyContinue
  } else {
    $env:EQMUX_FONT_STACK = $p.Value
  }

  Write-Host "── [$($p.Name)] $(if ($null -eq $p.Value) { '(강제 없음 — 제품 기본 스택)' } else { $p.Value })"
  $lines = & $exe --font-probe "--font-probe-out=$json" 2>&1 | ForEach-Object { "$_" }
  $verdicts = $lines | Where-Object { $_ -match '\[font-probe\]' }
  $verdicts | ForEach-Object { Write-Host "   $_" }

  $results += [pscustomobject]@{
    stack   = $p.Name
    json    = $json
    passed  = [bool]($verdicts -match 'CJK 통과')
    lines   = $verdicts
  }
  Write-Host ""
}

Remove-Item Env:\EQMUX_FONT_STACK -ErrorAction SilentlyContinue

Write-Host "=== 요약 ===" -ForegroundColor Cyan
$results | ForEach-Object {
  "{0,-12} {1}" -f $_.stack, $(if ($_.passed) { '통과' } else { '미달' })
}
Write-Host ""
Write-Host "⚠️ current 가 미달이면 동봉 폰트가 안 붙은 것이다 — dist/assets 에 .ttf 가 있는지부터 본다."
Write-Host "⚠️ no-bundled 가 통과하면 대조군이 무력화된 것이다 — 스택에서 'D2Coding ligature' 도 빠졌는지 본다."
Write-Host "   (docs/FONT-A2.md §0-A · 동봉 직후 실제로 한 번 그렇게 됐다)"
Write-Host ""
Write-Host "결과 JSON: $OutDir"
