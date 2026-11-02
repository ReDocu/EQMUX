// 실행 방식 선택 (ChIvy · 0.5 시안 xfVq4) — 레인 01의 2단계. 빠른 시작 · 기본 터미널 · 역할 팀으로 분기한다.
import { createSignal, For, onMount } from "solid-js";
import { listPresets } from "../backend/library";
import { backend } from "../backend/mock";
import { maxSlots } from "../backend/settings";
import { launchRoleAgents } from "../components/TerminalPane";
import { Identity, notify } from "../components/ui";
import { t, tf } from "../i18n";
import { setFocusRequest, setOverlay, setSelectedSession, setView } from "../state";
import { projectStem } from "../types";
import { quickStartSlots, wizardSteps } from "./launchRules";
import type { WizardPath } from "./launchRules";

type Mode = WizardPath;

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
  const quickSlots = () => quickStartSlots(backend.listPersonas(), backend.listJobs().map((j) => j.id));
  const personaName = (id: string) => backend.listPersonas().find((p) => p.id === id)?.name ?? id;

  // 빠른 시작 — 사람이 누른 버튼이 편성 · 기동까지 한 번에 한다. 임무는 배정하지 않는다
  const quickStart = () => {
    const slots = quickSlots();
    if (slots.length === 0) return notify(t("페르소나가 없어 빠른 시작을 할 수 없습니다 — 역할 팀으로 시작하세요"));
    backend.applyCasting(props.wsId, slots);
    backend.openWorkspace(props.wsId);
    const list = backend.listSessions().filter((s) => s.workspaceId === props.wsId && s.personaId);
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
    if (mode() === "quick") quickStart();
    else if (mode() === "terminal") setView({ kind: "terminalSetup", wsId: props.wsId });
    else setView({ kind: "casting", wsId: props.wsId, wizard: true });
  };
  // 마지막 버튼은 실제 도착지를 말한다 (P50)
  const nextLabel = () =>
    mode() === "quick" ? t("2세션으로 시작 → 워크스페이스") : mode() === "terminal" ? t("다음: 기본 터미널 구성 →") : t("다음: 팀 캐스팅 →");

  const choices = () =>
    [
      {
        id: "quick" as Mode,
        icon: "»",
        title: t("빠른 시작"),
        copy: t("폴더만 있으면 된다. 리드와 개발 Claude Code 세션 2개를 바로 띄운다. 캐스팅 · 페르소나 · 임무는 건너뛰고, 팀은 나중에 고칠 수 있다."),
        features: [
          quickSlots().length > 0
            ? tf("편성: {list}", {
                list: quickSlots()
                  .map((sl) => `${personaName(sl.personaId)} (${sl.jobId === "lead" ? t("리드") : t("개발")})`)
                  .join(" · "),
              })
            : t("페르소나가 없어 쓸 수 없다 — 역할 팀으로"),
          t("세션이 많을수록 사용 한도를 빨리 쓴다 — 2개로 시작한다"),
          tf("더 필요하면 팀 캐스팅에서 {n}개까지 늘린다", { n: maxSlots() }),
        ],
        route: t("다음 → 워크스페이스 (Claude Code 2개 기동)"),
        example: () => <Identity slot={1} name={personaName(quickSlots()[0]?.personaId ?? "")} title={t("리드")} cli="claude" />,
      },
      {
        id: "terminal" as Mode,
        icon: ">_",
        title: t("기본 터미널"),
        copy: t("셸만 연다. 에이전트는 필요할 때 사람이 직접 띄운다. 자동 이름은 프로젝트명XX(EQMUX01…)이고, 만들 때 직접 정할 수도 있다."),
        features: [
          t("세션 이름 · 번호가 헤더와 레일에 붙는다"),
          t("손으로 띄운 claude에는 기본으로 메시지를 쌓아 둔다 (넣기 칩) · 설정에서 idle 자동 넣기로 변경"),
          t("역할 팀은 나중에 팀 캐스팅으로 추가"),
        ],
        route: t("다음 → 기본 터미널 구성 (셸 · 브랜치 · 이름)"),
        example: () => <Identity slot={1} name={`${projectStem(ws()?.name ?? "")}01`} compact />,
      },
      {
        id: "team" as Mode,
        icon: "⛬",
        title: t("역할 팀"),
        copy: t("페르소나·직무·직함을 슬롯에 배정해 Claude Code·Codex 세션을 띄운다. 역할 파일과 team.md가 합성되고 메시지 버스가 켜진다."),
        features: [
          t("직함으로 맡는 영역을 나눈다 (클라이언트 · 서버 개발자)"),
          t("완료 신호 · 열린 handoff 회신 · 프로젝트 간 통신"),
          tf("프리셋: {list}", { list: presetNames().map((n) => t(n)).join(" · ") }),
        ],
        route: t("다음 → 팀 캐스팅 → 팀 편성 → 관제"),
        example: () => <Identity slot={3} name={t("카이")} title={t("클라이언트 개발자")} cli="claude" />,
      },
    ] as const;

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>
            {t("실행 방식 선택")} · {ws()?.name}
          </h1>
          <div class="sub mono">
            {tf("첫 세션을 어떻게 시작할까요? 나중에 바꿀 수 있어요 · 두 방식 모두 워크스페이스의 슬롯 {n}개를 써요", {
              n: maxSlots(),
            })}
          </div>
        </div>
        {/* [계속]은 아래 막대 하나 — 머리와 바닥에 같은 버튼이 둘 있었다 (U30) */}
      </div>

      <div class="screen-body launch-body">
        <WizardSteps path={mode()} at={1} />

        <div class="launch-choices" role="radiogroup" aria-label={t("실행 방식")}>
          <For each={choices()}>
            {(c) => (
              <button
                class="card launch-choice"
                role="radio"
                aria-checked={mode() === c.id}
                classList={{ selected: mode() === c.id }}
                onClick={() => setMode(c.id)}
              >
                <div class="launch-choice-head">
                  <span class="launch-choice-icon mono">{c.icon}</span>
                  <span class="launch-choice-title">{c.title}</span>
                  <span class="launch-radio" classList={{ on: mode() === c.id }} aria-hidden="true">
                    {mode() === c.id ? "✓" : ""}
                  </span>
                </div>
                <div class="muted launch-choice-desc">{c.copy}</div>
                <div class="launch-divider" />
                <div class="launch-features">
                  <For each={c.features}>
                    {(f) => (
                      <div class="launch-feature">
                        <span class="launch-check">✓</span>
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
          <div class="launch-footer-note">
            <span class="launch-info">ⓘ</span>
            <span class="muted">
              {tf(
                mode() === "quick"
                  ? "리드와 개발 2세션으로 시작해요. 워크스페이스가 열리면 Claude Code가 바로 떠요. 슬롯 {n}개 중 2개를 써요."
                  : mode() === "terminal"
                    ? "기본 터미널로 시작해요. 역할 팀은 나중에 추가할 수 있고, 두 방식 모두 슬롯 {n}개를 함께 써요."
                    : "역할 팀으로 시작해요. 기본 터미널은 나중에 추가할 수 있고, 두 방식 모두 슬롯 {n}개를 함께 써요.",
                { n: maxSlots() },
              )}
            </span>
          </div>
          <div class="launch-footer-actions">
            <button class="btn" onClick={() => setOverlay("connect")}>
              {t("← 저장소 연결")}
            </button>
            <button class="btn primary" onClick={next}>
              {nextLabel()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
