// S1-3 — xterm.js를 WebView2에서 WebGL 렌더러로 띄운다.
//
// 이 파일이 R1(프로젝트 최대 리스크)의 답이다.
// WebGL 애드온이 안 붙으면 터미널 렌더러를 직접 짜야 하고, 그건 다른 프로젝트다.
//
// PTY 연결은 `pty.ts`(S1-2·S1-4)가 맡는다. 이 파일은 렌더러만 본다.
// 아래 `echoOf`는 계측 모드(--latency-probe)에서만 쓰인다 — 셸 없이 렌더 경로만 재는 자리다.

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";

/** 렌더러가 실제로 무엇으로 붙었는지. "붙었다고 믿는 것"과 구분한다. */
export interface RendererStatus {
  /** WebglAddon.activate()가 예외 없이 끝났는가 */
  addonLoaded: boolean;
  /** .xterm-screen 안에 canvas가 실제로 생겼는가 (DOM 렌더러면 안 생긴다) */
  canvasPresent: boolean;
  /** 캔버스에서 확인한 컨텍스트 종류 */
  contextType: "webgl2" | "webgl" | "none";
  /** 언마스크 렌더러 문자열. SwiftShader 폴백 판별용 */
  unmaskedRenderer: string | null;
  /** 소프트웨어 래스터라이저로 떨어졌는가 */
  softwareRasterizer: boolean;
  /** 컨텍스트 유실이 일어났는가 (유실 시 xterm은 DOM으로 폴백한다) */
  contextLost: boolean;
  /** 붙이지 못했다면 그 이유 */
  error: string | null;
}

const THEME = {
  background: "#0d1220",
  foreground: "#d7dceb",
  cursor: "#6fd08c",
  selectionBackground: "#26314e",
  black: "#0d1220",
  red: "#ff7a7a",
  green: "#6fd08c",
  yellow: "#e8b84b",
  blue: "#6f9bd0",
  magenta: "#b98cd0",
  cyan: "#5fc9c9",
  white: "#d7dceb",
};

// A-2(CJK 폭)의 답. **순서를 바꾸기 전에 `docs/FONT-A2.md`를 읽을 것.**
//
// 규칙 한 줄: CJK는 거의 모든 폰트에서 **1.0em**이다. 그래서 비율이 2가 되려면
// **ASCII advance가 정확히 0.5em이어야 한다.** 그것뿐이다.
//
//   D2Coding ligature  0.5em   → 가 2.00 ✅  → · ■ 1.00 ✅
//   굴림체 · 돋움체     0.5em   → 가 2.00 ✅  → · ■ 2.00 ❌ (표 그리기가 옆 칸 침범)
//   Cascadia Mono      0.586em → 가 1.71 ❌
//   Consolas           0.550em → 가 1.82 ❌
//
// **앞의 두 항목이 `styles.css`의 @font-face로 동봉돼 있다** — 기계에 뭐가 깔렸든 여기서 잡힌다.
// 뒤쪽은 @font-face가 어떤 이유로든 안 붙었을 때의 그물이고, 그때는 A-2가 미달이다.
// 미달이 조용히 지나가지 않게 `--font-probe`로 언제든 숫자를 확인할 수 있다.
//
// ⚠️ `"D2Coding ligature"`를 같이 적어 둔다 — 사용자가 직접 설치한 경우의 **실제 패밀리 이름**이
// 그것이다. 옛 스택은 `"D2Coding"` 하나만 적어 두고 그게 잡힌다고 믿었고, 그래서
// 관문 A-2가 하루 동안 잘못된 전제 위에 서 있었다 (`docs/GATE-A.md` §1).
export const FONT_STACK =
  '"D2Coding", "D2Coding ligature", "Cascadia Mono", "굴림체", "돋움체", Consolas, monospace';

/** 터미널 글자 크기. A-2 폭 계측이 **같은 크기로** 재야 하므로 상수로 뺀다. */
export const FONT_SIZE = 14;

export interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
  status: RendererStatus;
}

/**
 * @param stack 폰트 스택 강제(`--font-stack` / `EQMUX_FONT_STACK`). `null`이면 `FONT_STACK`.
 *   **A-2 계측의 핵심이다** — 스택에서 D2Coding만 빼면 이 기계가 곧 사용자 기계 조건이 된다
 *   ([docs/GATE-A.md](../docs/GATE-A.md) §1이 A-2를 "잠정"으로 둔 이유가 그것이다).
 */
export function createTerminal(container: HTMLElement, stack: string | null = null): TerminalHandle {
  const term = new Terminal({
    fontFamily: stack ?? FONT_STACK,
    fontSize: FONT_SIZE,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorBlink: true,
    theme: THEME,
    scrollback: 5000,
    // S3-6에서 상한을 코드에 박는다. 지금은 기본값으로 둔다.
    allowProposedApi: true,
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);

  const status = attachWebgl(term);

  fit.fit();
  return { term, fit, status };
}

function attachWebgl(term: Terminal): RendererStatus {
  const status: RendererStatus = {
    addonLoaded: false,
    canvasPresent: false,
    contextType: "none",
    unmaskedRenderer: null,
    softwareRasterizer: false,
    contextLost: false,
    error: null,
  };

  try {
    const addon = new WebglAddon();
    // 컨텍스트를 잃으면 xterm은 조용히 DOM 렌더러로 돌아간다.
    // 조용히 느려지는 것이 제일 나쁘다 — 반드시 기록한다.
    addon.onContextLoss(() => {
      status.contextLost = true;
      console.error("[eqmux] WebGL 컨텍스트 유실 — DOM 렌더러로 폴백한다");
      addon.dispose();
    });
    term.loadAddon(addon);
    status.addonLoaded = true;
  } catch (e) {
    status.error = String(e);
    return status;
  }

  // 여기서부터가 진짜 확인이다. 애드온이 로드됐다는 것과
  // 캔버스가 실제로 GPU 컨텍스트를 잡았다는 것은 다른 이야기다.
  const canvas = term.element?.querySelector<HTMLCanvasElement>(".xterm-screen canvas");
  status.canvasPresent = !!canvas;

  // xterm이 이미 컨텍스트를 점유했으므로 같은 캔버스에서 다시 못 딴다.
  // 같은 페이지에서 별도 캔버스로 확인한다 — 같은 WebView2 인스턴스라 결과는 동일하다.
  const probe = document.createElement("canvas");
  const gl2 = probe.getContext("webgl2");
  const gl = gl2 ?? probe.getContext("webgl");
  if (gl) {
    status.contextType = gl2 ? "webgl2" : "webgl";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      status.unmaskedRenderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
      status.softwareRasterizer = /swiftshader|software|llvmpipe|basic render/i.test(
        status.unmaskedRenderer,
      );
    }
  }

  return status;
}

/**
 * 계측 모드 전용 로컬 에코 변환.
 *
 * 실제 터미널이면 셸이 해 주는 일이다. `--latency-probe`는 **렌더 경로만** 재야 하므로
 * PTY 왕복을 일부러 뺀다 — 두 시점의 숫자를 섞으면 안 된다(`docs/issue.md` #10).
 */
export function echoOf(data: string): string {
  if (data === "\r") return "\r\n$ ";
  if (data === "\x7f") return "\b \b";
  return data;
}

/**
 * xterm이 각 문자에 몇 칸을 배정하는지 확인한다 (관문 A-2의 절반).
 *
 * ⚠️ 이것은 **논리 폭**이다. xterm이 한글을 2칸으로 잡는가를 본다.
 * 폰트가 실제로 2칸 너비로 그리는가(**시각 폭**)는 여기서 알 수 없다 —
 * 그건 눈으로 봐야 하고, 관문 A에서 해원이 판정한다.
 * 논리 폭이 틀리면 시각은 볼 것도 없이 실패이므로, 싼 쪽을 먼저 거른다.
 */
