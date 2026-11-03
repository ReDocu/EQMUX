// 트랜스크립트 페인 (화면 #12 · 0.5 시안 Yd4E5) — 턴 단위 열람 (V1) · 입력은 PTY로 흘려보냄 (V3).
// 보조 페인이므로 세션 슬롯을 소비하지 않는다 (불변 규칙 3).
// Tauri: 에이전트 JSONL이 1급 소스 (FR-G-80), 인식 불가면 스크롤백 폴백 + 그 사실 표시 (FR-G-86).
// 도구 호출은 접힌 상태가 기본이다 (FR-G-83).
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { backend } from "../backend/mock";
import type { AgentStateEvt } from "../backend/agent";
import { cleanScrollback, exportSessionScrollback } from "../backend/panels";
import { clipWriteText, isTauri, scrollbackTail, writePty } from "../backend/pty";
import { t as tr, tf } from "../i18n";
import { readTranscript } from "../backend/transcript";
import type { TranscriptData } from "../backend/transcript";
import { tick } from "../state";
import { effectiveTitle, paneNo, sessionName } from "../types";
import type { Session } from "../types";
import { Identity } from "../components/ui";
import { Icon } from "../components/icons";
import { isSubmitEnter } from "../platform"; // 한글 조합 중 Enter는 제출이 아니다 (B130)

