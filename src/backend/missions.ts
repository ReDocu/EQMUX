// 임무 파일 브리지 (PRD E §4.6) — .eqmux/missions/*.md가 원본, UI는 하이드레이트만 한다.
// 배정의 원본은 역할 파일의 임무 블록 (FR-E-58) — 토글은 mission_assign으로 파일을 고치고
// 목록을 다시 실측한다 (FR-E-59). 브라우저 dev에서는 기존 목 동작으로 폴백한다.
import { invoke } from "@tauri-apps/api/core";
import { createSignal, onCleanup, onMount } from "solid-js";
import { backend } from "./mock";
import { cancelBrief, injectLine, queueBrief, sendConversation } from "./conversation";
import { isTauri, listAlivePty, onPtyOutput, writePty } from "./pty";
import { serverTermId } from "./ports";
import { exitMarkerSuffix, findExitCode, isPowerShell } from "../screens/reviewRules";
import { canInject } from "../types";
import type { ConversationMessage, Mission, MissionStatus } from "../types";
import { notify } from "../components/ui";
import { t, tf } from "../i18n";
import { dict as missionsDict } from "../i18n/missions";

interface MissionFile {
  id: string;
  name: string;
  status: MissionStatus;
  branch: string | null;
  goal: string;
  outputs: string[];
  outputsDone: boolean[]; // 산출물 체크 (C4)
  file: string;
  assigned: string[];
  isDefault: boolean; // 기본 임무 (FR-E-56)
  assignedAt?: Record<string, number>; // 배정 시각 (B92) — 세션 id → epoch ms, 임무 파일 frontmatter
  baseCommit: string | null; // 임무 시작점 (§13-2)
  commitsSince: number | null;
  dependsOn: string[]; // 선행 임무 (§4)
}

function wsPath(wsId: string): string | undefined {
  const ws = backend.listWorkspaces().find((w) => w.id === wsId);
  return ws && !ws.pathMissing ? ws.path : undefined;
}

/** 임무 파일 실측 → 목 목록 교체. 파일과 UI가 충돌하면 파일이 이긴다 (FR-E-74) */
export async function refreshMissions(wsId: string): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) return;
  const list = await invoke<MissionFile[]>("mission_list", { wsPath: path }).catch(
    () => undefined,
  );
  if (list) {
    // 배정 시각은 파일이 원본 (B92) — 재시작 뒤에도 완료 보고를 같은 기준으로 가른다
    for (const m of list) {
      for (const [sid, ms] of Object.entries(m.assignedAt ?? {})) assignedAt.set(atKey(wsId, m.id, sid), ms);
    }
    backend.hydrateMissions(
      wsId,
      list.map((m) => ({
        ...m,
        branch: m.branch ?? undefined,
        baseCommit: m.baseCommit ?? undefined,
        commitsSince: m.commitsSince ?? undefined,
        workspaceId: wsId,
      })),
    );
  }
}

export async function createMission(
  wsId: string,
  name: string,
  goal: string,
  branch?: string,
  outputs: string[] = [],
): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) {
    backend.createMission(wsId, name, goal, branch);
    return;
  }
  await invoke("mission_create", { wsPath: path, name, goal, branch: branch ?? null, outputs }).catch(failed);
  await refreshMissions(wsId);
}

const ORDER: MissionStatus[] = ["todo", "in-progress", "in-review", "done"];

export async function cycleMissionStatus(wsId: string, missionId: string): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) {
    backend.cycleMissionStatus(missionId);
    return;
  }
  const m = backend.listMissions().find((x) => x.id === missionId && x.workspaceId === wsId);
  if (!m) return;
  const next = ORDER[(ORDER.indexOf(m.status) + 1) % ORDER.length];
  await setMissionStatus(wsId, missionId, next);
}

