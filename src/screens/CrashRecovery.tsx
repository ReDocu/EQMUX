// 비정상 종료 복구 안내 (FR-C-35) — 직전 실행이 정상 종료되지 못했을 때 첫 실행에서 1회 표시.
// 목록만 보여준다 — 재개는 각 워크스페이스 페인의 재개 제안(FR-C-33)에서 사용자가 실행한다 (C5).
import { For } from "solid-js";
import type { CrashReport } from "../backend/recovery";
import { t, tf } from "../i18n";

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
  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="dialog" style={{ width: "560px" }} onClick={(e) => e.stopPropagation()}>
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
                <span>
                  <b class="mono">{s.id}</b>{" "}
                  <span class="muted mono" style={{ "font-size": "11px" }}>
                    {s.workspace}
                  </span>
                </span>
                <span class="mono" style={{ "font-size": "11px" }}>
                  <span class="muted">{fmtLastActivity(s.lastOutputAt)}</span>{" "}
                  <span classList={{ "st-busy": s.resumable, "st-dead": !s.resumable }}>
                    {s.resumable ? t("재개 가능") : t("재개 불가")}
                  </span>
                </span>
              </div>
            )}
          </For>
        </div>
        <div class="card inset" style={{ margin: "12px 20px", padding: "8px 12px" }}>
          <span class="muted" style={{ "font-size": "11px" }}>
            {t("자동으로 재실행하지 않습니다 — 워크스페이스 탭을 열면 각 페인에 재개 제안이 표시됩니다.")}
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
