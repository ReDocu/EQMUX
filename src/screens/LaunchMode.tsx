// 실행 방식 선택 (ChIvy · 0.5 시안 xfVq4) — 레인 01의 2단계. 빠른 시작 · 기본 터미널 · 역할 팀으로 분기한다.
import { createSignal, For, onMount, Show } from "solid-js";
import { agentClis, agentClisReady, INSTALL_CMD, refreshAgentClis } from "../backend/agentprobe";
import { listPresets } from "../backend/library";
import { backend } from "../backend/mock";
import { clipWriteText, isTauri } from "../backend/pty";
import { maxSlots } from "../backend/settings";
import { castingConfirmLines, castSavedTeam, savedTeam } from "../backend/team";
import { launchRoleAgents } from "../components/TerminalPane";
import { ConfirmDialog, Identity, notify } from "../components/ui";
import { t, tf } from "../i18n";
import { setFocusRequest, setOverlay, setSelectedSession, setView } from "../state";
import { projectStem } from "../types";
import type { Session } from "../types";
import { quickStartSlots, wizardSteps } from "./launchRules";
import type { WizardPath } from "./launchRules";
import { Icon } from "../components/icons";
import { segKeyIndex } from "../components/keynav";

/** saved = 저장소의 team.json으로 시작 (D3 · W4) — 단계는 빠른 시작과 같다(실행 방식에서 바로 워크스페이스) */
type Mode = WizardPath | "saved";

/** 마법사 단계 표시 (P49) — 실행 방식 · 기본 터미널 구성 · 팀 캐스팅 · 팀 편성이 같은 줄을 머리에 둔다.
 *  at은 지금 단계의 0부터 센 자리. 앞은 끝남, 지금은 강조 */
export function WizardSteps(props: { path: WizardPath; at: number }) {
  return (
    <div class="launch-steps mono" aria-label={t("진행 단계")}>
      <For each={wizardSteps(props.path)}>
        {(label, i) => (
          <>
            {i() > 0 && <span class="muted">›</span>}
            <span
              class="launch-step"
              classList={{ done: i() < props.at, active: i() === props.at }}
              aria-current={i() === props.at ? "step" : undefined}
            >
              {`${String(i() + 1).padStart(2, "0")} ${t(label)}`}
            </span>
          </>
        )}
      </For>
    </div>
  );
}

