// 같은 파일 동시 편집 경고 (0.6 §13-1 · C1) — 대시보드 주의 카드 · 페인 머리 칩.
// 막지도, 자동으로 보내지도 않는다. [○○에게 알리기]는 사람이 고칠 수 있는 ask 초안을 연다.
import { For } from "solid-js";
import { activeConflicts, conflictName, conflictsOf, dismissConflict, fmtAgo, outsideOf } from "../backend/attention";
import type { EditConflict } from "../backend/attention";
import { t, tf } from "../i18n";
import { openDraft } from "../state";
import { Chip } from "./ui";

const LIMIT_NOTE = "편집 도구로 고친 것만 잡습니다 (Bash · Codex 제외)";

/** 이 세션에게 보낼 초안 — 나머지 세션 이름을 넣는다 */
export function conflictDraft(c: EditConflict, to: string, name: (id: string) => string = conflictName): string {
  const others = c.sessions.filter((x) => x !== to).map(name).join(" · ");
  return tf("{path}를 {others}도 방금 편집했습니다. 서로 덮어쓰지 않게 {others}와 나눠 맡아 주세요.", { path: c.path, others });
}

/** 대시보드 주의 카드 — 살아 있는 동시 편집 하나에 카드 하나 */
export function ConflictCards() {
  return (
    <For each={activeConflicts()}>
      {(c) => (
        <div class="card conflict-card" role="alert">
          <div class="conflict-t">
            {tf("{names}이(가) 동시에 편집 중", { names: c.sessions.map(conflictName).join(" · ") })}
          </div>
          <div class="mono conflict-path" title={c.path}>
            {c.path}
          </div>
          <div class="muted conflict-why">
            {fmtAgo(Date.now() - c.ts)} · {t(LIMIT_NOTE)}
          </div>
          <div class="conflict-acts">
            <For each={c.sessions}>
              {(id) => (
                <button class="btn" onClick={() => openDraft(c.workspace, id, conflictDraft(c, id))}>
                  {tf("{name}에게 알리기", { name: conflictName(id) })}
                </button>
              )}
            </For>
            <button class="btn ghost" title={t("같은 파일에 새 편집이 오면 다시 뜹니다")} onClick={() => dismissConflict(c)}>
              {t("닫기")}
            </button>
          </div>
        </div>
      )}
    </For>
  );
}

/** 페인 머리 칩 — 이 세션이 걸린 동시 편집 중 가장 최근 것. [알리기]는 상대(첫 다른 세션)에게 초안 */
export function PaneConflictChip(props: { sessionId: string }) {
  const c = () => conflictsOf(props.sessionId)[0];
  const other = () => c()?.sessions.find((x) => x !== props.sessionId);
  return (
    <>
      {c() && (
        <Chip
          tone="amber"
          text={tf("동시 편집 · {path}", { path: c()!.path.split("/").pop() ?? c()!.path })}
          short={t("동시 편집")}
          title={`${tf("{names}이(가) {path}를 동시에 편집 중", {
            names: c()!.sessions.map(conflictName).join(" · "),
            path: c()!.path,
          })} — ${t(LIMIT_NOTE)}`}
          action={
            other()
              ? {
                  label: tf("{name}에게 알리기", { name: conflictName(other()!) }),
                  onClick: () => openDraft(c()!.workspace, other()!, conflictDraft(c()!, other()!)),
                }
              : undefined
          }
        />
      )}
      {/* 담당 밖 편집 (U120) — 동시 편집과 같은 자리에 10분. 막지 않고 보이기만 한다 */}
      {!c() && outsideOf(props.sessionId) && (
        <Chip
          tone="amber"
          text={tf("담당 밖 · {path}", { path: outsideOf(props.sessionId)!.path.split("/").pop() ?? "" })}
          short={t("담당 밖")}
          title={`${outsideOf(props.sessionId)!.path} — ${tf("담당: {owns}", { owns: outsideOf(props.sessionId)!.owns.join(" ") })}`}
        />
      )}
    </>
  );
}
