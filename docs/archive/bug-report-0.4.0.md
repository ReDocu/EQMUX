# 0.4.0 버그 조사 — "세션 추가 시 터미널 먹통 · 종료 불가"

조사일 2026-09-18 · 대상 `4c6a576` (v0.4.0) · 비교 기준 v0.3.8

## 사용자 증상

- 터미널 10개 이상이거나 오래 켜두면 발생
- **모든 터미널**이 입력·출력을 안 받음 (UI 자체는 반응)
- 그 상태에서 세션을 추가하면 **완전히 빈 검은 화면** — 프롬프트조차 안 뜸
- **앱 종료가 안 됨** → 작업 관리자로 강제 종료해야 함

---

## 1. 실측으로 확정한 사실

### 1-1. 멈춤의 정체는 "웹뷰 단독 사망"이다

`~/.eqmux/logs/diagnostics.log`에서 실제 발생 순간을 특정했다.

| 시각(KST) | 기록 주체 | 내용 |
|---|---|---|
| 09-17 22:51:56 | JS | `heartbeat(sweep) terms=8 webgl=8 webglLost=0 heapMB=16` — 마지막 정상 |
| 09-17 22:53:51 | **Rust** | `window focused` — 백엔드는 살아 있음 |
| 09-17 22:54:11 | Rust | 3개 워크스페이스의 세션이 **동시에** `session-exit` |
| 이후 ~3시간 | — | **JS가 찍는 로그가 하나도 없음** |
| 09-18 01:48 | — | 수동 재시작 |

`window focused`는 Rust가, `heartbeat`는 JS가 찍는다. 후자만 끊겼다는 것은
**Rust 백엔드는 정상인데 웹뷰(프론트엔드)만 죽었다**는 뜻이다.

이것이 세 증상을 한 번에 설명한다:

- 터미널 입출력은 전부 JS를 거친다 → 전 터미널 먹통
- 새 페인의 `initSession`도 JS다 → 빈 검은 화면
- 종료 버튼은 JS가 `app_exit`를 호출한다 → **종료 불가, 강제 종료만 남음**

`heapMB=16`으로 메모리 누수는 아니다. 웹뷰가 **블록되거나 크래시**한 것이다.

### 1-2. `session.db` 기록과 세션 로그의 불일치

같은 사건에서 일부 세션은 로그 파일에 `=== session exit ===` 마커를 남겼고
(`shell1@eqmux-5ec8da`, epoch 1789653250), 일부는 **남기지 못했다**
(`shell1@educraft-v1-cb8510`). 마커는 리더 스레드가 `child.wait()`를 통과한
뒤에 쓴다(`lib.rs:384-388`) — 일부 리더 스레드가 EOF 정리를 끝내지 못한 채
프로세스가 사라졌다는 뜻이다.

---

## 2. 고친 것

### 2-1. 🔴 세션 부팅 실패가 그 페인을 **영구히** 죽인다 — "빈 검은 화면"의 직접 원인

`src/components/TerminalPane.tsx` · `attach()`

```js
if (!e.initialized) {
  e.initialized = true;      // ← 먼저 세운다
  void initSession(e, props); // ← 실패는 아무도 안 받는다
}
```

`initSession`은 `await spawnPty(...)`를 하고 `spawnPty`에는 `.catch`가 없다
(`src/backend/pty.ts:68`). `pty_spawn`이 Err를 내면 프로미스가 reject되고,
`void`로 던져졌으므로 **조용히 사라진다**. 그런데 `e.initialized`는 이미 true다.

결과: 그 세션은 PTY 없는 빈 터미널이 되고, **탭을 옮겨 리마운트해도 다시
시도하지 않는다.** 앱을 재시작하는 것 말고는 복구할 방법이 없다 — 사용자가
말한 "완전히 빈 검은 화면"과 정확히 일치한다.

**수정:** 실패를 잡아 `initialized`를 되돌리고(다음 마운트에서 재시도) 이유를
터미널에 적는다. 조용한 실패가 "터미널이 죽었다"로 보이던 자리다.

