// 역할 라이브러리 브리지 (PRD E §4.3) — 앱데이터 jobs/*.md·personas/*.md가 원본 (FR-E-20~23).
// 부트스트랩에서 하이드레이트하고, 화면의 CRUD는 파일을 고친 뒤 다시 실측한다.
// 브라우저 dev에서는 기존 목 배열이 그대로 남는다.
import { invoke } from "@tauri-apps/api/core";
import { backend } from "./mock";
import { isTauri } from "./pty";
import type { Job, Persona } from "../types";

interface LibraryData {
  jobs: Job[];
  personas: (Omit<Persona, "color"> & { color: string })[];
}

const COLORS: Persona["color"][] = ["blue", "purple", "green", "amber"];

function toPersona(p: LibraryData["personas"][number]): Persona {
  return {
    ...p,
    color: (COLORS as string[]).includes(p.color) ? (p.color as Persona["color"]) : "blue",
  };
}

/** 라이브러리 실측 → 목 배열 교체. 전역 계층만 쓴다 — 오버라이드 병합은 Rust가 지원(ws_path) */
export async function refreshLibrary(): Promise<void> {
  if (!isTauri()) return;
  const lib = await invoke<LibraryData>("library_list", { wsPath: null }).catch(() => undefined);
  if (lib && lib.jobs.length > 0) {
    backend.hydrateLibrary(lib.jobs, lib.personas.map(toPersona));
  }
}

export async function savePersonaFile(p: Persona): Promise<void> {
  if (!isTauri()) {
    backend.savePersona(p);
    return;
  }
  await invoke("library_save_persona", { persona: p }).catch(() => {});
  await refreshLibrary();
}

export async function addPersonaFile(): Promise<void> {
  if (!isTauri()) {
    backend.addPersona();
    return;
  }
  const id = `p${Date.now().toString(36)}`;
  await invoke("library_save_persona", {
    persona: { id, name: "새 페르소나", hint: "판단 우선순위 · 강조점 · 금기를 5~10줄로", color: "blue" },
  }).catch(() => {});
  await refreshLibrary();
}

export async function deletePersonaFile(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("library_delete_persona", { id }).catch(() => {});
  await refreshLibrary();
}
