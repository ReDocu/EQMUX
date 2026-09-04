// 화면 손상 진단 계측 (임시) — "오래 켜놓으면 화면이 깨지고, 창 크기를 바꾸면 돌아온다".
//
// 두 후보를 가르는 것이 목적이다:
//   1) 자식 웹뷰(브라우저 패널)가 낡은 좌표에 앉아 메인 UI를 덮는다.
//   2) 컴포지터 타일이 낡은 채로 남는다 (좌표는 멀쩡하다).
// 둘 다 리사이즈로 고쳐지므로 눈으로는 구분되지 않는다. 숫자로만 갈린다.
//
// 원칙: 재지 않은 것을 고치지 않는다. 여기서 자동 보정은 하지 않는다 —
// 좌표를 몰래 다시 보내면 증상만 사라지고 원인은 영영 안 잡힌다.
//
// 로그는 조용해야 오래 켜 둘 수 있다. 이상할 때만 적고, 10분에 한 번 "정상은 이랬다"를 남긴다.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./pty";

export interface DiagRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rust가 재 준 그 순간의 기하 — 좌표는 전부 물리 픽셀이다 */
export interface DiagGeometry {
  scaleFactor: number;
  windowOuter: DiagRect;
  windowInner: DiagRect;
  monitorName: string | null;
  monitorScale: number | null;
  monitor: DiagRect;
  /** 브라우저 패널 자식 웹뷰 — 패널을 안 열었으면 null */
  browser: DiagRect | null;
}

const HEARTBEAT_MS = 10 * 60_000; // 정상 상태 기준선 — 이상 판정의 대조군
const SWEEP_MS = 30_000;
/** 이만큼 어긋나면 어긋난 것으로 본다 — 반올림 오차(±1)와 구분되어야 한다 */
const DRIFT_PX = 3;

export function diagNote(text: string): void {
  if (!isTauri()) return;
  void invoke("diag_note", { text }).catch(() => undefined);
}

export async function diagGeometry(): Promise<DiagGeometry | undefined> {
  if (!isTauri()) return undefined;
  return invoke<DiagGeometry>("diag_geometry").catch(() => undefined);
}

export async function diagLogPath(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  return invoke<string>("diag_log_path").catch(() => undefined);
}

// ── 브라우저 패널이 "의도한" 좌표 ─────────────────────────────────────────
// BrowserPanelTab이 browser_bounds로 보내는 바로 그 논리 픽셀 값을 여기에도 남긴다.
// 이것과 Rust가 잰 실제 물리 좌표의 차이가 후보 1의 증거다.

let intended: DiagRect | undefined;
let intendedAt = 0;

export function reportBrowserRect(r: DiagRect | undefined): void {
  intended = r;
  intendedAt = Date.now();
}

// ── WebGL 컨텍스트 유실 ──────────────────────────────────────────────────
// 지금은 유실되면 조용히 DOM 렌더러로 강등된다. 몇 번, 어느 세션에서 일어나는지 남긴다.

let webglLosses = 0;

export function noteWebglContextLoss(sessionId: string): void {
  webglLosses += 1;
  diagNote(`WEBGL-CONTEXT-LOST session=${sessionId} total=${webglLosses}`);
}

/** 살아 있는 터미널 수를 알려 주는 훅 — TerminalPane이 자기 REGISTRY를 노출해 꽂는다.
 *  진단이 컴포넌트를 import하면 순환이 되므로 방향을 뒤집는다 */
let terminalStats: () => { terminals: number; opened: number } = () => ({ terminals: 0, opened: 0 });

export function provideTerminalStats(fn: () => { terminals: number; opened: number }): void {
  terminalStats = fn;
}

// ── 표본 ────────────────────────────────────────────────────────────────

/** 논리 좌표 × 배율 = 물리. 자식 웹뷰 좌표가 창 상대인지 화면 절대인지는 추측하지 않고
 *  두 해석을 다 적는다 — 로그 첫 줄만 봐도 어느 쪽인지 드러나고, 어긋남은 한쪽이 벌어지는 것으로 보인다 */
export interface DriftResult {
  /** 자식 웹뷰 좌표를 창 상대로 해석했을 때의 어긋남 (px) */
  rel: number;
  /** 화면 절대로 해석했을 때의 어긋남 (px) */
  abs: number;
  /** 크기 어긋남 — 좌표가 맞아도 크기가 틀리면 덮는 넓이가 달라진다 */
  size: number;
  /** 둘 중 가까운 쪽 = 실제 어긋남. 좌표 기준을 몰라도 이 값은 옳다 */
  off: number;
  detail: string;
}