/** onJump — 페인(터미널 탭)으로 돌아가는 길. 화면을 소유한 쪽이 넘긴다 (시안 Yd4E5 "페인으로 점프") */
export function TranscriptPane(props: { session: Session; onJump?: () => void }) {
  const persona = () => backend.listPersonas().find((p) => p.id === props.session.personaId);

  const [data, setData] = createSignal<TranscriptData | undefined>(undefined);
  const [fallback, setFallback] = createSignal<string[] | undefined>(undefined);
  // 펼친 도구 턴 — 순번이 아니라 턴 내용으로 기억한다 (B236: 검색 · 창 밀림 · 세션 전환에 엉뚱한 턴이 펼쳐졌다).
  // ponytail: 같은 시각 · 같은 도구 · 같은 요약인 두 턴은 함께 펼쳐진다 — 턴에 tool_use id가 실리면 그것으로
  const [openTurn, setOpenTurn] = createSignal<string | undefined>(undefined);
  const turnKey = (t: { time: string; text: string; summary: string | null }) => `${t.time}\n${t.text}\n${t.summary ?? ""}`;

  onMount(() => {
    if (!isTauri()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 같은 내용이면 setData를 건너뛴다 (CPU·RAM C3) — Rust 캐시가 그대로여도 매번 새 객체가 와서
    // <For>가 턴·개요 DOM 전부를 다시 만들던 자리다. 로그는 append-only라 끝 턴과 개수로 가른다
    const sig = (d?: TranscriptData) =>
      d && `${d.file}|${d.turns.length}|${d.skipped}|${JSON.stringify(d.turns[d.turns.length - 1])}`;
    // 페인은 세션이 바뀌어도 다시 만들어지지 않는다 — 시작 때 세션을 잡아 두고, 끝났을 때 다르면 버린다 (B236)
    const load = async () => {
      const sid = props.session.id;
      const d = await readTranscript(props.session);
      if (sid !== props.session.id) return;
      if (d && sig(d) === sig(data())) return;
      setData(d);
      if (!d) {
        // 스크롤백 폴백 (FR-G-86) — 로그가 없거나 스키마 인식 불가. 여기는 평문만 쓴다.
        // TUI 잔해(프레임·로고 조각·연속 중복)는 걸러낸다 — 재생 필터와 같은 판정
        const lines = await scrollbackTail(props.session.workspaceId, sid, 200);
        if (sid === props.session.id) setFallback(cleanScrollback(lines).map((l) => l.text));
      }
    };
    createEffect(on(() => props.session.id, () => (setOpenTurn(undefined), void load())));
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 1000);
    };
    // 최적화 D1 — 아무 세션 방송이 아니라 이 세션의 agent-state(상태·도구 활동)에만 다시 읽는다.
    // 터미널에서 직접 띄운 에이전트(guessed)는 이 세션 이름의 이벤트가 없어 느린 폴링으로 받친다 —
    // Rust가 크기·mtime 캐시를 가지므로 바뀌지 않았으면 메타데이터 한 번이다
    const unlisten = listen<AgentStateEvt>("agent-state", (e) => {
      if (e.payload.session === props.session.id) later();
    });
    // 숨김 중에는 쉰다 (CPU·RAM C3) — 다시 보이면 다음 틱(10초 안)에 따라잡는다
    const poll = setInterval(() => {
      if (data()?.guessed && !document.hidden) void load();
    }, 10_000);
    onCleanup(() => {
      clearTimeout(timer);
      clearInterval(poll);
      void unlisten.then((f) => f());
    });
  });

  // 브라우저 dev — 기존 목 턴 유지
  const mockTurns = () => {
    tick();
    return backend.listTurns(props.session.id);
  };

  // 트랜스크립트 검색 (FR-G-87) — 로드된 창(끝 2MB) 안에서 클라이언트 필터.
  // 도구 턴은 요약 줄과 상세를 함께 검색한다. 필터 결과는 메모 — 카운터와 본문이
  // 같은 배열을 공유해 렌더당 이중 필터·정규화를 없앤다.
  const [query, setQuery] = createSignal("");
  const q = createMemo(() => query().trim().toLowerCase());
  const hit = (...texts: (string | null | undefined)[]) => {
    const qq = q();
    if (!qq) return true;
    return texts.some((t) => t?.toLowerCase().includes(qq));
  };
  const shownTurns = createMemo(() => (data()?.turns ?? []).filter((t) => hit(t.text, t.summary, t.detail)));
  const shownFallback = createMemo(() => (fallback() ?? []).filter((l) => hit(l)));
  const shownMock = createMemo(() => (isTauri() ? [] : mockTurns().filter((t) => hit(t.text))));

  // 세션 저장 — 세션 상세의 "기록 저장"과 같은 공용 흐름(exportSessionScrollback)을
  // 라인 카운터 옆에서 바로 연다. 대화상자·파일 쓰기는 Rust 몫, 여기선 결과 표시만 (FR-D-08)
  const [saving, setSaving] = createSignal(false);
  const [saveMsg, setSaveMsg] = createSignal<{ text: string; err: boolean } | undefined>(undefined);
  let saveMsgTimer: ReturnType<typeof setTimeout> | undefined;
  const showSaveMsg = (text: string, err: boolean) => {
    clearTimeout(saveMsgTimer);
    setSaveMsg({ text, err });
    saveMsgTimer = setTimeout(() => setSaveMsg(undefined), 8000);
  };
  createEffect(on(() => props.session.id, () => {
    clearTimeout(saveMsgTimer);
    setSaveMsg(undefined);
  }));
  onCleanup(() => clearTimeout(saveMsgTimer));
  const saveSession = async () => {
    setSaving(true);
    try {
      const msg = await exportSessionScrollback(props.session, persona()?.name ?? tr("기본 터미널"));
      if (msg) showSaveMsg(msg, false);
    } catch (err) {
      showSaveMsg(String(err), true);
    } finally {
      setSaving(false);
    }
  };

  const [draft, setDraft] = createSignal("");
  // 승인 · 질문 대기 중엔 글이 TUI 승인 창의 답이 된다 (B214) — 대화 버스처럼 waiting엔 넣지 않는다
  const blocked = () => props.session.status === "dead" || props.session.status === "waiting";
  const send = () => {
    const text = draft().trim();
    if (!text || blocked()) return;
    if (isTauri()) {
      writePty(props.session.id, text + "\r"); // V3 — 별도 경로 없이 PTY로
    } else {
      backend.sendInput(props.session.id, text);
    }
    setDraft("");
  };

  const sourceLabel = () => {
    const d = data();
    if (!isTauri()) return tr("목 데이터");
    if (d) {
      // 구현 용어(JSONL · cwd · 창) 대신 뜻을 말한다 (U160)
      const parts = [d.guessed ? tr("같은 폴더의 최근 대화로 추정 — 이 세션 것이 아닐 수 있습니다") : tr("대화 로그")];
      if (d.windowed) parts.push(tr("최근 2MB만"));
      if (d.skipped > 0) parts.push(tf("건너뜀 {n}줄", { n: d.skipped }));
      return parts.join(" · ");
    }
    return tr("터미널 기록에서 읽음");
  };

  // 출처 (FR-G-80·86) — 도구 턴만 늘어놓으면 이게 어느 폴더의 로그인지 알 수 없다.
  // JSONL 경로는 cwd로 정해지므로(agent::transcript_path) cwd + 파일명이 곧 출처다.
  // 셸 우선 추정(guessed)일수록 중요하다 — 같은 cwd의 최신 파일을 고른 것이라 세션과 1:1이 아니다.
  const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
  // 보이는 이름은 탭과 같은 워크스페이스 이름 + 저장소 상대 폴더다 (U160 — 내부 id 'eqmux-1a2b3c'가 보였다). 복사는 전체 경로
  const source = () => {
    if (!isTauri()) return undefined;
    const ws = backend.listWorkspaces().find((w) => w.id === props.session.workspaceId);
    const wsName = ws?.name ?? props.session.workspaceId;
    const d = data();
    if (d) {
      const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
      const root = ws ? norm(ws.path) : "";
      const cwd = norm(props.session.cwd ?? "");
      const rel = root && cwd.toLowerCase().startsWith(root.toLowerCase()) ? cwd.slice(root.length).replace(/^\//, "") : cwd;
      return { path: d.file, label: [wsName, rel, baseName(d.file)].filter(Boolean).join(" · "), guessed: d.guessed };
    }
    // 스크롤백 폴백은 워크스페이스 DB에서 읽는다 — 어느 워크스페이스인지가 곧 출처다
    if (!fallback()?.length) return undefined;
    return { path: `workspaces/${props.session.workspaceId}/session.db`, label: wsName, guessed: false };
  };

  const roleLabel = (role: string) =>
    role === "user"
      ? tf("사람 → {name}", { name: who() })
      : who(); // 도구 턴은 본문(도구 이름)이 이미 ⚙로 시작한다
  const who = () => sessionName(props.session, persona());

  // 턴 개요 (시안 Yd4E5 오른쪽 레일) — 보이는 턴의 시각과 첫 줄. 누르면 그 턴으로 스크롤한다
  let turnsEl: HTMLDivElement | undefined;
  const outline = () =>
    isTauri()
      ? shownTurns().map((t) => ({ time: t.time, label: t.text, user: t.role === "user" }))
      : shownMock().map((t) => ({ time: t.time, label: t.text, user: t.role === "user" }));
  const jumpTo = (i: number) => turnsEl?.querySelectorAll(".tr-turn")[i]?.scrollIntoView({ block: "start", behavior: "smooth" });

  const countText = () => {
    // 검색 중에는 필터 결과를 함께 보인다 — 총계만 남으면 카운터가 거짓말이 된다 (B6)
    const turns = data() || !isTauri(); // 턴이 아니면 스크롤백 줄이다
    const total = isTauri() ? (data()?.turns.length ?? fallback()?.length ?? 0) : mockTurns().length;
    if (!q()) return tf(turns ? "{n}턴" : "{n}줄", { n: total });
    const shown = isTauri() ? (data() ? shownTurns().length : shownFallback().length) : shownMock().length;
    return tf(turns ? "{shown} / {total}턴" : "{shown} / {total}줄", { shown, total });
  };

  return (
    <div class="card terminal-slot transcript">
      <div class="tr-head">
        <div class="tr-head-l">
          <span class="tr-ident" title={`${who()} · ${sourceLabel()}`}>
            <Identity slot={props.session.slot} no={paneNo(props.session)} name={who()} title={effectiveTitle(props.session, persona())} />
          </span>
          {/* 출처 한 줄 — 어느 워크스페이스(cwd)의 어느 파일에서 읽었는가. 클릭하면 전체 경로 복사 */}
          <Show when={source()} fallback={<span class="tr-src mono">{sourceLabel()}</span>}>
            {(s) => (
              <button
                class="tr-src mono"
                classList={{ "st-waiting": s().guessed }}
                title={tf("출처 {path} — 클릭하면 경로를 복사합니다", { path: s().path })}
                onClick={() => clipWriteText(s().path)}
              >
                {sourceLabel()} · {s().label}
              </button>
            )}
          </Show>
        </div>
        <div class="tr-head-r">
          <input
            class="tr-search"
            placeholder={tr("턴 검색…")}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <span class="muted mono tr-count">{countText()}</span>
          <button
            class="btn"
            title={tr("세션 저장 — 스크롤백 전체(디스크 포함)를 평문 .txt로 내보냅니다")}
            disabled={saving() || !isTauri()}
            onClick={() => void saveSession()}
          >
            {saving() ? tr("저장 중…") : tr("세션 저장")}
          </button>
          <Show when={props.onJump}>
            <button class="btn" onClick={() => props.onJump!()}>
              {tr("페인으로 점프")}
            </button>
          </Show>
        </div>
      </div>
      <Show when={saveMsg()}>
        {(m) => (
          <div class="mono transcript-save-msg" classList={{ "st-dead": m().err }}>
            {m().text}
          </div>
        )}
      </Show>
      <div class="tr-main">
        <div class="tr-turns" ref={turnsEl}>
          {/* Tauri — 실측 턴 */}
          <Show when={isTauri() && data()}>
            <For each={shownTurns()}>
              {(t) => (
                <div class="tr-turn" classList={{ user: t.role === "user" }}>
                  <div class="tr-turn-top">
                    <span class="tr-who">{roleLabel(t.role)}</span>
                    <span class="tr-time mono">{t.time}</span>
                  </div>
                  <Show
                    when={t.role === "tool"}
                    fallback={<div class="tr-text">{t.text}</div>}
                  >
                    {/* 도구 호출 — 접힌 상태 기본, 클릭 시 입력·출력 (FR-G-83).
                        요약(경로·명령)을 이름 옆에 붙여 펼치지 않고도 대상이 보이게 한다 */}
                    <button
                      class="mono turn-tool"
                      title={t.summary ?? undefined}
                      onClick={() => setOpenTurn(openTurn() === turnKey(t) ? undefined : turnKey(t))}
                    >
                      {t.text}
                      <Show when={t.summary}>{(s) => <span class="muted"> · {s()}</span>}</Show>{" "}
                      <span class="muted">{openTurn() === turnKey(t) ? <Icon name="chevron-down" size={12} /> : <Icon name="chevron-right" size={12} />}</span>
                    </button>
                    <Show when={openTurn() === turnKey(t) && t.detail}>
                      <pre class="mono muted tr-detail">{t.detail}</pre>
                    </Show>
                  </Show>
                </div>
              )}
            </For>
          </Show>

          {/* Tauri — 스크롤백 폴백 */}
          <Show when={isTauri() && !data()}>
            <Show
              when={(fallback()?.length ?? 0) > 0}
              fallback={<div class="muted">{tr("트랜스크립트 없음 — 에이전트 로그도 스크롤백도 아직 없습니다")}</div>}
            >
              <div class="tr-fallback">
                <span class="st-waiting">⚠</span>
                {tr("트랜스크립트를 인식할 수 없어 스크롤백으로 표시합니다")}
              </div>
              <For each={shownFallback()}>
                {(line) => <div class="mono muted tr-fb-line">{line}</div>}
              </For>
            </Show>
          </Show>

          {/* 브라우저 dev — 목 턴 */}
          <Show when={!isTauri()}>
            <Show when={mockTurns().length > 0} fallback={<div class="muted">{tr("트랜스크립트 없음 (목)")}</div>}>
              <For each={shownMock()}>
                {(t) => (
                  <div class="tr-turn" classList={{ user: t.role === "user" }}>
                    <div class="tr-turn-top">
                      <span class="tr-who">{roleLabel(t.role)}</span>
                      <span class="tr-time mono">{t.time}</span>
                    </div>
                    <div class="tr-text">{t.text}</div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>

        <div class="tr-rail">
          <div class="tr-rail-t">{tr("턴 개요")}</div>
          <For each={outline()}>
            {(o, i) => (
              <button class="tr-rail-it" classList={{ user: o.user }} onClick={() => jumpTo(i())}>
                <span class="tr-time mono">{o.time}</span>
                <span class="tr-rail-lb">{o.label}</span>
              </button>
            )}
          </For>
          <div class="tr-rail-src">
            <div class="tr-rail-src-t">{data() ? tr("대화 로그") : tr("터미널 기록에서 읽음")}</div>
            <div class="mono muted">{sourceLabel()}</div>
          </div>
        </div>
      </div>
      <div class="transcript-input">
        <input
          style={{ flex: 1, "min-width": 0 }}
          placeholder={
            props.session.status === "waiting"
              ? tr("승인 · 질문을 기다리는 중입니다 — 터미널에서 읽고 답하세요")
              : tf("{name}에게 입력 보내기", { name: who() })
          }
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => isSubmitEnter(e) && send()}
          disabled={blocked()}
        />
        <button class="btn primary" onClick={send} disabled={blocked()}>
          {tr("보내기")}
        </button>
      </div>
    </div>
  );
}
