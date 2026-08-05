# _paths.ps1 — 측정 대상 실행 파일의 경로를 "찾는다". 하드코딩하지 않는다.
#
# 왜 있나 (2026-08-05 · 해원):
#   하니스 4종이 전부 M1 시절의 'D:\...' 경로를 하드코딩하고 있었다. M2에는 D: 드라이브가 없다.
#   그대로 돌리면 넷 다 첫 줄에서 죽는다 — 그런데 그건 운이 좋은 경우다.
#   더 나쁜 경우는 "비슷한 경로가 우연히 존재해서 엉뚱한 앱을 재는 것"이다.
#
# 원칙 셋:
#   1. 라이브가 도는 실행 파일 경로가 언제나 정답이다 — 그건 추측이 아니라 실측이다
#   2. 못 찾으면 추측하지 않고 멈춘다. 틀린 앱을 재는 것보다 안 재는 게 낫다
#   3. 실패는 침묵하지 않는다. 무엇을 어디서 찾았고 왜 실패했는지 전부 찍는다 (§A ① 교훈)

function Resolve-AcmuxOps {
  <#
    AgentCommender의 ops 폴더를 찾는다.
    우선순위: ①환경변수 ②라이브 electron.exe 프로세스 ③알려진 후보 경로
  #>
  [CmdletBinding()]
  param([switch]$Quiet)

  $tried = [System.Collections.Generic.List[string]]::new()

  # ① 환경변수 — 기계가 또 바뀌었을 때의 탈출구
  if ($env:ACMUX_OPS_PATH) {
    $tried.Add("env:ACMUX_OPS_PATH = $env:ACMUX_OPS_PATH")
    if (Test-Path -LiteralPath $env:ACMUX_OPS_PATH) {
      if (-not $Quiet) { Write-Host "[paths] ops ← 환경변수: $env:ACMUX_OPS_PATH" }
      return (Resolve-Path -LiteralPath $env:ACMUX_OPS_PATH).Path
    }
  }

  # ② 라이브 프로세스 — 가장 믿을 만한 출처
  #    ...\ops\node_modules\electron\dist\electron.exe  →  네 단계 거슬러 올라가면 ops
  $live = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath } |
            Select-Object -ExpandProperty ExecutablePath -Unique)
  foreach ($exe in $live) {
    $tried.Add("live process: $exe")
    $p = $exe
    for ($i = 0; $i -lt 4; $i++) { $p = Split-Path -Parent $p }   # dist → electron → node_modules → ops
    if ($p -and (Test-Path -LiteralPath (Join-Path $p 'node_modules\electron\dist\electron.exe'))) {
      if (-not $Quiet) { Write-Host "[paths] ops ← 라이브 프로세스: $p" }
      return (Resolve-Path -LiteralPath $p).Path
    }
  }

  # ③ 알려진 후보 — 라이브가 안 떠 있을 때만. 목록을 늘리는 건 다음 기계에서 또 틀린다
  $cands = @(
    (Join-Path $env:USERPROFILE 'Desktop\GitProject\ClaudeCodeTemplate\root\AgentCommender\ops'),  # M2/M3
    'D:\ClaudeCockpit\root\AgentCommender\ops'                                                     # M1 (옛 판정 기계)
  )
  foreach ($c in $cands) {
    $tried.Add("candidate: $c")
    if (Test-Path -LiteralPath (Join-Path $c 'node_modules\electron\dist\electron.exe')) {
      if (-not $Quiet) { Write-Host "[paths] ops ← 후보 경로: $c" }
      return (Resolve-Path -LiteralPath $c).Path
    }
  }

  throw ("AgentCommender ops 폴더를 못 찾았다 — 멈춘다 (추측해서 재지 않는다).`n" +
         "  시도한 것:`n    " + ($tried -join "`n    ") + "`n" +
         "  해결: `$env:ACMUX_OPS_PATH 에 ops 폴더 경로를 넣고 다시 실행한다.")
}

function Resolve-AcmuxElectron {
  param([string]$Ops)
  if (-not $Ops) { $Ops = Resolve-AcmuxOps }
  $exe = Join-Path $Ops 'node_modules\electron\dist\electron.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw "electron.exe 없음: $exe" }
  return $exe
}

