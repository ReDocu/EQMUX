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
  /** 음소거 (FR-G-35) — 세션 id 또는 워크스페이스 id. OS 알림·사운드만 막고 인앱 미확인은 유지 (FR-G-37) */
  muted: string[];
  /** 테마 (M29) — 토큰 교체. 터미널 페인은 어느 테마에서든 다크 (TUI·ANSI 가독성) */
  theme: "dark" | "light" | "system";
}

export const DEFAULT_SETTINGS: AppSettings = {
  startView: "control", // FR-G-02 — 기본 포커스는 관제 탭
  notifications: "waiting-dead", // G3
  waitingSound: false, // G6 — 기본 꺼짐
  scrollbackReplay: 500,
  muted: [],
  theme: "dark", // terminal-first 기본
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
    muted: Array.isArray(v.muted) ? v.muted.filter((x): x is string => typeof x === "string") : [],
    theme: v.theme === "light" || v.theme === "system" ? v.theme : "dark",
  };
}

// ── 테마 적용 (M29) — <html data-theme="…">가 토큰을 고른다. system은 OS 설정을 따라간다 ──

function applyTheme(): void {
  const t = settings().theme;
  const resolved =
    t === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : t;
  document.documentElement.dataset.theme = resolved;
}

// OS 테마 변경 추적 — system 모드일 때만 반응한다
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (settings().theme === "system") applyTheme();
  });
}

/** 음소거 토글 (FR-G-35) — id는 세션 id 또는 워크스페이스 id */
export function toggleMuted(id: string): void {
  const cur = settings().muted;
  updateSettings({ muted: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
}

let loaded = false;

/** 부트스트랩 로드 — restoreLayout이 startView를 참조하므로 그보다 먼저 불린다 */
export async function loadSettings(): Promise<void> {
  if (loaded || !isTauri()) return;
  loaded = true;
  const raw = await invoke<unknown>("settings_load").catch(() => null);
  setSettings(sanitize(raw));
  applyTheme();
}

/** 변경 즉시 저장 — 파일 + Rust 메모리 사본(알림 게이트)이 함께 갱신된다 */
export function updateSettings(patch: Partial<AppSettings>): void {
  const next = sanitize({ ...settings(), ...patch });
  setSettings(next);
  applyTheme();
  if (isTauri()) void invoke("settings_save", { data: next }).catch(() => {});
}
