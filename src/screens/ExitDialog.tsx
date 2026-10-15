// 종료 확인 (sYRf5 → 0.5 시안 mMpfq) — 실행 중 에이전트 목록 + 재개 가능 여부. 자동 재개하지 않는다 (FR-C-61 · C10).
// 종료를 누르면 실제 시퀀스가 돈다 (FR-C-62·63): 입력 차단(이 다이얼로그) → flush → 신호 → 유예 → 종료.
import { createResource, createSignal, For, onMount, Show } from "solid-js";
import { backend } from "../backend/mock";
import { isServerTermId, portEntries, serverTermId } from "../backend/ports";
import { isTauri, listAlivePty } from "../backend/pty";
import { performShutdown } from "../backend/shutdown";
import type { ShutdownPhase } from "../backend/shutdown";
import { Chip, Identity } from "../components/ui";
import { t, tf } from "../i18n";
import { setExitOpen } from "../state";
import { effectiveTitle, paneNo, sessionName } from "../types";

const PHASE_TEXT: Record<ShutdownPhase, string> = {
  flush: "저장소 flush 중…",
  "flush-late": "flush가 2초를 넘겼습니다 — 계속 진행합니다",
  closing: "정상 종료 신호 → 유예 후 프로세스 트리 종료…",
};

const STATE_CLASS: Record<string, string> = { busy: "st-busy", waiting: "st-waiting" };

export function ExitDialog() {
  const running = () => backend.listSessions().filter((s) => s.status !== "dead");
  // 서버 탭 PTY (BR-05) — 세션 목록 밖이라 따로 센다. 끄면 dev 서버도 함께 죽는다
  const [alive] = createResource(() => listAlivePty());
  const servers = () => (alive() ?? []).filter(isServerTermId).map((id) => id.slice(id.indexOf("@") + 1));
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  const ws = (id: string) => backend.listWorkspaces().find((w) => w.id === id);
  const agents = () => running().filter((s) => s.personaId).length;
  const total = () => running().length + servers().length;

  const [phase, setPhase] = createSignal<ShutdownPhase | undefined>(undefined);
  const busy = () => phase() !== undefined;

  const doExit = () => {
    if (!isTauri()) {
      setExitOpen(false); // 브라우저 dev — 실종료 없음
      return;
    }
    void performShutdown(setPhase); // 앱이 꺼지므로 반환되지 않는 것이 정상
  };

  // 기본 포커스는 취소 (§UX 기반 확인창 규칙) — Enter 한 번으로 앱 전체가 꺼지지 않게
  let cancelBtn!: HTMLButtonElement;
  onMount(() => cancelBtn.focus());

  return (
    <div class="overlay" onClick={() => !busy() && setExitOpen(false)}>
      <div class="dialog exit-dlg" onClick={(e) => e.stopPropagation()}>
        <div class="exit-head">
          <div>
            <div class="exit-title">{t("EQMUX를 종료할까요?")}</div>
            <div class="exit-sub">
              {total() === 0
                ? t("실행 중인 세션이 없습니다 — 바로 종료합니다.")
                : tf("실행 중 {n} — 에이전트 {a} · 기본 터미널 {d} · 서버 {s}. 자동 재개하지 않습니다.", {
                    n: total(),
                    a: agents(),
                    d: running().length - agents(),
                    s: servers().length,
                  })}
            </div>
          </div>
          <button class="exit-close" title={t("취소")} disabled={busy()} onClick={() => setExitOpen(false)}>
            ✕
          </button>
        </div>
        <div class="exit-notice">
          <span class="exit-notice-ic">⚠</span>
          <span classList={{ "st-waiting": busy() }}>
            {busy() ? t(PHASE_TEXT[phase()!]) : t("입력 차단 → 저장소 flush → 정상 종료 신호 → 유예 후 트리 종료 (Job Object)")}
          </span>
        </div>
        <Show when={total() > 0}>
          <div class="exit-list">
            <For each={running()}>
              {(s) => {
                const p = () => persona(s.personaId);
                return (
                  <div class="exit-row">
                    <Identity slot={s.slot} no={paneNo(s)} name={sessionName(s, p())} title={effectiveTitle(s, p())} />
                    <span class="exit-row-r">
                      <Show
                        when={s.status === "waiting"}
                        fallback={
                          <Chip
                            tone={s.resumable ? "blue" : "info"}
                            text={s.resumable ? t("재개 가능") : `${t("재개 불가")} · ${t(s.resumeReason ?? "transcript 없음")}`}
                          />
                        }
                      >
                        <Chip tone="amber" text={t("승인 대기 — 종료하면 거부로 끝남")} />
                      </Show>
                      <span class={`exit-state mono ${STATE_CLASS[s.status] ?? "muted"}`}>{s.status.toUpperCase()}</span>
                    </span>
                  </div>
                );
              }}
            </For>
            <For each={servers()}>
              {(wsId) => {
                // 그 셸에 귀속된 포트가 있을 때만 dev 서버라고 부른다 — 탭을 열기만 한 맨 셸은 "서버 셸"
                const ports = () => portEntries().filter((e) => e.session === serverTermId(wsId)).map((e) => `:${e.port}`);
                return (
                  <div class="exit-row server">
                    <span class="exit-server mono">
                      <span class="st-waiting">▶</span> {t(ports().length > 0 ? "서버" : "서버 셸")} · {ws(wsId)?.name}
                      <Show when={ports().length > 0}> · {ports().join(" ")}</Show>
                    </span>
                    <Show when={ports().length > 0} fallback={<Chip tone="info" text={t("셸만 열려 있습니다")} />}>
                      <Chip tone="amber" text={t("dev 서버도 종료됩니다")} />
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
        <div class="exit-actions">
          <button ref={cancelBtn} class="btn" disabled={busy()} onClick={() => setExitOpen(false)}>
            {t("취소")}
          </button>
          <button class="btn danger" disabled={busy()} onClick={doExit}>
            {busy() ? t("종료 중…") : t("모두 종료")}
          </button>
        </div>
      </div>
    </div>
  );
}
