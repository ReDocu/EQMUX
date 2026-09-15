// 마지막 한 줄 요약 (M35) — "이 페인이 마지막에 무엇을 했는가".
// 원본은 SQLite(session.last_recap)다. Stop 훅이 트랜스크립트에서 뽑아 Rust가 적는다.
// 두 경로가 같은 곳으로 모인다: 찬 시작은 session_recaps 질의, 그 뒤는 session-recap 이벤트.
// 앱을 껐다 켰을 때 보이는 것이 이 기능의 목적이므로, 복원 경로가 본체고 라이브가 덤이다.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { backend } from "./mock";
import { isTauri } from "./pty";

/** [세션 id, 문장, 적은 시각] */
type RecapRow = [string, string, number];

/** 워크스페이스 하나의 저장된 요약을 세션에 얹는다 — restoreTeams 뒤에 부른다
 *  (세션이 있어야 붙는다. flags.ts의 부트스트랩 복원과 같은 이유다) */
export async function restoreRecaps(workspaceId: string): Promise<void> {
  if (!isTauri()) return;
  const rows = await invoke<RecapRow[]>("session_recaps", { workspace: workspaceId }).catch(
    () => [] as RecapRow[],
  );
  for (const [id, text] of rows) backend.applyRecap(id, text);
}

/** 라이브 갱신 — 턴이 끝날 때마다 Rust가 보낸다. 재시작을 기다리지 않는다 */
export function startRecapUpdates(): void {
  if (!isTauri()) return;
  void listen<{ session: string; text: string }>("session-recap", (e) =>
    backend.applyRecap(e.payload.session, e.payload.text),
  );
}