### 2-2. 🔴 렌더러 실패가 세션 부팅을 막는다

같은 `attach()`에서 `ensureWebgl()`이 `initSession` **앞에** 있고 보호가 없다.
`dropWebgl` → `webgl.dispose()`가 던지면 `attach()` 전체가 중단되어
`initSession`에 영영 도달하지 못한다 — 역시 빈 페인이다.

WebGL은 안 되면 DOM 렌더러로 돌면 그만인 부가 기능이다. 세션 부팅을 막을
자격이 없다. **수정:** `try`로 감쌌다.

### 2-3. 🟡 마지막 한 줄 요약(M35) 기능이 처음부터 동작하지 않았다

`src-tauri/src/agent.rs:638`

```rust
let data = crate::transcript::read(&transcript_path(cwd, uuid), 0).ok()?;
```

`transcript::read`의 `limit`은 "마지막 N턴만 남김"이다(`transcript.rs:247`).
`0`을 넘기면 `turns.drain(..len)`으로 **턴이 전부 삭제**된다. 다른 두 호출부는
`200`을 넘기는데 여기만 `0`이었다.

→ 0.4.0 내내 `session.last_recap`에 한 줄도 쌓이지 않았다. 페인 헤더의 요약은
한 번도 뜬 적이 없다.

**수정:** `usize::MAX`. `recap_from_transcript`가 경로를 받게 바꿔 읽기 경로에
테스트를 붙였다(옛 코드로 되돌리면 실패하는 것 확인).

부수 효과: 이 기능은 **동작하지 않으면서도 Stop 훅마다 최대 2MB 트랜스크립트를
읽고 JSONL 전체를 파싱**하고 있었다. `apply_hook` 맨 앞, `HookEffect::Ignore`
체크보다 먼저, 명명 파이프 응답을 붙잡은 채로(`agent.rs:675-680`).

---

## 3. 기각한 가설 — 같은 길을 다시 가지 않도록

| 가설 | 기각 근거 |
|---|---|
| WebGL 컨텍스트 상한(`c2d71f6`)이 원인 | 진단 로그 실측상 `terms`가 **최대 9**. `WEBGL_CAP=12`에 도달한 적이 없어 `pickEvictions`/`dropWebgl`이 **한 번도 실행되지 않았다.** `webglLost`도 커밋 이후 0 |
| WebGL 컨텍스트 유실이 원인 | `WEBGL-CONTEXT-LOST` 4건은 전부 `terms=N/M` 포맷 시절 = **그 커밋 이전**. 이후 0건 |
| IPC 연결 카운터(`MAX_CONNS=32`) 누수 | 실행 중인 앱에 `eqmux ping` **60회 순차 전송 → 60/60 성공**. 누수 없음 |
| `recap`이 다른 버그를 유발 | 기능이 완전 무동작이었으므로 화면에 아무것도 만들 수 없었다 (2-3 참고) |
| 메모리 누수 / OOM | 멈춤 직전 `heapMB=16`. 로그 전 구간 4~20MB |
| `Job::pids()` 무한 루프 | 최대 4회 루프로 유한(`job.rs:85`) |

---

## 4. 아직 못 밝힌 것 (1순위 의심)

**웹뷰가 왜 죽었는지는 확정하지 못했다.** 현재 계측으로는 잡을 수 없다 —
진단 로그는 JS가 찍는데, 정작 죽는 게 JS이기 때문이다.

남은 후보 (증거 없음, 코드 리뷰 수준):

1. **리사이즈 진동 루프** — `syncSize`가 `term.resize()`를 하면 레이아웃이 바뀌어
   `ResizeObserver` → `queueSync` → `syncSize`로 돌아온다. 터미널 10개면
   `window resize` 한 번에 10개의 타이머가 동시에 돈다(`TerminalPane.tsx:884-896`).
   두 크기를 오가며 수렴하지 못하면 JS가 영원히 멈춘다. **"10개 이상"과 맞물린다.**
2. **WebView2 렌더러 프로세스 크래시** — Rust는 살고 웹뷰만 죽는 전형적 형태.

### 다음에 재현되면 할 일 (순서대로)

