// 트랜스크립트 브리지 (PRD G §4.8) — 1급 소스 = 에이전트 JSONL (V1), 실패 시 undefined →
// 화면이 스크롤백 폴백으로 전환하고 그 사실을 표시한다 (FR-G-86).
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./pty";
import type { Session } from "../types";

export interface TranscriptTurnReal {
  role: "user" | "agent" | "tool";
  time: string;
  text: string;
  /** 도구 줄의 접힌 요약 — 건드린 경로·명령 앞부분 (FR-G-83). 도구 턴에만 있다 */
  summary: string | null;
  detail: string | null;
}

export interface TranscriptData {
  file: string;
  turns: TranscriptTurnReal[];
  skipped: number;
  windowed: boolean;
  /** 셸 우선 폴백 — 세션 매핑 없이 cwd의 최신 트랜스크립트로 추정했다 (표시용) */
  guessed: boolean;
}

export async function readTranscript(s: Session): Promise<TranscriptData | undefined> {
  if (!isTauri()) return undefined;
  return invoke<TranscriptData>("transcript_read", {
    workspace: s.workspaceId,
    id: s.id,
    cwd: s.cwd,
  }).catch(() => undefined);
}
