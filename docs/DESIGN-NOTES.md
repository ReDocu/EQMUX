# 디자인 이관 노트 (`S0-5`)

> 작성: 서이안 · 2026-08-04 · v0.1
> 원본: `AgentCommender/ops/design/design.pen` (136 KB, 최상위 프레임 `CPEx9` — "AgentCommender UI Concept & Components", 1440×840)

---

## 0. ⚠️ 막힌 것 — 팀장님 조치 필요

**`design.pen` 원본을 열지 못했습니다.**

Pencil MCP은 **Pencil 앱에 현재 열려 있는 문서**에만 동작합니다. `filePath` 인자를 줘도 무시되고,
지금 열린 빈 문서(`pencil-new.pen`, 800×600)를 대상으로 잡습니다.

```
execute(filePath: ".../design.pen")  →  bi8Au | Frame | 800x600   ← 빈 문서
get_screenshot(nodeId: "CPEx9")      →  Failed to find a node with id CPEx9
```

> **필요한 것: Pencil 앱에서 아래 파일을 열어 주십시오.**
> `C:\Users\LEE\Desktop\GitProject\ClaudeCodeTemplate\root\AgentCommender\ops\design\design.pen`
>
> 열리면 제가 바로 읽고 이 문서를 채웁니다.

**그동안 우회로로 8할은 확보했습니다.** 디자인 토큰이 이미 구현에 추출돼 있습니다
(`src/renderer/styles.css`의 `:root`, `src/renderer/status.ts`).
아래 내용은 전부 그 실측값입니다 — 추정이 아닙니다.

---

## 1. 색 토큰 (실측)

### 표면 — 짙은 남색 계열

| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg` | `#0c1118` | 앱 바탕 |
| `--surface` | `#141b24` | 카드·패널 |
| `--surface-2` | `#0f151d` | 한 단 낮은 표면 |
| `--deep` | `#080c11` | 가장 깊은 곳 (터미널 바탕 추정) |
| `--hover` | `#17202b` | 마우스 오버 |

### 경계 — 헤어라인

| 토큰 | 값 |
|---|---|
| `--line` | `#202b38` |
| `--line-strong` | `#2a3645` |

### 텍스트 — 4단계

| 토큰 | 값 | 용도 |
|---|---|---|
| `--text` | `#e7edf4` | 본문 |
| `--text-soft` | `#b5c0cd` | 보조 |
| `--muted` | `#78879a` | 흐린 |
| `--dim` | `#5f6e80` | 가장 흐린 |

### 상태색 — 6계열

| 토큰 | 값 | 쓰임 (추정) |
|---|---|---|
| `--blue` `--blue-text` `--blue-bg` `--blue-bg-soft` | `#5797f2` `#b8d4ff` `#1a2b43` `#17283c` | 주 강조 · 알림 |
| `--green` `--green-bg` | `#62c174` `#10231a` | 성공 · 완료 |
| `--amber` | `#d6a344` | 진행 · 주의 |
| `--red` | `#ee6a70` | 실패 · 오류 |
| `--purple` `--purple-text` `--purple-bg` | `#b58ae8` `#c9abe9` `#21182e` | 페르소나 계열 추정 |
| `--cyan` | `#4cc9c0` | 보조 강조 |

## 2. 서체 (실측)

```css
--font-ui:   Geist, 'Segoe UI Variable Text', 'Segoe UI', 'Malgun Gothic', sans-serif;
--font-mono: 'IBM Plex Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace;
```

- **UI: Geist** / **데이터·터미널: IBM Plex Mono** — 둘 다 무료(OFL) 서체
- **한글 폴백에 `Malgun Gothic`이 이미 들어 있습니다.** 잘 잡아 뒀습니다
- ⚠️ **결정 필요**: EQMUX에서 서체를 **번들할지 시스템 폴백에 맡길지**.
  번들하면 배포물이 커지고(KR1 ≤40MB), 안 하면 기기마다 다르게 보입니다.
  → 제 권고: **가변 서체(variable font) 1종만 subset해서 번들.** 한글은 시스템에 맡깁니다

---

## 3. 발견 — 세 가지

### ① 다크 전용입니다. 라이트 테마가 없습니다

