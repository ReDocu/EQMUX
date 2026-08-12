// 세션 상세 (lefeD) — 상태·실행 플래그 원문·메모리(C11)·재개 근거를 정직하게 표시한다.
// 승인·거부는 여기서 제공하지 않는다 (G7) — 액션은 점프·재개·중지 3종 + 역할 변경.
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { restartAgent, resumeAgent } from "../backend/agent";
import { backend } from "../backend/mock";
import { isTauri, openLogDir } from "../backend/pty";
import { sessionTermSize } from "../components/TerminalPane";
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

  // 역할 부여/변경/해제 — 직무(권한) 변경은 재시작 필요(E11′)로 이어진다
  const availablePersonas = () => {
    const used = new Set(
      backend
        .listSessions()
        .filter((x) => x.workspaceId === s().workspaceId && x.id !== s().id)
        .map((x) => x.personaId),
    );
    return backend.listPersonas().filter((p) => !used.has(p.id));
  };
  const [pendPersona, setPendPersona] = createSignal(s().personaId);
  const [pendJob, setPendJob] = createSignal(s().jobId);
  createEffect(
    on(
      () => `${s().id}:${s().personaId}:${s().jobId}`,
      () => {
        setPendPersona(s().personaId || (availablePersonas()[0]?.id ?? ""));
        setPendJob(s().jobId || (backend.listJobs()[0]?.id ?? ""));
      },
    ),
  );
  const roleChanged = () => pendPersona() !== s().personaId || pendJob() !== s().jobId;
  const applyRole = () => backend.updateSessionRole(s().id, pendPersona(), pendJob());
  const detachRole = () => backend.updateSessionRole(s().id, "", "");

  const [actionErr, setActionErr] = createSignal<string | undefined>(undefined);

  // 재개 (FR-D-21~23) — Tauri에서는 실제 --resume, 브라우저 목업에선 목 상태 전이
  const doResume = async () => {
    setActionErr(undefined);
    if (isTauri() && s().personaId) {
      const j = job();
      if (!j) return;
      const size = sessionTermSize(s().id);
      try {
        await resumeAgent(
          s().id,
          s().workspaceId,
          s().cwd,
          persona()?.name ?? s().personaId,
          j.permissions,
          size.cols,
          size.rows,
        );
      } catch (err) {
        setActionErr(String(err));
        return;
      }
    }
    backend.resumeSession(s().id);
  };

  // 권한 변경 재시작 (E11′ · FR-D-26) — 재개 기반, 대화 유지
  const doRestart = async () => {
    setActionErr(undefined);
    if (isTauri() && s().personaId) {
      const j = job();
      const size = sessionTermSize(s().id);
      try {
        if (j) await restartAgent(s().id, j.permissions, size.cols, size.rows);
      } catch (err) {
        setActionErr(String(err));
        return;
      }
    }
    backend.restartSession(s().id);
  };

  return (
    <div class="detail">
      <Eyebrow>SELECTED SESSION</Eyebrow>
      <div class="detail-head">
        <div>
          <div style={{ "font-size": "15px", "font-weight": 800 }}>
            {persona()?.name ?? "기본 터미널"} · {job()?.name ?? "셸"}
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
        <Show when={isTauri()}>
          <KV
            k="세션 로그"
            v={
              <button class="setting-v" title="로그 폴더 열기" onClick={openLogDir}>
                ~/.eqmux/logs/{s().id}.log ↗
              </button>
            }
          />
        </Show>
      </div>

      <div style={{ "margin-top": "10px" }}>
        <Eyebrow>실제 실행 플래그 (FR-D-41)</Eyebrow>
        <div class="card inset flags mono">{flags()}</div>
      </div>

      {/* 역할 CRUD — 기본 터미널엔 부여, 역할 세션엔 변경·해제. 권한 변경은 재시작으로 이어진다. */}
      <Show
        when={s().personaId}
        fallback={
          <div class="card inset role-edit">
            <Eyebrow>역할 부여</Eyebrow>
            <div class="muted" style={{ "font-size": "11px", margin: "4px 0 0" }}>
              기본 터미널입니다. 페르소나·직무를 붙이면 역할 세션이 됩니다.
            </div>
            <div class="role-edit-row">
              <select value={pendPersona()} onChange={(e) => setPendPersona(e.currentTarget.value)}>
                <For each={availablePersonas()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
              </select>
              <select value={pendJob()} onChange={(e) => setPendJob(e.currentTarget.value)}>
                <For each={backend.listJobs()}>{(j) => <option value={j.id}>{j.name}</option>}</For>
              </select>
              <button class="btn primary" disabled={!pendPersona() || !pendJob()} onClick={applyRole}>
                역할 부여
              </button>
            </div>
            <div class="muted" style={{ "font-size": "10px", "margin-top": "6px" }}>
              이미 돌던 셸이라 권한 플래그 적용을 위해 재시작이 필요합니다 (E11′).
            </div>
          </div>
        }
      >
        <div class="card inset role-edit">
          <Eyebrow>역할 변경</Eyebrow>
          <div class="role-edit-row">
            <select value={pendPersona()} onChange={(e) => setPendPersona(e.currentTarget.value)}>
              <For each={availablePersonas()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
            </select>
            <select value={pendJob()} onChange={(e) => setPendJob(e.currentTarget.value)}>
              <For each={backend.listJobs()}>{(j) => <option value={j.id}>{j.name}</option>}</For>
            </select>
            <button class="btn primary" disabled={!roleChanged()} onClick={applyRole}>
              적용
            </button>
          </div>
          <div class="muted" style={{ "font-size": "10px", "margin-top": "6px" }}>
            직무를 바꾸면 실행 권한이 달라져 재시작이 필요합니다 (E11′).
          </div>
          <button class="btn ghost" style={{ "margin-top": "8px", "align-self": "flex-start" }} onClick={detachRole}>
            역할 해제 — 기본 터미널로 전환
          </button>
        </div>
      </Show>

      <Show when={s().restartNeeded}>
        <div class="card restart-card">
          <span class="mono st-waiting" style={{ "font-weight": 700 }}>
            권한 변경 감지 · 재시작 필요
          </span>
          <button
            class="btn"
            title="재개 기반 재시작 — 대화를 잃지 않는다 (FR-D-26)"
            onClick={() => void doRestart()}
          >
            대화 유지 재시작
          </button>
        </div>
      </Show>

      <Show when={actionErr()}>
        <div class="card conn-error mono" style={{ "margin-top": "8px" }}>
          {actionErr()}
        </div>
      </Show>

      <div class="detail-actions">
        <button class="btn primary" onClick={() => jumpToSession(s().workspaceId, s().id)}>
          페인으로 점프
        </button>
        <button
          class="btn"
          classList={{ primary: !!s().restored && s().resumable }}
          disabled={!s().resumable || (s().status !== "dead" && !s().restored)}
          onClick={() => void doResume()}
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
