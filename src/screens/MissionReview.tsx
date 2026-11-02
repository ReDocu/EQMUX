// 임무 검토 (0.6 §13-3) — 한 화면에 셋: ① 목표 · 산출물 · 완료 보고 ② base_commit → 지금(작업 트리 포함) diff
// ③ [테스트 실행]. 결정은 [승인](→ DONE) · [되돌려 보내기](review 메시지 + IN-PROGRESS)뿐이다.
// 커밋 · PR은 하지 않는다(G7) — 리드 세션이나 사람이 한다. 상태를 바꾸는 것은 사람의 버튼뿐이다.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { backend } from "../backend/mock";
import { nameOf } from "../backend/conversation";
import {
  missionDoneReport,
  missionTouchedFiles,
  refreshMissions,
  runReviewTest,
  sendBackMission,
  setMissionStatus,
} from "../backend/missions";
import type { TestRun } from "../backend/missions";
import { fsRead } from "../backend/panels";
import { COMMANDS_FILE, parseCommands } from "../backend/ports";
import type { SavedCommand } from "../backend/ports";
import { t, tf } from "../i18n";
import { defaultShell, openPanel, setView, tick } from "../state";
import type { View } from "../state";
import { Chip, ConfirmDialog, notify } from "../components/ui";
import { GitDiffEditor } from "./GitDiffEditor";

