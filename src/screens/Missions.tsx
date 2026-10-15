// 임무 배정 (화면 #8 · 0.5 시안 jc2Fm) — 임무 목록 · 생성 · 세션 배정. 임무 = 브랜치 + 목표 (E12 — 연결하되 강제 아님).
// Tauri에서는 .eqmux/missions/*.md 실파일이 원본이다 (FR-E-51) — 화면은 브리지를 통해서만 쓴다.
import { createSignal, For, onMount, Show } from "solid-js";
import { backend } from "../backend/mock";
import {
  createMission,
  missionDoneReport,
  refreshMissions,
  setDefaultMission,
  setMissionStatus,
  toggleAssign,
} from "../backend/missions";
import { nameOf } from "../backend/conversation";
import { isTauri, revealPath } from "../backend/pty";
import { checkoutBranch } from "../backend/workspaces";
import { t, tf } from "../i18n";
import { setView, tick } from "../state";
import { Chip, ConfirmDialog, Eyebrow, Identity, notify, Segmented } from "../components/ui";
import { effectiveTitle, paneNo, sessionName } from "../types";
import type { Mission, MissionStatus } from "../types";

export function Missions(props: { wsId: string }) {
  onMount(() => void refreshMissions(props.wsId));
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);

  // 임무-브랜치 체크아웃 (FR-E-52) — 공유 repo 전체(E1′ 공유 기본)에 영향이 있어 2단 확인.
  // 워크트리 세션은 자기 브랜치를 따로 가지므로 영향받지 않는다.
  const [coConfirm, setCoConfirm] = createSignal<string | undefined>(undefined);
  const [coNote, setCoNote] = createSignal<{ id: string; text: string } | undefined>(undefined);
  const doCheckout = async (missionId: string, branch: string) => {
    if (coConfirm() !== missionId) {
      setCoConfirm(missionId);
      setCoNote(undefined);
      return;
    }
    setCoConfirm(undefined);
    if (!isTauri() || !ws()) {
      setCoNote({ id: missionId, text: t("브라우저 dev — 실제 체크아웃 없음") });
      return;
    }
    try {
      await checkoutBranch(ws()!.path, branch);
      setCoNote({ id: missionId, text: `⎇ ${branch} ${t("체크아웃 완료 — 공유 세션 전체에 적용됨")}` });
    } catch (err) {
      setCoNote({ id: missionId, text: `${t("체크아웃 실패")} — ${String(err)}` });
    }
  };
  const missions = () => {
    tick();
    return backend.listMissions().filter((m) => m.workspaceId === props.wsId);
  };
  const sessions = () => {
    tick();
    return backend.listSessions().filter((s) => s.workspaceId === props.wsId);
  };
  const persona = (id: string) => backend.listPersonas().find((p) => p.id === id);
  // 배정된 세션의 마지막 완료 보고(report --done) — 원장에서 찾는다. 페인을 열어 미확인이 지워져도
  // 임무 카드의 `검토 중으로`는 사람이 누를 때까지 남는다
  // 배정 뒤에 온 보고만 — 이전 임무의 보고가 새 임무에 뜨지 않게 (B92)
  const doneReport = (mission: Mission) => {
    tick();
    const m = missionDoneReport(backend.listMessages(), mission);
    return m ? { name: nameOf(m.from), text: m.body } : undefined;
  };
  // 배정은 이동이다 (U55) — 다른 임무에 있던 세션이면 옮기기 전에 묻는다
  const otherMission = (sid: string) => missions().find((x) => x.id !== sel()?.id && x.assigned.includes(sid));
  const [move, setMove] = createSignal<{ sid: string; from: string; to: Mission } | undefined>(undefined);
  const assign = (sid: string) => {
    const to = sel();
    if (!to) return;
    const from = !to.assigned.includes(sid) ? otherMission(sid) : undefined;
    if (from) setMove({ sid, from: from.name, to });
    else void toggleAssign(props.wsId, to.id, sid);
  };

  const [name, setName] = createSignal("");
  const [goal, setGoal] = createSignal("");
  const [branch, setBranch] = createSignal("");
  const [outputs, setOutputs] = createSignal("");

  const create = () => {
    if (!name().trim()) return;
    // 산출물 체크리스트 (C4) — 한 줄에 하나. 파일에 `- [ ]`로 남고, 체크는 파일의 `- [x]`가 원본이다
    const items = outputs().split("\n").map((s) => s.trim()).filter(Boolean);
    void createMission(props.wsId, name().trim(), goal().trim(), branch().trim() || undefined, items);
    setName("");
    setGoal("");
    setBranch("");
    setOutputs("");
  };

  // 0.5 시안 jc2Fm — 목록 | 편집 | 배정 세 칸. 고른 임무 하나를 가운데에 펼친다 (없으면 첫 임무)
  const [selId, setSelId] = createSignal<string | undefined>(undefined);
  const [creating, setCreating] = createSignal(false);
  const sel = () => missions().find((m) => m.id === selId()) ?? missions()[0];
  const assigneeNames = (m: Mission) =>
    m.assigned.length === 0 ? t("배정 없음") : m.assigned.map((id) => nameOf(id)).join(", ");
  const statusTone = (st: MissionStatus) => (st === "in-progress" || st === "in-review" ? "blue" : "info");

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>{t("임무 배정")} · {ws()?.name}</h1>
          <div class="sub">{t(".eqmux/missions/*.md 가 원본 · 배정하면 역할 파일 임무 블록에 반영 · 세션 클릭 = 배정 토글")}</div>
        </div>
        <div class="ma-head-r">
          <Chip text={t("자동 저장됨")} />
          <button class="btn ghost" onClick={() => setView({ kind: "workspace", id: props.wsId })}>
            {t("← 컨트롤 센터")}
          </button>
          <button class="btn primary" onClick={() => setCreating(true)}>
            {t("+ 새 임무")}
          </button>
        </div>
      </div>
      <div class="ma-cols">
        <div class="ma-list">
          <div class="ma-list-head">
            <span class="ma-list-t">{t("임무")}</span>
            <span class="ma-list-n mono">
              {missions().length} · in-progress {missions().filter((m) => m.status === "in-progress").length}
            </span>
          </div>
          <For each={missions()}>
            {(m) => (
              <button
                class="ma-item"
                classList={{ on: !creating() && sel()?.id === m.id }}
                onClick={() => (setSelId(m.id), setCreating(false))}
              >
                <span class="ma-item-top">
                  <span class="ma-item-nm">
                    {m.isDefault ? "★ " : ""}
                    {m.name}
                  </span>
                  <Chip tone={statusTone(m.status)} text={m.status.toUpperCase()} />
                </span>
                <span class="ma-item-meta">
                  {assigneeNames(m)}
                  <Show when={m.status === "in-progress" && doneReport(m)}> · {t("완료 보고")}</Show>
                </span>
              </button>
            )}
          </For>
          <Show when={missions().length === 0}>
            <div class="ma-empty muted">{t("임무가 없습니다 — + 새 임무로 만드세요")}</div>
          </Show>
        </div>

        <div class="ma-editor">
          <Show
            when={!creating() && sel()}
            fallback={
              <>
                <Eyebrow>{t("새 임무")}</Eyebrow>
                <input placeholder={t("임무 이름")} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
                <textarea rows={3} placeholder={t("목표 — 완료 조건을 측정 가능하게")} value={goal()} onInput={(e) => setGoal(e.currentTarget.value)} />
                <textarea
                  rows={3}
                  placeholder={t("산출물 — 한 줄에 하나 (선택)")}
                  value={outputs()}
                  onInput={(e) => setOutputs(e.currentTarget.value)}
                />
                <input
                  placeholder={t("브랜치 (선택)")}
                  class="mono"
                  value={branch()}
                  onInput={(e) => setBranch(e.currentTarget.value)}
                />
                <div class="ma-actions">
                  <Show when={missions().length > 0}>
                    <button class="btn" onClick={() => setCreating(false)}>
                      {t("취소")}
                    </button>
                  </Show>
                  <button class="btn primary" onClick={() => (create(), setCreating(false))} disabled={!name().trim()}>
                    {t("임무 생성")}
                  </button>
                </div>
                <div class="ma-hint muted">
                  {t("생성하면 .eqmux/missions/<id>.md 파일이 만들어지고 DB는 캐시로 따라갑니다. 불일치 시 파일이 이깁니다 (불변 규칙 4).")}
                </div>
              </>
            }
          >
            {(m) => (
              <>
                <div class="ma-scope mono">MISSION · {m().file}</div>
                <div class="ma-name-row">
                  <span class="ma-name">{m().name}</span>
                  {/* 기본 임무 (FR-E-56, M33) — 워크스페이스당 1개. 새 역할 세션이 자동 배정받는다 */}
                  <button
                    class="badge"
                    classList={{ amber: !!m().isDefault }}
                    style={{ cursor: "pointer" }}
                    title={t(
                      m().isDefault
                        ? "기본 임무 해제"
                        : "기본 임무로 지정 — 임무 없는 새 역할 세션이 자동 배정받습니다",
                    )}
                    onClick={() => void setDefaultMission(props.wsId, m().id, !m().isDefault)}
                  >
                    {m().isDefault ? t("★ 기본") : "☆"}
                  </button>
                  <span class="ma-grow" />
                  <Segmented
                    label={t("임무 상태")}
                    items={STATUS_ITEMS.map((v) => ({ value: v, label: v }))}
                    value={m().status}
                    onChange={(v) => void setMissionStatus(props.wsId, m().id, v)}
                  />
                </div>
                <div class="ma-field">
                  <div class="ma-label">{t("목표")}</div>
                  <div class="ma-box">{m().goal || <span class="muted">{t("목표 없음")}</span>}</div>
                </div>
                <div class="ma-field">
                  <div class="ma-label">{t("브랜치")}</div>
                  <div class="ma-box ma-branch mono">
                    <span>{m().branch ?? t("브랜치 미연결")}</span>
                    <Show when={m().branch}>
                      <button
                        class="btn ghost"
                        classList={{ danger: coConfirm() === m().id }}
                        title={t("공유 repo의 현재 브랜치를 바꿉니다 — 워크트리 세션은 영향 없음")}
                        onClick={() => void doCheckout(m().id, m().branch!)}
                      >
                        {t(coConfirm() === m().id ? "공유 repo 전환 확정?" : "⎇ 체크아웃")}
                      </button>
                    </Show>
                  </div>
                  <Show when={coNote()?.id === m().id}>
                    <div class="ma-hint mono muted">{coNote()!.text}</div>
                  </Show>
                </div>
                <Show when={m().outputs.length > 0}>
                  {/* 산출물 체크 (C4) — 파일의 `- [x]`를 그대로 보인다. 체크는 파일에서 한다 */}
                  <div class="ma-field">
                    <div class="ma-label">
                      {tf("산출물 · {done}/{total} 체크", {
                        done: m().outputs.filter((_, i) => m().outputsDone?.[i]).length,
                        total: m().outputs.length,
                      })}
                    </div>
                    <For each={m().outputs}>
                      {(o, i) => (
                        <div class="ma-check" classList={{ done: !!m().outputsDone?.[i()] }}>
                          <span class="ma-check-ic">{m().outputsDone?.[i()] ? "☑" : "☐"}</span>
                          {o}
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                {/* 완료 보고 (작업 완료 신호) — 배정된 세션이 report --done을 보냈다. 상태는 사람이
                    눌러야 in-review가 된다. 앱이 스스로 임무 상태를 바꾸지 않는다 */}
                <Show when={m().status === "in-progress" && doneReport(m())}>
                  {(d) => (
                    <div class="card inset mission-done">
                      <span class="badge blue">✓</span>
                      <span class="muted">
                        {t("완료 보고")} · {d().name}
                        <Show when={d().text}>: {d().text}</Show>
                      </span>
                    </div>
                  )}
                </Show>
                <div class="ma-actions">
                  <button
                    class="btn"
                    onClick={() => void revealPath(m().file, ws()?.path).then((ok) => ok || notify(t("파일을 열 수 없습니다")))}
                  >
                    {t("탐색기에서 열기")}
                  </button>
                  <Show when={m().status === "in-progress" && doneReport(m())}>
                    <button class="btn primary" onClick={() => void setMissionStatus(props.wsId, m().id, "in-review")}>
                      {t("검토 중으로")}
                    </button>
                  </Show>
                </div>
              </>
            )}
          </Show>
        </div>

        <div class="ma-assign">
          <div class="ma-assign-t">{t("세션 배정")}</div>
          <div class="ma-hint muted">
            {t("배정하면 역할 파일을 갱신하고 [EQ] 임무 배정 한 줄을 보냅니다. idle이면 바로, 작업 중이면 턴이 끝날 때. 세션의 임무는 하나라 배정하면 이전 임무에서 빠집니다.")}
          </div>
          <Show when={sel() && !creating()}>
            <For each={sessions()}>
              {(s) => {
                const on = () => !!sel()?.assigned.includes(s.id);
                const p = () => persona(s.personaId);
                return (
                  <button class="ma-assignee" classList={{ on: on() }} onClick={() => assign(s.id)}>
                    <Identity slot={s.slot} no={paneNo(s)} name={sessionName(s, p())} title={effectiveTitle(s, p())} />
                    <span class="ma-assignee-r">
                      <Show when={otherMission(s.id)}>
                        {(o) => <span class="muted ma-assignee-cur">{tf("현재: {name}", { name: o().name })}</span>}
                      </Show>
                      <span class={`exit-state mono ${ST_CLASS[s.status] ?? "muted"}`}>{s.status.toUpperCase()}</span>
                      <span class="ma-toggle">{on() ? "✓" : ""}</span>
                    </span>
                  </button>
                );
              }}
            </For>
            <Show when={sessions().some((s) => s.status === "dead")}>
              <div class="ma-hint muted">{t("죽은 세션은 배정해도 재개 전까지 메시지가 쌓입니다")}</div>
            </Show>
          </Show>
          <Show when={sessions().length === 0}>
            <span class="ma-hint muted">{t("세션 없음 — 캐스팅을 먼저 하세요")}</span>
          </Show>
        </div>
        <Show when={move()}>
          {(mv) => (
            <ConfirmDialog
              title={t("임무를 옮길까요?")}
              body={tf("{session}은(는) '{from}'에서 빠지고 '{to}'에 배정됩니다. 세션의 임무는 하나입니다.", {
                session: nameOf(mv().sid),
                from: mv().from,
                to: mv().to.name,
              })}
              confirmLabel={t("옮기기")}
              onConfirm={() => {
                const { sid, to } = mv();
                setMove(undefined);
                void toggleAssign(props.wsId, to.id, sid);
              }}
              onCancel={() => setMove(undefined)}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

const STATUS_ITEMS: MissionStatus[] = ["todo", "in-progress", "in-review", "done"];
const ST_CLASS: Record<string, string> = { busy: "st-busy", waiting: "st-waiting", dead: "st-dead" };
