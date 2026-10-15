# 플러그인 탭 기획서 — "확장" 그룹에서 엔진 플러그인 관리하기

최종 반영: [update-plan-0.5.0.md](../update-plan-0.5.0.md) §결정 22 · §개선 — 오른쪽 위 메뉴 정리 · §0.5.x로 넘기는 것 — 탭 위치·이름·출시 시점을 최종본에 맞춰 고쳤다.

2026-10-15 · 초안

## 개요

사이드 패널 "확장" 그룹에 **플러그인** 세그먼트를 둔다(`[MCP | 플러그인 | 스킬]`, 0.5.x). 이 화면에서 Claude Code와 Codex의 플러그인을 보고, 켜고 끄고, 설치·업데이트·제거한다. 지금은 플러그인을 바꾸려면 터미널에서 `claude plugin …`이나 `/plugin`을 직접 쳐야 하고, 어느 세션에 무엇이 붙어 있는지 앱 안에서 볼 수 없다.

- **대상**: 엔진(Claude Code · Codex)의 플러그인이다. EQMUX 자체의 확장 시스템은 이 문서의 범위가 아니다. 그것은 0.5 기획서 §0.6 이후의 "MCP 서버 · 플러그인" 항목으로 남는다(`docs/update-plan-0.5.0.md`).
- **방식**: 엔진 CLI를 그대로 부른다(`claude plugin … --json`, `codex plugin … --json`). EQMUX는 플러그인 파일을 직접 읽거나 쓰지 않는다. 저장 형식은 엔진이 바꿀 수 있고, CLI가 그 변화를 흡수한다.
- **원칙 유지**: 자동 실행이 없다는 원칙을 지킨다. 설치·제거·마켓플레이스 추가는 사람이 누를 때만 일어난다. 마켓플레이스가 선언한 명령은 사람에게 보여 주고 동의를 받은 뒤에만 실행한다(`-y`를 자동으로 붙이지 않는다).

## 화면 자리

0.5에서 사이드 패널 탭은 그룹 4개(대화 · 코드 · 실행 · 브라우저)로 묶인다. 0.5.x에서 `대화` 다음에 "확장" 그룹이 들어오고, 이 화면은 그 두 번째 세그먼트다(최종본 §결정 22). `src/components/SidePanel.tsx`의 "확장" 그룹에 하위 키 `plugins`를 넣는다.

```
[대화] [확장] [코드] [실행] [브라우저]  ◧ ✕
        └ [MCP | 플러그인 | 스킬]
```

- `src/state.ts`의 `PanelTab` 유니온에 `"plugins"`를 더한다.
- 새 컴포넌트는 `src/components/PluginsPanelTab.tsx` 하나다. 다른 패널 탭(`PortsPanelTab`, `GitPanelTab`)과 같은 모양(`panel-head-row` + 목록)을 쓴다.
- 탭 라벨은 `t("플러그인")`. i18n 키는 `src/i18n/shell.ts`에 더한다.

## 탭 구성

탭 상단에 엔진 전환(Claude Code · Codex)을 두고, 그 아래 세 구역을 둔다.

```
┌ 플러그인 ──────────────────── [Claude Code | Codex] ⟳ ┐
│ 설치됨 (5)                                             │
│  ● ponytail@ponytail        4.8.4  user   [켬] ⋯        │
│  ● pm-toolkit@pm-skills     2.1.0  user   [켬] ⋯        │
│  ○ chrome-devtools-mcp@…    —      user   [끔] ⋯        │
│ 마켓플레이스 (4)                                [+ 추가] │
│  pm-skills   github:phuryn/pm-skills       [업데이트] ⋯  │
│ 둘러보기                                     [검색 ___]  │
│  some-plugin@pm-skills  설명 한 줄             [설치]    │
│ ─────────────────────────────────────────────────────  │
│ ⚠ 바뀐 내용은 새로 띄우는 세션부터 적용됩니다            │
└────────────────────────────────────────────────────────┘
```

### 설치됨

| 열 | 출처 |
|---|---|
| 이름 · 버전 · 범위(user / project / local) · 켬 여부 | `claude plugin list --json` |
| 이 워크스페이스에서 켬 여부 | 같은 출력의 `projectEnabled` |
| 구성 요소(스킬·에이전트·훅·MCP 서버 수), 상시 토큰 비용 | `⋯` → 상세를 열 때 `claude plugin details <id>` |

`⋯` 메뉴: 상세 · 켜기/끄기 · 업데이트 · 제거 · 설치 폴더 열기.

