// 세션 상세 (lefeD) — 상태·실행 플래그 원문·메모리(C11)·재개 근거를 정직하게 표시한다.
// 승인·거부는 여기서 제공하지 않는다 (G7) — 액션은 점프·재개·중지 3종 + 역할 변경.
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { restartAgent, resumeAgent } from "../backend/agent";
import { queryEvents } from "../backend/events";
import type { FeedEvent } from "../backend/events";
import { autoAssignDefault } from "../backend/missions";
import { backend } from "../backend/mock";
import { exportSessionScrollback } from "../backend/panels";
import { nudgeRoleReload, removeRoleFile, saveRoleFile } from "../backend/roles";
import { isTauri, killPty, openLogDir } from "../backend/pty";
import { sessionTermSize } from "../components/TerminalPane";
import { settings, toggleMuted } from "../backend/settings";
import { t } from "../i18n";
import { jumpToSession } from "../state";
import { Eyebrow, KV, StatusLabel } from "../components/ui";
import type { Permissions, Session } from "../types";
import { agentAttached, flagsToString, sessionDisplayName, translatePermissions } from "../types";

const PERM_KEYS: (keyof Permissions)[] = ["write", "commit", "push"];

export function SessionDetailPanel(props: { session: Session; onClose?: () => void }) {
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
  // 페르소나의 저장 직무 — 역할 부여는 직무 선택 없이 이 값을 따른다 (라이브러리 `job:` 키).
  // 미지정·삭제된 직무면 개발(dev) → 첫 직무 순으로 받친다
  const personaJob = (pid: string) => {
    const jobs = backend.listJobs();
    const saved = backend.listPersonas().find((p) => p.id === pid)?.job;
    return jobs.find((j) => j.id === saved)?.id ?? jobs.find((j) => j.id === "dev")?.id ?? jobs[0]?.id ?? "";
  };
  const [pendPersona, setPendPersona] = createSignal(s().personaId);
  const [pendJob, setPendJob] = createSignal(s().jobId);
  createEffect(
    on(
      () => `${s().id}:${s().personaId}:${s().jobId}`,
      () => {
        const pid = s().personaId || (availablePersonas()[0]?.id ?? "");
        setPendPersona(pid);
        // 기본 터미널(부여 전)은 직무도 페르소나에서 유도한다 — 역할 세션은 현 직무 유지
        setPendJob(s().jobId || personaJob(pid));
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

  // 기록 저장 — 스크롤백 전체(디스크 포함, VT 제거 평문)를 .txt로 내보낸다.
  // 대화상자·파일 쓰기는 Rust(scrollback_export) 몫, 여기선 결과·에러 표시만 한다
  const [exporting, setExporting] = createSignal(false);
  const [exportMsg, setExportMsg] = createSignal<string | undefined>(undefined);
  createEffect(on(() => s().id, () => setExportMsg(undefined)));
  const doExport = async () => {
    setActionErr(undefined);
    setExportMsg(undefined);
    setExporting(true);
    try {
      const msg = await exportSessionScrollback(s(), persona()?.name ?? "기본 터미널");
      if (msg) setExportMsg(msg);
    } catch (err) {
      setActionErr(String(err));
    } finally {
      setExporting(false);
    }
  };

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
      {/* 드로어 상단 고정 (U1) — 스크롤해도 누구의 상세인지 남는다 */}
      <div class="detail-top">
      <Eyebrow>SELECTED SESSION</Eyebrow>
      <div class="detail-head">
        <div>
          <div style={{ "font-size": "15px", "font-weight": 800 }}>
            {sessionDisplayName(s(), persona()?.name ?? t("기본 터미널"))} · {job()?.name ?? t("셸")}
            <Show when={s().name && persona()}>
              <span class="muted" style={{ "font-size": "11px", "font-weight": 400 }}>
                {" "}
                ({persona()!.name})
              </span>
            </Show>
          </div>
          <div class="mono muted" style={{ "font-size": "11px" }}>
            <Show when={s().agentVersion} fallback={t("에이전트 미기동")}>
              Claude Code {s().agentVersion} · session {s().agentSessionId}…
            </Show>
          </div>
        </div>
        <StatusLabel session={s()} />
      </div>
      </div>

      <Show when={s().status === "waiting"}>
        <div class="card inset waiting-card">
          <div class="mono st-waiting" style={{ "font-weight": 700 }}>
            {t("승인 대기")} — {t(s().waitingFor!)}
          </div>
          <div class="muted" style={{ "margin-top": "4px", "font-size": "11px" }}>
            {t("승인·거부는 터미널 페인에서 수행합니다.")}
          </div>
        </div>
      </Show>

      {/* 아코디언 3그룹 (시안 §04) — 개요 / 실행 / 영속성. 14행 나열의 후신 */}
      <details class="acc" open>
        <summary>{t("개요")}</summary>
        <div class="card inset" style={{ padding: "4px 10px" }}>
          <KV k={t("상태")} v={s().status} vClass={s().status === "waiting" ? "st-waiting" : ""} />
          {/* 낮은 신뢰 (FR-G-27) — 정확한 척하지 않는다 */}
          <Show when={s().degraded}>
            <KV k={t("관측")} v={t("저하 — 레지스트리 접근 불가 · 훅 + 프로세스 생존으로 유지 (FR-D-63)")} vClass="st-waiting" />
          </Show>
          <KV k={t("임무")} v={mission()?.name ?? t("미배정")} />
          <KV k={t("역할")} v={`${persona()?.name ?? "—"} · ${job()?.name ?? "—"}`} />
          <KV k={t("서브에이전트")} v={String(s().subagents)} />
          <KV k={t("활동 (훅 2차)")} v={s().activity ?? "—"} />
          <KV
            k={t("비용 (statusLine)")}
            v={s().costUsd !== undefined ? `$${s().costUsd!.toFixed(2)} ${t("누적")}` : t("— (보고 전)")}
          />
          <KV
            k={t("메모리")}
            v={
              s().memoryMb !== undefined
                ? `${s().memoryMb} MB · peak ${s().memoryPeakMb ?? "—"} MB`
                : t("측정 불가")
            }
          />
          <KV
            k={t("재개")}
            v={s().resumable ? `${t("가능")} · ${t(s().resumeReason ?? "")}` : `${t("불가")} · ${t(s().resumeReason ?? "transcript 없음")}`}
          />
          <Show when={s().pid}>
            <KV k={t("PID · 셸")} v={`${s().pid} · ${s().shell}`} />
          </Show>
          <Show when={s().personaId}>
            <KV k={t("격리")} v={s().worktree ? t("워크트리 · 전용 브랜치 (E1′)") : t("공유 · repo 루트 (FR-E-60)")} />
          </Show>
          <KV k="cwd" v={s().cwd} />
          <KV
            k={t("알림")}
            v={
              <button
                class="setting-v"
                title={t("이 세션의 OS 알림·사운드 음소거 (FR-G-35) — 인앱 미확인 점은 유지")}
                onClick={() => toggleMuted(s().id)}
              >
                {sessMuted() ? t("🔇 음소거 중 — 해제") : wsMuted() ? t("🔇 워크스페이스 음소거 중") : t("🔔 켜짐 — 음소거")}
              </button>
            }
          />
        </div>
      </details>

      <details class="acc" open>
        <summary>{t("실행")}</summary>
        <div class="acc-body">

      {/* 세션 이름 분리 (P5 · FR-E-36) — 같은 페르소나를 여러 워크스페이스에 캐스팅할 때 구분한다 */}
      <div class="card inset" style={{ padding: "6px 10px", "margin-top": "10px", display: "flex", gap: "6px", "align-items": "center" }}>
        <span class="eyebrow" style={{ "white-space": "nowrap" }}>{t("세션 이름")}</span>
        <input
          style={{ flex: 1, "min-width": 0, "font-size": "11px" }}
          placeholder={persona()?.name ?? t("기본 터미널")}
          value={nameDraft()}
          onInput={(e) => setNameDraft(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && applyName()}
        />
        <button class="btn ghost" style={{ padding: "2px 8px", "font-size": "10px" }} onClick={applyName}>
          {t("적용")}
        </button>
      </div>

      <div style={{ "margin-top": "10px" }}>
        <Eyebrow>{t("실제 실행 플래그 (FR-D-41)")}</Eyebrow>
        <div class="card inset flags mono">{flags()}</div>
      </div>

      {/* 슬롯 권한 오버라이드 (FR-E-34, M31) — 직무 기본값을 이 세션에서만 덮어쓴다 */}
      <Show when={s().personaId && job()}>
        <div class="card inset" style={{ padding: "8px 10px", "margin-top": "10px" }}>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Eyebrow>{t("슬롯 권한 (FR-E-34)")}</Eyebrow>
            <Show when={s().permOverride}>
              <span class="badge purple" title={t("직무 기본값과 다른 슬롯 오버라이드 — team.json·역할 파일에 영속")}>
                {t("오버라이드")}
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
              {t("적용")}
            </button>
            <button
              class="btn ghost"
              style={{ padding: "2px 8px", "font-size": "10px" }}
              disabled={!s().permOverride}
              title={t("오버라이드 해제 — 직무 기본값으로")}
              onClick={resetPerms}
            >
              {t("기본값")}
            </button>
          </div>
          <div class="muted" style={{ "font-size": "10px" }}>
            {t("직무 기본")} — write {job()!.permissions.write ? "✓" : "—"} · commit {job()!.permissions.commit ? "✓" : "—"} ·
            push {job()!.permissions.push ? "✓" : "—"}. {t("유효 권한이 달라지면 재시작이 필요합니다 (E11′)")}
          </div>
        </div>
      </Show>

      {/* 재시작 필요 (E11′) — 원인(권한 변경) 바로 아래에 선다. 인과가 한 화면에 보인다 (U1).
          단, 재시작은 지금 붙어 있는 에이전트가 있을 때만 성립한다 — 권한 플래그는 스폰 시점에
          결정되므로 맨 셸 세션에는 재시작할 대상이 없다. 그 경우엔 권하지 않고 사실만 말한다. */}
      <Show when={s().restartNeeded}>
        <Show
          when={agentAttached(s())}
          fallback={
            <div class="card restart-card">
              <span class="mono muted">{t("권한 변경 감지 · 다음 기동 때 적용됩니다")}</span>
            </div>
          }
        >
          <div class="card restart-card">
            <span class="mono st-waiting" style={{ "font-weight": 700 }}>
              {t("권한 변경 감지 · 재시작 필요")}
            </span>
            <button
              class="btn"
              title={t("재개 기반 재시작 — 대화를 잃지 않는다 (FR-D-26)")}
              onClick={() => void doRestart()}
            >
              {t("대화 유지 재시작")}
            </button>
          </div>
        </Show>
      </Show>

      {/* 역할 CRUD — 기본 터미널엔 부여, 역할 세션엔 변경·해제. 권한 변경은 재시작으로 이어진다. */}
      <Show
        when={s().personaId}
        fallback={
          <div class="card inset role-edit">
            <Eyebrow>{t("역할 부여")}</Eyebrow>
            <div class="muted" style={{ "font-size": "11px", margin: "4px 0 0" }}>
              {t("기본 터미널입니다. 저장된 페르소나를 붙이면 역할 세션이 됩니다 — 직무는 페르소나의 저장 직무를 따릅니다.")}
            </div>
            <div class="role-edit-row">
              <select
                value={pendPersona()}
                onChange={(e) => {
                  setPendPersona(e.currentTarget.value);
                  setPendJob(personaJob(e.currentTarget.value));
                }}
              >
                <For each={availablePersonas()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
              </select>
              <span
                class="mono muted"
                style={{ "font-size": "11px", "white-space": "nowrap" }}
                title={t("페르소나의 저장 직무 (미지정이면 기본값) — 라이브러리의 페르소나 편집에서 바꿉니다")}
              >
                {t("직무")} {backend.listJobs().find((j) => j.id === pendJob())?.name ?? "—"}
              </span>
              <button class="btn primary" disabled={!pendPersona() || !pendJob()} onClick={applyRole}>
                {t("역할 부여")}
              </button>
            </div>
            <div class="muted" style={{ "font-size": "10px", "margin-top": "6px" }}>
              {t("이미 돌던 셸이라 권한 플래그 적용을 위해 재시작이 필요합니다 (E11′).")}
            </div>
          </div>
        }
      >
        <div class="card inset role-edit">
          <Eyebrow>{t("역할 변경")}</Eyebrow>
          <div class="role-edit-row">
            <select value={pendPersona()} onChange={(e) => setPendPersona(e.currentTarget.value)}>
              <For each={availablePersonas()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
            </select>
            <select value={pendJob()} onChange={(e) => setPendJob(e.currentTarget.value)}>
              <For each={backend.listJobs()}>{(j) => <option value={j.id}>{j.name}</option>}</For>
            </select>
            <button class="btn primary" disabled={!roleChanged()} onClick={applyRole}>
              {t("적용")}
            </button>
          </div>
          <div class="muted" style={{ "font-size": "10px", "margin-top": "6px" }}>
            {t("직무를 바꾸면 실행 권한이 달라져 재시작이 필요합니다 (E11′).")}
          </div>
          <button class="btn ghost" style={{ "margin-top": "8px", "align-self": "flex-start" }} onClick={detachRole}>
            {t("역할 해제 — 기본 터미널로 전환")}
          </button>
        </div>
      </Show>

        </div>
      </details>

      <details class="acc">
        <summary>{t("영속성")}</summary>
        <div class="card inset" style={{ padding: "4px 10px" }}>
          <KV k={t("스크롤백")} v={`${(s().scrollbackLines / 1000).toFixed(1)}K lines`} />
          <Show when={isTauri()}>
            <KV
              k={t("세션 로그")}
              v={
                <button class="setting-v" title={t("로그 폴더 열기")} onClick={openLogDir}>
                  ~/.eqmux/logs/{s().id}.log ↗
                </button>
              }
            />
            <KV
              k={t("기록 저장")}
              v={
                <button
                  class="setting-v"
                  title={t("스크롤백 전체(디스크 포함)를 평문 텍스트로 저장")}
                  disabled={exporting()}
                  onClick={() => void doExport()}
                >
                  {exporting() ? t("저장 중…") : t(".txt로 내보내기…")}
                </button>
              }
            />
            <Show when={exportMsg()}>
              <div class="mono muted" style={{ "font-size": "11px", "line-height": 1.7, "word-break": "break-all" }}>
                {exportMsg()}
              </div>
            </Show>
          </Show>
        </div>
        <Show when={isTauri() && feed().length > 0}>
          <div style={{ "margin-top": "8px" }}>
            <Eyebrow>{t("세션 이벤트 (FR-G-61)")}</Eyebrow>
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
        <button
          class="btn primary"
          onClick={() => {
            jumpToSession(s().workspaceId, s().id);
            props.onClose?.(); // 팝업에서 점프하면 닫는다 — 페인을 보러 가는 동작이다
          }}
        >
          {t("페인으로 점프")}
        </button>
        <button
          class="btn"
          classList={{ primary: !!s().restored && s().resumable }}
          disabled={!s().resumable || (s().status !== "dead" && !s().restored)}
          onClick={() => void doResume()}
        >
          {t("재개")}
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
          {t("중지")}
        </button>
      </div>
    </div>
  );
}