/** 상태를 정해서 바꾼다 — 완료 보고를 본 사람이 누르는 `검토 중으로`가 쓴다. 앱이 스스로 부르지 않는다 */
export async function setMissionStatus(wsId: string, missionId: string, status: MissionStatus): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) {
    const m = backend.listMissions().find((x) => x.id === missionId);
    while (m && m.status !== status) backend.cycleMissionStatus(missionId);
    return;
  }
  const ok = await invoke("mission_set_status", { wsPath: path, id: missionId, status }).then(
    () => true,
    (e) => (failed(e), false),
  );
  await refreshMissions(wsId);
  // 산출물 체크리스트 (C4) — 미체크가 남아도 막지 않고 알리기만 한다. 판단은 사람 몫
  const m = backend.listMissions().find((x) => x.id === missionId && x.workspaceId === wsId);
  const msg = ok ? outputsNotice(status, m?.outputs.filter((_, i) => !m.outputsDone?.[i]).length ?? 0) : undefined;
  if (msg) notify(msg);
  if (ok && status === "done") {
    for (const x of unlockedOrphans(missionId, backend.listMissions().filter((y) => y.workspaceId === wsId)))
      notify(tf("'{name}'의 선행 임무가 모두 끝났습니다 — 담당 세션이 없어 아무도 시작하지 않습니다", { name: x.name }));
  }
}

/** 미체크 산출물 안내 — 검토 중으로 옮길 때와 끝낼 때([승인] 포함, B188). 없으면 undefined */
export function outputsNotice(status: MissionStatus, open: number): string | undefined {
  if (open <= 0) return undefined;
  if (status === "in-review") return tf("산출물 {n}개가 아직 체크되지 않았습니다 — 검토 중으로 옮겼습니다", { n: open });
  if (status === "done") return tf("산출물 {n}개가 체크되지 않은 채 끝났습니다 — 임무 파일에서 확인하세요", { n: open });
  return undefined;
}

/** 임무 상태 표시 이름 (U136) — 파일 값(todo · in-progress …)은 그대로 두고 화면에만 쓴다 */
export const missionStatusText = (st: MissionStatus): string =>
  t(({ todo: "할 일", "in-progress": "진행 중", "in-review": "검토 중", done: "끝남" } as const)[st] ?? st);

/** 임무 쓰기 실패 (BR-12) — 조용히 삼키면 버튼이 안 먹는 것으로 읽힌다 */
function failed(e: unknown): void {
  notify(tf("임무 저장 실패 — {err}", { err: String(e) }));
}

/** 배정 토글 (FR-E-53·54) — 역할 파일의 임무 블록을 고치고 실측으로 되읽는다 */
export async function toggleAssign(
  wsId: string,
  missionId: string,
  sessionId: string,
): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) {
    if (!backend.listMissions().find((x) => x.id === missionId)?.assigned.includes(sessionId)) {
      assignedAt.set(atKey(wsId, missionId, sessionId), Date.now());
    }
    backend.toggleAssign(missionId, sessionId);
    return;
  }
  const m = backend.listMissions().find((x) => x.id === missionId && x.workspaceId === wsId);
  if (!m) return;
  const wasAssigned = m.assigned.includes(sessionId);
  const movedFrom = wasAssigned
    ? []
    : backend.listMissions().filter((x) => x.workspaceId === wsId && x.id !== missionId && x.assigned.includes(sessionId));
  // 역할 파일과 같은 cwd 규약 (FR-E-63 · B59) — repo 루트에 쓰면 워크트리 세션은 에이전트가
  // 읽는 파일이 아니라 루트의 반쪽 스텁에 임무가 들어가고, 화면만 ✓가 붙는다.
  // 임무 파일은 repo 루트에서 읽는다 (B277) — 워크트리에는 커밋 전 임무가 없다
  const sess = backend.listSessions().find((x) => x.id === sessionId);
  const ok = await invoke("mission_assign", {
    wsPath: sess?.cwd || path,
    root: path,
    session: sessionId,
    missionId: wasAssigned ? null : missionId,
  }).then(
    () => true,
    (e) => (failed(e), false),
  );
  // 쓰기가 실패하면 배정 시각 · 브리프로 가지 않는다 (B278) — 에이전트만 임무를 안다고 믿게 된다
  if (!ok) return;
  if (!wasAssigned) assignedAt.set(atKey(wsId, missionId, sessionId), Date.now());
  // 배정 시각 (B92) — repo 루트의 임무 파일에 남긴다(워크트리 세션도 같은 파일). 옮겨 온 임무의 항목은 지운다.
  // 실패해도 배정은 이미 됐다 — 그때는 시각을 몰라 예전처럼 모든 보고를 본다
  const mark = (id: string, assigned: boolean) =>
    invoke("mission_mark_assigned", { wsPath: path, id, session: sessionId, assigned }).catch(() => {});
  await Promise.all([mark(missionId, !wasAssigned), ...movedFrom.map((x) => mark(x.id, false))]);
  await refreshMissions(wsId);
  if (wasAssigned) cancelBrief(sessionId); // 해제된 임무의 브리프가 턴 끝에 늦게 들어가지 않게
  else sendBrief(sessionId, m);
}