function Resolve-EqmuxExe {
  <#
    빌드된 eqmux.exe를 찾는다. 저장소 상대 경로가 기본 — 저장소가 통째로 옮겨져도 따라온다.
    우선순위: ①환경변수 ②저장소 상대(tools/perf → 루트) ③라이브 eqmux 프로세스
  #>
  [CmdletBinding()]
  param([switch]$Quiet)

  $tried = [System.Collections.Generic.List[string]]::new()

  if ($env:EQMUX_EXE) {
    $tried.Add("env:EQMUX_EXE = $env:EQMUX_EXE")
    if (Test-Path -LiteralPath $env:EQMUX_EXE) {
      if (-not $Quiet) { Write-Host "[paths] eqmux.exe ← 환경변수: $env:EQMUX_EXE" }
      return (Resolve-Path -LiteralPath $env:EQMUX_EXE).Path
    }
  }

  # tools/perf 에서 두 단계 올라가면 저장소 루트다
  $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $rel  = Join-Path $root 'src-tauri\target\release\eqmux.exe'
  $tried.Add("repo-relative: $rel")
  if (Test-Path -LiteralPath $rel) {
    if (-not $Quiet) { Write-Host "[paths] eqmux.exe ← 저장소 상대: $rel" }
    return (Resolve-Path -LiteralPath $rel).Path
  }

  $live = @(Get-Process eqmux -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -Unique)
  foreach ($exe in $live) {
    $tried.Add("live process: $exe")
    if (Test-Path -LiteralPath $exe) {
      if (-not $Quiet) { Write-Host "[paths] eqmux.exe ← 라이브 프로세스: $exe" }
      return (Resolve-Path -LiteralPath $exe).Path
    }
  }

  throw ("eqmux.exe 를 못 찾았다 — 멈춘다.`n" +
         "  시도한 것:`n    " + ($tried -join "`n    ") + "`n" +
         "  해결: 'npm run tauri -- build' 로 빌드하거나 `$env:EQMUX_EXE 를 지정한다.`n" +
         "  ⚠️ cargo build --release 를 직접 쓰지 말 것 — 프런트가 컴파일 시점에 박힌다.")
}

function Get-MachineCode {
  <#
    이 기계가 M1인가 M2인가를 "실측으로" 답한다.
    #10: 모든 측정 문서와 출력에 기계 코드를 붙인다.
    그런데 코드를 스크립트에 하드코딩하면 기계가 바뀐 날 조용히 거짓말을 한다 —
    실제로 하니스 넷이 'M1'을 찍은 채로 M2에 와 있었다. 틀린 코드는 없는 것보다 나쁘다.

    ⚠️ M3은 M2와 같은 기계로 판단됐다 (PERF-TEST.md §8-3 · 대조 3항 일치).
       그래서 여기서 M3을 따로 구분하지 않는다.
  #>
  $host_ = (Get-CimInstance Win32_ComputerSystem).Name
  switch ($host_) {
    'DESKTOP-8GPGUF8' { return 'M1' }   # i7-14700KF · RTX 4070 Ti SUPER · Win 11 Pro 26200 · 60 Hz
    'DESKTOP-SQ0OEKB' { return 'M2' }   # Ryzen 7 8845HS · Radeon 780M · Win 11 Home 22631 · 120 Hz
    default           { return "UNKNOWN($host_)" }
  }
}

function Get-MachineLine {
  # 측정 출력 머리에 붙일 한 줄. 기계·OS·주사율·RAM을 실측으로 찍는다.
  $os = Get-CimInstance Win32_OperatingSystem
  $vc = Get-CimInstance Win32_VideoController | Select-Object -First 1
  $m  = Get-MemoryPressure
  "{0} · {1} · {2} {3} · {4} Hz · RAM {5} GB (여유 {6} GB · 사용률 {7}%)" -f `
    (Get-MachineCode), (Get-CimInstance Win32_ComputerSystem).Name,
    $os.Caption, $os.Version, $vc.CurrentRefreshRate, $m.total_gb, $m.free_gb, $m.used_pct
}

function Get-MemoryPressure {
  <#
    #15 할 일 3 — M2는 15.3 GB라 압력 자체가 값을 움직인다. 표본마다 같이 남긴다.
  #>
  $os = Get-CimInstance Win32_OperatingSystem
  [pscustomobject]@{
    total_gb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
    free_gb  = [math]::Round($os.FreePhysicalMemory   / 1MB, 2)
    used_pct = [math]::Round(100 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize * 100), 1)
  }
}

function Assert-MemoryHeadroom {
  <#
    A-4 착수 조건 — 여유가 부족하면 재는 것이 앱이 아니라 메모리 압력이 된다.
    그 위에서 도는 세션들까지 같이 느려진다. 그래서 경고가 아니라 중단이다.
  #>
  param([double]$MinFreeGb = 3.0)
  $m = Get-MemoryPressure
  Write-Host "[paths] 메모리: 총 $($m.total_gb) GB · 여유 $($m.free_gb) GB · 사용률 $($m.used_pct)%"
  if ($m.free_gb -lt $MinFreeGb) {
    throw ("메모리 여유 $($m.free_gb) GB < 기준 $MinFreeGb GB — 멈춘다.`n" +
           "  이 상태로 재면 앱이 아니라 메모리 압력을 재게 되고, 같은 기계에서 도는 세션들도 느려진다.`n" +
           "  (BRIEF-2026-08-05-A4-M2.md §0 · 이안 지시)")
  }
  return $m
}