상시 토큰 비용을 보여 주는 이유: 팀 세션 여러 개가 같은 플러그인을 모두 싣는다. 세션 수 × 상시 비용이 실제 부담이다(`docs/archive/token-optimization-candidates-2026-10-15.md`와 연결된다). 상세 화면에 "이 워크스페이스 세션 N개 × ~985 tok" 한 줄을 더한다.

### 마켓플레이스

- 목록: `claude plugin marketplace list --json`
- 추가: 입력칸 하나(URL · 경로 · `owner/repo`) → `claude plugin marketplace add <source>`
- 업데이트: `claude plugin marketplace update [name]`
- 제거: `claude plugin marketplace remove <name>` — 확인창을 띄운다

### 둘러보기

- `claude plugin list --available --json`의 `available` 목록을 보여 준다. 검색은 클라이언트 쪽 문자열 필터로 충분하다.
- 설치 버튼은 범위를 고르게 한다. 기본값은 **project**(이 워크스페이스)다. 팀 하나에만 필요한 플러그인이 다른 프로젝트 세션에 새지 않게 하기 위해서다.

## 설치 흐름

1. 사람이 [설치]를 누르고 범위를 고른다.
2. EQMUX가 `claude plugin install <id> --scope <s> --json`을 **`-y` 없이** 부른다.
3. 마켓플레이스가 선언한 명령이 있으면 CLI가 실행하지 않고 `shownCommand`(명령 원문 + sha256)를 돌려준다.
4. 탭이 그 명령 원문을 확인창에 그대로 보여 준다. "이 명령이 당신 권한으로 실행됩니다" 한 줄을 붙인다.
5. 사람이 동의하면 `--accept-command <sha256>`으로 다시 부른다. 그 사이 카탈로그가 바뀌었으면 CLI가 거부하고 3으로 돌아간다.
6. 끝나면 목록을 다시 읽고, 하단에 "새로 띄우는 세션부터 적용" 배너를 띄운다.

`userConfig`가 있는 플러그인은 설치 뒤 `claude plugin configure <id>`의 미설정 항목을 폼으로 보여 주고, 저장은 `--values-stdin`으로 넘긴다. 비밀값 입력칸은 `type="password"`로 두고 로그에 남기지 않는다.

## 이미 떠 있는 세션

플러그인 변경은 이미 떠 있는 Claude Code 세션에 바로 붙지 않는다(`update` 도움말도 "restart required"라고 적는다). 탭은 이것을 숨기지 않는다.

- 변경 뒤 배너: "적용하려면 세션을 다시 띄우세요 — 이 워크스페이스 세션 N개".
- 세션을 자동으로 재시작하지 않는다. 자동 실행이 없다는 원칙 때문이다. 배너의 세션 이름을 누르면 그 페인으로 간다(`focusSession`).

## Codex

`codex plugin`도 `add · list · marketplace · remove`와 `--json`을 가진다. 같은 탭에서 엔진 전환으로 보여 준다.

| 동작 | Claude Code | Codex |
|---|---|---|
| 설치됨 · 둘러보기 | `plugin list --json [--available]` | `plugin list --json [--available]` |
| 설치 | `plugin install <id> --scope <s>` | `plugin add <id> [-m <marketplace>]` |
| 제거 | `plugin uninstall <id>` | `plugin remove <id>` |
| 켜기/끄기 | `plugin enable/disable <id>` | 없음 — 버튼을 숨긴다 |
| 범위 | user · project · local | 없음 — 범위 열을 숨긴다 |
| 상세 · 토큰 비용 | `plugin details <id>` | 없음 |
| 마켓플레이스 | `plugin marketplace add/list/update/remove` | `plugin marketplace` 하위 명령 |

Codex의 `--json` 출력 모양은 구현 첫날 실측해서 이 표 아래에 적는다. 없는 기능은 버튼을 숨긴다. 회색 버튼을 두지 않는다.

엔진이 설치돼 있지 않으면(`agentscan.rs`가 이미 찾는다) 그 엔진 전환을 숨긴다.

## 구현

### Rust (`src-tauri/src/lib.rs` 또는 새 `plugins.rs`)

커맨드 하나로 충분하다.

```rust
#[tauri::command]
async fn engine_plugin(cli: String, args: Vec<String>, cwd: Option<String>, stdin: Option<String>)
    -> Result<String, String>
```

