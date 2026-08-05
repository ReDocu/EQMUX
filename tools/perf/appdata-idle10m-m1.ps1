# appdata-idle10m-m1.ps1 — AgentCommender 앱 데이터 "설치 직후 10분 유휴" (기계 무관 — #15. 파일명의 -m1은 인용 유지용이다)
# BASELINE.md §3.2b 재측정(§8 3c). 대조군: APPDATA-S2-1b.md §0 3·4번 · §4
#
# 세는 규칙은 APPDATA-S2-1b.md §2-3을 **그대로 옮겼다** — 자가 다르면 비교가 안 된다.
#   캐시 계열 = 폴더 이름에 'cache' 포함 OR (dictionaries|shared dictionary|service worker|blob_storage)
#              → 그 아래 전부를 캐시로 센다 (깊이 무관)
#   재파스 포인트(심볼릭 링크·정션)는 따라가지 않는다
#   워크스페이스는 udata 밖이라 애초에 안 들어간다 (§2-2와 결과 동일)
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_paths.ps1"                    # 경로는 하드코딩하지 않고 찾는다 (README §경로)
$ops      = Resolve-AcmuxOps
$electron = Resolve-AcmuxElectron -Ops $ops
$base     = Join-Path $env:TEMP 'acmux-idle10m'
$udata    = Join-Path $base 'udata'     # ← Electron userData. 이게 "앱 데이터" 층이다
$ws       = Join-Path $base 'ws'
$statePath= Join-Path $base 'state.json'
$outCsv   = Join-Path $PSScriptRoot 'appdata-idle10m-m1.csv'
$IDLE_SEC = 600

$CACHE_NAMES = @('dictionaries', 'shared dictionary', 'service worker', 'blob_storage')
function Test-CacheDir([string]$name) {
  $n = $name.ToLower()
  return ($n -like '*cache*') -or ($CACHE_NAMES -contains $n)
}

# 재귀 집계 — 캐시 폴더를 만나면 그 아래 전부를 캐시로 넣고 더 내려가지 않는다
function Measure-Tree([string]$dir, [bool]$inCache) {
  $total = 0L; $cache = 0L; $files = 0
  try { $entries = Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue } catch { return @(0L, 0L, 0) }
  foreach ($e in $entries) {
    if ($e.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    if ($e.PSIsContainer) {
      $childInCache = $inCache -or (Test-CacheDir $e.Name)
      $r = Measure-Tree $e.FullName $childInCache
      $total += $r[0]; $cache += $r[1]; $files += $r[2]
    } else {
      $total += $e.Length; $files++
      if ($inCache) { $cache += $e.Length }
    }
  }
  return @($total, $cache, $files)
}
function Get-AppData {
  if (-not (Test-Path $udata)) { return [pscustomobject]@{ total_mb=0.0; cache_mb=0.0; pct=0; files=0 } }
  $r = Measure-Tree $udata $false
  $t = [math]::Round($r[0] / 1MB, 2); $c = [math]::Round($r[1] / 1MB, 2)
  [pscustomobject]@{
    total_mb = $t
    cache_mb = $c
    pct      = $(if ($r[0] -gt 0) { [math]::Round(100 * $r[1] / $r[0]) } else { 0 })
    files    = $r[2]
  }
}

function Kill-Isolated {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.CommandLine -like '*acmux-idle10m*' } |
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
function Get-LiveSessions {
  try { return ((& node (Join-Path $ops 'dist\cli\acmux.js') list 2>&1) | Out-String).Trim() }
  catch { return "acmux 실패: $_" }
}

# ---- 격리 규칙 1·3 ----
$liveBefore = Get-LiveSessions
"=== 측정 전 라이브 세션 ==="; $liveBefore
if ($liveBefore -match '앱이 실행 중이 아닙니다') { throw '라이브 인스턴스 없음 — 중단 (BASELINE §1 규칙 1)' }

# ---- ⚠️ 빈 폴더에서 시작한다 — 이게 "설치 직후"의 정의다 ----
Kill-Isolated; Start-Sleep -Milliseconds 800
Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $base, $ws, $udata | Out-Null
"udata 초기 상태: $((Get-AppData).total_mb) MB (0이어야 한다)"

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
Set-Content -LiteralPath $statePath -Value ($state | ConvertTo-Json -Depth 20) -Encoding UTF8
$env:ACMUX_STATE_PATH = $statePath
$env:ACMUX_WORKSPACE_ROOT = $ws

# ---- 기동 ----
$p  = Start-Process -FilePath $electron -ArgumentList $ops, "--user-data-dir=`"$udata`"" -PassThru
Start-Sleep -Milliseconds 60
$t0 = (Get-Process -Id $p.Id).StartTime
"기동: pid=$($p.Id) · T0=$($t0.ToString('HH:mm:ss.fff'))"

$rows = @()
function Add-Row([string]$label) {
  $a = Get-AppData
  $row = [pscustomobject]@{
    label = $label
    elapsed_s = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    total_mb = $a.total_mb; cache_mb = $a.cache_mb; cache_pct = $a.pct; files = $a.files
  }
  $script:rows += $row
  "{0,-18} {1,7}s  총 {2,7} MB  캐시 {3,7} MB ({4,3}%)  파일 {5,5}" -f `
    $row.label, $row.elapsed_s, $row.total_mb, $row.cache_mb, $row.cache_pct, $row.files | Write-Host
  return $row
}

