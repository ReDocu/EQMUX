// 기본 터미널 구성 (0.5 시안 V4F7KU) — 역할 없는 셸 세션. 실제 기본 셸·브랜치·작업 폴더만 보이고,
// 열기 전에는 아무것도 실행하지 않는다. 슬롯 01에 셸 하나를 열고, 나머지 슬롯은 비워 둔다.
import { For } from "solid-js";
import { backend } from "../backend/mock";
import { respawnSessionShell } from "../components/TerminalPane";
import { Icon } from "../components/icons";
import { Segmented } from "../components/ui";
import { maxSlots } from "../backend/settings";
import { t } from "../i18n";
import { defaultShell, setView } from "../state";
import { slotNo } from "../types";

export function DefaultTerminalSetup(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);

  const openTerminal = () => {
    backend.openWorkspace(props.wsId);
    // 역할 없는 셸 세션 → 실제 PTY 부착. 죽어 있던 세션을 되살렸다면 PTY도 다시 띄운다 (B58) —
    // 페인의 initialized 래치는 세션이 제거될 때만 풀리므로 재마운트가 대신 스폰해 주지 않는다
    const revived = backend.startDefaultTerminal(props.wsId);
    if (revived) void respawnSessionShell(revived.id, revived.cwd, revived.workspaceId, revived.shell);
    setView({ kind: "workspace", id: props.wsId });
  };

  return (
    <div class="screen dts">
      <div class="screen-head">
        <div>
          <h1>
            {t("기본 터미널 구성")} · {ws()?.name}
          </h1>
          <div class="sub mono">{t("실제 기본 셸과 브랜치를 보입니다 · 열기 전에는 아무것도 실행하지 않습니다")}</div>
        </div>
        <button class="btn primary" onClick={openTerminal}>
          <Icon name="terminal" size={12} />
          {t("열기")}
        </button>
      </div>

      <div class="screen-body dts-body">
        <div class="dts-mode-row">
          {/* 역할 세션 쪽은 실행 방식 선택(팀 캐스팅 입구)으로 간다 — 0.4.2의 "역할 팀 구성" 버튼과 같은 동작 */}
          <Segmented
            label={t("실행 방식")}
            items={[
              { value: "terminal", label: t("기본 터미널") },
              { value: "role", label: t("역할 세션") },
            ]}
            value="terminal"
            onChange={() => setView({ kind: "launch", wsId: props.wsId })}
          />
          <span class="muted">{t("역할 세션은 팀 캐스팅에서")}</span>
        </div>

        <div class="dts-cards">
          <div class="card dts-card on">
            <div class="dts-card-head">
              <span class="mono dts-card-slot">SLOT {slotNo(1)}</span>
              <Icon name="square-check" size={14} />
            </div>
            <div class="kv">
              <span class="k">{t("셸")}</span>
              <span class="v mono">{defaultShell().label}</span>
            </div>
            <div class="kv">
              <span class="k">{t("브랜치")}</span>
              <span class="v mono">{ws()?.branch ?? "—"}</span>
            </div>
            <div class="kv">
              <span class="k">{t("작업 폴더")}</span>
              <span class="v mono" title={ws()?.path}>
                {ws()?.path ?? "—"}
              </span>
            </div>
          </div>
          {/* 빈 슬롯 카드 — 개수는 설정 슬롯 상한(maxSlots)을 따라간다 */}
          <For each={Array.from({ length: maxSlots() - 1 }, (_, i) => i + 2)}>
            {(n) => (
              <div class="card dts-card">
                <div class="dts-card-head">
                  <span class="mono dts-card-slot">SLOT {slotNo(n)}</span>
                  <Icon name="square" size={14} class="muted" />
                </div>
                <div class="dts-card-empty muted">
                  <Icon name="plus" size={18} />
                  <span>{t("이 슬롯은 비워 둡니다")}</span>
                </div>
              </div>
            )}
          </For>
        </div>

        <div class="dts-footer">
          <Icon name="info" size={13} />
          <span class="muted">{t("기본 셸은 설정의 '기본 셸' 값입니다. 열기 전에는 아무것도 실행하지 않습니다.")}</span>
        </div>
      </div>
    </div>
  );
}
