# 동봉 폰트 고지 — D2Coding

이 폴더의 폰트는 **EQMUX 배포물에 함께 실린다**. 관문 A-2(CJK 폭)의 답이 이 파일이다
([docs/FONT-A2.md](../../../docs/FONT-A2.md) · [docs/issue.md](../../../docs/issue.md) #8).

## 파일

| | |
|---|---|
| 파일 | `D2Coding-ligature-v1.3.2.ttf` (4,224,160 B) |
| 출처 | 이 개발 기계에 설치돼 있던 `D2Coding-Ver1.3.2-20180524-ligature.ttf`를 그대로 복사 |
| 변경 | **없음.** 바이트 그대로다 — 서브셋·리네임·수정을 하지 않았다 |

## 폰트 파일에서 그대로 읽은 메타데이터

`name` 테이블의 Windows / en-US 레코드를 파싱해 **원문 그대로** 옮긴 것이다.

| ID | 항목 | 값 |
|---|---|---|
| 0 | 저작권 | `Copyright (c) 2015-2016 NHN Corporation. All rights reserved. Font designed by FONTRIX Inc.` |
| 1 | 패밀리 | `D2Coding ligature` |
| 2 | 서브패밀리 | `Regular` |
| 5 | 버전 | `Version 1.3.2; Build 20180524` |
| 13 | 라이선스 | `This Font Software is licensed under the SIL Open Font License, Version 1.1.` |
| 14 | 라이선스 URL | `http://dev.naver.com/wiki/nanumfont/index.php/OpenFontLicense` |

> 위 표의 문자열은 **제가 쓴 문장이 아니라 폰트 바이너리에서 추출한 값**이다.
> 다시 확인하려면 `name` 테이블을 파싱하면 된다 — 값이 바뀌면 폰트가 바뀐 것이다.

## ✅ OFL 1.1 전문 — `public/licenses/LICENSE-OFL-1.1.txt` (2026-08-05 추가)

SIL OFL 1.1은 재배포 시 **저작권 고지와 라이선스 전문을 함께 싣도록** 요구한다(조건 2).
전문은 **이 폴더가 아니라 `public/licenses/LICENSE-OFL-1.1.txt`** 에 있다.

> **왜 폰트 옆이 아닌가.** `public/`에 둬야 Vite가 `dist/`로 복사하고, 그 `dist/`가 통째로
> 실행 파일에 박힌다 — **사용자가 받는 물건 안에 들어간다.** 여기(`src/assets/fonts/`)에 두면
> 저장소에만 있고 배포물에는 안 실린다. OFL 조건 2의 주어는 저장소가 아니라 *each copy*다.
> **사본을 둘로 만들지 않았다** — 파일은 하나고, 이 문서가 가리킨다.

| | |
|---|---|
| 출처 | **SIL 정본** `https://openfontlicense.org/documents/OFL.txt` (HTTP 200 · `text/plain` · 4,599 B) |
| 받은 날 | 2026-08-05 |
| 원본 sha256 | `1d361a8f8e8ce6e68457dcd93fb56e162e6baa3bbb7e7573a290d44399f6b57e` |
| 우리 파일 sha256 | `719f4b9237d61d376ee3ef033523c639978cd99e5dab9f2d8961bcc9bc565c98` (4,395 B · LF) |

**두 해시가 다른 이유는 한 군데뿐이다.** SIL 정본 첫 5줄은 라이선스 본문이 아니라
`Copyright (c) <dates>, <Copyright Holder> …` 형식의 **채워 넣으라는 빈칸**이다.
그 자리에 **폰트 `name` 테이블 ID 0에서 추출한 실제 문자열**을 넣었다.
**나머지는 손대지 않았다** — 정본 6행 이후와 우리 파일 2행 이후는 `diff` 0바이트로 동일하다.

```bash
# 재확인: 본문이 정본과 같은지
curl -sSL https://openfontlicense.org/documents/OFL.txt > /tmp/ofl.txt
diff <(tail -n +6 /tmp/ofl.txt) <(tail -n +2 public/licenses/LICENSE-OFL-1.1.txt)   # 출력 없으면 동일
```

> 라이선스 전문은 **기억으로 옮겨 적지 않았다.** 근사치로 적은 법적 문서는 고지가 아니라 위험이다.
> 받아서 넣었고, 무엇을 바꿨는지와 되돌려 볼 명령을 여기 남긴다.

## ✅ 배포물 탑재 — 확인됨 (2026-08-05 · M2)

저장소에 두는 것과 **사용자가 받는 물건에 실리는 것**은 다른 사건이라 따로 확인했다.

| 확인 | 결과 |
|---|---|
| `dist/licenses/LICENSE-OFL-1.1.txt` | 있음 · sha256 **동일** |
| `eqmux.exe` 크기 | 5,168,640 → **5,170,688 B** (+2,048 · 압축돼 박힌다) |
| exe 안 **평문** 검색 | **안 잡힌다** — Tauri가 자산을 압축해 넣으므로 정상. 크기만으로는 정황이지 증거가 아니다 |
| **런타임 판정** | `[license] OFL-1.1 탑재 확인 — 4395 B · sha256 719f4b9237d6…` |

**판정을 코드에 박았다** — `src/license.ts`. 앱이 부팅할 때 `/licenses/LICENSE-OFL-1.1.txt`를
직접 꺼내 **SHA-256으로 대조**하고 stderr에 한 줄 남긴다. 파일이 `public/`에서 빠지거나
줄바꿈이 변환되면 그 줄이 `미탑재`/`대조 실패`로 바뀐다. **라이선스 누락은 조용히 지나가면 안 되는 회귀다.**

```powershell
# 무인 재확인 — 창을 열어 셸 왕복까지 보고 끝난다
& .\src-tauri\target\release\eqmux.exe --pty-probe --pty-probe-cmd=dir --pty-probe-ms=6000 2>&1 |
    Select-String license
```

> ⚠️ **실패 경로는 아직 안 밟아 봤다.** 통과만 확인했다. 밟으려면 `public/licenses/`를 잠시 치우고
> 다시 빌드해 `미탑재`가 찍히는지 보면 된다(`cargo`는 `dist/` 변경만으로는 다시 안 도니
> **`npm run tauri -- build`로** 돌린다). 재빌드 2회가 들어 이번에는 안 했다.
>
> 지연 계측(`--latency-probe`) 중에는 이 확인이 **안 돈다.** 4KB라도 표본 구간에 얹힌 일은
> A-3 숫자에 섞인다.

## OFL이 허용/금지하는 것 중 우리에게 걸리는 것

| | |
|---|---|
| ✅ 소프트웨어와 함께 번들·재배포 | 우리가 하는 것 |
| ✅ 상업적 사용 | |
| ⛔ **폰트만 따로 파는 것** | 해당 없음 |
| ⛔ 예약 폰트 이름(RFN)으로 **수정본**을 배포 | **수정하지 않았다.** 서브셋을 만들 거면 그때 이름을 바꿔야 한다 |

> ⚠️ **서브셋 유혹을 조심할 것.** 4.2MB가 부담돼 한글만 남기고 싶어질 수 있는데,
> 그건 **수정본**이라 `D2Coding` 이름을 그대로 쓸 수 없다. 그리고 우리 `@font-face`가
> 선언하는 패밀리 이름이 곧 `terminal.ts`의 스택 첫 항목이다 — 이름을 바꾸면 거기도 같이 바꿔야 한다.
