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

## ✅ OFL 1.1 전문 — `LICENSE-OFL-1.1.txt` (2026-08-05 추가)

SIL OFL 1.1은 재배포 시 **저작권 고지와 라이선스 전문을 함께 싣도록** 요구한다(조건 2).
이 폴더의 `LICENSE-OFL-1.1.txt`가 그것이다.

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
diff <(tail -n +6 /tmp/ofl.txt) <(tail -n +2 src/assets/fonts/LICENSE-OFL-1.1.txt)   # 출력 없으면 동일
```

> 라이선스 전문은 **기억으로 옮겨 적지 않았다.** 근사치로 적은 법적 문서는 고지가 아니라 위험이다.
> 받아서 넣었고, 무엇을 바꿨는지와 되돌려 볼 명령을 여기 남긴다.

## ⚠️ 남은 것 — **전문 파일이 배포물에 안 실린다**

저장소에는 있지만 **사용자가 받는 물건에는 아직 없다.** `dist/`에 들어가는 건 `.ttf` 하나뿐이라
(`dist/assets/D2Coding-…ttf`), 이 `.txt`는 exe에도 설치본에도 안 따라간다.

- 폰트 바이너리 자체는 ID 13(OFL 1.1 명시)·ID 14(URL)를 갖고 있지만 **그 URL이 죽어 있다**(naver dev 위키).
  "기계 판독 가능 필드"로 버티기엔 사용자가 실제로 볼 수 없다.
- 고치는 법은 둘 중 하나 — **빌드 설정 변경이라 재빌드가 따른다.**
  1. `public/LICENSE-OFL-1.1.txt` — Vite가 `dist/`로 복사 → **exe 안에 박힌다**(포터블 배포까지 커버)
  2. `tauri.conf.json`의 `bundle.resources` — 설치본 exe **옆에** 놓인다(설치 경로만 커버)
- **A-2 육안 판정용 exe(4.93 MB)를 지금 갈아치우지 않으려고 보류했다.** 판정이 끝나면 1번으로 넣는다.

> `issue.md` #8이 *"동봉하게 되면 OFL 고지를 5차 라이선스 정리에 함께 넣는다"* 로 예정해 둔 자리다.
> `README.md`의 `LICENSE 미정 — 5차에 확정`과 함께 처리한다.

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
