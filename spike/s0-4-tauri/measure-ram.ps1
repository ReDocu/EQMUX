<#
.SYNOPSIS
  실행 중인 앱의 프로세스 트리 RAM을 잰다. (EQMUX S0-1 / S0-4 공용)

.DESCRIPTION
  Electron·Tauri 같은 다중 프로세스 앱은 부모 프로세스만 재면 실제 사용량의 10%도 안 나온다.
  이 스크립트는 루트 프로세스의 자식을 전부 따라가 합산한다.

  두 값을 낸다:
    WorkingSet        — 공유 페이지를 프로세스마다 중복으로 센다. 과대평가.
    PrivateWorkingSet — 프로세스 전용 페이지만. 절대값 판단에는 이쪽이 맞다.

  ※ AgentCommender와 EQMUX를 비교하려면 반드시 같은 스크립트로 재야 한다.
     WorkingSet만 비교하거나 PrivateWorkingSet만 비교하는 것은 되지만, 섞으면 안 된다.

.PARAMETER ProcessName
  루트 프로세스 이름 (확장자 없이). 예: s0-4-tauri, AgentCommender

.PARAMETER SettleSeconds
  측정 전 대기 시간(초). 유휴 상태를 재려면 600(10분)을 쓴다.

.EXAMPLE
  .\measure-ram.ps1 -ProcessName s0-4-tauri

.EXAMPLE
  # S0-1 유휴 RAM: 터미널 4개 띄우고 10분 방치 후
  .\measure-ram.ps1 -ProcessName AgentCommender -SettleSeconds 600
#>
param(
  [Parameter(Mandatory = $true)][string]$ProcessName,
  [int]$SettleSeconds = 0
)

$ErrorActionPreference = 'Stop'

$root = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
        Sort-Object StartTime | Select-Object -First 1
if (-not $root) { throw "프로세스를 찾을 수 없다: $ProcessName" }

if ($SettleSeconds -gt 0) {
  Write-Host "$SettleSeconds 초 대기 후 측정한다..."
  Start-Sleep -Seconds $SettleSeconds
}

# 프로세스 트리 수집 (BFS)
$all   = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize
$seen  = @($root.Id)
$queue = @($root.Id)
while ($queue.Count -gt 0) {
  $cur   = $queue[0]
  $queue = @($queue | Select-Object -Skip 1)
  foreach ($c in $all | Where-Object ParentProcessId -eq $cur) {
    if ($seen -notcontains $c.ProcessId) { $seen += $c.ProcessId; $queue += $c.ProcessId }
  }
}
$procs = $all | Where-Object { $seen -contains $_.ProcessId }

# PrivateWorkingSet — 성능 카운터에서만 얻을 수 있다
$private = 0
foreach ($p in $procs) {
  $n = (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue).ProcessName
  if ($n) {
    $path = '\Process V2(' + $n + ':' + $p.ProcessId + ')\Working Set - Private'
    try { $private += (Get-Counter $path -ErrorAction Stop).CounterSamples[0].CookedValue } catch {}
  }
}

Write-Host ""
Write-Host "루트: $ProcessName (PID $($root.Id))"
$procs | Group-Object Name | ForEach-Object {
  [PSCustomObject]@{
    Name         = $_.Name
    N            = $_.Count
    WorkingSetMB = [math]::Round((($_.Group | Measure-Object WorkingSetSize -Sum).Sum) / 1MB, 1)
  }
} | Sort-Object WorkingSetMB -Descending | Format-Table -AutoSize

[PSCustomObject]@{
  ProcessCount        = $procs.Count
  WorkingSetMB        = [math]::Round((($procs | Measure-Object WorkingSetSize -Sum).Sum) / 1MB, 1)
  PrivateWorkingSetMB = [math]::Round($private / 1MB, 1)
}
