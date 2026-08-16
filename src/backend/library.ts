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

const COLORS: Persona["color"][] = ["blue", "cyan", "purple", "pink", "green", "red", "slate", "orange", "amber"];

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
  // 로드 성공이면 빈 목록이어도 반영한다 (파일이 이긴다, FR-E-74) — 마지막 직무를 지웠을 때
  // 빈 결과를 버리면 삭제된 항목이 화면·캐스팅에 계속 남는다. undefined(호출 실패)만 건너뛴다
  if (lib) {
    backend.hydrateLibrary(lib.jobs, lib.personas.map(toPersona));
  }
}

/** 외부 변경 충돌 (P-7) — 편집 시작 mtime이 어긋나면 Rust가 저장을 거부한다.
 *  반환값은 사용자에게 보여줄 오류 문구 — null이면 성공. */
export async function savePersonaFile(p: Persona): Promise<string | null> {
  if (!isTauri()) {
    backend.savePersona(p);
    return null;
  }
  try {
    await invoke("library_save_persona", { persona: p, expectedMtimeMs: p.mtimeMs ?? null });
  } catch (e) {
    await refreshLibrary(); // 파일이 이긴다 (FR-E-74) — 밖의 변경으로 화면을 따라잡는다
    return String(e).includes("CONFLICT")
      ? "파일이 밖에서 바뀌었습니다 — 목록을 새로고침했으니 확인 후 다시 저장하세요"
      : "저장 실패 — 로그 패널을 확인하세요";
  }
  await refreshLibrary();
  return null;
}

/** 새 페르소나 생성 — 고른 단계가 명시 상태로 저장된다. 만들어진 id를 반환 (생성 플로우가 이어서 선택) */
export async function addPersonaFile(level: "basic" | "mid" | "adv" = "basic"): Promise<string | undefined> {
  if (!isTauri()) {
    backend.addPersona();
    return undefined;
  }
  const id = `p${Date.now().toString(36)}`;
  await invoke("library_save_persona", {
    persona: { id, name: "새 페르소나", level, hint: "판단 우선순위 · 강조점 · 금기를 5~10줄로", color: "blue" },
  }).catch(() => {});
  await refreshLibrary();
  return id;
}

export async function deletePersonaFile(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("library_delete_persona", { id }).catch(() => {});
  await refreshLibrary();
}

// ── 고급 캐릭터 시트 (3단계 페르소나) — personas/<id>.character.md, 존재 = 고급 단계.
// 전역 계층에만 쓴다 — 오버라이드 시트는 .eqmux/personas 파일로 직접 (FR-E-28과 동일 규칙).

export interface CharacterSheet {
  content: string;
  mtimeMs: number;
}

/** 시트 생성 (고급 승급) — 템플릿으로 만든다. 이미 있으면 그대로 (멱등) */
export async function createCharacterFile(id: string, name: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("library_character_create", { id, name }).catch(() => {});
  await refreshLibrary();
}

export async function readCharacterFile(id: string): Promise<CharacterSheet | undefined> {
  if (!isTauri()) return undefined;
  return invoke<CharacterSheet>("library_character_read", { id }).catch(() => undefined);
}

/** 시트 저장 — 페르소나 저장과 같은 충돌 계약 (P-7). null이면 성공. */
export async function saveCharacterFile(id: string, content: string, expectedMtimeMs?: number): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    await invoke("library_character_save", { id, content, expectedMtimeMs: expectedMtimeMs ?? null });
  } catch (e) {
    await refreshLibrary();
    return String(e).includes("CONFLICT")
      ? "시트가 밖에서 바뀌었습니다 — 다시 열어 확인 후 저장하세요"
      : "저장 실패 — 로그 패널을 확인하세요";
  }
  await refreshLibrary();
  return null;
}

/** 시트 삭제 (중간 이하로 강등) — 멱등 */
export async function deleteCharacterFile(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("library_character_delete", { id }).catch(() => {});
  await refreshLibrary();
}

// ── 직무 CRUD (FR-E-28) — 편집·복제·삭제. 복제 = 새 id로 저장, 같은 경로 하나다 ──

/** 외부 변경 충돌 (P-7) — savePersonaFile과 같은 계약. null이면 성공. */
export async function saveJobFile(j: Job): Promise<string | null> {
  if (!isTauri()) {
    backend.saveJob(j);
    return null;
  }
  try {
    await invoke("library_save_job", { job: j, expectedMtimeMs: j.mtimeMs ?? null });
  } catch (e) {
    await refreshLibrary();
    return String(e).includes("CONFLICT")
      ? "파일이 밖에서 바뀌었습니다 — 목록을 새로고침했으니 확인 후 다시 저장하세요"
      : "저장 실패 — 로그 패널을 확인하세요";
  }
  await refreshLibrary();
  return null;
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
