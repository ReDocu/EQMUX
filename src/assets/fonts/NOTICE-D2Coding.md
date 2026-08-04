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

## ⚠️ 아직 안 된 것 — **OFL 1.1 전문 파일**

SIL OFL 1.1은 재배포 시 **저작권 고지와 라이선스 전문을 함께 싣도록** 요구한다.
지금 이 저장소에는 **위 고지만 있고 전문 파일이 없다.**

- 라이선스 전문을 **기억으로 옮겨 적지 않았다.** 법적 문서를 근사치로 적으면 고지가 아니라 위험이다.
- 필요한 것: `LICENSE-OFL-1.1.txt` (SIL Open Font License 1.1 전문) 1개.
  ID 14의 URL은 naver dev 위키라 현재 접근되지 않으므로 **SIL 정본**에서 받아야 한다.
- `issue.md` #8이 *"동봉하게 되면 OFL 고지를 5차 라이선스 정리에 함께 넣는다"* 로 이미 예정해 뒀다.

> **배포 전에 반드시 채운다.** 지금은 개발 빌드라 유예된 것이지 면제된 것이 아니다.
> `README.md`의 `LICENSE 미정 — 5차에 확정`과 같은 자리에서 함께 처리한다.

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
