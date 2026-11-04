// 과거 세션 검색 · 재개 (0.6 §4 · W3) — 이 워크스페이스에서 돈 Claude Code 대화를 찾는다.
// 읽기만 한다. 재개는 새 경로를 만들지 않는다 — 슬롯의 마지막 대화면 기존 재개(resumeAgent)를,
// 그 밖의 대화(슬롯의 옛 대화 · 앱 밖 대화)는 `claude --resume <id>` 명령 복사만 준다.
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { resumeAgent } from "../backend/agent";
import { groupByConversation, historySearch, resumeCommand } from "../backend/history";
import type { HistoryGroup, HistoryHit } from "../backend/history";
import { backend } from "../backend/mock";
import { clipWriteText, isTauri } from "../backend/pty";
import { Icon } from "../components/icons";
import { sessionTermSize } from "../components/TerminalPane";
import { notify } from "../components/ui";
import { t, tErr, tf } from "../i18n";
import { defaultShell, jumpToSession, scopeWorkspace, setView, tick, view } from "../state";
import type { View } from "../state";
import type { Session } from "../types";
import { cliOf, sessionDisplayName, sessionName } from "../types";

export function HistorySearch(props: { wsId?: string }) {
  const ws = () => {
    tick();
    const byProp = props.wsId ? backend.listWorkspaces().find((w) => w.id === props.wsId) : undefined;
    const w = byProp ?? scopeWorkspace();
    return w && !w.pathMissing ? w : undefined;
  };
  const [query, setQuery] = createSignal("");
  const [hits, setHits] = createSignal<HistoryHit[] | undefined>();
  const [busy, setBusy] = createSignal(false);
  // 검색 실패 사유 (B186) — 결과 0건과 가른다
  const [err, setErr] = createSignal<string | undefined>();
  // 열지 못한 대화 파일 수 (B252) — 결과가 일부일 때 알린다
  const [unreadable, setUnreadable] = createSignal(0);
  let input: HTMLInputElement | undefined;
  const groups = createMemo(() => groupByConversation(hits() ?? []));

  const submit = async () => {
    const w = ws();
    const q = query().trim();
    if (!w || !q || busy()) return;
    setBusy(true);
    setErr(undefined);
    setUnreadable(0);
    try {
      const r = await historySearch(w.id, w.path, q);
      setHits(r.hits);
      setUnreadable(r.unreadable);
    } catch (e) {
      setHits(undefined);
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const slot = (g: HistoryGroup): Session | undefined => {
    tick();
    return g.session ? backend.listSessions().find((s) => s.id === g.session) : undefined;
  };
  const slotName = (s: Session) =>
    sessionDisplayName(s, backend.listPersonas().find((p) => p.id === s.personaId)?.name ?? s.personaId);

  // 대시보드 재개(P1)와 같은 경로 — 꺼진 슬롯의 마지막 대화만 여기로 온다
  const resume = async (s: Session) => {
    if (isTauri() && s.personaId) {
      const p = s.permOverride ?? backend.listJobs().find((j) => j.id === s.jobId)?.permissions;
      if (!p) return notify(t("직무 권한을 찾을 수 없습니다 — 역할을 다시 지정하세요"));
      const size = sessionTermSize(s.id);
      const persona = backend.listPersonas().find((x) => x.id === s.personaId);
      try {
        await resumeAgent(s.id, s.workspaceId, s.cwd, sessionName(s, persona), p, size.cols, size.rows, cliOf(s));
      } catch (err) {
        return notify(`${t("재개 실패")} — ${tErr(err)}`);
      }
    }
    backend.resumeSession(s.id);
    jumpToSession(s.workspaceId, s.id);
  };
  // 워크트리 세션 대화는 그 워크트리 폴더에서만 --resume이 찾는다 (S24)
  const copyResume = async (g: HistoryGroup) => {
    const w = ws();
    if (!w) return;
    const path = g.worktree ?? w.path;
    // 클립보드 쓰기가 실패하면 성공 토스트를 띄우지 않는다 (B262) · 기본 셸이 cmd면 cmd 문법으로 (B259)
    if (await clipWriteText(resumeCommand(g.uuid, path, defaultShell().label)))
      notify(tf("복사했습니다 — 터미널에 붙여 넣으면 {path}로 옮겨 재개합니다", { path }), "ok");
    else notify(t("복사하지 못했습니다"));
  };

  const close = () => {
    const v = view();
    setView((v.kind === "history" ? v.back : undefined) ?? ({ kind: "control" } as View));
  };
  onMount(() => {
    // autofocus 속성은 SPA에서 새로 붙은 요소에 듣지 않는다 (B245) — 팔레트로 열어도 바로 칠 수 있게
    input?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.matches?.("input, textarea, select")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const when = (ts: number) => new Date(ts).toLocaleString();

  return (
    <div class="screen hs">
      <div class="gx-toolbar">
        <span class="gx-title">
          <Icon name="messages-square" size={14} /> {t("과거 세션 검색")} · {ws()?.name ?? "—"}
        </span>
        <input
          class="panel-search mono hs-input"
          placeholder={t("찾을 말…")}
          title={t("이 워크스페이스에서 돈 Claude Code 대화에서 찾습니다 (Enter)")}
          value={query()}
          disabled={!ws()}
          ref={input}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.isComposing) void submit();
            else if (e.key === "Escape") query() ? setQuery("") : close();
          }}
        />
        <button class="btn" disabled={!ws() || !query().trim() || busy()} onClick={() => void submit()}>
          {busy() ? t("찾는 중…") : t("찾기")}
        </button>
        <span style={{ flex: 1 }} />
        <Show when={hits()?.length}>
          <span class="muted mono">{tf("대화 {n}개 · 줄 {m}개", { n: groups().length, m: hits()!.length })}</span>
        </Show>
        <button class="btn ghost" title={t("닫기 (Esc)")} aria-label={t("닫기 (Esc)")} onClick={close}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <div class="hs-body">
        <Show when={ws()} fallback={<p class="muted hs-empty">{t("워크스페이스를 고르세요")}</p>}>
          <Show when={err()}>
            <p class="hs-empty st-dead">
              {tf("검색하지 못했습니다 — {err}", { err: err()! })}{" "}
              <button class="btn ghost" onClick={() => void submit()}>
                {t("다시 시도")}
              </button>
            </p>
          </Show>
          <Show when={unreadable()}>
            <p class="muted hs-empty">{tf("일부 기록을 읽지 못했습니다 — 대화 파일 {n}개", { n: unreadable() })}</p>
          </Show>
          <Show when={hits() && !groups().length}>
            <p class="muted hs-empty">{t("맞는 대화가 없습니다")}</p>
          </Show>
          <For each={groups()}>
            {(g) => (
              <section class="hs-conv">
                <div class="hs-conv-head">
                  <strong>{slot(g) ? slotName(slot(g)!) : t("앱 밖 · 옛 대화")}</strong>
                  <Show when={g.worktree}>
                    {(wt) => (
                      <span class="muted mono" title={wt()}>
                        {t("워크트리 세션")} · {wt().split(/[\\/]/).pop()}
                      </span>
                    )}
                  </Show>
                  <span class="muted mono">
                    {g.uuid.slice(0, 8)} · {when(g.last)}
                  </span>
                  <span style={{ flex: 1 }} />
                  <Show
                    when={slot(g) && g.resumable}
                    fallback={
                      <button
                        class="btn ghost"
                        title={t("슬롯의 마지막 대화가 아니라 앱에서 재개할 수 없습니다 — 명령을 복사해 터미널에서 이어 가세요")}
                        onClick={() => void copyResume(g)}
                      >
                        <Icon name="copy" size={12} /> {t("재개 명령 복사")}
                      </button>
                    }
                  >
                    <Show
                      when={slot(g)!.status === "dead"}
                      fallback={
                        <button class="btn ghost" onClick={() => jumpToSession(slot(g)!.workspaceId, slot(g)!.id)}>
                          {t("세션으로 가기")}
                        </button>
                      }
                    >
                      <button class="btn" onClick={() => void resume(slot(g)!)}>
                        <Icon name="rotate-cw" size={12} /> {t("재개")}
                      </button>
                    </Show>
                  </Show>
                </div>
                <For each={g.hits}>
                  {(h) => (
                    <div class="hs-hit">
                      <span class="mono muted hs-when">{new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <span class="hs-role" classList={{ agent: h.role === "agent" }}>
                        {h.role === "agent" ? t("에이전트") : t("사람")}
                      </span>
                      <span class="hs-snippet">{h.snippet}</span>
                    </div>
                  )}
                </For>
              </section>
            )}
          </For>
          <p class="muted hs-note">{t("Codex 대화는 아직 찾지 않습니다 — 워크트리 세션 대화는 함께 찾습니다")}</p>
        </Show>
      </div>
    </div>
  );
}
