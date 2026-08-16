// 실행 방식 선택 (ChIvy) — 레인 01의 2단계. 기본 터미널(권장) 또는 역할 팀 구성으로 분기한다.
import { createSignal } from "solid-js";
import { backend } from "../backend/mock";
import { maxSlots } from "../backend/settings";
import { t, tf } from "../i18n";
import { setView } from "../state";

type Mode = "terminal" | "team";

export function LaunchMode(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  const [mode, setMode] = createSignal<Mode>("terminal");

  const next = () => {
    if (mode() === "terminal") setView({ kind: "terminalSetup", wsId: props.wsId });
    else setView({ kind: "casting", wsId: props.wsId });
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>{t("실행 방식 선택")}</h1>
          <div class="sub">{ws()?.name} · {t("첫 세션을 어떻게 시작할까요?")}</div>
        </div>
        <button class="btn primary" onClick={next}>
          {t(mode() === "terminal" ? "기본 터미널 설정 →" : "팀 캐스팅 →")}
        </button>
      </div>

      <div class="screen-body">
        <div class="launch-progress mono">
          <span class="muted">{t("01 저장소 연결")}</span>
          <span class="muted">›</span>
          <span class="active">{t("02 실행 방식")}</span>
          <span class="muted">›</span>
          <span class="muted">{t("03 세션 구성")}</span>
          <span class="muted">›</span>
          <span class="muted">{t("04 시작")}</span>
        </div>

        <div class="launch-choices">
          <button class="card launch-choice" classList={{ selected: mode() === "terminal" }} onClick={() => setMode("terminal")}>
            <div class="launch-choice-head">
              <span class="launch-choice-icon mono">&gt;_</span>
              <span class="badge" classList={{ blue: mode() === "terminal" }}>
                {t(mode() === "terminal" ? "선택됨 · 권장" : "권장")}
              </span>
            </div>
            <div class="launch-choice-title">{t("기본 터미널")}</div>
            <div class="launch-choice-sub">{t("역할 없이 현재 저장소에서 바로 시작")}</div>
            <div class="muted launch-choice-desc">
              {t("일반 셸 작업, 빠른 확인, 수동 명령 실행에 적합합니다. 에이전트 역할과 임무 파일을 요구하지 않으며 필요할 때 팀 세션을 추가할 수 있습니다.")}
            </div>
            <div class="launch-divider" />
            <div class="launch-features">
              <div class="launch-feature">{t("⚡ cwd와 셸만 확인하고 즉시 실행")}</div>
              <div class="launch-feature">{t("◌ 역할 · 페르소나 · 임무 지정 없음")}</div>
              <div class="launch-feature">{t("⛁ 동일한 세션 복구 · WAL 보존 정책 적용")}</div>
            </div>
            <div class="launch-route mono">
              <span class="eyebrow">NEXT</span>
              <span>{t("기본 터미널 설정 →")}</span>
            </div>
          </button>

          <button class="card launch-choice" classList={{ selected: mode() === "team" }} onClick={() => setMode("team")}>
            <div class="launch-choice-head">
              <span class="launch-choice-icon mono">⛬</span>
              <span class="badge" classList={{ blue: mode() === "team" }}>
                {t(mode() === "team" ? "선택됨 · 고급 구성" : "고급 구성")}
              </span>
            </div>
            <div class="launch-choice-title">{t("역할 팀 구성")}</div>
            <div class="launch-choice-sub">{t("역할과 임무를 가진 에이전트 팀 시작")}</div>
            <div class="muted launch-choice-desc">
              {tf("최대 {n}개 세션에 역할, 페르소나, 권한과 임무를 배정합니다. 병렬 구현, 리뷰, 조사처럼 책임이 분리된 작업에 적합합니다.", { n: maxSlots() })}
            </div>
            <div class="launch-divider" />
            <div class="launch-features">
              <div class="launch-feature">{t("✓ 역할 · 페르소나별 세션 구성")}</div>
              <div class="launch-feature">{t("☰ .eqmux 임무와 권한 정책 연결")}</div>
              <div class="launch-feature">{tf("▦ 최대 {n}개 책임 영역 병렬 실행", { n: maxSlots() })}</div>
            </div>
            <div class="launch-route mono">
              <span class="eyebrow">NEXT</span>
              <span>{t("팀 캐스팅 →")}</span>
            </div>
          </button>
        </div>

        <div class="cast-footer card">
          <div>
            <div style={{ "font-weight": 700, "font-size": "12px" }}>
              {t(mode() === "terminal" ? "기본 터미널로 시작합니다." : "역할 팀 구성으로 시작합니다.")}
            </div>
            <div class="muted" style={{ "font-size": "11px" }}>
              {t("역할 팀은 나중에 추가할 수 있으며 일반 터미널도 워크스페이스의 세션 한도를 사용합니다.")}
            </div>
          </div>
          <button class="btn primary" onClick={next}>
            {t("계속")}
          </button>
        </div>
      </div>
    </div>
  );
}
