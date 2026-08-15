// 미확인 영속 (FR-G-44 잔여 — G) — 재시작해도 세션 미확인 점이 남게 워크스페이스 DB의
// assignment_cache(KV)에 캐시한다. 원본은 어디까지나 화면 상태이고 DB는 캐시다 (FR-C-23).
import { invoke } from "@tauri-apps/api/core";
import { backend } from "./mock";
import { isTauri } from "./pty";

const KEY = "unseen";
const lastSaved = new Map<string, string>();

/** 부트스트랩 복원 — restoreTeams 이후(세션이 존재해야 마킹이 붙는다) 호출된다 */
export async function restoreUnseen(): Promise<void> {
  if (!isTauri()) return;
  for (const ws of backend.listWorkspaces()) {
    if (ws.pathMissing) continue;
    const raw = await invoke<string | null>("cache_get", { workspace: ws.id, key: KEY }).catch(() => null);
    if (!raw) continue;
    lastSaved.set(ws.id, raw);
    try {
      backend.hydrateUnseen(ws.id, JSON.parse(raw) as string[]);
    } catch {
      /* 손상 캐시 — 무시하고 다음 저장이 덮는다 */
    }
  }
}

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** 변경 감지 → 800ms 디바운스 저장. 반드시 restoreUnseen 이후에 시작한다 */
export function startUnseenSync(): void {
  if (started || !isTauri()) return;
  started = true;
  backend.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(flushUnseenNow, 800);
  });
}

/** 디바운스 즉시 flush — 종료 시퀀스가 부른다. sync 시작 전에는 no-op (빈 상태 덮어쓰기 방지) */
export function flushUnseenNow(): void {
  if (!started) return;
  clearTimeout(timer);
  for (const ws of backend.listWorkspaces()) {
    if (ws.pathMissing) continue;
    const ids = backend
      .listSessions()
      .filter((s) => s.workspaceId === ws.id && s.unseen)
      .map((s) => s.id);
    const json = JSON.stringify(ids);
    if (lastSaved.get(ws.id) === json) continue;
    lastSaved.set(ws.id, json);
    void invoke("cache_set", { workspace: ws.id, key: KEY, value: json }).catch(() => {});
  }
}
