// 트랜스크립트 브리지 (PRD G §4.8) — 1급 소스 = 에이전트 JSONL (V1), 실패 시 undefined →
// 화면이 스크롤백 폴백으로 전환하고 그 사실을 표시한다 (FR-G-86).
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./pty";
import type { Session } from "../types";

export interface TranscriptTurnReal {
  role: "user" | "agent" | "tool";
  time: string;
  text: string;
  detail: string | null;
}

export interface TranscriptData {
  file: string;
  turns: TranscriptTurnReal[];
  skipped: number;
  windowed: boolean;
}

export async function readTranscript(s: Session): Promise<TranscriptData | undefined> {
  if (!isTauri()) return undefined;
  return invoke<TranscriptData>("transcript_read", {
    workspace: s.workspaceId,
    id: s.id,
    cwd: s.cwd,
  }).catch(() => undefined);
}
