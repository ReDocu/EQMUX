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

// ── 직무 CRUD (FR-E-28) — 편집·복제·삭제. 복제 = 새 id로 저장, 같은 경로 하나다 ──

export async function saveJobFile(j: Job): Promise<void> {
  if (!isTauri()) {
    backend.saveJob(j);
    return;
  }
  await invoke("library_save_job", { job: j }).catch(() => {});
  await refreshLibrary();
}

export async function duplicateJobFile(src: Job): Promise<void> {
  const copy: Job = { ...src, id: `${src.id}-copy-${Date.now().toString(36)}`, name: `${src.name} (복제)` };
  await saveJobFile(copy);
}

export async function addJobFile(): Promise<void> {
  await saveJobFile({
    id: `j${Date.now().toString(36)}`,
    name: "새 직무",
    permissions: { write: false, commit: false, push: false }, // 기본은 가장 보수적으로 (D5)
    responsibility: "책임 · 산출물을 적으세요",
    forbidden: "금지를 적으세요",
  });
}

export async function deleteJobFile(id: string): Promise<void> {
  if (!isTauri()) {
    backend.deleteJob(id);
    return;
  }
  await invoke("library_delete_job", { id }).catch(() => {});
  await refreshLibrary();
}

// ── 워크스페이스 오버라이드 화면 반영 (FR-E-21, M30) — 병합 목록 + 출처 마킹 ──

export type LibSource = "global" | "ws";
export interface MergedLibrary {
  jobs: (Job & { source: LibSource })[];
  personas: (Persona & { source: LibSource })[];
}

/** 전역과 병합본을 나란히 실측해 오버라이드(같은 id 교체 · ws 전용 추가)를 표시용으로 마킹한다.
 *  내용까지 동일한 오버라이드는 구분할 수 없다 — 표시가 목적이므로 전역으로 취급한다. */
export async function listMergedLibrary(wsPath: string): Promise<MergedLibrary | undefined> {
  if (!isTauri()) return undefined;
  const [globalLib, merged] = await Promise.all([
    invoke<LibraryData>("library_list", { wsPath: null }).catch(() => undefined),
    invoke<LibraryData>("library_list", { wsPath }).catch(() => undefined),
  ]);
  if (!merged) return undefined;
  const mark = <T extends { id: string }>(items: T[], base: T[]): (T & { source: LibSource })[] =>
    items.map((it) => {
      const b = base.find((x) => x.id === it.id);
      return { ...it, source: b && JSON.stringify(b) === JSON.stringify(it) ? "global" : "ws" };
    });
  const g = globalLib ?? { jobs: [], personas: [] };
  return {
    jobs: mark(merged.jobs, g.jobs),
    personas: mark(merged.personas.map(toPersona), g.personas.map(toPersona)),
  };
}

/** 편성 프리셋 (FR-E-26) — 앱데이터 presets/*.json 실측. 직무 구성만 담는다 */
export interface CastingPreset {
  id: string;
  name: string;
  jobs: string[];
}

export async function listPresets(): Promise<CastingPreset[]> {
  if (!isTauri()) return [];
  return invoke<CastingPreset[]>("preset_list").catch(() => []);
}
