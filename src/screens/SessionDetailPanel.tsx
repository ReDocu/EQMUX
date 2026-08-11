// 세션 상세 (lefeD) — 상태·실행 플래그 원문·메모리(C11)·재개 근거를 정직하게 표시한다.
// 승인·거부는 여기서 제공하지 않는다 (G7) — 액션은 점프·재개·중지 3종.
import { Show } from "solid-js";
import { backend } from "../backend/mock";
import { jumpToSession } from "../state";
import { Eyebrow, KV, StatusLabel } from "../components/ui";
import type { Session } from "../types";
import { flagsToString, translatePermissions } from "../types";

export function SessionDetailPanel(props: { session: Session }) {
  const s = () => props.session;
  const persona = () => backend.listPersonas().find((p) => p.id === s().personaId);
  const job = () => backend.listJobs().find((j) => j.id === s().jobId);
  const mission = () => backend.listMissions().find((m) => m.id === s().missionId);
  const flags = () => {
    const j = job();
    return j ? flagsToString(translatePermissions(j.permissions), s().agentSessionId) : "—";
  };

  return (
    <div class="detail">
      <Eyebrow>SELECTED SESSION</Eyebrow>
      <div class="detail-head">
        <div>
          <div style={{ "font-size": "15px", "font-weight": 800 }}>
            {persona()?.name} · {job()?.name}
          </div>
          <div class="mono muted" style={{ "font-size": "11px" }}>
            <Show when={s().agentVersion} fallback="에이전트 미기동">
              Claude Code {s().agentVersion} · session {s().agentSessionId}…
            </Show>
          </div>
        </div>
        <StatusLabel session={s()} />
      </div>

      <Show when={s().status === "waiting"}>
        <div class="card inset waiting-card">
          <div class="mono st-waiting" style={{ "font-weight": 700 }}>
            승인 대기 — {s().waitingFor}
          </div>
          <div class="muted" style={{ "margin-top": "4px", "font-size": "11px" }}>
            승인·거부는 터미널 페인에서 수행합니다.
          </div>
        </div>
      </Show>

      <div class="card inset" style={{ padding: "4px 10px", "margin-top": "10px" }}>
        <KV k="상태" v={s().status} vClass={s().status === "waiting" ? "st-waiting" : ""} />
        <KV k="임무" v={mission()?.name ?? "미배정"} />
        <KV k="역할" v={`${persona()?.name ?? "—"} · ${job()?.name ?? "—"}`} />
        <KV k="서브에이전트" v={String(s().subagents)} />
        <KV
          k="메모리"
          v={
            s().memoryMb !== undefined
              ? `${s().memoryMb} MB · peak ${s().memoryPeakMb ?? "—"} MB`
              : "측정 불가"
          }
        />
        <KV k="스크롤백" v={`${(s().scrollbackLines / 1000).toFixed(1)}K lines`} />
        <KV
          k="재개"
          v={s().resumable ? `가능 · ${s().resumeReason ?? ""}` : `불가 · ${s().resumeReason ?? "transcript 없음"}`}
        />
        <Show when={s().pid}>
          <KV k="PID · 셸" v={`${s().pid} · ${s().shell}`} />
        </Show>
        <KV k="cwd" v={s().cwd} />
      </div>

      <div style={{ "margin-top": "10px" }}>
        <Eyebrow>실제 실행 플래그 (FR-D-41)</Eyebrow>
        <div class="card inset flags mono">{flags()}</div>
      </div>

      <Show when={s().restartNeeded}>
        <div class="card restart-card">
          <span class="mono st-waiting" style={{ "font-weight": 700 }}>
            권한 변경 감지 · 재시작 필요
          </span>
          <button
            class="btn"
            title="재개 기반 재시작 — 대화를 잃지 않는다 (FR-D-26)"
            onClick={() => backend.restartSession(s().id)}
          >
            대화 유지 재시작
          </button>
        </div>
      </Show>

      <div class="detail-actions">
        <button class="btn primary" onClick={() => jumpToSession(s().workspaceId, s().id)}>
          페인으로 점프
        </button>
        <button
          class="btn"
          disabled={!s().resumable || s().status !== "dead"}
          onClick={() => backend.resumeSession(s().id)}
        >
          재개
        </button>
        <button class="btn danger" disabled={s().status === "dead"} onClick={() => backend.stopSession(s().id)}>
          중지
        </button>
      </div>
    </div>
  );
}