/** 배정 시각 (B92) — 완료 보고를 이 임무 것으로 한정한다. 키 `워크스페이스|임무|세션`.
 *  원본은 임무 파일 frontmatter `assigned_at`이고, 배정 직후 파일을 되읽기 전에는 여기 값이 먼저 쓰인다.
 *  이 기록이 생기기 전(0.5.0)의 배정은 시각을 몰라 예전처럼 모든 보고를 본다 */
const assignedAt = new Map<string, number>();
const atKey = (wsId: string, missionId: string, sid: string) => `${wsId}|${missionId}|${sid}`;

/** 이 임무의 마지막 완료 보고 (B92) — 배정된 세션이 배정 뒤에 보낸 report --done만 센다.
 *  예전에는 이전 임무의 보고가 새 임무에 바로 '완료 보고'·[검토 중으로]로 떴다.
 *  [되돌려 보내기] 뒤에는 그 의견보다 나중 보고만 센다 (B172) — 배정 시각은 '고친 파일'의 시작점이라 다시 찍지 않는다 */
export function missionDoneReport(
  msgs: readonly ConversationMessage[],
  m: Pick<Mission, "id" | "workspaceId" | "assigned"> & { name?: string },
  since = (sid: string) => assignedAt.get(atKey(m.workspaceId, m.id, sid)),
): ConversationMessage | undefined {
  // 보낼 때의 언어가 지금과 다를 수 있다 (U123) — 한 · 영 머리 둘 다 본다
  const heads = m.name === undefined ? [] : [SEND_BACK_HEAD, missionsDict[SEND_BACK_HEAD]].map((h) => h.replaceAll("{name}", m.name!));
  const backAt = (sid: string) =>
    Math.max(0, ...msgs.filter((x) => x.from === "나" && x.type === "review" && x.to === sid && heads.some((h) => x.body.startsWith(h))).map((x) => x.ts ?? 0));
  const done = msgs.filter(
    (x) =>
      x.done &&
      x.workspaceId === m.workspaceId &&
      m.assigned.includes(x.from) &&
      (x.ts ?? 0) >= (since(x.from) ?? 0) &&
      (x.ts ?? 0) > backAt(x.from),
  );
  return done[done.length - 1]; // .at(-1)은 Safari 15.4 미만에 없다 (B329)
}

/** [되돌려 보내기] 의견의 머리 — missionDoneReport가 이것으로 되돌린 시각을 찾는다. 화면 언어를 따른다 (U123) */
const SEND_BACK_HEAD = "임무 '{name}' 검토 의견 — ";
const sendBackHead = (name: string) => tf(SEND_BACK_HEAD, { name });

/** 배정 브리프 (FR-E-55) — 지금 받을 수 있으면 바로, 아니면(작업 중·승인 대기·셸·종료) 다음 idle
 *  전이(턴 끝·기동·재개)에 넣는다 (B93 — 예전에는 흘려서 화면 약속과 반대였다).
 *  판정은 canInject 하나로 한다 (P-2 · G7) — 예전 가드(agentSessionId)는 지워지지 않는
 *  과거 기록이라 셸로 돌아온 페인에 브리프를 명령으로 실행시켰다. */
function sendBrief(sessionId: string, m: Mission): void {
  const s = backend.listSessions().find((x) => x.id === sessionId);
  if (!s?.personaId) return;
  const goal = m.goal ? ` — ${m.goal}` : "";
  // `[EQ]` 머리는 에이전트가 알아보는 표식이라 번역하지 않는다 (U123)
  const line = `[EQ] ${tf("임무 배정: {name}{goal} · 정의 {file}", { name: m.name, goal, file: m.file })}${depsNote(m)}`;
  if (canInject(s)) injectLine(sessionId, line); // 2단계 제출 (B94)
  else queueBrief(sessionId, line);
}