export function computeDrift(intended: DiagRect, g: DiagGeometry): DriftResult | undefined {
  if (!g.browser) return undefined;
  const sf = g.scaleFactor || 1;
  const ex = { x: intended.x * sf, y: intended.y * sf, w: intended.w * sf, h: intended.h * sf };
  const rel = Math.max(Math.abs(g.browser.x - ex.x), Math.abs(g.browser.y - ex.y));
  const abs = Math.max(
    Math.abs(g.browser.x - (ex.x + g.windowInner.x)),
    Math.abs(g.browser.y - (ex.y + g.windowInner.y)),
  );
  const size = Math.max(Math.abs(g.browser.w - ex.w), Math.abs(g.browser.h - ex.h));
  const detail =
    `intended(logical)=${intended.x},${intended.y} ${intended.w}x${intended.h}` +
    ` actual(physical)=${g.browser.x},${g.browser.y} ${g.browser.w}x${g.browser.h}` +
    ` sf=${sf} dRel=${Math.round(rel)} dAbs=${Math.round(abs)} dSize=${Math.round(size)}`;
  return { rel, abs, size, off: Math.min(rel, abs), detail };
}

function drift(g: DiagGeometry): DriftResult | undefined {
  if (!intended) return undefined;
  const d = computeDrift(intended, g);
  return d && { ...d, detail: `${d.detail} intendedAgeMs=${Date.now() - intendedAt}` };
}

function shell(): string {
  const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  const st = terminalStats();
  return (
    `dpr=${devicePixelRatio} inner=${innerWidth}x${innerHeight}` +
    ` terms=${st.terminals}/${st.opened} webglLost=${webglLosses}` +
    (mem ? ` heapMB=${Math.round(mem.usedJSHeapSize / 1048576)}` : "")
  );
}

/** 한 번 재서 한 줄로. reason이 주어지면 이상 여부와 무관하게 남긴다 */
export async function diagSnapshot(reason: string): Promise<string> {
  const g = await diagGeometry();
  if (!g) return `${reason} (기하 없음) ${shell()}`;
  const d = drift(g);
  const line =
    `${reason} ${shell()} sf=${g.scaleFactor} monitor=${JSON.stringify(g.monitorName)}` +
    ` monScale=${g.monitorScale} inner=${g.windowInner.x},${g.windowInner.y} ${g.windowInner.w}x${g.windowInner.h}` +
    (d ? ` | browser ${d.detail}` : g.browser ? " | browser(열림, 의도 좌표 없음)" : " | browser=없음");
  diagNote(line);
  return line;
}

// ── 상시 감시 ────────────────────────────────────────────────────────────

let started = false;

export function startDiagnostics(): void {
  if (started || !isTauri()) return;
  started = true;

  let lastDpr = devicePixelRatio;
  let lastHeartbeat = 0;
  let lastDriftReported = 0;

  const sweep = async (reason: string, force: boolean) => {
    const g = await diagGeometry();
    if (!g) return;
    const now = Date.now();

    if (devicePixelRatio !== lastDpr) {
      diagNote(`DPR-CHANGED ${lastDpr} -> ${devicePixelRatio} ${shell()}`);
      lastDpr = devicePixelRatio;
      force = true;
    }

    // 자식 웹뷰가 의도한 자리에 없다 — 후보 1의 직접 증거.
    // 두 해석 중 가까운 쪽으로 판정한다 (좌표 기준을 모르는 채로도 어긋남은 잡힌다)
    const d = drift(g);
    if (d && Math.max(d.off, d.size) > DRIFT_PX && now - lastDriftReported > 5_000) {
      lastDriftReported = now;
      diagNote(`DRIFT ${reason} ${d.detail} ${shell()}`);
      return;
    }

    if (force || now - lastHeartbeat > HEARTBEAT_MS) {
      lastHeartbeat = now;
      void diagSnapshot(`heartbeat(${reason})`);
    }
  };

  void diagSnapshot("startup");

  // Rust가 배율·모니터 변화를 잡은 순간 — 프런트가 볼 수 없는 유일한 사건이다
  void listen("diag-geometry", () => void sweep("window-geometry", true));

  const timer = setInterval(() => void sweep("sweep", false), SWEEP_MS);
  addEventListener("focus", () => void sweep("focus", false));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void sweep("visible", false);
  });
  // 배율 변경은 이 미디어 쿼리가 가장 먼저 안다 (창 이벤트보다 이른 경우가 있다)
  try {
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener("change", () =>
      void sweep("dpr-media", true),
    );
  } catch {
    /* 구형 WebView2 — DPR 변화는 sweep이 늦게라도 잡는다 */
  }
  addEventListener("beforeunload", () => clearInterval(timer));
}