export function MissionReview(props: { wsId: string; missionId: string; back?: View }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  const m = () => {
    tick();
    return backend.listMissions().find((x) => x.workspaceId === props.wsId && x.id === props.missionId);
  };
  const report = () => {
    tick();
    const mm = m();
    return mm ? missionDoneReport(backend.listMessages(), mm) : undefined;
  };
  const close = () => setView(props.back ?? { kind: "workspace", id: props.wsId });

  // ② diff 필터 — 기본은 이 임무 담당 세션이 편집 도구로 고친 파일. 한 폴더를 같이 쓰므로 필터가 없으면 남의 변경이 섞인다
  const [touched, setTouched] = createSignal<string[] | undefined>(undefined);
  // ③ 저장 명령 중 kind "test" (C7). 없으면 버튼을 숨긴다
  const [tests, setTests] = createSignal<SavedCommand[]>([]);
  const [pick, setPick] = createSignal(0);
  const [testState, setTestState] = createSignal<"running" | TestRun | undefined>(undefined);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !sendBackOpen()) close();
  };
  onMount(() => {
    void refreshMissions(props.wsId);
    void missionTouchedFiles(props.wsId, props.missionId).then(setTouched);
    const path = ws()?.path;
    if (path) {
      void fsRead(path, COMMANDS_FILE).then(
        (c) => setTests(parseCommands(c.text).commands.filter((x) => x.kind === "test")),
        () => setTests([]),
      );
    }
    window.addEventListener("keydown", onKey);
  });
  onCleanup(() => window.removeEventListener("keydown", onKey));

  const runTest = async () => {
    const c = tests()[pick()];
    if (!c) return;
    setTestState("running");
    const r = await runReviewTest(props.wsId, c.run, defaultShell().cmd ?? defaultShell().label); // mac 로그인 셸은 cmd 없음 → posix
    setTestState(r);
    if (r === "no-shell") openPanel("server"); // 서버 셸이 떠야 칠 수 있다 — 탭을 열어 띄우게 한다
  };
  const testLabel = () => {
    const s = testState();
    if (s === undefined) return "";
    if (s === "running") return t("실행 중 — 서버 탭에서 출력을 볼 수 있습니다");
    if (s === "no-shell") return t("서버 탭 셸이 없습니다 — 서버 탭을 열었습니다. 셸이 뜬 뒤 다시 누르세요");
    if (s === "unsupported") return t("이 셸(cmd)에서는 종료 코드를 읽을 수 없습니다 — 서버 탭 출력으로 판단하세요");
    if (s === "timeout") return t("30분 동안 끝나지 않았습니다 — 서버 탭을 확인하세요");
    return s === 0 ? tf("종료 코드 {code} — 통과", { code: s }) : tf("종료 코드 {code} — 실패", { code: s });
  };

  const approve = async () => {
    const mm = m();
    if (!mm) return;
    await setMissionStatus(props.wsId, mm.id, "done"); // 선행 임무 알림(depends_on)은 이 경로에서 W3가 낸다
    close();
  };
  const [sendBackOpen, setSendBackOpen] = createSignal(false);
  const [note, setNote] = createSignal("");
  const sendBack = async () => {
    const mm = m();
    if (!mm || !note().trim()) return;
    setSendBackOpen(false);
    await sendBackMission(props.wsId, mm, note(), nameOf);
    notify(tf("{n}명에게 검토 의견을 보내고 진행 중으로 되돌렸습니다", { n: mm.assigned.length }));
    close();
  };

  return (
    <div class="screen">
      <Show when={m()} fallback={<div class="muted" style={{ padding: "24px" }}>{t("임무를 찾을 수 없습니다")}</div>}>
        {(mm) => (
          <>
            <div class="screen-head">
              <div>
                <h1>
                  {t("임무 검토")} · {mm().name}
                </h1>
                <div class="sub mono">
                  {mm().baseCommit
                    ? tf("시작 {sha} · 그 뒤 커밋 {n}개", { sha: mm().baseCommit!.slice(0, 7), n: mm().commitsSince ?? 0 })
                    : t("시작점 기록 없음 — 지금 작업 트리의 변경을 보입니다")}
                </div>
              </div>
              <div class="ma-head-r">
                <Chip text={mm().status.toUpperCase()} />
                <button class="btn ghost" onClick={close}>
                  {t("닫기")}
                </button>
                <button class="btn" disabled={mm().assigned.length === 0} onClick={() => setSendBackOpen(true)}>
                  {t("되돌려 보내기")}
                </button>
                <button class="btn primary" disabled={mm().status === "done"} onClick={() => void approve()}>
                  {t("승인")}
                </button>
              </div>
            </div>
            <div class="mrv-cols">
              {/* ① 목표 · 산출물 · 완료 보고 · 고친 파일 · 테스트 */}
              <div class="mrv-side">
                <div class="ma-field">
                  <div class="ma-label">{t("목표")}</div>
                  <div class="ma-box">{mm().goal || <span class="muted">{t("목표 없음")}</span>}</div>
                </div>
                <Show when={mm().outputs.length > 0}>
                  <div class="ma-field">
                    <div class="ma-label">{t("산출물")}</div>
                    <For each={mm().outputs}>
                      {(o, i) => (
                        <div class="ma-check" classList={{ done: !!mm().outputsDone?.[i()] }}>
                          <span class="ma-check-ic">{mm().outputsDone?.[i()] ? "☑" : "☐"}</span>
                          {o}
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <div class="ma-field">
                  <div class="ma-label">{t("완료 보고")}</div>
                  <Show when={report()} fallback={<div class="ma-box muted">{t("아직 완료 보고가 없습니다")}</div>}>
                    {(r) => (
                      <div class="ma-box">
                        <b>{nameOf(r().from)}</b> · {r().body}
                      </div>
                    )}
                  </Show>
                </div>
                <div class="ma-field">
                  <div class="ma-label">
                    {tf("담당 세션이 고친 파일 · {n}개", { n: touched()?.length ?? 0 })}
                    <span class="muted"> — {t("편집 도구로 고친 것만")}</span>
                  </div>
                  <Show when={touched()?.length} fallback={<div class="muted mrv-hint">{t("편집 기록이 없습니다 — 전체 변경을 보세요")}</div>}>
                    <div class="mrv-files mono">
                      <For each={touched()}>{(f) => <div>{f}</div>}</For>
                    </div>
                  </Show>
                </div>
                <Show when={tests().length > 0}>
                  <div class="ma-field">
                    <div class="ma-label">{t("테스트 실행 — 서버 탭 셸에서 돕니다")}</div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <Show when={tests().length > 1}>
                        <select value={pick()} onChange={(e) => setPick(Number(e.currentTarget.value))}>
                          <For each={tests()}>{(c, i) => <option value={i()}>{c.name}</option>}</For>
                        </select>
                      </Show>
                      <button class="btn" title={tests()[pick()]?.run} disabled={testState() === "running"} onClick={() => void runTest()}>
                        {tests().length > 1 ? t("테스트 실행") : `${t("테스트 실행")} · ${tests()[0].name}`}
                      </button>
                    </div>
                    <Show when={testLabel()}>
                      <div class="mrv-hint mono" classList={{ "st-waiting": typeof testState() === "number" && testState() !== 0 }}>
                        {testLabel()}
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
              {/* ② diff — base_commit 기준 · 담당 파일 필터는 W5의 GitDiffEditor base/only가 들어오면 붙인다.
                  그 전에는 HEAD ↔ 작업 트리 전체를 보인다 */}
              <div class="mrv-diff">
                <GitDiffEditor wsId={props.wsId} />
              </div>
            </div>
            <Show when={sendBackOpen()}>
              <ConfirmDialog
                title={t("되돌려 보낼까요?")}
                body={
                  <textarea
                    rows={4}
                    style={{ width: "100%" }}
                    placeholder={t("고칠 점 — 담당 세션에게 review 메시지로 갑니다")}
                    value={note()}
                    onInput={(e) => setNote(e.currentTarget.value)}
                  />
                }
                info={[tf("받는 세션: {names}", { names: mm().assigned.map(nameOf).join(", ") }), t("임무는 진행 중으로 돌아갑니다")]}
                confirmLabel={t("보내기")}
                onConfirm={() => void sendBack()}
                onCancel={() => setSendBackOpen(false)}
              />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
