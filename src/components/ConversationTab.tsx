// 대화 탭 (KnvN6) — 사이드 패널 탭이며 메인 화면이 아니다 (M1).
// 워크스페이스 = 팀 = 스트림 하나 (M5 평면). 원장은 message 테이블(PRD F)이고
// 발신은 msg_send, 전달은 conversation.ts의 인박스 + 상태 기반 PTY 주입 (M3).
// 사람도 같은 스트림의 참여자다 (M4) — "@카이 내용"이면 그 세션, 없으면 @all.
import { createEffect, createSignal, For, Show } from "solid-js";
import {
  deliveryOf,
  ensureConversation,
  exportConversation,
  hasOlder,
  loadOlder,
  markConversationRead,
  nameOf as nameOfId,
  pendingInbox,
  projectLabels,
  sendConversation,
  senderLabel,
} from "../backend/conversation";
import { backend } from "../backend/mock";
import { isTauri, revealPath } from "../backend/pty";
import { t, tf } from "../i18n";
import { focusSession, jumpToSession, scopeWorkspace, tick } from "../state";
import { ContextMenu, Eyebrow, notify } from "./ui";
import { effectiveTitle, sessionName as sessionNameOf } from "../types";
import type { ConversationMessage, Session } from "../types";

/** 화면 지우기 (표시 전용) — 워크스페이스별로 "지운 시점에 화면에 있던 메시지 id"를 담아 둔다.
 *  원장(message 테이블)은 건드리지 않는다: 저장(⤓)은 여전히 전량을 내보내고, "다시 보기"로 되돌아온다.
 *  ts가 아니라 id 집합인 이유 — ts는 선택 필드라(목 시드·브라우저 dev 발신에는 없다) 시각 기준으로
 *  자르면 그쪽 메시지가 통째로 숨는다. id는 재하이드레이트(`wsId:rowId`)에도 안정적이다.
 *  모듈 스코프인 이유 — 패널 탭을 옮기면 이 컴포넌트가 언마운트되므로, 컴포넌트 신호에 두면
 *  탭을 한 번 왕복하는 것만으로 지워 둔 화면이 되살아난다. */
const [clearedIds, setClearedIds] = createSignal<Record<string, Set<string>>>({});
/** `모든 프로젝트` 필터 칩 — 끄면 다른 프로젝트와 오간 메시지를 숨긴다 (탭을 오가도 남게 모듈 스코프) */
const [allProjects, setAllProjects] = createSignal(true);
/** 펼친 긴 본문 — 4줄을 넘는 본문은 접어 둔다 */
const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
const FOLD_LINES = 4;
const foldable = (body: string) => body.split(/\r?\n/).length > FOLD_LINES || body.length > FOLD_LINES * 80;

const TYPES: ConversationMessage["type"][] = ["ask", "handoff", "report", "review", "escalate"];
const TYPE_COLOR: Record<ConversationMessage["type"], string> = {
  ask: "blue",
  handoff: "purple",
  report: "green",
  review: "amber",
  escalate: "red",
};

