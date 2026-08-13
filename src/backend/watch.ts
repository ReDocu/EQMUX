// 외부 편집 감지 브리지 (FR-E-73, M35) — Rust notify가 .eqmux 변화를 알리면
// 파일을 다시 실측해 UI를 덮는다 (FR-E-74 — 파일이 이긴다).
// 반영 범위: 임무 목록·배정(missions/) + 라이브러리 오버라이드(jobs/·personas/).
// team.json의 라이브 슬롯 재편은 실행 중 세션과 충돌하므로 하지 않는다 — 재시작 복원이 담당.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createSignal } from "solid-js";
import { refreshLibrary } from "./library";
import { refreshMissions } from "./missions";
import { backend } from "./mock";
import { isTauri } from "./pty";

/** 외부 변경 틱 — 병합 뷰(역할 라이브러리 스코프 등)가 구독해 재실측한다 */
export const [fileChangeTick, setFileChangeTick] = createSignal(0);

const watched = new Set<string>();
let started = false;

/** 열린 워크스페이스만 감시한다 — 열림/닫힘을 방송에서 따라간다 */
function syncWatchers(): void {
  for (const ws of backend.listWorkspaces()) {
    const want = ws.open && !ws.pathMissing;
    if (want && !watched.has(ws.id)) {
      watched.add(ws.id);
      void invoke("ws_watch", { workspaceId: ws.id, wsPath: ws.path }).catch(() => watched.delete(ws.id));
    } else if (!want && watched.has(ws.id)) {
      watched.delete(ws.id);
      void invoke("ws_unwatch", { workspaceId: ws.id }).catch(() => {});
    }
  }
}

export function startFileWatch(): void {
  if (started || !isTauri()) return;
  started = true;
  syncWatchers();
  backend.subscribe(syncWatchers);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  void listen<{ workspaceId: string }>("eqmux-file-change", (e) => {
    const wsId = e.payload.workspaceId;
    // 500ms 디바운스 — 에디터 저장·git 작업은 이벤트를 몰아서 낸다
    clearTimeout(timers.get(wsId));
    timers.set(
      wsId,
      setTimeout(() => {
        timers.delete(wsId);
        void refreshMissions(wsId);
        void refreshLibrary();
        // 감시 재등록 — 그 사이 새로 생긴 missions/·jobs/·personas/ 디렉터리를 잡는다
        const ws = backend.listWorkspaces().find((w) => w.id === wsId);
        if (ws?.open && !ws.pathMissing) {
          void invoke("ws_watch", { workspaceId: wsId, wsPath: ws.path }).catch(() => {});
        }
        setFileChangeTick((t) => t + 1);
      }, 500),
    );
  });
}