1. 멈춘 상태에서 `eqmux ping` — 응답하면 백엔드는 살아 있다(=웹뷰 사망 확정)
2. 작업 관리자에서 `msedgewebview2.exe` 프로세스 개수·CPU 확인
   — **한 코어를 100% 먹고 있으면 1번(진동 루프) 확정**
3. 죽이기 전에 `~/.eqmux/logs/diagnostics.log`의 마지막 `heartbeat` 시각 기록

### 계측 제안

이 버그를 잡으려면 **Rust가 프론트의 생사를 감시**해야 한다. `diag.rs`의
스윕에서 프론트에 ping을 보내고 N초 내 응답이 없으면 Rust 쪽에 한 줄 남기는
것으로 충분하다 — 지금은 웹뷰가 죽은 사실 자체가 어디에도 안 남는다.

---

## 5. 검증 기록

| 항목 | 결과 |
|---|---|
| Rust 단위 테스트 | 92 passed (recap 읽기 경로 테스트 1건 신규) |
| 프론트 단위 테스트 | 49 passed |
| `tsc --noEmit` | 통과 |
| 신규 테스트의 결함 재현 | 옛 코드(`limit=0`)로 되돌리면 실패하는 것 확인 |
| 수정본 실제 기동 | `startup` + `heartbeat(sweep)` 기록 확인 = 프론트 정상, 회귀 없음 |
| IPC 응답 | `eqmux ping` → `EQMUX 응답 · v0.4.0` |

**한계:** 이 세션에서는 GUI 자동화 수단(Chrome 확장 · 터미널 멀티플렉서 CLI)을 쓸 수 없어
터미널 10개 이상을 띄운 재현은 하지 못했다. 위 실측은 전부 사용자의 실제
로그와 DB, 그리고 앱을 띄운 상태의 IPC 측정에 근거한다.

---

## 6. 확정 (2026-09-21) — 원인은 동기 커맨드 안의 자식 웹뷰 생성

같은 증상이 재현됐다(00:58 마지막 하트비트 → 00:59:29 자식 웹뷰 renderer 생성 →
`eqmux browser open` 3회 → 이후 하트비트 없음, Rust는 `window moved` 계속 기록).

- `browser.rs`의 `browser_open`이 **동기** `#[tauri::command]`였다. wry는 IPC 요청을
  WebView2 `WebResourceRequested` 콜백 안(UI 스레드)에서 그대로 실행하고, 거기서
  `WebviewBuilder::new` + `add_child`가 컨트롤러 생성 완료를 `wait_with_pump`(중첩
  메시지 루프)로 기다린다. WebView2는 재진입을 막아 바깥 콜백이 끝나기 전엔 완료
  콜백을 주지 않는다 → 영원히 펌프. Tauri 문서 그대로: "On Windows, this function
  deadlocks when used in a synchronous command … use async commands".
- 중첩 펌프 안에서 창 메시지는 처리되므로 "응답 없음"이 아니고 `window moved`도 찍히지만,
  tao 이벤트 핸들러가 잡혀 있어 emit·eval·invoke 응답이 전부 버퍼에만 쌓인다 → 전 터미널
  입출력·새 세션(검은 화면)·종료(`shutdown_flush` invoke) 모두 멈춘다.
- 4장의 후보 1(리사이즈 진동)·2(렌더러 크래시)는 아니었다. renderer CPU ≈ 0, 크래시 덤프 없음.

**수정:** 웹뷰를 만지는 커맨드 5개를 `async fn`으로. CLI(`cli()`)가 쓰던 `browser_nav`는
동기 본체 `nav()`로 분리. 컴파일 타임 가드(`browser_commands_are_async`) 추가 — `async`를
떼면 빌드가 깨진다.

**검증(실기, UIA 자동화):** 수정 빌드에서 브라우저 패널 생성 3회(닫기→재생성 포함) 후
매번 터미널 에코 정상, `BROWSER-OPEN` 진단 기록 정상, 종료 버튼 → flush → 1초 내 종료,
`running.flag` 삭제, 세션 exit 기록 flush 확인.
