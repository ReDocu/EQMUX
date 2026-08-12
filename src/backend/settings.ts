// 설정 브리지 (PRD J) — 앱데이터 settings.json이 원본. 동작에 연결된 항목만 여기 있다:
// 시작 화면(FR-G-02) · OS 알림 라우팅(FR-G-30·37, Rust 게이트) · waiting 사운드 보관(FR-G-34) ·
// 스크롤백 재생 줄 수(FR-C-31). 고정 정책 항목은 화면에 선언만 하고 저장하지 않는다.
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { isTauri } from "./pty";

export interface AppSettings {
  startView: "control" | "last";
  notifications: "waiting-dead" | "waiting" | "off";
  waitingSound: boolean;
  scrollbackReplay: number; // 500 | 1000 | 2000
}

export const DEFAULT_SETTINGS: AppSettings = {
  startView: "control", // FR-G-02 — 기본 포커스는 관제 탭
  notifications: "waiting-dead", // G3
  waitingSound: false, // G6 — 기본 꺼짐
  scrollbackReplay: 500,
};

const [settings, setSettings] = createSignal<AppSettings>(DEFAULT_SETTINGS);
export { settings };

function sanitize(raw: unknown): AppSettings {
  const v = (raw ?? {}) as Partial<AppSettings>;
  return {
    startView: v.startView === "last" ? "last" : "control",
    notifications:
      v.notifications === "waiting" || v.notifications === "off" ? v.notifications : "waiting-dead",
    waitingSound: v.waitingSound === true,
    scrollbackReplay: [500, 1000, 2000].includes(v.scrollbackReplay as number)
      ? (v.scrollbackReplay as number)
      : 500,
  };
}

let loaded = false;

/** 부트스트랩 로드 — restoreLayout이 startView를 참조하므로 그보다 먼저 불린다 */
export async function loadSettings(): Promise<void> {
  if (loaded || !isTauri()) return;
  loaded = true;
  const raw = await invoke<unknown>("settings_load").catch(() => null);
  setSettings(sanitize(raw));
}

/** 변경 즉시 저장 — 파일 + Rust 메모리 사본(알림 게이트)이 함께 갱신된다 */
export function updateSettings(patch: Partial<AppSettings>): void {
  const next = sanitize({ ...settings(), ...patch });
  setSettings(next);
  if (isTauri()) void invoke("settings_save", { data: next }).catch(() => {});
}
