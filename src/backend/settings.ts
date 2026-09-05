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
  /** 색 팔레트 — 다크 표면과 터미널 ANSI의 명도·색온도. 강조색은 팔레트 간 공유라 정체성은 유지된다.
   *  라이트 테마에서는 앱 토큰을 라이트가 덮으므로 터미널 페인에만 적용된다 (터미널은 항상 다크) */
  palette: "soft" | "contrast" | "neutral" | "warm";
  /** 세션 메모리 배너 임계값 MB (FR-G-67, M30) — 0 = 꺼짐(기본). 소프트 경고만, 강제 개입 없음 */
  memBannerMb: number;
  /** SGR 색 저장 (FR-C-15, M32) — 스크롤백에 색 시퀀스 보존. 끄면 평문만 (용량 절감) */
  sgrStore: boolean;
  /** 워크스페이스당 세션 슬롯 상한 — 4(기본)·6·8. 줄여도 이미 열린 세션은 닫지 않는다 */
  maxSlots: number;
  /** UI 언어 — 한국어(기본)·영어. 코드의 한국어 원문이 키이고 영어는 사전 치환(i18n.ts) */
  language: "ko" | "en";
  /** 에이전트 세션 상태 줄 (FR-D-19) — 우리가 --settings로 주입한 statusLine이 그리는 한 줄.
   *  full=모델·비용 · nocost=모델만 · off=줄 없음. 어느 값이든 채널 자체는 계속 돌아
   *  세션 비용 수집(apply_statusline)은 끊기지 않는다 */
  statusLine: "full" | "nocost" | "off";
}

/** 상태 줄 옵션 — 설정 화면·검증·Rust 주입이 공유한다 */
export const STATUSLINE_MODES = ["full", "nocost", "off"] as const;

/** 팔레트 옵션 — 설정 화면·검증이 공유한다. styles.css의 [data-palette] 블록과 1:1 */
export const PALETTES = ["soft", "contrast", "neutral", "warm"] as const;

/** 슬롯 수 옵션 — 설정 화면·검증이 공유한다 */
export const SLOT_OPTIONS = [4, 6, 8] as const;
/** 절대 상한 — team.json 복원 등은 설정과 무관하게 이 값까지 받는다 (설정을 줄여도 데이터를 버리지 않는다) */
export const HARD_MAX_SLOTS = 8;

export const DEFAULT_SETTINGS: AppSettings = {
  startView: "control", // FR-G-02 — 기본 포커스는 관제 탭
  notifications: "waiting-dead", // G3
  waitingSound: false, // G6 — 기본 꺼짐
  scrollbackReplay: 500,
  muted: [],
  theme: "dark", // terminal-first 기본
  palette: "soft", // 순검정 대신 띄운 배경 — 번짐을 줄인다
  memBannerMb: 0, // FR-G-67 — 기본 꺼짐
  sgrStore: true, // FR-C-15 — 기본 켜짐, 끄면 용량 절감
  maxSlots: 4, // 세션 슬롯 상한 — 기본 4, 옵션으로 6·8
  language: "ko", // UI 언어 — 기본 한국어
  statusLine: "full", // 현행 유지 — 모델·비용 한 줄
};

const [settings, setSettings] = createSignal<AppSettings>(DEFAULT_SETTINGS);
export { settings };

/** 현재 세션 슬롯 상한 — 그리드·세션 추가·캐스팅이 전부 이 값을 본다 */
export const maxSlots = (): number => settings().maxSlots;

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
    palette: (PALETTES as readonly string[]).includes(v.palette as string)
      ? (v.palette as AppSettings["palette"])
      : "soft",
    memBannerMb: [0, 2048, 4096, 8192].includes(v.memBannerMb as number) ? (v.memBannerMb as number) : 0,
    sgrStore: v.sgrStore !== false,
    maxSlots: (SLOT_OPTIONS as readonly number[]).includes(v.maxSlots as number) ? (v.maxSlots as number) : 4,
    language: v.language === "en" ? "en" : "ko",
    statusLine: (STATUSLINE_MODES as readonly string[]).includes(v.statusLine as string)
      ? (v.statusLine as AppSettings["statusLine"])
      : "full",
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
  document.documentElement.dataset.palette = settings().palette;
  // 터미널은 CSS가 아니라 xterm theme 객체로 색을 받는다 — 토큰이 바뀐 사실을 알려야 다시 읽는다.
  // 이벤트로 알리는 이유: 살아 있는 터미널은 컴포넌트 밖 레지스트리에 있어 반응성으로 닿지 않는다.
  window.dispatchEvent(new CustomEvent("eq-tokens-changed"));
}

// OS 테마 변경 추적 — system 모드일 때만 반응한다
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (settings().theme === "system") applyTheme();
  });
}

/** 부트스트랩 체인이 아니라 모듈 로드 시점에 시작한다 — 설정 화면은 첫 프레임부터
 *  열 수 있는 오버레이인데(App.tsx), 로드 전에는 settings()가 DEFAULT_SETTINGS다.
 *  updateSettings는 객체 전체를 저장하므로 그 창에서 한 번만 눌러도 저장본이 통째로
 *  기본값으로 덮인다 — 재시작하면 설정이 사라져 있는 원인. */
let loadOk = !isTauri(); // Tauri 밖에서는 저장 자체를 안 하므로 참으로 둔다
const ready: Promise<void> = isTauri()
  ? invoke<unknown>("settings_load").then(
      (raw) => {
        // Null 응답(저장본 없음·손상)은 정상 — 기본값이 맞는 기준선이다.
        // invoke 자체가 실패한 경우만 저장을 막는다 (기본값으로 파일을 덮지 않기 위해).
        setSettings(sanitize(raw));
        applyTheme();
        loadOk = true;
      },
      () => {},
    )
  : Promise.resolve();

/** 부트스트랩 로드 — restoreTeams(maxSlots)·restoreLayout(startView)보다 먼저 await된다 */
export const loadSettings = (): Promise<void> => ready;

/** 음소거 토글 (FR-G-35) — id는 세션 id 또는 워크스페이스 id */
export function toggleMuted(id: string): void {
  void ready.then(() => {
    const cur = settings().muted; // 로드 뒤에 읽는다 — 기본값 []에 얹으면 기존 음소거가 날아간다
    updateSettings({ muted: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  });
}

/** 마지막 settings.json 저장 실패 (B54) — 있으면 설정 화면이 배너로 알린다 */
const [saveError, setSaveError] = createSignal<string | undefined>(undefined);
export const settingsSaveError = saveError;

/** 변경 즉시 저장 — 파일 + Rust 메모리 사본(알림 게이트)이 함께 갱신된다.
 *  로드가 끝난 뒤에 적용한다 — 기본값 기준선으로 저장본을 덮지 않기 위해 */
export function updateSettings(patch: Partial<AppSettings>): void {
  void ready.then(() => {
    const next = sanitize({ ...settings(), ...patch });
    setSettings(next);
    applyTheme();
    if (isTauri() && loadOk) {
      // 저장 실패를 삼키지 않는다 (B54) — 화면은 이미 새 값을 그렸으므로, 파일에 안 남았다는
      // 사실을 알리지 않으면 사용자는 다음 실행에 값이 되돌아간 이유를 알 길이 없다
      void invoke("settings_save", { data: next }).then(
        () => setSaveError(undefined),
        (e) => setSaveError(String(e)),
      );
    }
  });
}
