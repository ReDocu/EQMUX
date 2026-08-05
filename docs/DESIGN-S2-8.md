# DESIGN — S2-8 · UI를 design.pen에 맞추기 (설계 정본)

> 작성: 서이안 · 2026-08-05 · **v0.1 설계** (구현은 `S2-6b` 뒤 — 이 문서가 그때의 정본)
> 원본: `project/EQMUX/design.pen` **실물 열람** (Pencil · 08-05) · 대조: [DESIGN-NOTES.md](DESIGN-NOTES.md)(S0-5) ·
> AgentCommender `styles.css` 실측 24색

---

## 0. ⚠️ 어긋남 기록 — 문서가 아니라 파일이 정본이다

[DESIGN-NOTES.md](DESIGN-NOTES.md) §0-A(08-04)가 기술한 것과 **지금 파일이 다르다.**

| §0-A 기록 (08-04) | 실물 (08-05 열람) |
|---|---|
| 변수 **31개** (색 23 + 서체 2 + 간격 5 + 반경 1) | 변수 **15개** (색 13 + 서체 2) — 간격·반경 변수 없음 |
| `component/StatusTag` · `component/TerminalPane` | **`UI Container / *` 계열 18종** (Terminal Pane · Session Card 3종 · 패널 6종 · 메뉴 3종 등) |
| `1차 — 터미널 뷰` (1440×900) | **그 프레임이 없다** — 대신 `AgentCommender — Fixed Operations Layout Set`(10680×900) |

파일이 그 뒤 재구성됐다. **이 스펙은 실물 기준으로 쓴다.** (→ 팀장님 확인 1건: §5)

## 1. 토큰 매핑 — 3층 구조

**pen 변수(15)는 styles.css 실측(24색)의 부분집합이고, 값이 전부 일치한다.** 구현 토큰은 다음 우선순위:

```
① design.pen 변수 15   — 디자인이 이름 붙인 것 (정본)
② styles.css 실측 24색 — pen에 없는 파생 톤은 여기서 계승 (#5 "코드가 정본")
③ pen 리터럴          — 컴포넌트 안에서 발견된 값. ②와 대조해 이름을 찾아 준다
```

### ①+② 통합 토큰 표 (EQMUX `styles.css` `:root`에 실을 것)

| CSS 변수 | 값 | 출처 | 용도 |
|---|---|---|---|
| `--bg` | `#0C1118` | pen `bg` | 앱 바탕 |
| `--panel` | `#141B24` | pen `panel` | 탭바·사이드바·패널 크롬 |
| `--panel-2` | `#0F151D` | pen `panel2` | 한 단 낮은 표면 |
| `--deep` | `#080C11` | pen 리터럴(Terminal Screen fill) = styles.css `--deep` | **터미널 본문 바탕** — 추정이었는데 실물로 확정 |
| `--line` / `--line-soft` | `#2A3645` / `#202B38` | pen `line`/`lineSoft` | 분할선·헤어라인 (⚠️ AgentCommender와 강/약 명명이 반대 — **pen 명명을 따른다**) |
| `--text` / `--muted` | `#E7EDF4` / `#78879A` | pen | 본문 / 흐린 |
| `--text-soft` `--dim` `--hover` | `#B5C0CD` `#5F6E80` `#17202B` | styles.css 계승 | pen에 없는 파생 톤 |
| `--blue` `--green` `--cyan` `--amber` `--purple` `--red` | `#5797F2` `#62C174` `#4CC9C0` `#D6A344` `#B58AE8` `#EE6A70` | pen | 상태·계열색 6종 |
| `--blue-bg-soft` 등 `*-bg` 6종 | styles.css 계승 | — | pen에선 리터럴로 확인 (`#17283C` = 헤더 배경 = `--blue-bg-soft` ✓) |
| `--term-fg` | `#C1CDD9` | pen 리터럴(Terminal Content) | **터미널 전경 — 신규 토큰.** styles.css에 없던 값 |

### 서체 — ⚠️ 터미널 셀은 디자인을 따르지 않는다