/** 아직 끝나지 않은 선행 임무 (P60) — 목록에 없는 id는 빼고(지워진 선행이 영영 남지 않게) 이름과 상태를 돌려준다 */
export function openDeps(m: Pick<Mission, "dependsOn">, all: readonly Mission[]): Mission[] {
  return (m.dependsOn ?? []).flatMap((id) => all.filter((x) => x.id === id && x.status !== "done"));
}

/** 브리프 꼬리 (P60) — 선행이 남았으면 에이전트가 곧바로 시작하지 않게 알린다 */
function depsNote(m: Mission): string {
  const left = openDeps(m, backend.listMissions().filter((x) => x.workspaceId === m.workspaceId));
  return left.length
    ? ` · ${tf("선행: {deps} — 끝나면 알림이 옵니다", { deps: left.map((x) => `${x.name}(${missionStatusText(x.status)})`).join(", ") })}`
    : "";
}

/** 선행 임무 지정 (P60) — 파일 frontmatter depends_on을 고치고 다시 읽는다 */
export async function setMissionDepends(wsId: string, missionId: string, deps: string[]): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) {
    // 목 경로도 방송한다 (B270) — 예전에는 배열만 고쳐 브라우저 dev 화면이 바뀌지 않았다. 실모드의 재실측과 같은 길
    const list = backend.listMissions().filter((x) => x.workspaceId === wsId);
    backend.hydrateMissions(wsId, list.map((x) => (x.id === missionId ? { ...x, dependsOn: deps } : x)));
    return;
  }
  await invoke("mission_set_depends", { wsPath: path, id: missionId, deps }).catch(failed);
  await refreshMissions(wsId);
}

/** 선행이 모두 끝났는데 담당이 없는 후행 임무 (P60) — Rust 알림은 배정 세션에게만 가므로 사람에게 알릴 것 */
export function unlockedOrphans(doneId: string, all: readonly Mission[]): Mission[] {
  return all.filter((m) => m.status !== "done" && m.assigned.length === 0 && (m.dependsOn ?? []).includes(doneId) && openDeps(m, all).length === 0);
}

/** [브리프 전달] 때 임무 시작점을 지금 HEAD로 (§13-2) — 배정 때는 mission_mark_assigned가 처음 한 번 적는다 */
export async function markMissionBase(wsId: string, missionId: string): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) return;
  await invoke("mission_mark_base", { wsPath: path, id: missionId }).catch(failed);
  await refreshMissions(wsId);
}

/** 기본 임무 지정·해제 (FR-E-56, M33) — frontmatter default: true, 워크스페이스당 1개 */
export async function setDefaultMission(wsId: string, missionId: string, on: boolean): Promise<void> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) return;
  await invoke("mission_set_default", { wsPath: path, id: missionId, on }).catch(failed);
  await refreshMissions(wsId);
}

/** 임무 없는 세션의 기본 임무 자동 배정 (FR-E-56) — 세션 생성·역할 부여 시점에 부른다.
 *  수동 해제와 싸우지 않도록 여기 말고는 자동 경로가 없다 (배정 화면 재실측이 재배정하지 않는다). */
export async function autoAssignDefault(wsId: string, sessionId: string): Promise<void> {
  if (!isTauri() || !wsPath(wsId)) return;
  await refreshMissions(wsId); // 파일 실측 — 기본 임무·기존 배정을 최신으로
  const s = backend.listSessions().find((x) => x.id === sessionId);
  if (!s?.personaId || s.missionId) return;
  const def = backend
    .listMissions()
    .find((m) => m.workspaceId === wsId && m.isDefault && m.status !== "done");
  if (def) await toggleAssign(wsId, def.id, sessionId); // 같은 경로 — 임무 블록 + 브리프
}

// ── 임무 검토 (0.6 §13-3) — 화면은 screens/MissionReview.tsx. 상태를 바꾸는 것은 사람의 버튼뿐이다 ──

/** 이 임무 담당 세션들이 배정 뒤 편집 도구로 고친 파일 (C4 file_touch) — 저장소 기준 상대 경로 */
export async function missionTouchedFiles(wsId: string, missionId: string): Promise<string[] | undefined> {
  const path = wsPath(wsId);
  if (!isTauri() || !path) return undefined;
  return invoke<string[]>("mission_touched_files", { wsId, wsPath: path, id: missionId }).catch(() => undefined);
}

