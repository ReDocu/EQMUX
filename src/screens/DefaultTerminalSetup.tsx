// 기본 터미널 구성 (0.5 시안 V4F7KU) — 역할 없는 셸 세션. 실제 기본 셸·브랜치·작업 폴더만 보이고,
// 열기 전에는 아무것도 실행하지 않는다. 첫 빈 슬롯에 셸 하나를 열고, 나머지 슬롯은 그대로 둔다.
import { For, Show } from "solid-js";
import { backend } from "../backend/mock";
import { respawnSessionShell } from "../components/TerminalPane";
import { Icon } from "../components/icons";
import { Segmented } from "../components/ui";
import { maxSlots } from "../backend/settings";
import { t, tf } from "../i18n";
import { defaultShell, setView, tick } from "../state";
import { sessionName, slotNo } from "../types";
import { defaultTerminalPlan } from "./launchRules";

export function DefaultTerminalSetup(props: { wsId: string }) {
  const ws = () => backend.listWorkspaces().find((w) => w.id === props.wsId);
  // 실제 점유 슬롯 (B107) — 이미 찬 슬롯을 빈 것처럼 보이고, 가득 차면 [열기]가 말없이 탭으로 넘어갔다
  const sessions = () => {
    tick();
    return backend.listSessions().filter((x) => x.workspaceId === props.wsId);
  };
  const plan = () => defaultTerminalPlan(sessions(), maxSlots());
  const target = () => {
    const p = plan();
    return "slot" in p ? p.slot : undefined;
  };
  const occupant = (n: number) => sessions().find((x) => x.slot === n && x.status !== "dead");
  const occupantName = (n: number) => {
    const o = occupant(n);
    return o ? sessionName(o, backend.listPersonas().find((p) => p.id === o.personaId)) : "";
  };
  const blocked = () => {
    const p = plan();
    if (!("blocked" in p)) return undefined;
    return p.blocked === "live"
      ? t("기본 터미널이 이미 열려 있습니다 — 탭으로 갑니다")
      : tf("빈 슬롯이 없습니다 ({n}/{n}) — 세션 하나를 닫고 다시 여세요", { n: maxSlots() });
  };
  const full = () => {
    const p = plan();
    return "blocked" in p && p.blocked === "full";
  };

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
        <button class="btn primary" disabled={full()} title={blocked()} onClick={openTerminal}>
          <Icon name="terminal" size={12} />
          {"blocked" in plan() && !full() ? t("탭으로 가기") : t("열기")}
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

        <Show when={blocked()}>
          <div class="card conn-error mono">{blocked()}</div>
        </Show>

        <div class="dts-cards">
          {/* 슬롯 카드 — 개수는 설정 슬롯 상한(maxSlots)을 따라간다. 새 셸이 들어갈 슬롯·이미 찬 슬롯·빈 슬롯 */}
          <For each={Array.from({ length: maxSlots() }, (_, i) => i + 1)}>
            {(n) => (
              <Show
                when={target() === n}
                fallback={
                  <div class="card dts-card">
                    <div class="dts-card-head">
                      <span class="mono dts-card-slot">SLOT {slotNo(n)}</span>
                      <Icon name={occupant(n) ? "square-check" : "square"} size={14} class="muted" />
                    </div>
                    <div class="dts-card-empty muted">
                      <Show when={occupant(n)} fallback={<Icon name="plus" size={18} />}>
                        <Icon name="terminal" size={18} />
                      </Show>
                      <span>
                        {occupant(n) ? tf("사용 중 · {name}", { name: occupantName(n) }) : t("이 슬롯은 비워 둡니다")}
                      </span>
                    </div>
                  </div>
                }
              >
                <div class="card dts-card on">
                  <div class="dts-card-head">
                    <span class="mono dts-card-slot">SLOT {slotNo(n)}</span>
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
              </Show>
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
