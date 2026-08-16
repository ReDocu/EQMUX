// 기본 터미널 구성 (S9u2S) — 역할 없는 셸 세션 설정. 저장 후 워크스페이스를 연다.
import { For } from "solid-js";
import { backend } from "../backend/mock";
import { maxSlots } from "../backend/settings";
import { t, tf } from "../i18n";
import { setView } from "../state";

export function DefaultTerminalSetup(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);

  const openTerminal = () => {
    backend.openWorkspace(props.wsId);
    backend.startDefaultTerminal(props.wsId); // 역할 없는 셸 세션 → 실제 PTY 부착
    setView({ kind: "workspace", id: props.wsId });
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>{t("기본 터미널 구성")}</h1>
          <div class="sub">{ws()?.name} · {t("역할 없는 셸 세션 설정")}</div>
        </div>
        <button class="btn primary" onClick={openTerminal}>
          {t("터미널 열기")}
        </button>
      </div>

      <div class="screen-body">
        <div class="dts-mode-row">
          <button class="btn primary mono">&gt;_ {t("기본 터미널")}</button>
          <button class="btn" onClick={() => setView({ kind: "launch", wsId: props.wsId })}>
            ⛬ {t("역할 팀 구성")}
          </button>
          <span class="muted" style={{ "font-size": "11px" }}>
            {t("변경하면 실행 방식 선택 단계로 돌아갑니다.")}
          </span>
        </div>

        <div class="dts-grid">
          <div class="card dts-guide">
            <span class="badge blue mono">&gt;_ ROLELESS SESSION</span>
            <div class="dts-guide-title">{t("역할 없이, 바로 터미널")}</div>
            <div class="muted" style={{ "font-size": "12px" }}>
              {t("팀·역할·임무를 지정하지 않은 일반 셸 세션입니다. 현재 저장소를 그대로 열고 필요할 때 역할 세션으로 전환할 수 있습니다.")}
            </div>
            <div class="launch-divider" />
            <div class="launch-features">
              <div class="launch-feature">{t("✓ 추가 설정 없이 즉시 시작")}</div>
              <div class="launch-feature">{tf("✓ 워크스페이스당 최대 {n}개 세션", { n: maxSlots() })}</div>
              <div class="launch-feature">{t("✓ 언제든 역할 · 임무 세션으로 전환")}</div>
            </div>
            <div class="card inset" style={{ padding: "8px 10px" }}>
              <div class="eyebrow">START CONTEXT</div>
              <div class="kv">
                <span class="k">cwd</span>
                <span class="v">{ws()?.path ?? "—"}</span>
              </div>
              <div class="kv">
                <span class="k">shell</span>
                <span class="v">pwsh · login</span>
              </div>
            </div>
            <div class="dts-persist mono muted">⛁ {t("스크롤백과 세션 상태는 기존 WAL 정책으로 보존됩니다.")}</div>
          </div>

          <div class="card dts-preview">
            <div class="terminal-head mono">
              <span>
                <span class="dts-ready-dot" /> session-01 · {t("기본 터미널")}
              </span>
              <span>READY</span>
            </div>
            <div class="terminal-body mono dts-screen">
              <div class="muted">EQMUX workspace connected · branch {ws()?.branch ?? "main"}</div>
              <div>
                <span class="muted">{ws()?.path ?? "~"}</span> $ git status --short
              </div>
              <div class="st-waiting"> M docs/design.pen</div>
              <div>
                <span class="muted">{ws()?.path ?? "~"}</span> $ <span class="dts-cursor">_</span>
              </div>
            </div>
            <div class="dts-slots">
              <div class="card inset dts-slot active">
                <span class="mono">{t("01 · 기본")}</span>
                <span class="mono" style={{ color: "var(--eq-green)" }}>
                  ready
                </span>
              </div>
              {/* 빈 슬롯 카드 — 개수는 설정 슬롯 상한(maxSlots)을 따라간다 */}
              <For each={Array.from({ length: maxSlots() - 1 }, (_, i) => i + 2)}>
                {(n) => (
                  <div class="card inset dts-slot">
                    <span class="mono muted">{String(n).padStart(2, "0")} · {t("비어 있음")}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>

        <div class="cast-footer card">
          <div>
            <div style={{ "font-weight": 700, "font-size": "12px" }}>{t("기본 터미널 구성을 저장하시겠습니까?")}</div>
            <div class="muted" style={{ "font-size": "11px" }}>
              {t("팀 역할은 비워 두고 현재 저장소와 셸 설정만 워크스페이스에 기록합니다.")}
            </div>
          </div>
          <button class="btn primary" onClick={openTerminal}>
            {t("저장 후 열기")}
          </button>
        </div>
      </div>
    </div>
  );
}
