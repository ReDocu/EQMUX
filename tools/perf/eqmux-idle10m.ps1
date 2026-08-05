# eqmux-idle10m.ps1 — EQMUX 앱 데이터 "설치 직후 10분 유휴" (기계 무관 — 기계 코드는 실행 시 실측한다)
# 절차: APPDATA-S2-1b.md §4 그대로. 세는 것은 eqmux.exe --appdata-report (같은 코드·같은 자)
# PowerShell로 따로 세지 않는다 (§4 세아 요청).
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_paths.ps1"                    # 경로는 하드코딩하지 않고 찾는다 (README §경로)
$eq    = Resolve-EqmuxExe
$base  = Join-Path $env:TEMP 'eqmux-idle'
$outCsv= Join-Path $PSScriptRoot 'eqmux-idle10m.csv'
$IDLE  = 600

if (-not (Test-Path $eq)) { throw "eqmux.exe 없음: $eq" }
if (@(Get-Process eqmux -ErrorAction SilentlyContinue).Count -gt 0) { throw '이미 도는 eqmux가 있다 — 중단' }

Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $base | Out-Null
$env:EQMUX_STATE_PATH     = Join-Path $base 'state.json'
$env:EQMUX_WORKSPACE_ROOT = Join-Path $base 'ws'
$env:EQMUX_DATA_DIR       = Join-Path $base 'webview'

# --appdata-report의 stderr 한 줄을 파싱한다 (§3 출력 형식)
#   [eqmux][appdata] 무인 — 총 13.75 MB (캐시 12.84 MB · 93%) · … · 파일 189개 · 2ms
function Get-Report {
  $txt = (& $eq --appdata-report 2>&1) | Out-String
  $m = [regex]::Match($txt, '총\s+([\d.]+)\s*MB\s*\(캐시\s+([\d.]+)\s*MB\s*[·・]\s*(\d+)%\)')
  $f = [regex]::Match($txt, '파일\s+(\d+)\s*개')
  if (-not $m.Success) { return [pscustomobject]@{ total_mb=$null; cache_mb=$null; pct=$null; files=$null; raw=$txt.Trim() } }
  [pscustomobject]@{
    total_mb = [double]$m.Groups[1].Value
    cache_mb = [double]$m.Groups[2].Value
    pct      = [int]$m.Groups[3].Value
    files    = $(if ($f.Success) { [int]$f.Groups[1].Value } else { $null })
    raw      = ($txt.Trim() -split "`n")[0]
  }
}

"=== 기동 전 (빈 폴더 확인) ==="
$pre = Get-Report
"  총 $($pre.total_mb) MB — 0이어야 한다"

$p  = Start-Process -FilePath $eq -PassThru
Start-Sleep -Milliseconds 60
$t0 = (Get-Process -Id $p.Id).StartTime
"기동: pid=$($p.Id) · T0=$($t0.ToString('HH:mm:ss.fff'))"
""
"라벨          경과      총계        캐시          파일"

$rows = @()
function Add-Row([string]$label) {
  $r = Get-Report
  $row = [pscustomobject]@{
    label=$label; elapsed_s=[math]::Round(((Get-Date)-$t0).TotalSeconds,1)
    total_mb=$r.total_mb; cache_mb=$r.cache_mb; cache_pct=$r.pct; files=$r.files
  }
  $script:rows += $row
  "{0,-12} {1,6}s  {2,7} MB  {3,7} MB ({4,3}%)  {5,5}" -f `
    $row.label,$row.elapsed_s,$row.total_mb,$row.cache_mb,$row.cache_pct,$row.files | Write-Host
}

Start-Sleep -Seconds 2
Add-Row '창 뜬 직후'
while (((Get-Date)-$t0).TotalSeconds -lt 7) { Start-Sleep -Milliseconds 100 }
Add-Row '7초 후'
for ($s = 60; $s -le $IDLE; $s += 60) {
  while (((Get-Date)-$t0).TotalSeconds -lt $s) { Start-Sleep -Milliseconds 500 }
  Add-Row "${s}초"
}

$rows | Export-Csv -LiteralPath $outCsv -NoTypeInformation -Encoding UTF8
& $eq --appdata-report-out="$base\idle-10m.json" 2>&1 | Out-Null

$f = $rows[-1]
""
"=== 결과 (EQMUX · $(Get-MachineCode) · 빈 폴더 → 10분 유휴) ==="
"기계: $(Get-MachineLine)"
"측정한 exe: $eq ($([math]::Round((Get-Item $eq).Length/1MB,2)) MB · $((Get-Item $eq).LastWriteTime))"
"총계   : $($f.total_mb) MB   캐시 $($f.cache_mb) MB ($($f.cache_pct)%)   파일 $($f.files)개"
"대조군 : AgentCommender 30.43 MB (같은 조건 · M1)"
"JSON   : $base\idle-10m.json"
"CSV    : $outCsv"

try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { }
Start-Sleep -Milliseconds 800
"eqmux 잔여: $(@(Get-Process eqmux -ErrorAction SilentlyContinue).Count) 개"