- `cli`는 `normalize_cli`로 `claude` / `codex`만 받는다.
- `args[0]`은 허용 목록(`list · details · install · uninstall · enable · disable · update · configure · marketplace` / Codex는 `list · add · remove · marketplace`)만 받는다. 그 밖은 거부한다. 임의 명령 실행 통로가 되지 않게 하기 위해서다.
- `-y` · `--yes` 인자는 거부한다. 동의는 `--accept-command <sha256>`로만 들어온다.
- `spawn_blocking` 안에서 돈다. 메인 스레드 동기 커맨드가 앱을 굳히는 문제(`docs/archive/optimization-candidates-2026-10-14.md`)를 다시 만들지 않는다.
- Windows에서 `creation_flags(0x0800_0000)`(CREATE_NO_WINDOW)를 준다 — `agentscan.rs:161`과 같다.
- `cwd`는 워크스페이스 경로다. project 범위와 `projectEnabled`가 이것으로 정해진다.
- 시간 상한 60초. 넘으면 프로세스를 죽이고 오류를 돌려준다.
- stdout을 문자열로 그대로 돌려준다. JSON 해석은 TS 쪽이 한다.

### TS (`src/backend/plugins.ts`)

- `listPlugins(engine, wsPath, available)` · `pluginDetails` · `installPlugin` · `setPluginEnabled` · `uninstallPlugin` · `updatePlugin` · `marketplaces` · `addMarketplace` 등 얇은 래퍼. 모두 `invoke("engine_plugin", …)` 한 줄이다.
- 브라우저 dev(`!isTauri()`)에서는 `mock.ts`의 고정 목록을 돌려준다. 다른 패널과 같은 폴백이다.
- 상태는 탭 컴포넌트 안의 신호로 둔다. 전역 상태에 넣지 않는다 — 다른 화면이 쓰지 않는다.

### 하지 않는 것

| 하지 않음 | 이유 |
|---|---|
| `~/.claude/plugins/*.json`, `settings.json`의 `enabledPlugins` 직접 읽기·쓰기 | 엔진의 내부 형식이다. CLI가 같은 일을 하고 형식 변화를 흡수한다 |
| 세션별 플러그인 다르게 싣기(`--plugin-dir` 주입) | 지금 요구가 없다. 역할별 플러그인 묶음이 필요해지면 그때 `roles.rs`와 함께 설계한다 |
| 플러그인 자동 업데이트·주기적 확인 | 자동 실행 없음 원칙. [⟳]와 업데이트 버튼이 있다 |
| 플러그인 제작(`init`·`validate`·`eval`·`tag`) | 관리 탭이지 개발 도구가 아니다. 터미널에서 하면 된다 |

## 확인 · 테스트

- `src/backend/plugins.test.ts` 하나: 허용 목록 밖 하위 명령, `-y` 인자가 Rust로 넘어가기 전에 막히는지, `list --json` 샘플(위 실측 출력)을 화면 행으로 바꾸는 함수.
- Rust 쪽은 허용 목록 판정 함수 하나에 `#[test]`를 붙인다(`agent.rs`의 `normalize_cli` 테스트 옆).
- 수동 확인: 마켓플레이스 선언 명령이 있는 플러그인을 설치해 확인창이 뜨는지, 동의 없이 설치가 진행되지 않는지.

## 작업 순서

| 단계 | 내용 | 크기 |
|---|---|---|
| 1 | `engine_plugin` 커맨드 + 허용 목록 + 테스트 | 작음 |
| 2 | 탭 자리 · 설치됨 목록 · 켜기/끄기 · 상세 | 작음 |
| 3 | 둘러보기 · 설치 흐름(선언 명령 동의) · 제거 · 업데이트 | 중간 |
| 4 | 마켓플레이스 구역 · `configure` 폼 | 작음 |
| 5 | Codex 전환 | 작음 — 출력 실측 뒤 |

1~3이 쓸 만한 최소 단위다. 최종본은 1~3단계를 0.5.x에 넣었다(§0.5.x로 넘기는 것). 4·5단계의 시점은 정하지 않았다.

## 열린 질문

1. 기본 설치 범위를 project로 둘지 user로 둘지. 이 문서는 project를 제안한다.
2. ~~탭 이름을 "플러그인"으로 할지, "확장"으로 할지~~ — 정했다(최종본 §결정 22). 그룹 이름은 "확장"이고, 이 화면은 그 안의 `플러그인` 세그먼트다. MCP 서버 관리는 같은 그룹의 `MCP` 세그먼트(`docs/archive/mcp-panel-plan-2026-10-15.md`)가 맡는다.
3. 세션 재시작 배너에서 "모두 다시 띄우기" 버튼을 줄지. 이 문서는 주지 않는다(대화 중인 세션을 사람이 하나씩 고르게 한다).
