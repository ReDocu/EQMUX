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
