# 관문 A-2 육안 판정 — 표본 출력 스크립트
#
# a2-shell.cmd 가 EQMUX_SHELL 로 이걸 띄운다. 한글은 전부 여기 있다 —
# .cmd 는 OEM 코드페이지로 읽혀 한글을 담으면 깨진다(그쪽 주석 참고).
#
# 화면을 둘로 나누는 이유: 한 화면에 다 넣었더니 [1][2]가 위로 밀려 안 보였다.
# 판정에서 제일 중요한 두 절이라 밀리면 판정 자체가 안 된다.
#   1화면 = a2-visual.txt (폭·표·기호·실사용)   → 5초 뒤
#   2화면 = 굵게·밑줄·반전 (ESC 필요)          → 그로부터 12초 뒤
# 각 화면이 뜬 동안 캡처하면 된다.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Start-Sleep -Seconds 5
Get-Content -LiteralPath "$PSScriptRoot\a2-visual.txt" -Encoding utf8

Start-Sleep -Seconds 12
Clear-Host

# ESC는 [Console]::Out 으로 직접 쓴다.
#   Write-Host 로 냈더니 굵게·밑줄·반전이 **하나도 안 걸렸다.** PowerShell이 호스트
#   렌더링 단계에서 ANSI를 삼킨다($PSStyle.OutputRendering). 그러면 "굵게를 쟀다"가
#   아니라 "굵게인 척한 보통 글씨를 쟀다"가 된다 — 계측기 결함 #2와 같은 종류의 함정이다.
$PSStyle.OutputRendering = 'ANSI'
$e = [char]27
$out = [Console]::Out
$out.Write("[5] 굵게·밑줄·반전 — 굵어져도 폭이 안 변하는가 (계측 2.0000)`r`n")
$out.Write("보통 가나다라마 ABCDE 漢字`r`n")
$out.Write("$e[1m굵게 가나다라마 ABCDE 漢字$e[0m`r`n")
$out.Write("$e[4m밑줄 가나다라마 ABCDE 漢字$e[0m`r`n")
$out.Write("$e[7m반전 가나다라마 ABCDE 漢字$e[0m`r`n")
$out.Write("01234567890123456789012345  <- 위 네 줄과 끝 자리가 같아야 한다`r`n")
$out.Write("`r`n[6] 색 — 색이 붙어도 폭이 안 변하는가`r`n")
$out.Write("$e[31m빨강 가나다$e[0m $e[32m초록 가나다$e[0m $e[33m노랑 가나다$e[0m`r`n")
$out.Write("01234567890123456789012345678901234  <- 위 줄과 끝 자리가 같아야 한다`r`n")
$out.Flush()
