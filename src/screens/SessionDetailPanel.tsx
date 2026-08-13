// 세션 상세 (lefeD) — 상태·실행 플래그 원문·메모리(C11)·재개 근거를 정직하게 표시한다.
// 승인·거부는 여기서 제공하지 않는다 (G7) — 액션은 점프·재개·중지 3종 + 역할 변경.
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { restartAgent, resumeAgent } from "../backend/agent";
import { queryEvents } from "../backend/events";
import type { FeedEvent } from "../backend/events";
import { autoAssignDefault } from "../backend/missions";
import { backend } from "../backend/mock";
import { nudgeRoleReload, removeRoleFile, saveRoleFile } from "../backend/roles";
import { isTauri, killPty, openLogDir } from "../backend/pty";
import { sessionTermSize } from "../components/TerminalPane";
import { settings, toggleMuted } from "../backend/settings";
import { jumpToSession } from "../state";
import { Eyebrow, KV, StatusLabel } from "../components/ui";
import type { Permissions, Session } from "../types";
import { flagsToString, sessionDisplayName, translatePermissions } from "../types";

const PERM_KEYS: (keyof Permissions)[] = ["write", "commit", "push"];

export function SessionDetailPanel(props: { session: Session }) {
  const s = () => props.session;
  // 상세를 열면 미확인 해제 (FR-G-44) — markSeen은 변경 없으면 방송하지 않아 재귀가 없다
  createEffect(() => {
    if (s().unseen) backend.markSeen(s().id);
  });

  // 세션 스코프 이벤트 피드 (FR-G-61) — 원천은 event 테이블, 상태 방송에 붙어 갱신
  const [feed, setFeed] = createSignal<FeedEvent[]>([]);
  onMount(() => {
    if (!isTauri()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => void queryEvents(s().workspaceId, { session: s().id, limit: 8 }).then(setFeed);
    createEffect(on(() => s().id, load));
    const unsub = backend.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 500);
    });
    onCleanup(() => {
      clearTimeout(timer);
      unsub();
    });
  });
  const persona = () => backend.listPersonas().find((p) => p.id === s().personaId);
  const job = () => backend.listJobs().find((j) => j.id === s().jobId);
  const mission = () => backend.listMissions().find((m) => m.id === s().missionId);
  // 유효 권한 (FR-E-34) — 슬롯 오버라이드가 있으면 그것, 없으면 직무 기본값
  const effPerms = () => s().permOverride ?? job()?.permissions;
  const flags = () => {
    const p = effPerms();
    return p ? flagsToString(translatePermissions(p), s().agentSessionId) : "—";
  };

  // ── 슬롯 권한 오버라이드 편집 (FR-E-34, M31) — 적용은 재시작(E11′), 파일에도 반영 ──
  const [permDraft, setPermDraft] = createSignal<Permissions>({ write: false, commit: false, push: false });
  createEffect(
    on(
      () => `${s().id}:${s().jobId}:${JSON.stringify(s().permOverride)}`,
      () => {
        const p = effPerms();
        if (p) setPermDraft({ ...p });
      },
    ),
  );
  const permChanged = () => JSON.stringify(permDraft()) !== JSON.stringify(effPerms());
  const applyPerms = () => {
    backend.setPermissionOverride(s().id, permDraft());
    void saveRoleFile(s().id); // 역할 파일 frontmatter permissions 반영 (FR-E-33)
  };
  const resetPerms = () => {
    backend.setPermissionOverride(s().id, undefined);
    void saveRoleFile(s().id);
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
  // 역할 변경 = 파일 즉시 갱신 (FR-E-44·46). 비권한 변경(직무 유지)은 "다시 읽어라" 안내 한 줄,
  // 권한 변경(직무 교체)은 재시작 배지(E11′)가 담당한다.
  const applyRole = () => {
    const permissionChange = pendJob() !== s().jobId;
    const wasRoleless = !s().personaId;
    backend.updateSessionRole(s().id, pendPersona(), pendJob());
    void saveRoleFile(s().id).then((path) => {
      if (path && !permissionChange) nudgeRoleReload(s().id, path);
      // 역할이 새로 부여된 세션 — 기본 임무 자동 배정 (FR-E-56)
      if (wasRoleless) void autoAssignDefault(s().workspaceId, s().id);
    });
  };
  const detachRole = () => {
    const ws = backend.listWorkspaces().find((w) => w.id === s().workspaceId);
    backend.updateSessionRole(s().id, "", "");
    // 역할 파일은 세션 cwd 규약 (FR-E-63) — 워크트리 세션은 자기 사본에서 지운다
    if (ws && !ws.pathMissing) removeRoleFile(s().cwd || ws.path, s().id);
  };

  const [actionErr, setActionErr] = createSignal<string | undefined>(undefined);

  // 세션 이름 분리 (P5 · FR-E-36) — 빈 값 저장 = 페르소나 이름으로 복귀. team.json에 영속된다
  const [nameDraft, setNameDraft] = createSignal(s().name ?? "");
  createEffect(on(() => s().id, () => setNameDraft(s().name ?? "")));
  const applyName = () => backend.renameSession(s().id, nameDraft());

  // 음소거 (FR-G-35) — OS 알림·사운드만 막는다. 인앱 미확인 점은 유지 (FR-G-37)
  const sessMuted = () => settings().muted.includes(s().id);
  const wsMuted = () => settings().muted.includes(s().workspaceId);

  // 재개 (FR-D-21~23) — Tauri에서는 실제 --resume, 브라우저 목업에선 목 상태 전이
  const doResume = async () => {
    setActionErr(undefined);
    if (isTauri() && s().personaId) {
      const p = effPerms();
      if (!p) return;
      const size = sessionTermSize(s().id);
      try {
        await resumeAgent(
          s().id,
          s().workspaceId,
          s().cwd,
          persona()?.name ?? s().personaId,
          p,
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
      const p = effPerms();
      const size = sessionTermSize(s().id);
      try {
        if (p) await restartAgent(s().id, p, size.cols, size.rows);
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
            {sessionDisplayName(s(), persona()?.name ?? "기본 터미널")} · {job()?.name ?? "셸"}
            <Show when={s().name && persona()}>
              <span class="muted" style={{ "font-size": "11px", "font-weight": 400 }}>
                {" "}
                ({persona()!.name})
              </span>
            </Show>
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

      {/* 아코디언 3그룹 (시안 §04) — 개요 / 실행 / 영속성. 14행 나열의 후신 */}
      <details class="acc" open>
        <summary>개요</summary>
        <div class="card inset" style={{ padding: "4px 10px" }}>
          <KV k="상태" v={s().status} vClass={s().status === "waiting" ? "st-waiting" : ""} />
          {/* 낮은 신뢰 (FR-G-27) — 정확한 척하지 않는다 */}
          <Show when={s().degraded}>
            <KV k="관측" v="저하 — 레지스트리 접근 불가 · 훅 + 프로세스 생존으로 유지 (FR-D-63)" vClass="st-waiting" />
          </Show>
          <KV k="임무" v={mission()?.name ?? "미배정"} />
          <KV k="역할" v={`${persona()?.name ?? "—"} · ${job()?.name ?? "—"}`} />
          <KV k="서브에이전트" v={String(s().subagents)} />
          <KV k="활동 (훅 2차)" v={s().activity ?? "—"} />
          <KV
            k="비용 (statusLine)"
            v={s().costUsd !== undefined ? `$${s().costUsd!.toFixed(2)} 누적` : "— (보고 전)"}
          />
          <KV
            k="메모리"
            v={
              s().memoryMb !== undefined
                ? `${s().memoryMb} MB · peak ${s().memoryPeakMb ?? "—"} MB`
                : "측정 불가"
            }
          />
          <KV
            k="재개"
            v={s().resumable ? `가능 · ${s().resumeReason ?? ""}` : `불가 · ${s().resumeReason ?? "transcript 없음"}`}
          />
          <Show when={s().pid}>
            <KV k="PID · 셸" v={`${s().pid} · ${s().shell}`} />
          </Show>
          <Show when={s().personaId}>
            <KV k="격리" v={s().worktree ? "워크트리 · 전용 브랜치 (E1′)" : "공유 · repo 루트 (FR-E-60)"} />
          </Show>
          <KV k="cwd" v={s().cwd} />
          <KV
            k="알림"
            v={
              <button
                class="setting-v"
                title="이 세션의 OS 알림·사운드 음소거 (FR-G-35) — 인앱 미확인 점은 유지"
                onClick={() => toggleMuted(s().id)}
              >
                {sessMuted() ? "🔇 음소거 중 — 해제" : wsMuted() ? "🔇 워크스페이스 음소거 중" : "🔔 켜짐 — 음소거"}
              </button>
            }
          />
        </div>
      </details>

      <details class="acc" open>
        <summary>실행</summary>
        <div class="acc-body">

      {/* 세션 이름 분리 (P5 · FR-E-36) — 같은 페르소나를 여러 워크스페이스에 캐스팅할 때 구분한다 */}
      <div class="card inset" style={{ padding: "6px 10px", "margin-top": "10px", display: "flex", gap: "6px", "align-items": "center" }}>
        <span class="eyebrow" style={{ "white-space": "nowrap" }}>세션 이름</span>
        <input
          style={{ flex: 1, "min-width": 0, "font-size": "11px" }}
          placeholder={persona()?.name ?? "기본 터미널"}
          value={nameDraft()}
          onInput={(e) => setNameDraft(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && applyName()}
        />
        <button class="btn ghost" style={{ padding: "2px 8px", "font-size": "10px" }} onClick={applyName}>
          적용
        </button>
      </div>

      <div style={{ "margin-top": "10px" }}>
        <Eyebrow>실제 실행 플래그 (FR-D-41)</Eyebrow>
        <div class="card inset flags mono">{flags()}</div>
      </div>

      {/* 슬롯 권한 오버라이드 (FR-E-34, M31) — 직무 기본값을 이 세션에서만 덮어쓴다 */}
      <Show when={s().personaId && job()}>
        <div class="card inset" style={{ padding: "8px 10px", "margin-top": "10px" }}>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Eyebrow>슬롯 권한 (FR-E-34)</Eyebrow>
            <Show when={s().permOverride}>
              <span class="badge purple" title="직무 기본값과 다른 슬롯 오버라이드 — team.json·역할 파일에 영속">
                오버라이드
              </span>
            </Show>
          </div>
          <div style={{ display: "flex", gap: "12px", "align-items": "center", margin: "6px 0" }}>
            <For each={PERM_KEYS}>
              {(key) => (
                <label class="mono" style={{ "font-size": "11px", display: "flex", gap: "4px", "align-items": "center", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={permDraft()[key]}
                    onChange={(e) => setPermDraft({ ...permDraft(), [key]: e.currentTarget.checked })}
                  />
                  {key}
                </label>
              )}
            </For>
            <button class="btn ghost" style={{ padding: "2px 8px", "font-size": "10px" }} disabled={!permChanged()} onClick={applyPerms}>
              적용
            </button>
            <button
              class="btn ghost"
              style={{ padding: "2px 8px", "font-size": "10px" }}
              disabled={!s().permOverride}
              title="오버라이드 해제 — 직무 기본값으로"
              onClick={resetPerms}
            >
              기본값
            </button>
          </div>
          <div class="muted" style={{ "font-size": "10px" }}>
            직무 기본 — write {job()!.permissions.write ? "✓" : "—"} · commit {job()!.permissions.commit ? "✓" : "—"} ·
            push {job()!.permissions.push ? "✓" : "—"}. 유효 권한이 달라지면 재시작이 필요합니다 (E11′)
          </div>
        </div>
      </Show>

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
        </div>
      </details>

      <details class="acc">
        <summary>영속성</summary>
        <div class="card inset" style={{ padding: "4px 10px" }}>
          <KV k="스크롤백" v={`${(s().scrollbackLines / 1000).toFixed(1)}K lines`} />
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
        <Show when={isTauri() && feed().length > 0}>
          <div style={{ "margin-top": "8px" }}>
            <Eyebrow>세션 이벤트 (FR-G-61)</Eyebrow>
            <div class="card inset" style={{ padding: "6px 10px" }}>
              <For each={feed()}>
                {(e) => (
                  <div class="mono muted" style={{ "font-size": "11px", "line-height": 1.7 }}>
                    {e.time} {e.message}
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </details>

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
        <button
          class="btn danger"
          disabled={s().status === "dead"}
          onClick={() => {
            // 실제 PTY 종료 (FR-G-52) — 의도한 종료라 OS 알림은 나지 않는다 (Rust expected_exit)
            if (isTauri()) killPty(s().id);
            backend.stopSession(s().id);
          }}
        >
          중지
        </button>
      </div>
    </div>
  );
}
