// 포트·탐색기 패널 브리지 (PRD H) — 관측 전용 실측. 브라우저 dev에서는 목 폴백.
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./pty";

export interface PortRow {
  port: number;
  host: string;
  pid: number;
  process: string;
  session: string | null;
}

export async function portsSnapshot(): Promise<PortRow[] | undefined> {
  if (!isTauri()) return undefined;
  return invoke<PortRow[]>("ports_snapshot").catch(() => undefined);
}

export interface FsNode {
  name: string;
  rel: string;
  depth: number;
  dir: boolean;
}

export async function fsTree(wsPath: string): Promise<FsNode[] | undefined> {
  if (!isTauri()) return undefined;
  return invoke<FsNode[]>("fs_tree", { wsPath }).catch(() => undefined);
}

export async function fsPreview(wsPath: string, rel: string): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  return invoke<string>("fs_preview", { wsPath, rel }).catch(() => undefined);
}

// ── 스크롤백 검색·디스크 페이징 (FR-C-13·14·16) ──

export interface ScrollbackHit {
  sessionId: string;
  seq: number;
  ts: number;
  text: string;
}

/** 전문 검색 (FTS5, 없으면 LIKE 폴백) — 워크스페이스 DB 하나 스코프 */
export async function searchScrollback(
  wsId: string,
  query: string,
  session?: string,
  limit = 60,
): Promise<ScrollbackHit[]> {
  if (!isTauri()) return [];
  return invoke<ScrollbackHit[]>("scrollback_search", {
    workspace: wsId,
    query,
    session: session ?? null,
    limit,
  }).catch(() => []);
}

/** 디스크 페이징 — before_seq 이전 limit줄, 시간 오름차순 */
export async function pageScrollback(
  wsId: string,
  session: string,
  beforeSeq: number | null,
  limit = 200,
): Promise<ScrollbackHit[]> {
  if (!isTauri()) return [];
  return invoke<ScrollbackHit[]>("scrollback_page", {
    workspace: wsId,
    session,
    beforeSeq,
    limit,
  }).catch(() => []);
}