export const CELL_PROBES = ["A", "가", "漢", "ｱ", "→", "■"] as const;

/**
 * 호출 전에 `CELL_PROBES`를 이어 붙인 문자열이 커서 줄에 쓰여 있어야 한다.
 * `term.write()`는 비동기로 파싱되므로 **write 콜백 안에서** 부른다.
 */
export function readCellWidths(term: Terminal): Record<string, number> {
  const result: Record<string, number> = {};
  const buf = term.buffer.active;
  const line = buf.getLine(buf.cursorY);
  if (!line) return result;

  let col = 0;
  for (const ch of CELL_PROBES) {
    const w = line.getCell(col)?.getWidth() ?? -1;
    result[ch] = w;
    col += Math.max(w, 1);
  }
  return result;
}

/** 렌더러 상태를 한 줄 판정으로 압축한다. */
export function verdictOf(s: RendererStatus): { text: string; sgr: string } {
  if (!s.addonLoaded) return { text: `WebGL 실패 — ${s.error ?? "원인 불명"}`, sgr: "31" };
  if (s.contextLost) return { text: "WebGL 컨텍스트 유실 — DOM 폴백", sgr: "31" };
  if (!s.canvasPresent) return { text: "캔버스 없음 — DOM 렌더러", sgr: "31" };
  if (s.softwareRasterizer) return { text: "WebGL(소프트웨어 래스터라이저)", sgr: "33" };
  if (s.contextType === "webgl2") return { text: "WebGL2 · 하드웨어", sgr: "32" };
  if (s.contextType === "webgl") return { text: "WebGL1 · 하드웨어", sgr: "32" };
  return { text: "WebGL 상태 불명", sgr: "33" };
}

/**
 * 관문 A-2(CJK 폭)를 눈으로 볼 수 있는 데모 출력.
 *
 * 렌더러 판정을 여기에도 찍는다. 하단 상태줄이나 IPC가 죽어도
 * **터미널 자체는 그려지므로**, 판정을 읽을 경로가 최소 하나는 남는다.
 */
export function writeDemo(
  term: Terminal,
  status: RendererStatus,
  note: string,
  fakePrompt: boolean,
): void {
  const v = verdictOf(status);
  const L = [
    "\x1b[1;36mEQMUX\x1b[0m S1-3 — xterm.js + WebGL @ WebView2",
    `렌더러: \x1b[${v.sgr}m${v.text}\x1b[0m`,
    `GPU   : \x1b[90m${status.unmaskedRenderer ?? "(문자열 없음)"}\x1b[0m`,
    "",
    "\x1b[90m── CJK 폭 (관문 A-2) ─────────────────────\x1b[0m",
    "┌──────────────┬──────────────┐",
    "│ 한글 두 칸   │ ASCII 1 cell │",
    "│ 가나다라마바 │ abcdefghijkl │",
    "│ 漢字混在テスト│ 0123456789ab │",
    "└──────────────┴──────────────┘",
    "",
    "\x1b[90m── 색상 ──────────────────────────────────\x1b[0m",
    "\x1b[31m■red\x1b[0m \x1b[32m■green\x1b[0m \x1b[33m■yellow\x1b[0m \x1b[34m■blue\x1b[0m \x1b[35m■magenta\x1b[0m \x1b[36m■cyan\x1b[0m",
    "\x1b[1m굵게\x1b[0m \x1b[3m기울임\x1b[0m \x1b[4m밑줄\x1b[0m \x1b[7m반전\x1b[0m",
    "",
    `\x1b[90m${note}\x1b[0m`,
    "",
  ];
  // 가짜 프롬프트는 로컬 에코 모드에서만 그린다.
  // PTY가 붙은 상태에서 그리면 진짜 프롬프트와 겹쳐 두 줄이 된다.
  term.write(L.join("\r\n") + "\r\n" + (fakePrompt ? "$ " : ""));
}