# 대조 지점 ① 터미널 4개 준비 = 세아 §0 3번("창 뜨는 순간")과 같은 층
$logs = 1..4 | ForEach-Object { Join-Path $ws "BASE\t$_\session.log" }
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 30) {
  if (@($logs | Where-Object { (Test-Path $_) -and (Test-PromptWritten $_) }).Count -eq 4) { break }
  Start-Sleep -Milliseconds 50
}
""
"라벨                    경과      총계          캐시            파일"
Add-Row '창+셸 준비' | Out-Null

# 대조 지점 ② 7초 후 = 세아 §0 4번
while (((Get-Date) - $t0).TotalSeconds -lt 7) { Start-Sleep -Milliseconds 100 }
Add-Row '7초 후' | Out-Null

# 이후 60초 간격으로 10분까지 — 아무 입력도 하지 않는다
for ($s = 60; $s -le $IDLE_SEC; $s += 60) {
  while (((Get-Date) - $t0).TotalSeconds -lt $s) { Start-Sleep -Milliseconds 500 }
  Add-Row "${s}초" | Out-Null
}

$rows | Export-Csv -LiteralPath $outCsv -NoTypeInformation -Encoding UTF8
$final = $rows[-1]

""
"=== 결과 ($(Get-MachineCode) · 빈 폴더 → 10분 유휴 · 세는 자: APPDATA-S2-1b §2-3) ==="
"기계: $(Get-MachineLine)"
"총계   : $($final.total_mb) MB"
"캐시   : $($final.cache_mb) MB ($($final.cache_pct)%)"
"파일 수: $($final.files)"
"대조   : M3 값 34.43 MB (BASELINE §3.2b · 4폴더 수동 규칙)"
"CSV: $outCsv"

# 1단계 내역 (어디가 자랐는지)
""
"=== udata 1단계 내역 ==="
Get-ChildItem -LiteralPath $udata -Force -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.PSIsContainer) {
    $r = Measure-Tree $_.FullName (Test-CacheDir $_.Name)
    "  {0,-28} {1,8} MB {2}" -f $_.Name, [math]::Round($r[0]/1MB,2), $(if (Test-CacheDir $_.Name) { '[캐시]' } else { '' })
  } else {
    "  {0,-28} {1,8} MB" -f $_.Name, [math]::Round($_.Length/1MB,2)
  }
} | Sort-Object -Descending

Kill-Isolated
Start-Sleep -Milliseconds 1500
"=== 측정 후 라이브 세션 ==="
Get-LiveSessions
"격리 잔여: $(@(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*acmux-idle10m*' }).Count) 개"
