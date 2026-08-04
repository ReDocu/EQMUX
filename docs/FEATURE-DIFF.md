# FEATURE-DIFF — `FEATURES.md` 101개 ↔ AgentCommender 코드 실측

> `S0-2` 산출물 · 작성: 윤해원 · 2026-08-04
> **대조 기준: `src/` 코드** ([issue](issue.md) #5 확정). 문서는 대조 **대상**이지 기준이 아니다.
> 대조 소스: `D:\ClaudeCockpit\root\AgentCommender\ops\src` (읽기 전용 · 무수정)
> 대조 문서: `…\ops\docs\` — `인수인계.md` · `Feature_Map.md` · `Tech.md` · `Tech_check_List.md`

---

## 0. 읽는 법

**코드 위치** — 전부 `ops/src/` 기준 `파일:줄`. 추정하지 않았다.
기능이 없으면 `없음(검색어: …)` — **무엇을 찾아봤는지가 다음 사람에게 정보**다.

**문서 4열** — 코드와 **어긋날 때만** 표시한다.

| 표기 | 뜻 |
|---|---|
| ✅ | 코드와 일치 |
| ❌ | 코드와 어긋남 — 무엇이 다른지 함께 적었다 |
| — | 그 문서가 이 항목을 **다루지 않음** (누락이 아니라 범위 밖. 어긋남으로 세지 않는다) |

**EQMUX 판정** — `승계` / `개선 후 승계` / `버림` / `신규`

**코드 실측 3분류** (브리프 §4 원문 용어)

| 표기 | 뜻 |
|---|---|
| **있음** | wmux 기능과 같은 목적·같은 방식으로 이미 있다 |
| **다름** | 목적은 같은데 **방식·단축키·범위가 다르다**. 그대로 쓰면 어긋난다 |
| **없음** | 코드에 없다 |

---

## 1. 요약 통계

### 1.1 코드 실측 — 101개 전수

| 절 | 항목 | 있음 | 다름 | 없음 |
|---|---:|---:|---:|---:|
| A 터미널 코어 | 16 | 10 | 4 | 2 |
| B 멀티플렉싱 | 19 | 2 | 9 | 8 |
| C 셸 통합 | 11 | 0 | 2 | 9 |
| D 세션 영속 | 9 | 2 | 4 | 3 |
| E 에이전트 | 11 | 2 | 5 | 4 |
| F CLI/IPC | 11 | 1 | 5 | 5 |
| G 알림 | 10 | 0 | 2 | 8 |
| H 설정·테마 | 9 | 0 | 2 | 7 |
| I 브라우저 | 5 | 1 | 3 | 1 |
| **합계** | **101** | **18** | **36** | **47** |

> **101개 전부 코드로 확인했다.** 미확인 항목 없음.

**한 문장.** 터미널 코어(A)는 **10/16이 이미 있고**, 멀티플렉싱(B)은 **개념이 한 계층 얕다**
(탭 = 팀 하나뿐, 패널당 탭이 없다). 셸 통합(C)·알림(G)·설정(H)은 **거의 통째로 없다** —
여기가 EQMUX의 실제 신규 작업량이다.

### 1.2 문서가 코드와 어긋난 건수

| 문서 | 자칭 기준일 | 어긋남 | 성격 |
|---|---|---:|---|
| `Tech.md` | 2026-08-02 | **5건** | 가장 정확. 다만 **모듈 지도·IPC 계약이 낡았고**, FS-7(임무)이 구버전 동작을 기술 |
| `Tech_check_List.md` | 2026-08-01 | **7건** | **구현된 것을 `[ ] 미구현`으로 적은 게 3건** — 규모 산정을 직접 오염시킨다 |
| `Feature_Map.md` | 2026-08-01 | **8건** | 커밋 표기가 틀렸고, 그 이후 기능(배치 팔레트·로그 패널·브로드캐스트)이 반영 안 됨 |
| `인수인계.md` | 2026-07-31 | **8건** | 가장 오래됨. 미구현 목록에 **이미 구현된 것**이 남아 있다 |

> ⚠️ **`Tech.md`가 가장 정확하지만 "정본"은 아니다.** 5건 중 3건(FS-7 배정·키·잠금)이
> [issue](issue.md) #1·#2·#3의 **모순 출처 그 자체**다. 문서 하나를 정본으로 세우는 순간
> 그 3건이 EQMUX 설계로 그대로 넘어온다. #5의 "코드가 정본" 결정이 옳았다.

### 1.3 EQMUX 판정 집계

> ### ⚠️ 정정 (해원 검증, 2026-08-05) — 이 표의 네 값이 전부 틀렸습니다
>
> 이안 지시로 요약 통계를 본문과 대조했습니다. **§1.1(18/36/47)은 정확합니다** —
> 9개 절의 표를 한 줄씩 세어 절별 값·합계가 전부 일치했습니다.
> **틀린 것은 이 §1.3뿐입니다.** 본문 `EQMUX 판정` 열을 세지 않고
> §1.1의 코드 실측값(18/36)을 그대로 옮겨 쓴 것으로 보입니다.
>
> **두 축은 1:1이 아닙니다.** 대표 반례가 **I1(내장 브라우저 패널)** 입니다 —
> 코드에는 **있음**이지만 EQMUX 판정은 **버림**입니다(`:360`). 그래서 `있음 18 ≠ 승계 18`입니다.

| 판정 | ~~기존~~ → **실제** | 근거 (본문에서 센 것) |
|---|---:|---|
| 승계 | ~~18~~ → **17** | A 10 · B 2 · D 2 · E 2 · F 1 |
| 개선 후 승계 | ~~36~~ → **35** | A 4 · B 9 · C 2 · D 4 · E 5 · F 5 · G 2 · H 2 · I 2 |
| 신규 | ~~37~~ → **35** | A 2 · B 8 · C 8 · D 1 · E 3 · F 2 · G 8 · H 2 · I 1 |
| 버림 | ~~10~~ → **14** | C7 · D8 · D9 · E9 · F9 · F10 · F11 · H4 · H5 · H6 · H8 · H9 · I1 · I2 |
| **합계** | **101** | 17 + 35 + 35 + 14 = 101 ✅ |

> **재설계 낭비 방지 관점의 결론 (정정판)**: **17개는 이미 돌아가고 35개는 손보면 된다.**
> 백지에서 짜야 하는 건 **35개**, 아예 안 만드는 것이 **14개**다.
>
> **결론의 방향은 안 바뀝니다.** 다만 "버림 10"은 `FEATURES.md`의 ❌ 10개를 그대로 옮긴 값이라
> **⏸ 보류 3건(F9·F10·F11)과 I1이 빠져 있었습니다.** 안 만들 것이 4개 더 많습니다.

---

## 2. 반드시 먼저 볼 4건

### 2.1 [issue #4] 터미널 내 검색 — **구현돼 있다. 확정.**

| | |
|---|---|
| **결론** | **AgentCommender에 `SearchAddon` 기반 `Ctrl+F` 검색이 완전히 구현돼 있다** |
| **의존성** | `package.json:19` — `"@xterm/addon-search": "^0.16.0"` |
| **로드** | `renderer/TerminalPane.tsx:5` import · `:138-140` `new SearchAddon()` → `term.loadAddon(search)` → `searchRef` |
| **열기** | `renderer/TerminalPane.tsx:169-172` — `key === 'f' && !e.shiftKey` → `setSearchOpen(true)`, `return false`로 xterm에 안 넘김 |
| **증분 검색** | `renderer/TerminalPane.tsx:360-363` — `onChange` → `findNext(value, { incremental: true })` |
| **다음/이전/닫기** | `renderer/TerminalPane.tsx:364-369` — `Enter`=`findNext` · `Shift+Enter`=`findPrevious` · `Escape`=`closeSearch` |
| **UI** | `renderer/TerminalPane.tsx:352-381` — `.find-bar` + 입력 + ↑ / ↓ / ✕ 버튼. 열리면 자동 포커스(`:270-272`) |
| **정리** | `renderer/TerminalPane.tsx:274-279` `closeSearch` — 선택 해제 후 터미널로 포커스 복귀 |

**틀린 문서는 `Tech_check_List.md:145` 하나다.**

> `- [ ] 터미널 내 검색 UI (Ctrl+F 오버레이 — `@xterm/addon-search`는 이미 의존성에 있음) `P1``

같은 문서 `:13`은 *"xterm 6 WebGL 렌더링 + fit/**검색**/웹링크 애드온 의존성"* 을 `[x]`로 적어 놓았다.
**한 문서 안에서 갈린다.** `:13`은 "의존성"만 말하고 `:145`는 "UI"가 없다고 읽히지만,
UI는 `TerminalPane.tsx:352-381`에 **있다.** `:145`는 그냥 낡았다.

> ### ⚠️ `S3-2` 규모에 미치는 영향
>
> `WORKPLAN.md:108` `S3-2`(터미널 내 검색)는 **신규 구현이 아니라 참조 대상이 있는 이식**이다.
> 규모 **S 유지**가 맞다. 다만 EQMUX는 `SearchAddon`을 그대로 쓸 수 있으므로
> **실제 작업은 검색 바 UI + 키 라우팅뿐**이고, 참조 구현이 34줄(`:352-381`)짜리다.
> — **`S3-2`는 S 중에서도 가벼운 쪽으로 봐도 된다.**

### 2.2 [issue #1] 팀 기본 임무는 **잠금이 아니다** — 코드로 확정

| | |
|---|---|
| **코드** | `renderer/App.tsx:600-632` — 자동 배정 이펙트 |
| **동작** | `if (!project \|\| state.assignments[key] !== undefined) continue` (`:613`) — **임무가 없는 세션만 채운다** |
| **해제 없음** | 다른 임무를 맡은 세션을 **건드리는 코드가 없다** (일괄 해제·확인 다이얼로그 부재) |
| **차단 없음** | 이후 배정을 막는 가드가 없다 — `Dashboard.tsx`의 배정 select에 잠금 분기 없음 |
| **주석 명시** | `main/state.ts:48` — *"팀 이름 → 기본 임무(프로젝트) 이름 — 임무 없는 세션에 자동 배정된다 **(잠금이 아니다)**"* |

**틀린 문서**: `Tech.md:294`. (`Feature_Map.md:166-168`·`Tech_check_List.md:66-67`·`Mission_Spec.md:94`는 맞다.)
→ **issue #1은 "설계 선택"이 아니라 "문서 오류"였다. 코드가 이미 B(기본값)다.**

### 2.3 [issue #2] 배정 캐시 키는 **`"<팀>/<세션>"`** — 코드로 확정

`renderer/mission.ts:15-17` `missionKey(team, session) => \`${team}/${session}\``
· 구버전 마이그레이션 `renderer/mission.ts:88-102` `migrateAssignments`
· 이유 주석 `renderer/mission.ts:11-14` *"세션 이름은 팀 사이에서 겹칠 수 있다"*

**틀린 문서**: `Tech.md:293` (`assignments[세션명]`). → **EQMUX는 처음부터 `<팀>/<세션>`로 간다.**

### 2.4 [issue #3] 배정 전달 방식은 **분기한다** — 코드로 확정

`renderer/mission.ts:27-32` `deliverBrief`:

```ts
const text = session.agent
  ? `[관제] 임무 '${mission.project}' 배정. 브리프 ${mission.doc} 를 먼저 읽고, 작업은 ${mission.path} 에서 한다.`
  : `cd "${mission.path}"`
```

판별은 **선언값** `SessionInfo.agent` (`main/pty-manager.ts:18-24` 주석이 한계를 자인)
· 기록 `main/index.ts:138-148` `pty:set-agent` · UI `renderer/Dashboard.tsx:2101-2118`

**틀린 문서**: `Tech.md:293` ("무조건 `cd` 전송") · `인수인계.md:38`.
→ **분기는 승계. 판별만 실측으로 바꾼다** (issue #3 의견대로).

---

## 3. A. 터미널 코어 — 16개

| 기능 | 코드 실측 | 코드 위치 | 인수인계 | Feature_Map | Tech | 체크리스트 | EQMUX 판정 |
|---|---|---|---|---|---|---|---|
| A1 ConPTY 세션 관리 | **있음** — `@lydell/node-pty`, `xterm-256color` 80×24로 spawn, 생성 직후 `pause()` → 렌더러 준비 후 `resume()` | `main/pty-manager.ts:89-95` · `:130` · `renderer/TerminalPane.tsx:223-234` | ✅ | ✅ | ✅ | ✅ | 승계 |
| A2 VT 에뮬레이션 | **있음** — xterm.js 6 | `renderer/TerminalPane.tsx:129-135` · `package.json:22` | ✅ | ✅ | ✅ | ✅ | 승계 |
| A3 트루컬러 24bit | **있음** — xterm 기본값. 전용 설정 없이 `THEME` 16색 팔레트만 지정 | `renderer/TerminalPane.tsx:16-38` | — | — | — | — | 승계 |
| A4 GPU 렌더링(WebGL) | **있음** — `WebglAddon`, `try/catch`로 기본 렌더러 폴백 | `renderer/TerminalPane.tsx:148-152` | — | ✅ | ✅ | ✅ | 승계 |
| A5 **CJK 문자 폭** | **없음** — 전용 처리도 `Unicode11Addon`도 없다. xterm 내장 폭 테이블에 전적으로 의존 | 없음(검색어: `unicode`, `Unicode11`, `wcwidth`, `addon-unicode` — `src/` 전체 0건 · `package.json:16-25`에도 없음) | — | — | — | — | **신규** (v0.1 관문 A-2) |
| A6 **IME 조합 입력** | **없음** — 전용 처리 없음. xterm 내장 composition helper에 전적으로 의존 | 없음(검색어: `composition`, `compositionstart`, `IME`, `preedit` — `src/` 전체 0건) | — | — | — | — | **신규** (v0.1 관문 A-1) |
| A7 마우스 리포팅 | **있음** — xterm 기본. 앱이 막지 않는다 (`attachCustomKeyEventHandler`는 키만 가로챔) | `renderer/TerminalPane.tsx:153-175` (마우스 미개입) | — | — | — | — | 승계 |
| A8 스크롤백 버퍼 | **있음** — **10,000줄 상한**. 무제한 아님 | `renderer/TerminalPane.tsx:134` | — | ✅ | ✅ | — | 승계 (상한값 재검토) |
| A9 셸 자동 감지 | **있음** — PowerShell·pwsh·cmd·Git Bash·WSL 실측 감지 + 기본값 폴백 | `main/shells.ts:15-50` · `main/pty-manager.ts:40-43` | ✅ | ✅ | ✅ | ✅ | 승계 |
| A10 선택·복사·붙여넣기 | **다름** — **`Ctrl+C`/`Ctrl+V`** (Windows Terminal 방식). `Ctrl+Shift+C/V` 아님. + 우클릭 복사/붙여넣기 | `renderer/TerminalPane.tsx:157-168` · `:178-187` | ✅ | ✅ | ✅ | — | **개선 후 승계** — 키 결정 필요 |
| A11 **터미널 내 검색** | **있음** — `SearchAddon`, `Ctrl+F`, 증분 검색, Enter/Shift+Enter/Esc, ↑↓✕ 버튼 | `renderer/TerminalPane.tsx:5,138-140,169-172,352-381` | ✅ | ✅ | ✅ | ❌ **`:145` "미구현 P1"로 적혀 있으나 구현됨** (같은 문서 `:13`과도 충돌) | 승계 → **`S3-2` 규모 재확인 완료** |
| A12 클릭 가능한 링크 | **다름** — `WebLinksAddon` + **`Ctrl`+클릭**, 그리고 **내장 브라우저 패널**로 연다 (외부 브라우저 아님) | `renderer/TerminalPane.tsx:142-146` · `renderer/App.tsx:595-598` | ✅ | ✅ | ✅ | — | **개선 후 승계** — 대상을 외부 Chrome으로 |
| A13 클립보드 이미지 → 경로 주입 | **있음** — 파일 → 이미지(PNG 저장) → 텍스트 우선순위 판별 | `main/index.ts:308-332` | ✅ | ✅ | ✅ | ✅ | 승계 |
| A14 폰트 설정 + 리거처 | **다름** — 폰트 스택이 **하드코딩**(`"Cascadia Mono", Consolas, "Courier New", monospace`). 설정 UI 없음, 리거처 설정 없음. 바꿀 수 있는 건 **크기뿐** | `renderer/TerminalPane.tsx:130` | — | ✅(폰트명만) | ✅(폰트명만) | — | **개선 후 승계** |
| A15 커서 스타일 | **다름** — `cursorBlink: true`만. `cursorStyle` 옵션·설정 없음 | `renderer/TerminalPane.tsx:133` | — | — | — | — | **개선 후 승계** |
| A16 폰트 크기 조절 | **있음** — `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, 8~24 클램프, `state.json`에 저장 | `renderer/shortcuts.ts:42-46` · `renderer/App.tsx:547-555` · `:493` | ✅ | ✅ | ✅ | ✅ | 승계 |

> **A5·A6이 코드에 아무 흔적도 없다는 게 이 표에서 제일 중요한 줄이다.**
> AgentCommender가 한글 환경에서 잘 돌아온 것은 **xterm.js가 알아서 해 준 결과**이지
> 누가 설계한 결과가 아니다. → EQMUX가 xterm.js를 그대로 쓰는 한 같은 수준은 확보되지만,
> **`Unicode11Addon` 미탑재는 승계된 잠재 결함**이다. 관문 A-2에서 이것부터 본다.

> ### ⚠️ 보탬 (해원 검증, 2026-08-05) — **폰트 스택에 한글 폰트가 하나도 없다**
>
> 위 총평은 **폭 계산**(`Unicode11Addon`) 이야기다. 그 아래에 **폰트 폴백**이라는 다른 층이 하나 더 있다.
>
> ```ts
> // renderer/TerminalPane.tsx:130
> fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace'
> ```
>
> **Cascadia Mono · Consolas · Courier New 셋 다 한글 글리프가 없다.**
> 지금 AgentCommender에서 한글이 보이는 건 **마지막 `monospace` 폴백**이 시스템 한글 폰트를
> 끌어오기 때문이고, **그게 어느 폰트인지는 기계마다 다르다.** 스택에 명시된 적이 없다.
>
> EQMUX 스택은 다르다 — `"D2Coding", "Cascadia Mono", "굴림체", "돋움체", Consolas, monospace`
> ([GATE-A.md](GATE-A.md) §1). **한글 폰트를 명시했다는 점에서 EQMUX가 이미 낫다.**
>
> **관문 A-2에 대한 함의**: *"AgentCommender에서 한글이 잘 나오니 EQMUX도 될 것"* 이라는 추론은
> **성립하지 않는다.** 스택이 다르고, AgentCommender 쪽은 폴백이 명시조차 안 돼 있다.
> `A14`(폰트 설정)를 "하드코딩"으로만 읽으면 이 사실이 안 보인다 — **`#8` 판단에 넣을 것.**
> 측정 기계의 실제 설치 폰트는 [MACHINE-SPEC.md](MACHINE-SPEC.md) §3에 있다.

---

## 4. B. 멀티플렉싱 — 19개

> ### ⚠️ 개념 계층이 하나 얕다 — 이 절 전체의 전제
>
> | | wmux | AgentCommender |
> |---|---|---|
> | 계층 | 워크스페이스 → 패널 → **탭(서피스)** | **팀(=탭) → 페인** |
> | 근거 | — | `renderer/model.ts:23-32` `Tab` = 팀 하나 = 레이아웃 트리 하나 · `renderer/App.tsx:768-832` |
>
> AgentCommender의 "탭"은 wmux의 **워크스페이스**에 해당한다.
> **패널 안에 탭을 여는 개념(B7)이 아예 없다.** B8·B9·B10·B12·B13이 전부 여기서 어긋난다.

| 기능 | 코드 실측 | 코드 위치 | 인수인계 | Feature_Map | Tech | 체크리스트 | EQMUX 판정 |
|---|---|---|---|---|---|---|---|
| B1 수평 분할 | **다름** — `Ctrl+Shift+D` (wmux `Ctrl+D`). 내부명 `split-row`= **좌우** | `renderer/shortcuts.ts:26-27` · `renderer/App.tsx:523-524` · `renderer/model.ts:52-70` | ✅ | ✅ | ✅ | ✅ | **개선 후 승계** |
| B2 수직 분할 | **다름** — `Ctrl+Shift+E` (wmux `Ctrl+Shift+D`). 내부명 `split-col`= 상하 | `renderer/shortcuts.ts:28-29` · `renderer/App.tsx:525-526` | ✅ | ✅ | ✅ | ✅ | **개선 후 승계** |
| B3 패널 닫기 | **있음** — `Ctrl+Shift+W`. 마지막 페인이면 팀도 닫힘 | `renderer/shortcuts.ts:24-25` · `renderer/App.tsx:217-240` | ✅ | ✅ | ✅ | ✅ | 승계 |
| B4 드래그 크기 조절 | **있음** — 분할선 드래그, 비율 0.1~0.9 클램프 | `renderer/App.tsx:651-675` · `renderer/model.ts:254-255` | ✅ | ✅ | ✅ | ✅ | 승계 |
| B5 방향 포커스 이동 | **없음** — 포커스 이동은 **마우스 클릭뿐** (`onMouseDown` → `SET_ACTIVE_PANE`) | 없음(검색어: `Ctrl+Alt`, `altKey`, `ArrowLeft`, `ArrowRight`, `focus-left`, `directional` — `renderer/shortcuts.ts` 전체에 방향키 없음) | — | — | — | — | **신규** |
| B6 패널 확대(줌) | **다름** — `Ctrl+Shift+Z` (wmux `Ctrl+Shift+Enter`). 다른 페인은 `visibility:hidden`이라 **세션이 죽지 않는다** | `renderer/shortcuts.ts:34-35` · `renderer/App.tsx:326-334` · `renderer/TerminalPane.tsx:302` | ✅ | ✅ | ✅ | ✅ | **개선 후 승계** |
| B7 **탭(서피스) — 패널당 다중 탭** | **없음** — 페인 = 세션 1개 고정. 페인 안에 탭 개념이 없다 | 없음(검색어: `surface`, `서피스`, `paneTabs`, `Tab` — `model.ts:23-32`의 `Tab`은 **팀**이다) | — | — | — | — | **신규** |
| B8 새 탭 | **다름** — `Ctrl+Shift+T`가 **팀 추가 팝업**을 연다 (wmux `Ctrl+T` = 새 탭) | `renderer/shortcuts.ts:22-23` · `renderer/App.tsx:517-519` · `renderer/TeamDialog.tsx` | ✅ | ✅ | ✅ | ✅ | **개선 후 승계** |
| B9 탭 전환 | **다름** — `Ctrl+Tab`/`Ctrl+Shift+Tab` 순환만. **`Alt+1~8`·`Ctrl+Shift+[`/`]` 없음** | `renderer/shortcuts.ts:19` · `renderer/App.tsx:174-178` | ✅ | ✅ | ✅ | — | **개선 후 승계** |
| B10 탭 닫기 | **다름** — **단축키 없음.** 탭 `×` 또는 **휠클릭**만 | `renderer/TabBar.tsx:81-103` · `:178-188` | ✅ | ✅ | ✅ | — | **개선 후 승계** |
| B11 탭 라벨 자동(셸 종류) | **없음** — 탭 라벨 = 팀 이름, 페인 라벨 = 세션 이름. 셸 종류로 라벨을 붙이는 코드 없음 | 없음(검색어: `shellLabel`, `tab-title`, `title` — `App.tsx:50-53` `shellLabel`은 **상태바 표시용**이고 탭 라벨이 아니다) | — | — | — | — | **신규** |
| B12 워크스페이스 생성 | **다름** — 개념상 **팀 생성**이 이것. `Ctrl+Shift+T` (wmux `Ctrl+N`). 이름 필수·중복 거부 | `renderer/App.tsx:137-148` · `renderer/model.ts:44-49` | ✅ | ✅ | ✅ | ✅ | **개선 후 승계** |
| B13 워크스페이스 전환 | **다름** — 탭 클릭 / `Ctrl+Tab`. **`Ctrl+1~8`·`Ctrl+PgUp/PgDn` 없음** | `renderer/App.tsx:173-178` · `renderer/TabBar.tsx:81-84` | ✅ | ✅ | ✅ | — | **개선 후 승계** |
| B14 워크스페이스 이름변경 / 닫기 | **다름** — **이름 변경 기능이 의도적으로 제거됨** (담당 폴더가 팀 이름에 묶임). 닫기만 있음 | `renderer/TabBar.tsx:178-188` · 근거 `Tech.md:621`·`Tech_check_List.md:32` | — | ✅ | ✅ | ✅ | **개선 후 승계** — 폴더 결합 해소 필요 |
| B15 사이드바 토글 | **없음** — 사이드바 개념 자체가 없다. 유사물은 **사이드 패널 5종**(브라우저/포트/임무/git/로그)이고 `Ctrl+Shift+B`는 **브라우저만** 연다 | 없음(검색어: `sidebar`, `사이드바`, `toggle-sidebar` — 0건. `App.tsx:61` `SidePanel`은 우측 패널 유니온) | — | — | — | — | **신규** |
| B16 명령 팔레트 | **없음** — `Ctrl+Shift+L` **배치 팔레트**는 레이아웃 프리셋 6종 선택기이지 명령 팔레트가 아니다 | 없음(검색어: `palette`, `command-palette`, `CommandPalette`, `Ctrl+Shift+P` — 0건. `LayoutPicker.tsx`는 배치 전용) | — | — | — | — | **신규** |
| B17 새 창 | **없음** — **단일 인스턴스 락**. 두 번째 실행은 기존 창을 포커스하고 종료 | 없음(검색어: `new BrowserWindow` — `main/index.ts:82` 단 1곳 · `:70-79` `requestSingleInstanceLock`) | — | — | ✅(범위 밖 명시) | — | **신규** |
| B18 전체화면 | **없음** | 없음(검색어: `setFullScreen`, `fullscreen`, `F11` — `src/` 전체 0건) | — | — | — | — | **신규** |
| B19 단축키 커스터마이징 | **없음** — 하드코딩 `switch`문 하나 | 없음(검색어: `keybinding`, `keymap`, `customKeys` — 0건. 정의처는 `renderer/shortcuts.ts:17-49` 단일 함수) | — | — | ✅(단일 정의처 명시) | — | 🔻 축소 → **신규(바인딩 파일)** |

> **B 절 총평.** `FEATURES.md`가 B를 "전부 ✅ 완비"로 잡았는데, **코드 기준으로 그대로 쓸 수 있는 건 2개**(B3·B4)다.
> **B7(패널당 탭)이 없다는 게 가장 크다** — `S2` 멀티플렉싱은 AgentCommender 코드를 참조할 대상이
> 사실상 **분할 트리(`model.ts`)뿐**이라는 뜻이다. `model.ts:52-303`은 그대로 이식 가치가 있다
> (트리 → 절대좌표 평면 렌더링으로 **분할해도 세션이 안 죽는** 구조 — `model.ts:234-303`, 주석 `:235-236`).

---

## 5. C. 셸 통합 — 11개

> ### ⚠️ **셸 통합은 통째로 없다.** 이 절이 EQMUX 신규 작업량의 최대치다.
> PTY는 `env: process.env`를 **그대로 넘기고 인자는 빈 배열**이다 (`main/pty-manager.ts:89-95`).
> 즉 **셸에 아무것도 주입하지 않는다.** OSC 시퀀스도 안 읽는다 — `shared/ansi.ts:6`이 **지워 버린다.**

| 기능 | 코드 실측 | 코드 위치 | 인수인계 | Feature_Map | Tech | 체크리스트 | EQMUX 판정 |
|---|---|---|---|---|---|---|---|
| C1 셸 스크립트 자동 주입 | **없음** — `pty.spawn(shell, [], {...})` 인자 없음, 프로필/rc 조작 없음 | 없음(검색어: `PROMPT_COMMAND`, `PSReadLine`, `prompt`, `--init-file`, `-NoProfile` — `pty-manager.ts:89-95` 확인) | — | — | — | — | **신규** |
| C2 작업 디렉터리(CWD) 추적 | **없음** — `cwd`는 **생성 시점 값 고정**. 이후 셸이 이동해도 갱신되지 않는다 (상태바에 뜨는 경로도 생성 시 값) | 없음(검색어: `cwd` 갱신 경로 — `pty-manager.ts:88,103`에서 1회 기록 후 쓰기 없음 · 표시 `App.tsx:846-848`) | ❌ 없음(다루지 않음이 아니라 이 한계를 안 적음) | — | — | — | **신규** |
| C3 git 브랜치 + dirty | **다름** — **세션 단위가 아니라 저장소 단위.** 별도 git 패널이 워크스페이스 저장소를 5초 폴링 | `main/git.ts:126-175` `repoStatus` · `renderer/GitPanel.tsx` · `main/index.ts:503` | — | ✅ | ✅ | ✅ | **개선 후 승계** |
| C4 마지막 명령 exit code → 색 | **없음** — 세션 종료 코드는 로그에만 남김(`pty:exit`), 명령 단위 추적 없음 | 없음(검색어: `exitCode`, `OSC 133`, `exit code` — `pty-manager.ts:117-127`은 **세션** 종료지 명령이 아니다) | — | — | — | — | **신규** |
| C5 인터럽트 감지 (exit 130) | **없음** | 없음(검색어: `130`, `SIGINT`, `interrupt` — 0건) | — | — | — | — | **신규** |
| C6 활성 포트 감지 | **다름** — 셸 통합이 아니라 **`netstat -ano` + 프로세스 부모 추적(최대 64단계)**으로 세션 귀속 판정 | `main/ports.ts:59-105` · `:71-79` `ownerOf` | ✅ | ✅ | ✅ | ✅ | 🔻 축소 → **개선 후 승계** |
| C7 GitHub PR 상태 폴링 | **없음** | 없음(검색어: `gh pr`, `github`, `pull request` — 0건) | — | — | — | — | **버림** |
| C8 환경변수 주입 | **없음** — `ACMUX_*`는 **앱이 읽는 오버라이드**일 뿐 세션에 주입하지 않는다 (`WORKSPACE_ROOT`/`STATE_PATH`/`SHELL`/`PERSONA_DIR` 4종) | 없음(주입 코드 없음 — `pty-manager.ts:94` `env: process.env as Record<string,string>` 통과만) · 읽기 위치 `main/state.ts:54` · `main/workspace.ts:25` · `main/pty-manager.ts:41` · `main/persona-library.ts:52` | ❌ `:65` 환경변수를 "기능"으로 적었으나 **주입이 아니라 오버라이드**다 | — | — | — | **신규** |
| C9 PowerShell 통합 | **없음** | 없음(검색어: `PSReadLine`, `prompt override`, `preexec` — 0건) | — | — | — | — | **신규** |
| C10 CMD `PROMPT` OSC 9 | **없음** | 없음(검색어: `PROMPT`, `OSC 9`, `\x1b]9` — `shared/ansi.ts:6`은 OSC를 **제거**한다) | — | — | — | — | **신규** |
| C11 Bash/Zsh (WSL) 통합 | **없음** — WSL은 **셸 선택지로만** 존재 | 없음(통합 코드 없음) · 셸 감지만 `main/shells.ts:46-47` | — | — | — | — | **신규** |

> **AgentCommender가 "세션이 지금 뭘 하는지"를 아는 유일한 방법은 출력 텍스트 패턴 매칭이다**
> (`renderer/activity.ts:34-45`). 셸이 알려 주는 게 아니라 **앱이 추측한다.**
> `Tech.md:618`이 이 한계를 자인한다 — *"세션 활동은 출력 타이밍 추정이다."*
> → EQMUX가 C1~C5를 넣으면 **E3(활동 표시등)의 정확도가 근본적으로 올라간다.** 이 둘은 한 묶음이다.

---

## 6. D. 세션 영속 — 9개

| 기능 | 코드 실측 | 코드 위치 | 인수인계 | Feature_Map | Tech | 체크리스트 | EQMUX 판정 |
|---|---|---|---|---|---|---|---|
| D1 30초 자동 저장 + 종료 시 저장 | **다름** — **500ms 디바운스**(30초 아님). 종료 시 별도 저장 없음 — `before-quit`은 **세션 로그 아카이브**만 한다 | `renderer/App.tsx:476-496` (`setTimeout(…, 500)`) · `main/state.ts:68-84` (tmp → rename 원자적 쓰기) · `main/index.ts:835-844` | ❌ `:60` "0.5초 디바운스"는 ✅이나 **종료 시 저장을 안 적음** | ✅ | ✅ | ✅ | **개선 후 승계** |
| D2 복구: 창 위치·크기 | **없음** — 매번 1500×950 고정 | 없음(검색어: `bounds`, `getBounds`, `windowState`, `x:`/`y:` — `main/index.ts:82-92`에 크기 하드코딩) | — | — | — | — | **신규** |
| D3 복구: 레이아웃·제목·색 | **다름** — 팀 이름 + 모드 + 프리셋 + 레이아웃 트리 저장. **색 개념 없음** | `main/state.ts:29-36` `SavedTeam` · `renderer/App.tsx:479-487` | ✅ | ✅ | ✅ | ✅ | **개선 후 승계** |
| D4 복구: 분할 구조 + 비율 | **있음** — `serializeLayout`/`restoreLayout`이 `dir`·`ratio`까지 보존 | `renderer/model.ts:112-141` · `renderer/App.tsx:286-310` | ✅ | ✅ | ✅ | ✅ | 승계 |
| D5 복구: 작업 디렉터리 | **다름** — cwd를 저장하지 않는다. **세션 이름만** 복원하고, 이름 → 담당 폴더가 결정적이라 **결과적으로** 같은 폴더에서 시작한다 | `renderer/model.ts:116` (`session: nameOf(id)`) · `main/pty-manager.ts:76-88` (`ensureWorkspace(team, name)` → cwd) | ✅(의도 일치) | ✅ | ✅ | ✅ | **개선 후 승계** |
| D6 복구: 기본 셸 | **있음** — `settings.shell` | `renderer/App.tsx:466` · `:493` | ✅ | ✅ | ✅ | ✅ | 승계 |
| D7 명명 세션 저장/목록/불러오기 | **다름** — 세션 단위가 아니라 **팀 폴더 단위 불러오기**. 워크스페이스를 실측해 팀 폴더 → 세션 폴더 이름으로 복원(최대 8) | `main/index.ts:299` `workspace:list-teams` · `renderer/App.tsx:149-169` `IMPORT_TEAM` · `renderer/TeamDialog.tsx` | ✅ | ✅ | ✅ | ✅ | **개선 후 승계** |
| D8 살아있는 프로세스 상태 복구 | **없음** — 원리적으로 불가. 문서도 명시 | 없음(`Tech.md:617` "프로세스는 되살릴 수 없다") | ✅ | ✅ | ✅ | — | **버림** |
| D9 스크롤백 내용 복구 | **없음** — 대신 **`session.log` 파일**이 남는다(ANSI 제거·5MB 회전). 복원 시 터미널로 되돌리지는 않는다 | 없음(스크롤백 복원 코드 없음) · 로그 `main/pty-manager.ts:107` · `:148-163` · `:34` `LOG_MAX` | ✅ | ✅ | ✅ | ✅ | **버림** |

> **스키마 버전 필드는 이미 있다** — `main/state.ts:39` `version: number` · 쓰기 `renderer/App.tsx:489` `version: 1`.
> **다만 읽을 때 검사하지 않는다** (`main/state.ts:57-66`이 `teams` 배열 여부만 본다).
> → `WORKPLAN.md:110` `S3-4`는 **필드 추가가 아니라 "버전을 실제로 보는 로직" 추가**다. 거기서 규모가 갈린다.

---

## 7. E. 에이전트 통합 — 11개

| 기능 | 코드 실측 | 코드 위치 | 인수인계 | Feature_Map | Tech | 체크리스트 | EQMUX 판정 |
|---|---|---|---|---|---|---|---|
| E1 Claude Code 훅 자동 등록 | **없음** | 없음(검색어: `SessionStart`, `PostToolUse`, `SubagentStop`, `hooks`, `.claude/settings` — `src/` 전체 0건) | ✅(미구현으로 적음) | — | ✅(이식 후보로 적음) | ✅ `:150` FS-7 미구현 | **신규** |
| E2 `~/.claude/CLAUDE.md` 지침 자동 주입 | **다름** — 대상이 **전역이 아니라 세션 담당 폴더의 `CLAUDE.md`**. 페르소나·임무·팀 3종 블록을 관제가 멱등 동기화 | `main/persona.ts:1-11` · `main/index.ts:342-355` (persona) · `:613-632` (mission) · `:406-423` (team) | — | ✅ | ✅ | ✅ | **개선 후 승계** |
| E3 활동 표시등 | **다름** — **4단계**(`attention`/`active`/`running`/`waiting`), 색·의미 매핑이 wmux(주황/초록/빨강/회색)와 다름. 판정은 **출력 타이밍 추정** | `renderer/status.ts:4,25-35` · `:6-7` (`ACTIVE_MS=3000`, `RUNNING_MS=60000`) · `renderer/TerminalPane.tsx:325,329` | ❌ `:31` **3단계** | ❌ `:125` **3단계** | ✅ `:263-268` | ❌ `:49` **3단계** | **개선 후 승계** |
| E4 화면 읽기 `read-screen` | **없음** — CLI에 출력 조회 명령이 없다 | 없음(검색어: `read-screen`, `readScreen`, `tail`, `read` — `cli/acmux.ts:43-55` USAGE에 없음) | ✅ `:92` "최우선 미구현" — **여전히 맞다** | — | — | — | **신규** |
| E5 텍스트 전송 `send` | **있음** — `acmux send <id\|이름> <텍스트> [--no-enter]` | `cli/acmux.ts:112-137` · `main/index.ts:677-692` | ✅ | ✅ | ✅ | ✅ | 승계 |
| E6 키 전송 `send-key` | **없음** — 특수키 전송 경로 없음 (`send`가 `\r`만 붙임) | 없음(검색어: `send-key`, `sendKey`, `--ctrl` — 0건) | — | — | — | — | **신규** |
| E7 에이전트 spawn/list/status/kill | **다름** — "에이전트 실행"은 **셸에 명령 문자열을 보내는 것**(`claude`/`codex`/`gemini`). 에이전트 단위 list/status가 없고, kill은 **세션** 단위 | `renderer/Dashboard.tsx:22-26` `AGENT_CLIS` · `:2092-2107` · `main/index.ts:138-148` `pty:set-agent` · `cli/acmux.ts:138-144` (세션 kill) | ✅ | ✅ | ✅ | ✅ | **개선 후 승계** |
| E8 일괄 spawn `spawn-batch --json` | **다름** — JSON 배치는 없다. 대신 **팀 브로드캐스트**(같은 명령)와 **세션별 일괄 명령**(다른 명령)이 있다 | `main/index.ts:163-175` `broadcastToTeam` · `:178-189` `pty:send-each` · `cli/acmux.ts:113-125` `send --team` | — | ❌ `:321-334` CLI 목록에 **`send --team`이 없다** | ✅ `:281-283,419` | ❌ `:125` **"미구현 P2"로 적혀 있으나 구현됨** | **개선 후 승계** |
| E9 오케스트레이터 플러그인 | **없음** | 없음(검색어: `orchestrat`, `plugin` — 0건) | — | — | ✅(범위 밖) | ✅(P3 미구현) | **버림** |
| E10 **"입력대기" 상태 구분** | **있음** — 최우선 판정. 화이트리스트 패턴(`[y/n]`·`(yes/no)`·`password:`·`계속하시겠습니까` 등)으로 **끝나고** 2초 이상 잠잠할 때 | `renderer/status.ts:29-30` · `renderer/activity.ts:42-45` (`WAIT_RE`, `WAIT_IDLE_MS=2000`) · `:88-93` | ❌ `:95` **"대기 감지·알림 — 미구현"** (구현돼 있다) | ❌ `:125` 언급 없음(3단계) | ✅ `:265,270` | ❌ `:49` 언급 없음(3단계) | 승계 |
| E11 사이드바 배지 = 입력대기 개수만 | **다름** — 사이드바가 없다. 관제 **'주의' 스탯 타일** = **입력대기 ∪ 에러 감지** (겹치면 1회) | `renderer/Dashboard.tsx:69-77` (`notice` 타일) · `:593-599` · 에러 패턴 `renderer/activity.ts:34-37` | ❌ `:29` 타일 **5종** (주의 없음) | ❌ `:124` **5종** | ✅ `:252` **6종** | ❌ `:48` **5종** | **개선 후 승계** |

> ### E10·E11 — `FEATURES.md`의 "⭐ 신규" 정정이 코드로 재확인됐다
>
> `FEATURES.md:181-203`의 정정이 맞다. 다만 **E11은 "그대로 계승"이 아니다**:
> AgentCommender의 '주의' 타일은 **입력대기 + 에러**를 합친 값이고, `FEATURES.md:249`가
> *"토스트는 '입력대기'에만"* 이라고 정한 정책과 **경계가 다르다.**
> → EQMUX는 **입력대기와 에러를 분리해 세야** G6 정책이 성립한다. `개선 후 승계`로 잡은 이유다.

---

## 8. F. CLI / IPC — 11개

| 기능 | 코드 실측 | 코드 위치 | 인수인계 | Feature_Map | Tech | 체크리스트 | EQMUX 판정 |
|---|---|---|---|---|---|---|---|
| F1 명명 파이프 | **있음** — `\\.\pipe\acmux` (win) / `$TMPDIR/acmux.sock` | `main/control-server.ts:6-9` · `cli/acmux.ts:8-11` | ✅ | ✅ | ✅ | ✅ | 승계 |
| F2 Socket API 프로토콜 | **다름** — **JSON 한 줄 요청 → JSON 한 줄 응답 → 연결 종료.** JSON-**RPC**가 아니다(`id`·`jsonrpc`·`method` 없음). 대신 **프로토콜이 하나뿐**이라 wmux의 V1/V2 부채는 없다 | `main/control-server.ts:25-52` · `cli/acmux.ts:13-41` | ✅ | ✅ | ✅ | ✅ | 🔻 축소 → **개선 후 승계** |
| F3 `workspace.create` / `.list` | **다름** — `new`(생성)만 있고 **워크스페이스 목록 CLI가 없다.** `acmux list`는 **세션** 목록이다 | `cli/acmux.ts:97-101` (`new`) · `:85-96` (`list` = 세션) · `main/index.ts:673-676` | ✅ | ✅ | ✅ | ✅ | **개선 후 승계** |
| F4 `surface.send_text` / `.read_text` | **다름** — 쓰기만 있고 **읽기가 없다** | `cli/acmux.ts:112-137` · **read 없음**(검색어: `read_text`, `read-screen`, `readText`) | ✅(읽기 미구현 명시) | ✅ | ✅ | — | **개선 후 승계** |
| F5 `agent.spawn/.spawn_batch/.list/.kill` | **없음** — 에이전트를 1급 객체로 다루는 API가 없다 | 없음(검색어: `agent.spawn`, `spawn_batch`, `agent.list` — CLI 명령 표 `cli/acmux.ts:43-55`에 없음) | — | — | — | — | **신규** |
| F6 `system.tree` | **없음** | 없음(검색어: `tree`, `system.tree` — `MissionsPanel`의 폴더 트리는 UI이지 CLI가 아니다) | — | — | — | — | **신규** |
| F7 `browser.*` | **다름** — `acmux browser <url>` **하나뿐.** snapshot/click/type/fill/eval 없음. `screenshot`은 **앱 창 캡처**(브라우저 패널은 `*.browser.png`로 곁들임) | `cli/acmux.ts:145-151` · `main/index.ts:705-708` · `:721-737` · IPC `:654-659` | ✅ | ✅ | ✅ | ✅ | 🔄 대체 → **개선 후 승계** |
| F8 CLI 명령군 | **다름** — 9개(`list new add split send kill browser dashboard screenshot`). **`ping`·`notify`·`new-window`·`send-key`·`read-screen` 없음**. 반대로 wmux에 없는 `add`·`dashboard`가 있다 | `cli/acmux.ts:43-55` (USAGE) · `:84-168` | ✅ | ❌ `:321-334` **`send --team` 누락** | ✅ `:410-423` | ✅ | **개선 후 승계** |
| F9 SSH 워크스페이스 | **없음** | 없음(검색어: `ssh`, `remote` — 0건) | — | — | ✅(범위 밖 `:657`) | — | **버림** (FEATURES ⏸ 보류) |
| F10 원격 관리 | **없음** | 없음(검색어: `--remote`, `token`, `auth` — 0건) | — | — | ✅(범위 밖 `:657`) | — | **버림** (FEATURES ⏸ 보류) |
| F11 `bridge` / `token` | **없음** | 없음(검색어: `bridge`, `token` — 0건) | — | — | — | — | **버림** (FEATURES ⏸ 보류) |

> **F2 판정 근거.** `FEATURES.md:229-231`이 *"wmux는 텍스트 프로토콜과 JSON-RPC를 둘 다 유지한다 → 우리는 하나만"* 이라고 정했는데,
> **AgentCommender는 이미 하나만 쓴다.** 다만 그 하나가 JSON-RPC가 아니라 **자체 규격**이다
> (`{cmd, ...}` → `{ok, ...}`). → **"프로토콜을 하나로"는 승계, "JSON-RPC로"는 신규 결정**이다. 둘을 섞어 읽으면 안 된다.

---

## 9. G. 알림 — 10개

> ### ⚠️ **알림 계통이 통째로 없다.**
> OSC 수신 경로 자체가 없다 — `shared/ansi.ts:6`의 정규식이 **OSC를 제거**한다:
> `\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?`
> 즉 앱이 OSC를 **읽는 게 아니라 지운다.** 알림은 전적으로 **출력 텍스트 패턴 추측**에 의존한다.

| 기능 | 코드 실측 | 코드 위치 | 인수인계 | Feature_Map | Tech | 체크리스트 | EQMUX 판정 |
|---|---|---|---|---|---|---|---|
| G1 OSC 9 / 99 / 777 수신 | **없음** — OSC를 파싱하지 않고 제거한다 | 없음(검색어: `OSC`, `\x1b]`, `\u001b]`, `osc` — 유일한 매치가 `shared/ansi.ts:6`의 **제거** 정규식) | — | — | — | — | **신규** |
| G2 `notify "text"` CLI | **없음** | 없음(검색어: `notify`, `Notification`, `notification` — `src/` 전체 0건) | — | — | — | — | **신규** |
| G3 유휴 감지 | **다름** — 출력 타이밍 기반 `waiting`(60초 초과 무출력). 알림이 아니라 **상태 표시**로만 쓰인다 | `renderer/status.ts:31-34` | ❌ `:31` 3단계 표기 | ❌ `:125` 3단계 | ✅ `:268` | ❌ `:49` 3단계 | **개선 후 승계** |
| G4 패널 테두리 강조 | **다름** — `.pane.active` **활성 표시**만 있고, 알림용 강조가 아니다 | `renderer/TerminalPane.tsx:297` (`pane${isActive ? ' active' : ''}`) · 상태 점 `:325` | — | — | — | — | **개선 후 승계** |
| G5 탭 하이라이트 / 사이드바 배지 | **없음** — 탭바는 **활성 탭만** 표시. 알림 배지 없음 | 없음(검색어: `badge`, `unread`, `highlight` — `TabBar.tsx:80` `tab${i===current?' active':''}`가 전부) | — | — | — | — | **신규** |
| G6 Windows 토스트 | **없음** | 없음(검색어: `Notification`, `toast`, `showNotification` — 0건) | — | — | — | — | **신규** |
| G7 작업 표시줄 깜빡임 | **없음** | 없음(검색어: `flashFrame`, `setOverlayIcon`, `taskbar` — 0건) | — | — | — | — | **신규** |
| G8 알림 센터 | **없음** — 유사물은 **서버 작업 로그 패널**(메모리 링 500건, 앱 끄면 소멸). 알림 센터가 아니다 | 없음(알림 센터 없음) · 로그 패널 `main/logger.ts` · `renderer/LogsPanel.tsx` · `main/index.ts:449-450` | — | ❌ 로그 패널 자체가 **문서에 없다**(§4 사이드 패널 4종) | ✅ `:390-398` FS-13 | ❌ `:95` 사이드 패널 **4종** | **신규** |
| G9 `Ctrl+Alt+N` / `Ctrl+Shift+U` | **없음** | 없음(검색어: `Ctrl+Alt`, `altKey` — `shortcuts.ts:18`이 `!e.altKey`로 **Alt 조합을 아예 배제**한다) | — | — | — | — | **신규** |
| G10 선택적 소리 | **없음** | 없음(검색어: `Audio`, `sound`, `bell`, `\x07` — 0건) | — | — | — | — | **신규** |

---

## 10. H. 설정 · 테마 — 9개

| 기능 | 코드 실측 | 코드 위치 | 인수인계 | Feature_Map | Tech | 체크리스트 | EQMUX 판정 |
|---|---|---|---|---|---|---|---|
| H1 `config.toml` 설정 파일 | **다름** — **사람이 읽고 쓰는 설정 파일이 없다.** `~/AgentCommender/state.json`의 `settings` 객체가 그 자리(폰트·셸·패널 위치·워크스페이스 루트·인격 라이브러리) | `main/state.ts:38-51` · `:53-55` `statePath()` · 쓰기 `renderer/App.tsx:488-494` | ✅ | ✅ | ✅ | ✅ | **개선 후 승계** |
| H2 번들 테마 | **다름** — **1개, 하드코딩.** design.pen 팔레트 16색 상수 | `renderer/TerminalPane.tsx:16-38` `THEME` | — | ✅ | ✅ | — | 🔻 2개 → **개선 후 승계** |
| H3 테마 직접 정의 | **없음** — 사용자가 색을 바꿀 경로가 없다 | 없음(검색어: `theme` — `src/` 전체에서 `TerminalPane.tsx:132`의 상수 참조 1건뿐) | — | — | — | — | **신규** |
| H4 Ghostty config 임포트 | **없음** | 없음(검색어: `ghostty`, `import.*config` — 0건) | — | — | — | — | **버림** |
| H5 Windows Terminal 임포트 | **없음** | 없음(검색어: `windowsterminal`, `settings.json` 임포트 — 0건) | — | — | — | — | **버림** |
| H6 패널별 테마 오버라이드 | **없음** — `THEME`이 모든 페인에 동일 적용 | 없음(`TerminalPane.tsx:132` `theme: THEME` 고정) | — | — | — | — | **버림** |
| H7 설정 UI (`Ctrl+,`) | **없음** — 설정 화면이 없다. 항목이 UI에 **흩어져 있다**(관제 헤더 셸 select · 워크스페이스 버튼 · 폰트 단축키 · 패널 좌우 토글) | 없음(검색어: `Ctrl+,`, `settings`, `Preferences`, `SettingsPanel` — 설정 화면 컴포넌트 없음) · 흩어진 위치: `Dashboard.tsx:412`(셸) · `main/index.ts:262-286`(워크스페이스) · `renderer/PanelSideToggle.tsx` | — | ✅ | ✅ | — | 🔻 축소 → **신규** |
| H8 첫 실행 7단계 튜토리얼 | **없음** — 첫 실행은 **워크스페이스 위치 묻는 다이얼로그 1개**가 전부 | 없음(튜토리얼 없음) · 첫 실행 `main/index.ts:743-772` | ✅ | — | ✅ `:195` | — | **버림** |
| H9 업데이트 배지 | **없음** — 자동 업데이트 자체 없음 | 없음(검색어: `autoUpdater`, `update`, `version check` — 0건) | — | — | — | — | **버림** |

---

## 11. I. 브라우저 — 5개

| 기능 | 코드 실측 | 코드 위치 | 인수인계 | Feature_Map | Tech | 체크리스트 | EQMUX 판정 |
|---|---|---|---|---|---|---|---|
| I1 내장 Chromium 패널 | **있음** — Electron `WebContentsView` (iframe 아님 → `X-Frame-Options` 무관). 사이드 슬롯에 좌표 동기화 | `main/browser-panel.ts:20-123` · `renderer/BrowserPanel.tsx` · IPC `main/index.ts:654-659` | ✅ | ✅ | ✅ | ✅ | **버림** — EQMUX는 외부 Chrome |
| I2 `Ctrl+Shift+I` 패널 토글 / DevTools | **다름** — 패널 토글은 **`Ctrl+Shift+B`**. DevTools는 **F12**이고 대상이 **앱 창**이다(패널 콘솔 아님) | `renderer/shortcuts.ts:30-31` · `main/index.ts:97-101` | ✅ | ✅ | ✅ | — | **버림** |
| I3 CDP 프록시 `localhost:9222` | **없음** | 없음(검색어: `9222`, `CDP`, `debugger`, `remote-debugging` — 0건) | — | — | — | — | **신규** (외부 Chrome 대상) |
| I4 `browser open/snapshot/click/…` | **다름** — `open`에 해당하는 것만(`acmux browser <url>`). 앱 내부 IPC로 back/forward/reload는 있으나 **CLI에 없다** | `cli/acmux.ts:145-151` · `main/browser-panel.ts:86-109` · `preload/index.ts:228-235` | ✅ | ✅ | ✅ | ✅ | **개선 후 승계** |
| I5 터미널 링크 클릭 → 브라우저 | **다름** — `Ctrl`+클릭 → **내장 패널**로 연다 | `renderer/TerminalPane.tsx:142-146` · `renderer/App.tsx:595-598` | ✅ | ✅ | ✅ | — | **개선 후 승계** — 대상만 외부 Chrome |

---

## 12. 문서별 어긋남 전체 목록

> 이 절이 **"3·4차에서 어떤 문서를 설계서로 승계할지"** 의 근거다 ([issue](issue.md) #5 요구사항).

### 12.1 `Tech.md` — 5건 (가장 정확하지만, 틀린 곳이 하필 issue #1·#2·#3다)

| # | 위치 | 문서 주장 | 코드 실측 |
|---|---|---|---|
| T1 | `:76-99` 모듈 지도 | `main/mission.ts`·`main/team.ts`·`renderer/mission.ts`·`renderer/team.ts`·`renderer/status.ts`·`renderer/shortcuts.ts`·`TeamDialog.tsx`·`TeamRosterDialog.tsx` **부재**. 행수도 낡음(`index.ts` 675 / `App.tsx` 860 / `Dashboard.tsx` 2506 / `TerminalPane.tsx` 324) | 전부 존재. 실제 행수 **844 / 991 / 2767 / 385** (`src/` 실측, `styles.css` 3,699줄 제외 시 총 11,802줄) |
| T2 | `:293` | 배정 캐시 키 = `assignments[세션명]` | `<팀>/<세션>` — `renderer/mission.ts:15-17` |
| T3 | `:293` | 배정 시 **무조건 `cd "<경로>"` 전송** | 셸/에이전트 **분기** — `renderer/mission.ts:27-32` |
| T4 | `:294` | 담당 프로젝트 = **잠금**(일괄 해제 + 이후 차단) | 잠금 아님 — `renderer/App.tsx:613` · `main/state.ts:48` 주석 |
| T5 | `:450-472` IPC 계약 | `mission:get/assign/clear` · `team:roster` · `team:save-roster` · `pty:set-agent` · `pty:send-each` · `session:log-save` · `applog:save` · `app:quit` · `window:focus-main` **누락** | 전부 존재 — `main/index.ts:138,178,193,219,406,408,609,613,634,649,652` |

> **T2·T3·T4가 한 표(FS-7) 안에 몰려 있다.** `Tech.md`의 나머지(FS-3·FS-5·FS-15·부록)는 거의 완벽하다.
> **FS-7 절만 갱신이 안 됐다.** 문서 전체를 버릴 이유는 없고, **FS-7만 신뢰하지 않으면 된다.**

### 12.2 `Tech_check_List.md` — 7건 (구현된 것을 미구현으로 적은 게 3건)

| # | 위치 | 문서 주장 | 코드 실측 | 영향 |
|---|---|---|---|---|
| C1 | `:145` | `[ ]` 터미널 내 검색 UI **미구현** `P1` | **구현됨** — `TerminalPane.tsx:352-381` | ⚠️ **`S3-2` 규모 산정 오염** ([issue](issue.md) #4) |
| C2 | `:125` | `[ ]` 팀 브로드캐스트 `acmux send --team` **미구현** `P2` | **구현됨** — `cli/acmux.ts:113-125` · `main/index.ts:163-175` | 이식 대상 누락 |
| C3 | `:121` | `[ ]` 세션 로그 뷰어 **미구현** `P1` | **구현됨** — `main/index.ts:193-215,243-251` · `preload/index.ts:80-89` | 이식 대상 누락 |
| C4 | `:48` | 통계 타일 **5종** | **6종** — `Dashboard.tsx:50-77` | |
| C5 | `:49` | 세션 상태 **3단계** | **4단계** — `status.ts:4` | |
| C6 | `:95` | 사이드 패널 **4종** | **5종**(로그 패널 추가) — `App.tsx:61` · `TabBar.tsx:23-39` | |
| C7 | `:10-11` | 배치 = "그리드 자동 배치"만 | **프리셋 6종 + `Ctrl+Shift+L` 팔레트** — `model.ts:164-232` · `LayoutPicker.tsx` | |

> ⚠️ **이 문서를 로드맵으로 쓰면 이미 있는 걸 다시 만든다.** `S0-2`가 막으려던 낭비가 정확히 여기 있다.

### 12.3 `Feature_Map.md` — 8건

| # | 위치 | 문서 주장 | 코드 실측 |
|---|---|---|---|
| M1 | `:3` | 기준 커밋 `c0d23a0` | `80fb110`(페르소나·로그 패널·브로드캐스트·배치 팔레트) **이후** 내용을 일부 담고 있다 — 커밋 표기가 틀렸다 |
| M2 | `:124` | 통계 타일 5종 | **6종** |
| M3 | `:125` | 상태 3단계 | **4단계** |
| M4 | `:58-62` · `:234` | 사이드 패널 **4종** | **5종** (로그 패널 부재) |
| M5 | `:81` | 배치 = 그리드 자동 배치만 | **프리셋 6종** — `model.ts:164-173` |
| M6 | `:376-393` 단축키 표 | `Ctrl+Shift+L` **누락** | 존재 — `shortcuts.ts:36-37` |
| M7 | `:321-334` CLI 표 | `send --team` **누락** | 존재 — `cli/acmux.ts:113-125` |
| M8 | `:148-157` 상세 패널 | `session.log` 뷰어 **누락** | 존재 — `preload/index.ts:80-89` |

### 12.4 `인수인계.md` — 8건 (가장 오래됨. 2026-07-31)

| # | 위치 | 문서 주장 | 코드 실측 |
|---|---|---|---|
| H1 | `:15` | 그리드 **행 우선, 최대 2×4** | **열 우선**(`grid-col`), 세로 4개 채우고 새 열 — `model.ts:167,223-232` |
| H2 | `:29` | 스탯 타일 **5종** | **6종** |
| H3 | `:31` | 상태 **3단계** | **4단계** |
| H4 | `:38` | 임무 배정 = "배정 + 해당 폴더로 **cd 전송**" | 셸/에이전트 **분기** — `renderer/mission.ts:27-32` |
| H5 | `:52-56` | 사이드 패널 **3종**(브라우저/포트/임무) | **5종**(git·로그 추가) |
| H6 | `:60` | `state.json` = 팀/레이아웃/세션이름/임무배정/폰트/셸 | + `teamProjects`·`panelSide`·`workspaceRoot`·`personaLibraryRoot`·`userTitle` — `main/state.ts:38-51` |
| H7 | `:73-77` 단축키 | `Ctrl+Shift+L` **누락** | 존재 |
| H8 | `:95` | **"대기 감지·알림 — 미구현"** | **구현됨** — `activity.ts:88-93` · `status.ts:29-30` (이것이 `FEATURES.md` E10 오표기의 원인) |

> `인수인계.md`가 **맞은** 것도 있다 — `:92` *"`acmux read/tail` 세션 출력 읽기 미구현(최우선)"* 은 지금도 맞다(E4/F4).
> `:96` *"스탯 '에이전트 수' 미구현"* 도 맞다. **전부 틀린 문서가 아니라, 그 뒤 3일치 변경이 안 들어간 문서다.**

---

## 13. EQMUX에 넘길 것 — 우선순위 있는 결론

### 13.1 그대로 이식 가치가 높은 코드 (참조 대상)

| 대상 | 코드 | 왜 |
|---|---|---|
| **분할 트리 → 절대좌표 평면 렌더링** | `renderer/model.ts:234-303` | **분할해도 터미널이 리마운트되지 않는다**(=세션이 안 죽는다). 주석 `:235-236`이 이유를 적어 놓았다. `S2-2`에서 같은 함정을 다시 밟을 이유가 없다 |
| **검색 바** | `renderer/TerminalPane.tsx:352-381` (34줄) | `S3-2` 참조 구현 |
| **PTY 출력 유실 방지** | `main/pty-manager.ts:130` + `renderer/TerminalPane.tsx:233` | `pause()` → 리스너 부착 → `resume()`. 셸 초기 배너가 잘리지 않는 이유 |
| **붙여넣기 우선순위 판별** | `main/index.ts:308-332` | 파일 → 이미지(PNG 저장) → 텍스트. `FEATURES.md:79-80`이 "영리하다"고 짚은 A13의 실체 |
| **상태 원자적 저장** | `main/state.ts:68-84` | tmp → rename + 메인 전용 설정 병합 보존 |
| **포트 세션 귀속 판정** | `main/ports.ts:71-79` | 부모 pid 추적 64단계 상한. issue #3의 "프로세스 실측"과 **같은 기법**이다 — 재사용 가능 |

### 13.2 승계하되 **이름을 고쳐야** 하는 것

`renderer/status.ts:17-22` — 한글 라벨과 영문 태그가 어긋난다:

| 내부값 | 한글 (`:9-14`) | 영문 (`:17-22`) | 문제 |
|---|---|---|---|
| `attention` | 입력 대기 | **`WAITING`** | 영문만 보면 '대기'로 읽힌다 |
| `waiting` | 대기 | **`IDLE`** | |

**EQMUX에서는 `attention → NEEDS INPUT`, `waiting → IDLE`로 맞춘다** ([issue](issue.md) #5 단서 반영).

### 13.3 `S2` 착수 전 결정이 필요한 것 — **단축키 체계**

`개선 후 승계` 36개 중 **9개가 B절 단축키**다. 지금 정하지 않으면 `S2`에서 두 번 짠다.

| | AgentCommender | wmux (`FEATURES.md`) |
|---|---|---|
| 분할 | `Ctrl+Shift+D` / `Ctrl+Shift+E` | `Ctrl+D` / `Ctrl+Shift+D` |
| 줌 | `Ctrl+Shift+Z` | `Ctrl+Shift+Enter` |
| 새 탭 | `Ctrl+Shift+T` (= 팀 추가) | `Ctrl+T` |
| 탭 전환 | `Ctrl+Tab`만 | `Ctrl+Shift+[`/`]`, `Alt+1~8` |
| 복사/붙여넣기 | `Ctrl+C` / `Ctrl+V` | `Ctrl+Shift+C` / `Ctrl+Shift+V` |

> **의견(해원)**: **AgentCommender 쪽을 지키는 게 맞다고 봅니다.**
> ① 우리 팀이 지금 그 키로 일하고 있고, ② `Ctrl+C`/`Ctrl+V`는 Windows Terminal 관행이라
> 사용자가 재학습할 필요가 없으며, ③ `B19`(바인딩 파일)를 넣으면 취향 문제는 그쪽에서 해결됩니다.
> **다만 이건 제 의견이고 결정은 이안·팀장님 몫입니다.** 안건으로 올릴지도 지시를 기다립니다.

### 13.3b ⭐ 어느 표에도 없는데 **빠지면 퇴행**인 것 — 드래그앤드롭 (해원 검증 추가)

`FEATURES.md`는 **wmux 기준**이라 wmux에 없는 기능은 101개 안에 아예 없다.
그래서 이 문서의 9개 절에도 안 걸린다. **없어져도 아무 표가 경고하지 않는다.**

| 기능 | 코드 | 왜 중요한가 |
|---|---|---|
| **파일·폴더 드래그앤드롭 → 따옴표 감싼 경로 입력** | `renderer/TerminalPane.tsx:282-293` `onDrop` → `preload/index.ts:207` `webUtils.getPathForFile` → `term.paste()` | **A13(클립보드 이미지 → 경로 주입)과 한 쌍이다.** 에이전트에게 파일을 건네는 **두 번째 경로**이고, 여러 개를 한 번에 넘길 수 있는 **유일한** 경로다 |

`FEATURES.md:79-80`이 A13을 *"의외로 영리하다 · 반드시 가져온다"* 고 짚었는데,
**같은 목적의 나머지 절반이 목록에 없다.** 드롭 방지 처리까지 짝으로 들어가 있다
(`App.tsx:429-437` — Electron이 파일로 이동해 버리는 기본 동작 차단).

> **제안**: `FEATURES.md`에 **`A17` ⭐ 신규**로 추가한다. 101 → 102가 된다.
> 이 문서의 집계는 `FEATURES.md` 101개 기준이므로 **여기 숫자는 건드리지 않았다.**

### 13.4 `S2` 착수 전 알아야 할 것 — **참조할 코드가 없다**

`S2`(멀티플렉싱) 19개 항목 중 AgentCommender에 **그대로 있는 건 2개**(B3·B4)다.
**B7(패널당 탭)·B5(방향 포커스)·B15(사이드바)·B16(명령 팔레트)는 참조 대상이 아예 없다.**
→ **`WORKPLAN.md`의 `S2` 규모를 "AgentCommender에서 가져온다" 전제로 잡았다면 재검토가 필요하다.**
가져올 수 있는 것은 `model.ts` 하나뿐이다.

---

## 14. 검증 절차 (재현용)

| # | 무엇을 | 어떻게 |
|---|---|---|
| 1 | 소스 범위 확정 | `wc -l $(find ops/src -type f)` → 45파일 15,501줄 (`styles.css` 3,699 제외 시 **11,802줄**) |
| 2 | 기능별 존재 확인 | `grep -rn "<검색어>" ops/src/` — 0건이면 `없음(검색어: …)`로 기록 |
| 3 | 존재하는 기능 | 해당 파일을 **전문 열람**해 줄 번호 확정 (추정 금지) |
| 4 | 문서 대조 | 4개 문서를 열람해 같은 기능을 기술한 줄을 찾고 코드와 비교 |
| 5 | 무수정 보장 | AgentCommender 폴더에 **읽기 도구만** 사용. `Write`/`Edit`/파일 생성 0회 |

**소스 규모 참고** — `Tech.md:4` "~4,900행" / `OBJECTIVES.md:19` "11,802줄" / `BASELINE.md` §4 "11,095줄".
이번 실측(`styles.css` 제외 45파일) = **11,802줄**로 `OBJECTIVES.md` 값과 일치한다.
`BASELINE.md`의 11,095는 `.d.ts`·`index.tsx` 등 일부 제외 기준으로 보인다 — **세는 범위가 달랐을 뿐 모순은 아니다.**

---

## 15. 남은 일

| 담당 | 할 일 |
|---|---|
| **이안** | ① [issue](issue.md) #4 **닫기** — 구현 확인 완료, `S3-2` = 이식(규모 S 유지) ② #1·#2·#3을 **"설계 선택"에서 "문서 오류 확인 완료"로 강등** — 코드가 이미 답을 갖고 있다 ③ §13.3 단축키 체계 결정 ④ §13.4 반영해 `S2` 규모 재검토 |
| **해원** | 이안 판단 후 `issue.md` #1·#2·#3·#4 상태 갱신 |
| **세아** | §13.1의 6개 참조 코드를 `S2` 착수 시 열람 — 특히 `model.ts:234-303`(리마운트 방지)은 **먼저 읽고 시작하는 게 싸다** |