export type TestRun = number | "no-shell" | "unsupported" | "timeout";

/** [테스트 실행] — 서버 탭 셸에 명령 + 종료 표식을 치고, 출력에서 표식을 찾아 종료 코드를 돌려준다.
 *  서버 셸이 안 떠 있으면 "no-shell"(화면이 서버 탭을 연다), 표식을 못 붙이는 셸(cmd)은 "unsupported".
 *  shellCmd는 서버 PTY가 실제로 뜬 셸이다 (B276 — 누르는 순간의 기본 셸 설정이 아니다). 모르면 "unsupported".
 *  ponytail: 30분 넘게 표식이 없으면 "timeout" — 셸은 그대로 두고 기다리기만 그만둔다 */
export async function runReviewTest(wsId: string, run: string, shellCmd: string | undefined): Promise<TestRun> {
  const id = serverTermId(wsId);
  if (!(await listAlivePty()).includes(id)) return "no-shell";
  const tag = Date.now().toString(36); // 실행마다 다른 꼬리표 — 같은 셸의 앞 실행 표식과 섞이지 않게
  const suffix = shellCmd && exitMarkerSuffix(shellCmd, tag);
  if (!suffix) return "unsupported";
  const pwsh = isPowerShell(shellCmd);
  return new Promise((resolve) => {
    let buf = "";
    const off = onPtyOutput(id, (d) => {
      buf = (buf + d).slice(-8000);
      const code = findExitCode(buf, tag, pwsh);
      if (code === undefined) return;
      off();
      clearTimeout(timer);
      resolve(code);
    });
    const timer = setTimeout(() => (off(), resolve("timeout")), 30 * 60_000);
    writePty(id, `${run}${suffix}\r`);
  });
}

/** [되돌려 보내기] — 의견을 담당 세션(to, 기본은 모두)에게 review로 보내고 IN-PROGRESS로 되돌린다.
 *  수신자는 세션 id다 (B169) — `@이름` 문자열은 원장에서 어느 세션에도 맞지 않아 아무에게도 닿지 않았다.
 *  받은 세션과 못 받은 세션을 나눠 돌려준다 (B255) — 화면이 누가 받았는지 보이고, 다시 보내기는 못 받은 쪽에만 간다.
 *  하나라도 못 받았으면 상태를 바꾸지 않는다 */
export async function sendBackMission(
  wsId: string,
  m: Mission,
  note: string,
  to: readonly string[] = m.assigned,
): Promise<{ sent: string[]; failed: { sid: string; err: string }[] }> {
  const body = `${sendBackHead(m.name)}${note.trim()}`;
  const rs = await Promise.allSettled(to.map((sid) => sendConversation(wsId, sid, "review", body)));
  const sent: string[] = [];
  const failed: { sid: string; err: string }[] = [];
  rs.forEach((r, i) => {
    const err = r.status === "rejected" ? String(r.reason) : r.value;
    if (err) failed.push({ sid: to[i], err });
    else sent.push(to[i]);
  });
  if (!failed.length) await setMissionStatus(wsId, m.id, "in-progress");
  return { sent, failed };
}

/** 임무별 비용 (§13-6 · W2 cost_summary) — 임무 id → USD, 보존 기간(30일) 전체. 임무 밖 비용(null)은 뺀다 */
export async function missionCosts(wsId: string): Promise<Record<string, number>> {
  if (!isTauri()) return {};
  const rows = await invoke<{ mission: string | null; usd: number }[]>("cost_summary", { workspace: wsId, sinceMs: 0 }).catch(() => []);
  return Object.fromEntries(rows.filter((r) => r.mission).map((r) => [r.mission!, r.usd]));
}

/** 화면이 떠 있는 동안 임무별 비용 — W2 배정 캐시가 60초라 그보다 자주 읽을 까닭이 없다 */
export function missionCostSignal(wsId: () => string): () => Record<string, number> {
  const [costs, setCosts] = createSignal<Record<string, number>>({});
  const load = () => void missionCosts(wsId()).then(setCosts);
  onMount(load);
  const timer = setInterval(load, 60_000);
  onCleanup(() => clearInterval(timer));
  return costs;
}

export const fmtUsd = (usd: number) => `$${usd.toFixed(2)}`;