export function LaunchMode(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  // 처음 쓰는 사람의 기본은 빠른 시작이다 (§10) — 폴더만 고르면 리드 + 개발 2세션
  const [mode, setMode] = createSignal<Mode>("quick");
  // 프리셋 이름 — 원본은 앱데이터 presets/*.json (팀 캐스팅과 같은 실측). 브라우저 dev는 시드 이름
  const [presetNames, setPresetNames] = createSignal(["표준", "집중개발", "제품기획", "품질"]);
  onMount(() => {
    void listPresets().then((list) => list.length > 0 && setPresetNames(list.map((p) => p.name)));
  });
  // 저장소에 편성이 있으면 (D3) — 클론한 저장소에서 그 팀으로 바로. 있으면 그것이 기본 선택이다
  const [saved, setSaved] = createSignal<{ slots: number; missing: string[] }>();
  onMount(() => {
    void savedTeam(props.wsId).then((v) => {
      setSaved(v);
      if (v) setMode("saved");
    });
  });
  const quickSlots = () => quickStartSlots(backend.listPersonas(), backend.listJobs().map((j) => j.id));
  const personaName = (id: string) => backend.listPersonas().find((p) => p.id === id)?.name ?? id;
  // 빠른 시작은 claude를 바로 띄운다 (P64) — PATH 실측에 없으면 시작을 막고 설치 명령을 보인다(세션 추가와 같은 블록).
  // 브라우저 dev는 실측이 없어 막지 않는다
  const claudeMissing = () => isTauri() && agentClisReady() && !agentClis().some((a) => a.cmd === "claude" && a.installed);

  // 빠른 시작 — 사람이 누른 버튼이 편성 · 기동까지 한 번에 한다. 임무는 배정하지 않는다
  // 이미 세션이 있으면 편성 교체가 그것을 끝내므로 먼저 묻는다 (B198 · 팀 캐스팅과 같은 확인)
  const [confirmQuick, setConfirmQuick] = createSignal<string[]>();
  const quickStart = (confirmed = false) => {
    const slots = quickSlots();
    if (slots.length === 0) return notify(t("페르소나가 없어 빠른 시작을 할 수 없습니다 — 역할 팀으로 시작하세요"));
    const lines = confirmed ? [] : castingConfirmLines(props.wsId, slots);
    if (lines.length > 0) return setConfirmQuick(lines);
    backend.applyCasting(props.wsId, slots);
    backend.openWorkspace(props.wsId);
    arrive(backend.listSessions().filter((s) => s.workspaceId === props.wsId && s.personaId));
  };
  // 저장소의 편성으로 시작 (D3) — castSavedTeam이 슬롯에 앉히고 워크스페이스를 연다. 기동은 여기서
  // 기다리는 동안 버튼을 막는다 (0.6 QA B231) — 두 번 누르면 기동이 두 번 걸렸다
  const [starting, setStarting] = createSignal(false);
  const startSaved = async () => {
    if (starting()) return;
    setStarting(true);
    try {
      arrive(await castSavedTeam(props.wsId));
    } finally {
      setStarting(false);
    }
  };
  // 띄우고 워크스페이스로 — 리드에게 키보드를 준다 (U108)
  const arrive = (list: Session[]) => {
    launchRoleAgents(list);
    setView({ kind: "workspace", id: props.wsId });
    // 새 세션에 키보드를 준다 (U108) — 이전 페인에 남아 키가 엉뚱한 셸로 갔다
    const lead = list.find((s) => s.jobId === "lead") ?? list[0];
    if (lead) {
      setSelectedSession(lead.id);
      setFocusRequest({ session: lead.id });
    }
  };

  const next = () => {
    if (mode() === "saved") void startSaved();
    else if (mode() === "quick") quickStart();
    else if (mode() === "terminal") setView({ kind: "terminalSetup", wsId: props.wsId });
    else setView({ kind: "casting", wsId: props.wsId, wizard: true });
  };
  // 마지막 버튼은 실제 도착지를 말한다 (P50)
  const nextLabel = () =>
    mode() === "saved"
      ? t("이 팀으로 시작 → 워크스페이스")
      : mode() === "quick"
        ? t("2세션으로 시작 → 워크스페이스")
        : mode() === "terminal" ? t("다음: 기본 터미널 구성 →") : t("다음: 팀 캐스팅 →");

  const choices = () =>
    [
      ...(saved()
        ? [
            {
              id: "saved" as Mode,
              icon: "⛬",
              title: t("이 팀으로 시작"),
              copy: tf("저장소의 편성(.eqmux/team.json) {n}명으로 바로 기동합니다", { n: saved()!.slots }),
              features: [
                ...(saved()!.missing.length > 0
                  ? [tf("라이브러리에 없는 페르소나는 셸로 둡니다: {names}", { names: saved()!.missing.join(", ") })]
                  : []),
                t("편성은 팀 캐스팅에서 나중에 바꿀 수 있습니다"),
              ],
              route: t("다음 → 워크스페이스 (편성대로 기동)"),
              example: () => <Identity slot={1} name={t("저장된 팀")} cli="claude" />,
            },
          ]
        : []),
      {
        id: "quick" as Mode,
        icon: "»",
        title: t("빠른 시작"),
        copy: t("폴더만 있으면 됩니다. 리드와 개발 Claude Code 세션 2개를 바로 띄웁니다. 캐스팅 · 페르소나 · 임무는 건너뛰고, 팀은 나중에 고칠 수 있습니다."),
        features: [
          quickSlots().length > 0
            ? tf("편성: {list}", {
                list: quickSlots()
                  .map((sl) => `${personaName(sl.personaId)} (${sl.jobId === "lead" ? t("리드") : t("개발")})`)
                  .join(" · "),
              })
            : t("페르소나가 없어 쓸 수 없습니다 — 역할 팀으로 시작하세요"),
          t("세션이 많을수록 사용 한도를 빨리 씁니다 — 2개로 시작합니다"),
          tf("더 필요하면 팀 캐스팅에서 {n}개까지 늘릴 수 있습니다", { n: maxSlots() }),
        ],
        route: t("다음 → 워크스페이스 (Claude Code 2개 기동)"),
        example: () => <Identity slot={1} name={personaName(quickSlots()[0]?.personaId ?? "")} title={t("리드")} cli="claude" />,
      },
      {
        id: "terminal" as Mode,
        icon: ">_",
        title: t("기본 터미널"),
        // 예는 지금 워크스페이스 이름으로 (U139) — 아래 헤더 예와 같은 이름
        // 구성 화면에는 고칠 칸이 없다 (U172) — 셸은 설정 값, 이름은 자동이고 연 뒤에 바꾼다고 실제대로 말한다
        copy: tf("셸만 엽니다. 에이전트는 필요할 때 직접 띄웁니다. 셸은 설정의 기본 셸이고, 이름은 워크스페이스명XX({name}01…)로 붙습니다 — 연 뒤 세션 상세에서 바꿀 수 있습니다.", {
          name: projectStem(ws()?.name ?? ""),
        }),
        features: [
          t("세션 이름 · 번호가 헤더와 레일에 붙습니다"),
          t("손으로 띄운 claude에는 메시지를 쌓아 둡니다 (넣기 칩) · 설정에서 '쉬면 자동으로 넣기'로 바꿀 수 있습니다"),
          t("역할 팀은 나중에 팀 캐스팅으로 더할 수 있습니다"),
        ],
        route: t("다음 → 기본 터미널 구성 (셸 · 브랜치 확인)"),
        example: () => <Identity slot={1} name={`${projectStem(ws()?.name ?? "")}01`} compact />,
      },
      {
        id: "team" as Mode,
        icon: "⛬",
        title: t("역할 팀"),
        copy: t("역할을 맡긴 Claude Code 세션을 띄웁니다 — 서로 메시지를 주고받습니다."),
        features: [
          t("직함으로 맡는 영역을 나눕니다 (클라이언트 · 서버 개발자)"),
          t("완료 신호 · 넘김 회신 · 워크스페이스 간 통신"),
          tf("프리셋: {list}", { list: presetNames().map((n) => t(n)).join(" · ") }),
        ],
        route: t("다음 → 팀 캐스팅 → 팀 편성 → 워크스페이스"), // U129 — 단계 줄 · 팀 편성 마지막 버튼과 같은 도착지
        // 라이브러리의 실제 이름 (0.6 QA U150) — 영어 화면에서 'Kai'와 '카이'가 한 줄에 섞였다
        example: () => <Identity slot={3} name={backend.listPersonas().find((x) => x.id !== quickSlots()[0]?.personaId)?.name ?? t("카이")} title={t("클라이언트 개발자")} cli="claude" />,
      },
    ] as const;

  return (
    <div class="screen">
      <Show when={confirmQuick()}>
        {(lines) => (
          <ConfirmDialog
            title={t("빠른 시작이 지금 팀을 바꿉니다")}
            body={t("시작하면 아래가 바로 일어납니다. 종료된 세션은 되돌릴 수 없습니다.")}
            info={lines()}
            danger
            confirmLabel={t("바꾸고 시작")}
            onConfirm={() => {
              setConfirmQuick(undefined);
              quickStart(true);
            }}
            onCancel={() => setConfirmQuick(undefined)}
          />
        )}
      </Show>
      <div class="screen-head">
        <div>
          <h1>
            {t("실행 방식 선택")} · {ws()?.name}
          </h1>
          <div class="sub mono">
            {tf("첫 세션을 어떻게 시작할지 고르세요 — 나중에 바꿀 수 있습니다 · 어느 방식이든 워크스페이스의 슬롯 {n}개를 씁니다", {
              n: maxSlots(),
            })}
          </div>
        </div>
        {/* [계속]은 아래 막대 하나 — 머리와 바닥에 같은 버튼이 둘 있었다 (U30) */}
      </div>

      <div class="screen-body launch-body">
        <WizardSteps path={mode() === "saved" ? "quick" : (mode() as WizardPath)} at={1} />

        {/* 라디오 그룹 관례 (U130 · U37) — 탭 정지는 고른 카드 하나, 화살표 · Home · End로 바로 고른다 */}
        <div
          class="launch-choices"
          role="radiogroup"
          aria-label={t("실행 방식")}
          onKeyDown={(e) => {
            const ids = choices().map((c) => c.id);
            const i = segKeyIndex(e.key, ids.length, ids.indexOf(mode()));
            if (i === undefined) return;
            e.preventDefault();
            setMode(ids[i]);
            e.currentTarget.querySelectorAll<HTMLButtonElement>(".launch-choice")[i]?.focus();
          }}
        >
          <For each={choices()}>
            {(c) => (
              <button
                class="card launch-choice"
                role="radio"
                aria-checked={mode() === c.id}
                tabIndex={mode() === c.id ? 0 : -1}
                classList={{ selected: mode() === c.id }}
                onClick={() => setMode(c.id)}
              >
                <div class="launch-choice-head">
                  <span class="launch-choice-icon mono">{c.icon}</span>
                  <span class="launch-choice-title">{c.title}</span>
                  <span class="launch-radio" classList={{ on: mode() === c.id }} aria-hidden="true">
                    {mode() === c.id ? <Icon name="check" size={12} /> : ""}
                  </span>
                </div>
                <div class="muted launch-choice-desc">{c.copy}</div>
                <div class="launch-divider" />
                <div class="launch-features">
                  <For each={c.features}>
                    {(f) => (
                      <div class="launch-feature">
                        <span class="launch-check"><Icon name="check" size={12} /></span>
                        {f}
                      </div>
                    )}
                  </For>
                </div>
                <div class="launch-route mono">
                  <span class="muted">⇢</span>
                  <span>{c.route}</span>
                </div>
                <div class="launch-example">
                  <span class="mono muted">{t("헤더 예")}</span>
                  {c.example()}
                </div>
              </button>
            )}
          </For>
        </div>

        <div class="launch-footer">
          {/* 빠른 시작인데 claude가 없다 (P64) — 세션 추가의 설치 블록과 같은 모양. 설치 뒤 [다시 감지]로 풀린다 */}
          <Show when={mode() === "quick" && claudeMissing()}>
            <div class="engine-missing mono">
              <div class="st-dead">{tf("PATH에 {cmd}가 없습니다 — 아래 명령으로 설치한 뒤 다시 감지하세요", { cmd: "claude" })}</div>
              <div class="engine-install">
                <code>{INSTALL_CMD.claude}</code>
                <button class="btn ghost" onClick={() => clipWriteText(INSTALL_CMD.claude)}>
                  {t("복사")}
                </button>
                <button class="btn ghost" onClick={() => void refreshAgentClis()}>
                  {t("다시 감지")}
                </button>
              </div>
            </div>
          </Show>
          <div class="launch-footer-note">
            <span class="launch-info">ⓘ</span>
            <span class="muted">
              {tf(
                mode() === "saved"
                  ? "저장소의 편성대로 시작합니다. 워크스페이스가 열리면 역할 세션이 바로 뜹니다. 슬롯은 {n}개까지 씁니다."
                  : mode() === "quick"
                  ? "리드와 개발 2세션으로 시작합니다. 워크스페이스가 열리면 Claude Code가 바로 뜹니다. 슬롯 {n}개 중 2개를 씁니다."
                  : mode() === "terminal"
                    ? "기본 터미널로 시작합니다. 역할 팀은 나중에 추가할 수 있고, 두 방식 모두 슬롯 {n}개를 함께 씁니다."
                    : "역할 팀으로 시작합니다. 기본 터미널은 나중에 추가할 수 있고, 두 방식 모두 슬롯 {n}개를 함께 씁니다.",
                { n: maxSlots() },
              )}
            </span>
          </div>
          <div class="launch-footer-actions">
            <button class="btn" onClick={() => setOverlay("connect")}>
              {t("← 워크스페이스 열기")}
            </button>
            <button class="btn primary" disabled={starting() || (mode() === "quick" && claudeMissing())} onClick={next}>
              {starting() ? t("기동 중…") : nextLabel()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
