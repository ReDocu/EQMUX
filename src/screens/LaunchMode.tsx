// 실행 방식 선택 (ChIvy · 0.5 시안 xfVq4) — 레인 01의 2단계. 기본 터미널 또는 역할 팀으로 분기한다.
import { createSignal, For, onMount } from "solid-js";
import { listPresets } from "../backend/library";
import { backend } from "../backend/mock";
import { maxSlots } from "../backend/settings";
import { Identity } from "../components/ui";
import { t, tf } from "../i18n";
import { setOverlay, setView } from "../state";
import { projectStem } from "../types";

type Mode = "terminal" | "team";

export function LaunchMode(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  const [mode, setMode] = createSignal<Mode>("terminal");
  // 프리셋 이름 — 원본은 앱데이터 presets/*.json (팀 캐스팅과 같은 실측). 브라우저 dev는 시드 이름
  const [presetNames, setPresetNames] = createSignal(["표준", "집중개발", "제품기획", "품질"]);
  onMount(() => {
    void listPresets().then((list) => list.length > 0 && setPresetNames(list.map((p) => p.name)));
  });

  const next = () => {
    if (mode() === "terminal") setView({ kind: "terminalSetup", wsId: props.wsId });
    else setView({ kind: "casting", wsId: props.wsId });
  };

  const steps = [
    ["01 저장소 연결", "done"],
    ["02 실행 방식", "active"],
    ["03 세션 구성", ""],
    ["04 시작", ""],
  ] as const;

  const choices = () =>
    [
      {
        id: "terminal" as Mode,
        icon: ">_",
        title: t("기본 터미널"),
        copy: t("셸만 연다. 에이전트는 필요할 때 사람이 직접 띄운다. 자동 이름은 프로젝트명XX(EQMUX01…)이고, 만들 때 직접 정할 수도 있다."),
        features: [
          t("세션 이름 · 번호가 헤더와 레일에 붙는다"),
          t("손으로 띄운 claude에는 메시지를 자동 주입하지 않는다 (넣기 칩)"),
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
            {tf("첫 세션을 어떻게 시작할까요? 나중에 바꿀 수 있다 · 두 방식 모두 워크스페이스의 슬롯 {n}개를 쓴다", {
              n: maxSlots(),
            })}
          </div>
        </div>
        <button class="btn primary" onClick={next}>
          {t("→ 계속")}
        </button>
      </div>

      <div class="screen-body launch-body">
        <div class="launch-steps mono">
          <For each={steps}>
            {([label, st], i) => (
              <>
                {i() > 0 && <span class="muted">›</span>}
                <span class="launch-step" classList={{ done: st === "done", active: st === "active" }}>
                  {t(label)}
                </span>
              </>
            )}
          </For>
        </div>

        <div class="launch-choices">
          <For each={choices()}>
            {(c) => (
              <button class="card launch-choice" classList={{ selected: mode() === c.id }} onClick={() => setMode(c.id)}>
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
                mode() === "terminal"
                  ? "기본 터미널로 시작합니다. 역할 팀은 나중에 추가할 수 있고, 두 방식 모두 슬롯 한도 {n}을 함께 쓴다."
                  : "역할 팀으로 시작합니다. 기본 터미널은 나중에 추가할 수 있고, 두 방식 모두 슬롯 한도 {n}을 함께 쓴다.",
                { n: maxSlots() },
              )}
            </span>
          </div>
          <div class="launch-footer-actions">
            <button class="btn" onClick={() => setOverlay("connect")}>
              {t("← 저장소 연결")}
            </button>
            <button class="btn primary" onClick={next}>
              {t("계속")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