export function ConversationTab() {
  // 스코프 = 현재 워크스페이스 문맥 (state.scopeWorkspace — 단일 소스). 활성 워크스페이스
  // 화면이 없으면 마지막으로 있던 워크스페이스를 유지한다. 임의 폴백은 없다 —
  // 조용히 다른 팀의 스트림을 보여주지 않는다.
  const ws = () => scopeWorkspace();
  createEffect(() => {
    const w = ws();
    if (w) ensureConversation(w.id); // 늦게 등록된 워크스페이스도 첫 열람 때 원장을 읽는다
  });

  const personaOf = (s: Session) => backend.listPersonas().find((p) => p.id === s.personaId);
  const personaName = (personaId: string) =>
    backend.listPersonas().find((p) => p.id === personaId)?.name ?? personaId;
  // 기본 터미널(역할 없음)도 대화 참여자다 — 수신은 셸 프롬프트의 주석 라인 (conversation.ts)
  const wsSessions = () => backend.listSessions().filter((s) => s.workspaceId === ws()?.id);
  const nameOf = (s: Session) => sessionNameOf(s, personaOf(s));
  const sessionName = (id: string) => nameOfId(id);
  // 이 워크스페이스에서 본 이름 — 다른 프로젝트 세션이면 `카이@app-b` (받은 주소 그대로 답할 수 있게)
  const label = (id: string) => (id === "나" ? t("나") : id === "@all" ? "@all" : senderLabel(id, ws()?.id));
  const sessionOf = (id: string) => backend.listSessions().find((x) => x.id === id);
  // 다른 프로젝트와 오간 메시지 — 그 프로젝트 이름(배지). 같은 프로젝트면 undefined
  const otherProject = (m: ConversationMessage): string | undefined => {
    const here = ws()?.id;
    for (const id of [m.from, m.to]) {
      const s = sessionOf(id);
      if (s && s.workspaceId !== here) return projectLabels().get(s.workspaceId) ?? s.workspaceId;
    }
    return undefined;
  };
  const titleTip = (id: string) => {
    const s = sessionOf(id);
    return s ? effectiveTitle(s, personaOf(s)) : undefined;
  };

  const messages = () => {
    tick();
    const id = ws()?.id;
    return backend.listMessages().filter((m) => m.workspaceId === id || m.workspaceId === undefined);
  };
  const unread = () => messages().filter((m) => m.unread).length; // 원장 기준 — 화면을 지워도 줄지 않는다
  // 화면에 남길 것 — 지운 id를 뺀 나머지. 필터(전체·미확인)보다 앞선다
  const visible = () => {
    const c = ws() ? clearedIds()[ws()!.id] : undefined;
    return c ? messages().filter((m) => !c.has(m.id)) : messages();
  };
  const hiddenCount = () => messages().length - visible().length;
  const clearScreen = () => {
    const w = ws();
    if (!w) return;
    setClearedIds({ ...clearedIds(), [w.id]: new Set(messages().map((m) => m.id)) });
  };
  const unclearScreen = () => {
    const w = ws();
    if (!w) return;
    const next = { ...clearedIds() };
    delete next[w.id];
    setClearedIds(next);
  };
  // 사람이 답해야 진행되는 세션 (Focus 대상) — 대화로는 답이 닿지 않는 상태다: waiting에는
  // 본문을 주입하지 않고 인박스에 쌓아 두므로(M3), 여기서 페인으로 건너가는 길을 준다
  const waitingNow = () => {
    tick();
    return wsSessions().filter((s) => s.status === "waiting");
  };
  const waitingInbox = () => {
    tick();
    const ids = new Set(wsSessions().map((s) => s.id));
    return pendingInbox().filter((p) => ids.has(p.sessionId));
  };

  const [selType, setSelType] = createSignal<ConversationMessage["type"]>("ask");
  const [filter, setFilter] = createSignal<"전체" | "미확인">("전체");
  const [draft, setDraft] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  const shown = () => {
    tick();
    const v = allProjects() ? visible() : visible().filter((m) => !otherProject(m));
    return filter() === "미확인" ? v.filter((m) => m.unread) : v;
  };

  // 메시지 메뉴 — 답장 · 다른 프로젝트로 전달 · 페인으로 점프 · 본문 복사 · 첨부 파일 열기
  const [msgMenu, setMsgMenu] = createSignal<{ x: number; y: number; m: ConversationMessage } | null>(null);
  const [forwarding, setForwarding] = createSignal<ConversationMessage | null>(null);
  const openFile = async (m: ConversationMessage) => {
    const w = ws();
    if (!w || !m.file) return;
    if (!(await revealPath(m.file.path, w.path))) notify(tf("파일을 열 수 없습니다 — {path}", { path: m.file.path }));
  };

  // @멘션 해석 (M4) — 표시 이름·페르소나 이름·페르소나 id·세션 id 무엇으로든 그 세션을 찾는다.
  // 이름에 공백이 있을 수 있으므로("H[역사강사] 힐데") 공백 없는 토큰으로 끊지 않고, 실제 후보
  // 이름들에 대한 최장 일치로 끊는다 — 토큰으로 끊으면 그런 팀원에게는 어떤 방법으로도 1:1
  // 메시지를 보낼 수 없다. 이름 없는 기본 터미널 여럿이면 첫 번째가 잡힌다 (구분은 FR-E-36).
  const mentionMatch = (rest: string): { id: string; len: number } | undefined =>
    [
      ...wsSessions().flatMap((s) => [
        { key: nameOf(s), id: s.id },
        { key: s.id, id: s.id },
        ...(s.personaId ? [{ key: personaName(s.personaId), id: s.id }, { key: s.personaId, id: s.id }] : []),
      ]),
      // 다른 프로젝트 세션은 `이름@프로젝트`로만 — 이름만으로는 이 팀의 같은 이름과 겹칠 수 있다
      ...backend
        .listSessions()
        .filter((s) => s.workspaceId !== ws()?.id && projectLabels().has(s.workspaceId))
        .map((s) => ({ key: `${nameOf(s)}@${projectLabels().get(s.workspaceId)}`, id: s.id })),
    ]
      .filter((c) => c.key && rest.startsWith(c.key) && /^(\s|$)/.test(rest.slice(c.key.length)))
      .sort((a, b) => b.key.length - a.key.length)
      .map((c) => ({ id: c.id, len: c.key.length }))[0];

  // 대화 저장 — 이 워크스페이스의 대화 원장 전체를 Markdown 파일로 내보낸다.
  // 대화상자·파일 쓰기는 Rust(msg_export) 몫이고, 여기선 표시 이름 맵과 결과 표시만 맡는다.
  // 화면의 최근 200건이 아니라 원장 전부가 나간다 — "본 것만" 저장되면 기록이 아니다.
  const [saving, setSaving] = createSignal(false);
  const [note, setNote] = createSignal<{ ws: string; text: string; bad?: boolean } | null>(null);
  // 결과 문구는 그 팀의 것이다 — 다른 워크스페이스를 보면 자연히 사라진다. 지우는 이펙트를 두면
  // 스코프 신호가 다시 튈 때마다(저장 대화상자가 닫히며 포커스가 돌아올 때가 그렇다) 함께 날아간다.
  const shownNote = () => {
    const n = note();
    return n && n.ws === ws()?.id ? n : null;
  };

  const doExport = async () => {
    const w = ws();
    if (!w) return;
    setNote(null);
    setSaving(true);
    try {
      // 원장에는 세션 id만 남는다 — 사람이 읽을 이름은 지금 화면이 아는 것으로 넘긴다
      const names: Record<string, string> = { 나: t("나") };
      for (const s of wsSessions()) names[s.id] = nameOf(s);
      const r = await exportConversation(w.id, w.name, names);
      if (r) setNote({ ws: w.id, text: tf("{n}건 저장됨 — {path}", { n: r.count, path: r.path }) });
    } catch (e) {
      setNote({ ws: w.id, text: `${t("저장 실패 — 로그 패널을 확인하세요")} (${String(e)})`, bad: true });
    } finally {
      setSaving(false);
    }
  };

  // @멘션 자동완성 (P2 U-6, 시안 iqhwU) — 이 팀은 이름, 다른 프로젝트는 `이름@프로젝트`, 끝에 @all.
  // 고르면 `@이름 `까지 채운다 — 해석은 위 mentionMatch가 그대로 한다(후보 글자와 같은 키)
  const [mentionIdx, setMentionIdx] = createSignal(0);
  const [mentionOff, setMentionOff] = createSignal(false); // Esc로 접은 동안 — 다시 치면 풀린다
  const mentionAll = () => {
    tick();
    const here = ws();
    if (!here) return [];
    const labels = projectLabels();
    const hint = (s: Session) =>
      [effectiveTitle(s, personaOf(s)), backend.listJobs().find((j) => j.id === s.jobId)?.name].filter(Boolean).join(" · ");
    return [
      ...wsSessions().map((s) => ({ key: nameOf(s), hint: hint(s), project: labels.get(here.id) ?? here.name })),
      ...backend
        .listSessions()
        .filter((s) => s.workspaceId !== here.id && labels.has(s.workspaceId))
        .map((s) => ({ key: `${nameOf(s)}@${labels.get(s.workspaceId)}`, hint: hint(s), project: labels.get(s.workspaceId)! })),
      { key: "all", hint: t("이 프로젝트 전체"), project: labels.get(here.id) ?? here.name },
    ];
  };
  const mentions = () => {
    const d = draft();
    if (mentionOff() || !d.startsWith("@")) return [];
    const q = d.slice(1).toLowerCase();
    return mentionAll()
      .filter((c) => c.key.toLowerCase().startsWith(q) && c.key.toLowerCase() !== q)
      .slice(0, 8);
  };
  const pickMention = (key: string) => {
    setDraft(`@${key} `);
    setMentionIdx(0);
  };
  const onDraftKey = (e: KeyboardEvent) => {
    const list = mentions();
    if (list.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => (i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(list[Math.min(mentionIdx(), list.length - 1)].key);
        return;
      }
      if (e.key === "Escape") {
        setMentionOff(true);
        return;
      }
    }
    if (e.key === "Enter") void send();
  };

  const send = async () => {
    const w = ws();
    const body = draft().trim();
    if (!w || !body) return;
    let to = "@all";
    let text = body;
    if (body.startsWith("@")) {
      const rest = body.slice(1);
      if (/^all(\s|$)/.test(rest)) {
        text = rest.slice(3).trim();
      } else {
        const hit = mentionMatch(rest);
        if (!hit) {
          // 어디까지가 이름인지 모르므로 첫 토큰만 보여준다 — 이름에 공백이 있으면 그 조각이다
          setError(tf("수신자 없음: @{name} — 이 워크스페이스의 페르소나·세션 이름으로", { name: rest.split(/\s/)[0] }));
          return;
        }
        to = hit.id;
        text = rest.slice(hit.len).trim();
      }
    }
    if (!text) {
      // 멘션만 치고 끝낸 경우 — 조용히 삼키면 "보내기가 안 먹는다"로 읽힌다
      setError(t("본문이 없습니다 — 받는 사람 뒤에 보낼 내용을 적어주세요"));
      return;
    }
    // 다른 프로젝트 세션이면 그 프로젝트 원장으로 보낸다 — 받는 쪽 대화 탭에 프로젝트 배지와 함께 남는다
    const target = to === "@all" ? w.id : (sessionOf(to)?.workspaceId ?? w.id);
    setError(await sendConversation(target, to, selType(), text));
    if (!error()) setDraft("");
  };

  return (
    <div class="conv-tab">
      <div class="conv-head">
        <Eyebrow>
          {t("팀 대화")}{ws() ? ` · ${ws()!.name}` : ""} · {unread()} {t("미확인")}
        </Eyebrow>
        <div style={{ display: "flex", gap: "4px" }}>
          <For each={["전체", "미확인"] as const}>
            {(f) => (
              <button class="btn ghost" classList={{ primary: filter() === f }} onClick={() => setFilter(f)}>
                {t(f)}
              </button>
            )}
          </For>
          <button
            class="btn ghost"
            classList={{ primary: allProjects() }}
            aria-pressed={allProjects()}
            title={t("끄면 다른 프로젝트와 오간 메시지를 숨깁니다")}
            onClick={() => setAllProjects(!allProjects())}
          >
            {t("모든 프로젝트")}
          </button>
          <button class="btn ghost" onClick={() => markConversationRead(ws()?.id)}>
            {t("모두 읽음")}
          </button>
          <button
            class="btn ghost"
            disabled={!ws() || saving() || !isTauri()}
            title={t(
              isTauri()
                ? "이 팀의 대화 전체를 Markdown 파일로 저장"
                : "파일 저장은 앱에서만 됩니다 — 브라우저 목업에는 원장이 없습니다",
            )}
            onClick={() => void doExport()}
          >
            ⤓ {t("저장")}
          </button>
          {/* 화면 지우기 — 표시만 비운다. 지우기 전에 저장할 수 있게 ⤓ 바로 오른쪽에 둔다 */}
          <button
            class="btn ghost"
            disabled={!ws() || shown().length === 0}
            title={t("화면만 지웁니다 — 대화 원장과 저장 파일은 그대로 남습니다")}
            onClick={clearScreen}
          >
            ⌫ {t("화면 지우기")}
          </button>
        </div>
      </div>
      <Show when={shownNote()}>
        {(n) => (
          <div
            class="mono"
            classList={{ muted: !n().bad }}
            style={{
              "font-size": "10px",
              padding: "0 2px 4px",
              "word-break": "break-all",
              color: n().bad ? "var(--eq-red)" : undefined,
            }}
          >
            {n().text}
          </div>
        )}
      </Show>
      <Show when={waitingNow().length > 0}>
        <div class="card inset conv-waiting">
          <span class="muted">{t("응답 대기 — 대화로는 답할 수 없습니다. 페인에서 직접 입력하세요")}</span>
          <div class="conv-waiting-row">
            <For each={waitingNow()}>
              {(s) => (
                <button
                  class="badge amber conv-focus"
                  title={t("Focus — 이 페인을 전체 화면으로 잡고 키보드를 넘깁니다")}
                  onClick={() => focusSession(s.workspaceId, s.id)}
                >
                  ⛶ {nameOf(s)}
                  <Show when={s.waitingFor}> · {t(s.waitingFor!)}</Show>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={waitingInbox().length > 0}>
        <div class="card inset" style={{ padding: "6px 10px", "font-size": "11px" }}>
          <span class="muted">{t("인박스 대기 (턴 종료 시 전달)")}: </span>
          <For each={waitingInbox()}>
            {(p, i) => (
              <span class="mono">
                {i() > 0 ? " · " : ""}
                {sessionName(p.sessionId)} {tf("{n}건", { n: p.count })}
              </span>
            )}
          </For>
        </div>
      </Show>
      {/* 지운 화면 되돌리기 — 원장이 그대로라는 사실을 그 자리에서 보인다
          (터미널 페인의 "▲ 디스크 기록 보기"와 같은 약속) */}
      <Show when={hiddenCount() > 0}>
        <button class="btn ghost conv-uncleared mono" onClick={unclearScreen}>
          ▲ {tf("이전 {n}건 숨김 — 다시 보기", { n: hiddenCount() })}
        </button>
      </Show>
      <Show when={ws() && hasOlder(ws()!.id)}>
        <button class="btn ghost conv-uncleared mono" onClick={() => void loadOlder(ws()!.id)}>
          ▲ {t("이전 200건")}
        </button>
      </Show>
      <div class="conv-stream">
        <Show
          when={shown().length > 0}
          fallback={
            <div class="muted" style={{ padding: "16px", "font-size": "12px", "text-align": "center" }}>
              {t(
                hiddenCount() > 0
                  ? "화면을 지웠습니다 — 새 메시지부터 여기에 표시됩니다"
                  : "아직 메시지가 없습니다 — 아래에서 타입을 골라 팀에 보내보세요.",
              )}
              <div class="mono" style={{ "font-size": "10px", "margin-top": "6px" }}>
                {t("idle 세션에는 즉시, 작업 중이면 턴 종료 시 전달됩니다")}
              </div>
            </div>
          }
        >
          <For each={shown()}>
            {(m) => (
              <div
                class="card conv-msg"
                classList={{ unread: m.unread }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMsgMenu({ x: e.clientX, y: e.clientY, m });
                }}
              >
                <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                  <span style={{ "font-weight": 700, "font-size": "12px" }}>
                    <span title={titleTip(m.from)}>{label(m.from)}</span> → {label(m.to)}
                  </span>
                  <span class={`badge ${TYPE_COLOR[m.type]}`}>{m.type.toUpperCase()}</span>
                  <Show when={otherProject(m)}>{(p) => <span class="badge purple">{p()}</span>}</Show>
                  <Show when={m.done}>
                    <span class="badge blue" title={t("완료 보고 — 에이전트가 맡은 일을 끝냈다고 밝혔습니다")}>
                      ✓
                    </span>
                  </Show>
                  <Show when={m.from === "나" && deliveryOf(m.id)}>
                    {(d) => (
                      <span class="mono conv-delivery" classList={{ queued: d() === "queued" }}>
                        {d() === "queued" ? t("대기 중 · 상대 작업 중") : t("전달됨")}
                      </span>
                    )}
                  </Show>
                  <span class="mono muted" style={{ "margin-left": "auto", "font-size": "10px" }}>
                    {m.time}
                  </span>
                </div>
                <div
                  class="conv-body"
                  classList={{ folded: foldable(m.body) && !expanded().has(m.id) }}
                  style={{ "margin-top": "4px", "font-size": "12px" }}
                >
                  {m.body}
                </div>
                <Show when={foldable(m.body)}>
                  <button
                    class="btn ghost conv-fold"
                    onClick={() => {
                      const n = new Set(expanded());
                      if (n.has(m.id)) n.delete(m.id);
                      else n.add(m.id);
                      setExpanded(n);
                    }}
                  >
                    {expanded().has(m.id) ? t("접기") : t("펼치기")}
                  </button>
                </Show>
                <Show when={m.file}>
                  {(f) => (
                    <button class="btn ghost mono conv-file" title={t("탐색기에서 열기")} onClick={() => void openFile(m)}>
                      📎 {relPath(f().path, ws()?.path)} · {fmtSize(f().size)}
                    </button>
                  )}
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="conv-composer card">
        <div style={{ display: "flex", gap: "4px", "flex-wrap": "wrap", "margin-bottom": "6px" }}>
          <For each={TYPES}>
            {(t) => (
              <button
                class={`badge ${selType() === t ? TYPE_COLOR[t] : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSelType(t)}
              >
                {t.toUpperCase()}
              </button>
            )}
          </For>
        </div>
        <div style={{ display: "flex", gap: "6px", position: "relative" }}>
          <Show when={mentions().length > 0}>
            <div class="card conv-mention" role="listbox" aria-label={t("받는 사람")}>
              <For each={mentions()}>
                {(c, i) => (
                  <button
                    class="conv-mention-it"
                    classList={{ on: i() === Math.min(mentionIdx(), mentions().length - 1) }}
                    role="option"
                    aria-selected={i() === mentionIdx()}
                    onMouseDown={(e) => {
                      e.preventDefault(); // 입력란 포커스를 뺏지 않는다
                      pickMention(c.key);
                    }}
                  >
                    <b class="mono">@{c.key}</b>
                    <span class="muted conv-mention-hint">{c.hint}</span>
                    <span class="mono conv-mention-proj">{c.project}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <input
            style={{ flex: 1, "min-width": 0 }}
            placeholder={t(ws() ? "@이름 질문… (@ 없으면 @all)" : "워크스페이스 탭을 먼저 여세요")}
            disabled={!ws()}
            value={draft()}
            aria-autocomplete="list"
            onInput={(e) => {
              setDraft(e.currentTarget.value);
              setMentionOff(false);
              setMentionIdx(0);
            }}
            onKeyDown={onDraftKey}
          />
          <button class="btn primary" disabled={!ws()} onClick={() => void send()}>
            {t("보내기")}
          </button>
        </div>
        <Show when={error()}>
          <div style={{ color: "var(--eq-red)", "font-size": "11px", "margin-top": "4px" }}>
            {error()}
          </div>
        </Show>
      </div>
      <Show when={msgMenu()}>
        {(mm) => {
          const m = mm().m;
          const peer = m.from === "나" ? m.to : m.from;
          const peerSession = sessionOf(peer);
          return (
            <ContextMenu
              x={mm().x}
              y={mm().y}
              onClose={() => setMsgMenu(null)}
              groups={[
                [
                  {
                    label: tf("답장 (@{name})", { name: label(peer) }),
                    disabled: !peerSession,
                    action: () => setDraft(`@${label(peer)} `),
                  },
                  {
                    label: t("다른 프로젝트로 전달…"),
                    disabled: projectLabels().size < 2,
                    action: () => setForwarding(m),
                  },
                  {
                    label: t("페인으로 점프"),
                    disabled: !peerSession,
                    action: () => peerSession && jumpToSession(peerSession.workspaceId, peerSession.id),
                  },
                ],
                [
                  { label: t("본문 복사"), action: () => void navigator.clipboard?.writeText(m.body) },
                  { label: t("첨부 파일 열기"), disabled: !m.file, action: () => void openFile(m) },
                ],
              ]}
            />
          );
        }}
      </Show>
      <Show when={forwarding()}>
        {(m) => <ForwardDialog m={m()} from={ws()?.id} onClose={() => setForwarding(null)} />}
      </Show>
    </div>
  );
}

const fmtSize = (n: number) => (n < 1024 ? `${n}B` : `${(n / 1024).toFixed(1)}KB`);
/** 원장은 첨부를 절대 경로로 남긴다 — 화면에는 저장소 상대 경로로 짧게 */
const relPath = (p: string, root?: string) => {
  const n = p.replace(/\\/g, "/");
  const r = root?.replace(/\\/g, "/").replace(/\/$/, "");
  return r && n.toLowerCase().startsWith(r.toLowerCase() + "/") ? n.slice(r.length + 1) : n;
};

/** 다른 프로젝트로 전달 — 사람이 프로젝트와 받는 사람을 고르면 원문을 인용해 "나" 이름으로 보낸다 */
function ForwardDialog(props: { m: ConversationMessage; from?: string; onClose: () => void }) {
  const projects = () => [...projectLabels()].filter(([id]) => id !== props.from);
  const [wsId, setWsId] = createSignal(projects()[0]?.[0] ?? "");
  const targets = () => backend.listSessions().filter((s) => s.workspaceId === wsId());
  const [to, setTo] = createSignal("@all");
  const [err, setErr] = createSignal<string | null>(null);
  const body = () => `[${t("전달")} · ${senderLabel(props.m.from, wsId())}] ${props.m.body}`;
  const send = async () => {
    const e = await sendConversation(wsId(), to(), props.m.type, body());
    if (e) setErr(e);
    else props.onClose();
  };
  return (
    <div class="card inset conv-forward">
      <div class="eyebrow">{t("다른 프로젝트로 전달")}</div>
      <div style={{ display: "flex", gap: "6px" }}>
        <select
          value={wsId()}
          onChange={(e) => {
            setWsId(e.currentTarget.value);
            setTo("@all");
          }}
        >
          <For each={projects()}>{([id, name]) => <option value={id}>{name}</option>}</For>
        </select>
        <select value={to()} onChange={(e) => setTo(e.currentTarget.value)}>
          <option value="@all">@all</option>
          <For each={targets()}>{(s) => <option value={s.id}>{nameOfId(s.id)}</option>}</For>
        </select>
      </div>
      <div class="muted conv-forward-preview">{body()}</div>
      <Show when={err()}>
        <div style={{ color: "var(--eq-red)", "font-size": "11px" }}>{err()}</div>
      </Show>
      <div style={{ display: "flex", gap: "6px", "justify-content": "flex-end" }}>
        <button class="btn ghost" onClick={props.onClose}>
          {t("취소")}
        </button>
        <button class="btn primary" disabled={!wsId()} onClick={() => void send()}>
          {t("전달")}
        </button>
      </div>
    </div>
  );
}