토큰 전체가 어두운 표면 기준 한 벌뿐입니다.

`FEATURES.md`에서 **"테마 2종(라이트/다크)"**로 축소한다고 썼는데, **라이트는 계승이 아니라 신규 제작**입니다.
디자인 작업이 실제로 발생하는 지점입니다.

> **권고: 1차·2차는 다크 한 벌로 갑니다.** 라이트는 5차(공개 배포) 범위로 미룹니다.
> 내부 팀은 아무도 라이트를 안 씁니다. 공개할 때 필요해집니다.

### ② 입력대기 상태가 이미 구현돼 있습니다 — 제 오판 정정

`src/renderer/status.ts`:

```ts
export type SessionStatus = 'attention' | 'active' | 'running' | 'waiting'

export const STATUS_LABEL = { attention: '입력 대기', active: '활성', running: '진행', waiting: '대기' }
export const STATUS_TAG   = { attention: 'WAITING',  active: 'ACTIVE', running: 'RUNNING', waiting: 'IDLE' }

// 입력 대기가 최우선 — 질문에 멈춰 있는 세션이 지휘관이 가장 먼저 봐야 할 세션이다
if (activity.isWaitingInput(id)) return 'attention'
```

**`FEATURES.md`의 E10·E11을 "⭐ 신규"로 표기한 것은 오류입니다.** 이미 있습니다.
제가 근거로 삼은 `인수인계.md`(2026-07-31)에는 미구현으로 적혀 있었으나 그 이후 구현됐습니다.

> **교훈: 문서보다 코드가 최신입니다.** `S0-2` 대조표를 `인수인계.md`가 아니라
> **소스 기준으로** 하도록 해원에게 지시를 고쳐야 합니다.

또한 `STATUS_TAG` 주석에 `(design.pen)`이라고 적혀 있습니다 —
**영문 라벨이 디자인 원본에서 온 것**이므로, 원본을 열면 페인 헤더 시안을 볼 수 있습니다.

### ③ 상태가 4단계입니다 (3단계가 아니라)

`인수인계.md`에는 "세션 상태 3단계: 활성 / 진행 / 대기"로 적혀 있는데 실제 코드는 **4단계**입니다.
`attention`(입력 대기)이 최우선으로 앞에 붙습니다. 판정 임계값도 확인됐습니다:

| 상태 | 조건 |
|---|---|
| `attention` 입력 대기 | `isWaitingInput()` — **최우선** |
| `active` 활성 | 마지막 출력 < 3초 |
| `running` 진행 | < 60초 |
| `waiting` 대기 | 그 외 |

**EQMUX는 이 4단계를 그대로 계승합니다.** 검증된 모델을 다시 설계할 이유가 없습니다.

---

## 4. 이관 계획

| # | 항목 | 방식 | 단계 |
|---|---|---|---|
| 1 | 색 토큰 24개 | **그대로 이식.** CSS 변수 → `config.toml` 기본 테마 | 1차 |
| 2 | 서체 2종 | 이식 + **번들 여부 결정** (KR1 영향) | 1차 |
| 3 | 상태 4단계 + 라벨 | **그대로 계승** | 1차 |
| 4 | 레이아웃·간격·아이콘 | ⏸ **design.pen 열람 후** | 1차 |
| 5 | 라이트 테마 | 🆕 신규 제작 | **5차** |

**1차에 필요한 화면 (WORKPLAN `S2-8` 대상)**
- 터미널 페인 (헤더: 상태 태그 · 이름 / 바탕: `--deep`)
- 탭바 · 분할선
- 사이드바 (워크스페이스 목록)
- 하단 상태바

> 관제 대시보드 · 페르소나 패널 · 팀 편성 관계도는 **3·4차 화면**입니다. 1차엔 안 그립니다.

---

## 5. 남은 것

1. **`design.pen` 원본 열람** — 팀장님이 Pencil에서 열어 주셔야 합니다 (0절)
   → 필요한 것: 레이아웃 간격 · 아이콘 세트 · 페인 헤더 시안 · 컴포넌트 목록
2. **서체 번들 여부 결정** — KR1(≤40MB)과 직결
3. **`S0-2` 지시 수정** — 대조 기준을 `인수인계.md` → **소스 코드**로 (3절 ② 참조)
