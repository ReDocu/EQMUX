// 비정상 종료 복구 안내 (FR-C-35) — 직전 실행이 정상 종료되지 못했을 때 첫 실행에서 1회 표시.
// 목록만 보여준다 — 재개는 각 워크스페이스 페인의 재개 제안(FR-C-33)에서 사용자가 실행한다 (C5).
import { For, onCleanup, Show } from "solid-js";
import { backend } from "../backend/mock";
import type { CrashReport, CrashSession } from "../backend/recovery";
import { t, tf } from "../i18n";
import { openSessionDetail, pushLayer, tick } from "../state";
import { sessionName } from "../types";

/** 내부 id(`shell1@eqmux-1e3b93`) 대신 사람이 아는 이름 — 세션이 복원돼 있으면 세션 이름,
 *  아직이면 id 앞부분의 페르소나 이름, 그것도 없으면 기본 터미널이다 */
function crashName(c: CrashSession): string {
  tick(); // 팀 복원이 끝나면 이름이 따라온다
  const personas = backend.listPersonas();
  const s = backend.listSessions().find((x) => x.id === c.id);
  if (s) return sessionName(s, personas.find((p) => p.id === s.personaId));
  return personas.find((p) => p.id === c.id.split("@")[0])?.name ?? t("기본 터미널");
}

/** 세션이 복원돼 탭에 있다 — 그 페인으로 바로 갈 수 있다 */
function restored(c: CrashSession): boolean {
  tick();
  return backend.listSessions().some((x) => x.id === c.id);
}

/** 기본 터미널 행 — 역할이 없으니 셸만 다시 열린다 (B109). crashName과 같은 판정 */
function shellOnly(c: CrashSession): boolean {
  const s = backend.listSessions().find((x) => x.id === c.id);
  if (s) return !s.personaId;
  return !backend.listPersonas().some((p) => p.id === c.id.split("@")[0]);
}

/** DB 폴더 이름(워크스페이스 id) → 표시 이름. 프런트가 모르는 워크스페이스면 내부 id 대신 중립 표시 (U63) */
const wsName = (id: string) => backend.listWorkspaces().find((w) => w.id === id)?.name ?? t("알 수 없는 워크스페이스");

function fmtLastActivity(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const abs = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const min = Math.floor((Date.now() - ms) / 60000);
  const rel =
    min < 1
      ? t("방금")
      : min < 60
        ? tf("{m}분 전", { m: min })
        : min < 1440
          ? tf("{h}시간 전", { h: Math.floor(min / 60) })
          : tf("{d}일 전", { d: Math.floor(min / 1440) });
  return `${abs} (${rel})`;
}

export function CrashRecovery(props: { report: CrashReport; onClose: () => void }) {
  // 레이어로만 올린다 — Esc가 이 창도 그 밑의 것도 닫지 않는다 (바깥 클릭과 같은 이유)
  let box: HTMLDivElement | undefined;
  onCleanup(pushLayer(() => {}, () => box)); // 모달 — Tab 가두기·뒤 이동 막기 (U37·B72)
  return (
    // 바깥 클릭으로 닫지 않는다 — 값은 첫 조회에 소비돼 다시 띄울 수 없다 (U63)
    <div class="overlay">
      <div ref={box} class="dialog" role="dialog" aria-modal="true" aria-label={t("직전 실행이 정상 종료되지 않았습니다")} style={{ width: "560px" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ "font-size": "16px", "font-weight": 800 }}>{t("직전 실행이 정상 종료되지 않았습니다")}</div>
          <div class="muted" style={{ "font-size": "12px", "margin-top": "4px" }}>
            {t("종료 시퀀스를 거치지 못한 채 끝났습니다. 그때 실행 중이던 세션과 마지막 활동 시각입니다.")}
          </div>
        </div>
        <div style={{ padding: "12px 20px 0", "max-height": "300px", "overflow-y": "auto" }}>
          <For each={props.report.sessions}>
            {(s) => (
              <div class="kv">
                <span title={s.id}>
                  <b>{crashName(s)}</b>{" "}
                  <span class="muted" style={{ "font-size": "11px" }}>
                    {wsName(s.workspace)}
                  </span>
                </span>
                <span class="mono" style={{ "font-size": "11px" }}>
                  <span class="muted">{fmtLastActivity(s.lastOutputAt)}</span>{" "}
                  <Show
                    when={!shellOnly(s)}
                    fallback={<span class="muted">{t("셸만 복원")}</span>}
                  >
                    <span classList={{ "st-busy": s.resumable, "st-dead": !s.resumable }}>
                      {s.resumable ? t("재개 가능") : t("재개 불가")}
                    </span>
                  </Show>
                  {/* 복원된 세션이면 그 세션 상세를 바로 연다 — [▶ 이전 대화 재개]가 거기 있다 (U63) */}
                  <Show when={restored(s)}>
                    {" "}
                    <button
                      class="btn"
                      style={{ "font-size": "11px", padding: "1px 8px" }}
                      onClick={() => {
                        if (openSessionDetail(s.workspace, s.id)) props.onClose();
                      }}
                    >
                      {t("세션 상세")}
                    </button>
                  </Show>
                </span>
              </div>
            )}
          </For>
        </div>
        <div class="card inset" style={{ margin: "12px 20px", padding: "8px 12px" }}>
          <span class="muted" style={{ "font-size": "11px" }}>
            {/* 안내는 실제로 존재하는 경로만 가리킨다 — 버튼 이름은 엔진마다 다르므로(▶ Claude 기동 …)
                특정 이름에 묶지 않는다 (B109 · B33 재발). 기동은 페인 상태 줄, 재개는 세션 상세다. */}
            {t("자동으로 재실행하지 않습니다 — 역할 세션은 페인 위 상태 줄의 [▶ 기동]으로, 이전 대화는 세션 상세의 [▶ 이전 대화 재개]로 다시 시작합니다. 기본 터미널은 셸이 다시 열립니다.")}
          </span>
        </div>
        <div style={{ display: "flex", "justify-content": "flex-end", padding: "0 20px 16px" }}>
          <button class="btn primary" onClick={props.onClose}>
            {t("확인")}
          </button>
        </div>
      </div>
    </div>
  );
}