| 자리 | 서체 | 근거 |
|---|---|---|
| UI 크롬 (탭·사이드바·헤더) | `Geist` → 시스템 폴백 | pen `font-ui` · 번들 여부는 §5 미결 |
| 데이터 라벨 (상태 태그·칩·상태바) | `IBM Plex Mono` → 폴백 | pen `font-mono` |
| **터미널 셀** | **`FONT_STACK`(D2Coding 동봉) 그대로 — 불변** | **관문 A-2가 이 스택으로 통과했다** (오차 0.000px). pen이 터미널 본문을 IBM Plex Mono로 그렸지만 **그건 시안의 목업 텍스트다.** 셀 폰트를 바꾸면 A-2를 다시 열어야 한다 |

> WORKPLAN S2-8 비고 *"폰트 최종 선택도 여기서"* 의 답: **터미널 셀은 이미 끝난 결정이다**(`#8` 동봉).
> 여기서 정할 것은 **UI 서체 번들 여부**뿐이다 (§5).

## 2. 터미널 페인 — 실물 구조 계승 (`UI Container / Terminal Pane` 714×185)

```
┌─ 헤더 30px · --blue-bg-soft(활성) · 아래 헤어라인 --line-soft · 좌우 pad 8 ─┐
│  ● 상태점 6px   이름(mono·--text)   [임무칩: 보라 테두리·mono]     ACTIVE  ⤢  ⋯  │
├──────────────────────────────────────────────────────────────────┤
│  본문 · --deep · pad 9/10 · 전경 --term-fg                          │
└─ 페인 테두리: 활성/입력대기 --blue · 그 외 --line ─────────────────────┘
```

- 헤더 좌: **상태점 → 이름 → 임무칩** (gap 6) / 우: **상태라벨 → 줌 → 더보기** (gap 8)
- 상태 4단계 색 (status.ts 계승 · [DESIGN-NOTES.md](DESIGN-NOTES.md) §3-③):
  `attention`=`--blue`(**지배적 강조** — 테두리까지) · `active`=`--green` · `running`=`--amber` · `waiting`=`--muted`
- **강조는 하나일 때만 강조** — attention 외 상태는 배경 투명, 점·라벨 색만
- ⚠️ **pen의 절대 치수는 참고값이다.** 컴포넌트가 축소 시안(714×185 · 7pt)이라 px를 그대로 옮기지 않는다.
  옮기는 것은 **토큰·위계·비율**(헤더 ≈ 본문 글자높이의 2배, 점 6:이름 7 비율 등)이다.

## 3. 구현 절차 (S2-6b 뒤 · 이안)

| # | 순서 | 회귀 게이트 |
|---|---|---|
| 1 | `styles.css` `:root`를 §1 표로 교체 (현행 임시색 제거) | — |
| 2 | xterm 테마 갱신 — `background: --deep` · `foreground: --term-fg` · selection/cursor `--blue` 계열. **ANSI 16색은 현행 유지** (디자인 파일에 정의가 없다 — 없는 것을 발명하지 않는다) | **A-3** (렌더 경로 불변 확인) |
| 3 | 페인 헤더를 §2 구조로 (S2-2 패널 막대 개편) | `--panes-probe` |
| 4 | 탭바·사이드바·상태바 토큰 적용 (S2-6b 산출물 위에) | — |
| 5 | **A-2 재계측** — 셀 폰트는 안 건드리지만 `font-family` 상속 경로가 바뀔 수 있다 | **A-2 · 검증: 해원** (`#18` 규칙 2 — 구현자 이안) |

## 4. 안 하는 것

- **라이트 테마** — 5차 (DESIGN-NOTES §3-① 권고 유지 · 내부팀 전원 다크)
- **ANSI 팔레트 재설계** — 디자인 관할 밖. 현행 유지
- 관제 대시보드·페르소나 카드·메뉴 3종 — **3·4차 화면**이다. pen에 있다고 1차에 그리지 않는다

## 5. 팀장님 확인 2건

1. **`1차 — 터미널 뷰`(1440×900) 프레임이 현재 파일에 없습니다** — 재구성 때 뺀 것인지, 지금 남은
   `AgentCommender — Fixed Operations Layout Set` 기준으로 가면 되는지. (스펙은 컴포넌트 기준이라 안 막힙니다)
2. **UI 서체(Geist) 번들 여부** — 제 권고는 S0-5 그대로: **번들 안 함**(시스템 폴백). KR1 여유는 크지만
   (5→40MB) OFL 표기 의무가 늘고, UI 크롬 서체는 기기 차이가 치명적이지 않습니다. 반대 없으시면 폴백으로 갑니다.
