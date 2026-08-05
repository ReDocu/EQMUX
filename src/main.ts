// S2-2 — 기동 분기와 레이아웃 화면.
//
// 화면에 글자가 그려지는 것만으로는 통과가 아니다.
// DOM 렌더러로 조용히 폴백해도 글자는 그려진다 — 느릴 뿐이다.
// 그래서 렌더 경로를 항상 눈에 보이게 표시한다 (S1-3부터의 규칙).
//
// 분기 순서는 lib.rs의 충돌 경고와 같은 말이어야 한다: 폭 > 지연 > 패널 검증 > 프리셋 확인 > 일반.

import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";

import {
  createTerminal,
  writeDemo,
  verdictOf,
  readCellWidths,
  CELL_PROBES,
  FONT_STACK,
  FONT_SIZE,
  type TerminalHandle,
} from "./terminal";
import { runFontProbe, ensureFontsLoaded, type FontProbeResult } from "./font";
import { LatencyProbe, installFrameHold, type Progress } from "./latency";
import { bufferText, type PtyLink, type PtyInfo } from "./pty";
import {
  PanelManager,
  ensurePanes,
  renderStaticGrid,
  type LayoutNode,
  type LayoutStateDto,
  type PresetInfo,
  type SplitDirection,
} from "./panels";
import { installFocusKeys, connectFocus } from "./focus";
import { installGlobalHandlers, logError, logInfo } from "./log";
import { verifyBundledLicense } from "./license";

interface Paths {
  state_file: string;
  workspace_root: string;
  webview_data_dir: string | null;
  /** WebView2가 실제로 쓰는 폴더 — 안 덮었으면 Tauri 기본값이 들어온다. */
  webview_effective: string;
  isolated: boolean;
}

interface ProbeConfig {
  enabled: boolean;
  auto_samples: number | null;
  out_path: string;
  /** 자가 검증 ② — 입력 처리 경로에 넣을 인위적 바쁜 루프(ms) */
  inject_ms: number;
  /** 자가 검증 ③ — rAF 콜백을 K프레임마다 한 번만 흘린다 */
  frame_hold: number;
  /** 합성 키 간격(ms) */
  gap_ms: number;
  /** S2-10 — 첫 키 전 유휴 대기(ms). 0이면 기존 동작. 유휴→첫 키 실측용 */
  idle_wait_ms: number;
}

interface PtyProbeConfig {
  enabled: boolean;
  command: string;
  wait_ms: number;
  out_path: string;
}

/** A-2 폭 계측 (`--font-probe`). `stack`은 계측과 무관하게도 먹는다. */
interface FontProbeConfig {
  enabled: boolean;
  out_path: string;
  stack: string | null;
}

/** S2-2 — 기동 분할(`--panes=N`)·패널 무인 검증(`--panes-probe`). */
interface PanesConfig {
  probe: boolean;
  count: number;
  out_path: string;
}

/** S2-11 — 배치 프리셋 무인 확인(`--preset-probe`). `target`이 `all`이면 6종 전수. */
interface PresetProbeConfig {
  enabled: boolean;
  target: string;
  out_path: string;
}

interface AppInfo {
  name: string;
  version: string;
  paths: Paths;
  probe: ProbeConfig;
  pty_probe: PtyProbeConfig;
  font_probe: FontProbeConfig;
  panes: PanesConfig;
  preset_probe: PresetProbeConfig;
  shell: string;
}

/** S2-1b — 앱 데이터 폴더 크기. 필드 정의는 `src-tauri/src/appdata.rs`. */
interface AppDataReport {
  roots: { label: string; path: string; exists: boolean; bytes: number; files: number }[];
  total_bytes: number;
  cache_bytes: number;
  files: number;
  elapsed_ms: number;
  /** 훑기 상한에 걸려 도중에 끊겼는가. 걸린 값을 안 걸린 척 보여주면 안 된다. */
  truncated: boolean;
  /** KR2 하드 상한(60MB). 색 기준을 Rust에서 받아 온다 — 두 곳에 숫자를 박지 않는다. */
  limit_bytes: number;
  isolated: boolean;
}

/** 상태줄 갱신 주기. 캐시는 초 단위로 자라지 않는다 — 자주 훑을수록 디스크만 긁는다. */
const APPDATA_REFRESH_MS = 120_000;

function el<T extends HTMLElement>(sel: string): T {
  const found = document.querySelector<T>(sel);
  if (!found) throw new Error(`요소를 찾을 수 없다: ${sel}`);
  return found;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

async function main(): Promise<void> {
  const info = await invoke<AppInfo>("app_info");

  el("#ver").textContent = `v${info.version}`;
  const modeEl = el("#mode");
  modeEl.textContent = info.paths.isolated ? "격리 인스턴스" : "일반 인스턴스";
  modeEl.classList.add(info.paths.isolated ? "isolated" : "normal");

  // 자가 검증 ③ — 프레임 홀드는 **모든 터미널 생성 전에** 걸어야 한다.
  // xterm이 rAF를 잡은 뒤에 갈아끼우면 이미 등록된 콜백이 옛 경로로 돈다.
  if (info.probe.enabled && info.probe.frame_hold > 1) {
    installFrameHold(info.probe.frame_hold);
  }

  // S2-4 — 앱 층 키(포커스 이동·줌) 리스너. 계측 모드 포함 전 경로에 건다 —
  // 실사용 키 입력은 항상 이 리스너를 지나므로, A-3도 같은 조건에서 재야 회귀를 잡는다.
  installFocusKeys();

  // 동봉 폰트의 라이선스 전문이 이 바이너리 안에 있는지 확인한다(OFL 1.1 조건 2).
  // 지연 계측 중에는 돌리지 않는다 — 4KB라도 표본 구간에 얹힌 일은 A-3 숫자에 섞인다.
  if (!info.probe.enabled) {
    void verifyBundledLicense();
  }

  // ⚠️ **터미널보다 먼저** 동봉 폰트를 붙인다. xterm은 셀 크기를 생성 시점에 한 번 재므로,
  // 그때 폰트가 없으면 격자가 폴백 기준으로 잡히고 나중에 폰트가 바뀌어도 안 고쳐진다.
  const loadedFonts = await ensureFontsLoaded(["D2Coding"], FONT_SIZE);
  if (loadedFonts.length === 0) {
    logError("동봉 폰트를 붙이지 못했다 — 폴백으로 뜬다 (A-2 미달 가능)", "D2Coding");
  }

  const layoutEl = el<HTMLElement>("#layout");
  const stack = info.font_probe.stack;

  // ── A-2 폭 계측 — 터미널 하나만 있으면 된다. 재고, 남기고, 끝낸다.
  if (info.font_probe.enabled) {
    layoutEl.classList.add("single");
    const { term } = createTerminal(layoutEl, stack);
    await runFontProbeAndExit(info, await measureCells(term));
    return;
  }

  // ── A-3 지연 계측 — 셸 없이 렌더 경로만 잰다. `--panes=N`이면 N분할 상태에서(§2-2).
  if (info.probe.enabled) {
    await runLatencyProbe(info, layoutEl, stack);
    return;
  }

  // ── 일반 기동 — 백엔드 레이아웃 트리를 그린다 (S2-2). `--panes-probe`도 이 화면 위에서 돈다.
  await runApp(info, layoutEl, stack);
}

/** 빈 버퍼에서 셀 폭을 재고 지운다. 데모·셸 출력이 섞이면 열 위치를 못 잡는다. */
function measureCells(term: Terminal): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    term.write(CELL_PROBES.join(""), () => {
      const w = readCellWidths(term);
      term.reset();
      resolve(w);
    });
  });
}

/** 어떤 스택으로 그려진 화면인지 화면 안에 적는다 — 모르고 본 육안 확인은 A-2에서 못 쓴다. */
function stackNote(info: AppInfo): string {
  return info.font_probe.stack
    ? `\r\n\x1b[33m폰트 스택 강제 — ${info.font_probe.stack}\x1b[0m`
    : "";
}

/**
 * 렌더 판정을 상태줄과 stderr에 남긴다. 기준은 **첫 패널**이다 —
 * 나머지 패널의 판정은 `panels`로 같이 실려 나간다 (4분할에서 하나만 폴백해도 보이게).
 */
function reportRenderer(
  first: TerminalHandle,
  cellWidths: Record<string, number>,
  panels: { leaf?: string; verdict: string }[],
): void {
  const v = verdictOf(first.status);
  const rendEl = el("#renderer");
  rendEl.textContent = v.text;
  rendEl.classList.add(v.sgr === "32" ? "ok" : v.sgr === "33" ? "warn" : "bad");
  el("#gpu").textContent = first.status.unmaskedRenderer ?? "(렌더러 문자열 없음)";

  // 화면 없이도 렌더 경로를 확인할 수 있어야 한다.
  // 레이아웃 높이도 같이 실어 보낸다 — 상태줄이 화면 밖으로 밀리면 여기서 드러난다.
  const h = (sel: string) => Math.round(el(sel).getBoundingClientRect().height);
  void invoke("report_renderer", {
    status: JSON.stringify({
      ...first.status,
      verdict: v.text,
      // 논리 셀 폭. 한글·한자가 2가 아니면 A-2는 볼 것도 없이 실패다.
      cellWidths,
      // 컨테이너가 아니라 터미널이 실제로 쓰는 폰트를 적는다.
      fontFamily: first.term.options.fontFamily,
      panels,
      layout: {
        innerHeight: window.innerHeight,
        bar: h(".bar"),
        term: h("#layout"),
        status: h(".status"),
        rows: first.term.rows,
        cols: first.term.cols,
      },
    }),
  });
}

/**
 * `--latency-probe` — 관문 A-3.
 *
 * `--panes=N`과 조합하면 **백엔드 레이아웃·PTY 없이** 화면만 N개로 나눈 상태에서 잰다.
 * 계측 모드는 라이브 `state.json`을 만들지도 않는다(§2-4) — layout_* 명령을 부르지 않는다.
 * 계측은 항상 1번 패널에서 돈다. 나머지는 유휴 — A2의 "유휴 4분할"과 같은 화면 조건이다.
 */
async function runLatencyProbe(
  info: AppInfo,
  layoutEl: HTMLElement,
  stack: string | null,
): Promise<void> {
  const n = Math.max(1, info.panes.count);
  let handles: TerminalHandle[];
  if (n === 1) {
    // 1패널은 S1-3 경로 그대로 단일 마운트 — 지난 A-3 값과 같은 조건을 유지한다.
    layoutEl.classList.add("single");
    handles = [createTerminal(layoutEl, stack)];
  } else {
    handles = renderStaticGrid(layoutEl, n, stack);
  }
  const first = handles[0];
  const cellWidths = await measureCells(first.term);

  writeDemo(
    first.term,
    first.status,
    "계측 모드 — 셸 없이 로컬 에코만 잰다." +
      (n > 1 ? ` · 패널 ${n}개(계측은 이 패널)` : "") +
      stackNote(info),
    true,
  );
  for (let i = 1; i < handles.length; i++) {
    handles[i].term.write(`\x1b[90m패널 ${i + 1} — 계측 유휴 (셸·입력 없음)\x1b[0m`);
  }

  reportRenderer(
    first,
    cellWidths,
    handles.map((h, i) => ({ leaf: `grid-${i + 1}`, verdict: verdictOf(h.status).text })),
  );

  const latEl = el("#latency");
  latEl.hidden = false;

  // S2-10 유휴→첫 키 모드 — 계측엔 PTY가 없어(#10) 복귀 트리거를 memlevel_touch로 재현한다.
  // 발사 형태(IPC 한 발)가 pty_write와 같다. **표준 실행에는 안 건다** — 조건이 달라지면
  // 지난 A-3 값과 비교가 깨진다. 요약 config에 idle_wait와 함께 찍혀 섞임을 막는다.
  const idleWait = info.probe.idle_wait_ms;
  if (idleWait > 0) {
    first.term.onData(() => void invoke("memlevel_touch").catch(() => undefined));
  }

  const probe = new LatencyProbe(first.term, {
    autoSamples: info.probe.auto_samples,
    injectMs: info.probe.inject_ms,
    frameHold: info.probe.frame_hold,
    gapMs: info.probe.gap_ms,
    gpu: first.status.unmaskedRenderer,
    panels: n,
    idleWaitMs: idleWait,
    onUpdate: (p: Progress) => {
      latEl.textContent =
        `n=${p.n} · 실작업 p99 ${fmt(p.work.p99)} · 대기 p99 ${fmt(p.wait.p99)}` +
        ` · 총지연 p99 ${fmt(p.total.p99)} ms · [${p.path}]`;
      // 화면에 거는 판정선은 **A-3-①(실작업 ≤ 8ms)** 이다. 총지연은 주사율이 절반 이상이라
      // 여기에 걸면 기계마다 색이 갈린다 (docs/issue.md #10).
      latEl.classList.toggle("ok", p.work.p99 <= 8);
      latEl.classList.toggle("bad", p.work.p99 > 8);
    },
  });

  if (idleWait > 0) {
    // 유휴로 둔다 — Low 진입은 백엔드 stderr([memlevel])로 확인된다. 그 뒤 첫 키가 표본 1이다.
    latEl.textContent = `유휴 대기 ${Math.round(idleWait / 1000)}s — Low 진입 후 첫 키를 잰다`;
    logInfo(`유휴 대기 ${idleWait}ms 시작 — 종료 후 계측 개시 (S2-10 유휴→첫 키)`);
    await sleep(idleWait);
  }

  probe.start();
  logInfo(
    `계측 시작 — 목표 ${info.probe.auto_samples ?? "수동"}회 · 패널 ${n}개` +
      ` · inject=${info.probe.inject_ms}ms · hold=${info.probe.frame_hold} · gap=${info.probe.gap_ms}ms` +
      (idleWait > 0 ? ` · idle_wait=${idleWait}ms` : ""),
  );
}

/** 일반 기동 — 레이아웃 트리 렌더 + 패널마다 셸. `S2-2`의 본편이다. */
async function runApp(info: AppInfo, layoutEl: HTMLElement, stack: string | null): Promise<void> {
  // `--panes=0` — 빈 화면(SPIKE-A4 바닥 B). 터미널·PTY·WebGL을 하나도 만들지 않는다.
  // JS 번들은 이미 파싱된 뒤다 — B의 정의는 "번들 로드 + 인스턴스 0"이고 문서에 그렇게 적는다.
  if (info.panes.count === 0) {
    const note = document.createElement("div");
    note.style.cssText = "display:flex;align-items:center;justify-content:center;height:100%;color:#7b87a8;font:13px 'Cascadia Mono',monospace";
    note.textContent = "진단 모드 — 터미널 없음 (SPIKE-A4 바닥 측정)";
    layoutEl.appendChild(note);
    el("#renderer").textContent = "진단 — 렌더러 미생성";
    el("#shell").textContent = "셸 없음";
    logInfo("빈 화면 준비 완료 — xterm 0 · PTY 0 · WebGL 0");
    installAppDataReport();
    return;
  }
  let cellWidths: Record<string, number> = {};
  let firstHandle: TerminalHandle | null = null;

  const manager = new PanelManager(layoutEl, {
    fontStack: stack,
    usePty: true,
    onFirstTerminal: async (handle) => {
      firstHandle = handle;
      cellWidths = await measureCells(handle.term);
      // 판정을 터미널에 먼저 찍는다. 상태줄이나 IPC가 죽어도 이건 남는다.
      writeDemo(handle.term, handle.status, `셸 연결 중 — ${info.shell}` + stackNote(info), false);
    },
    onFocus: (panel) => {
      const shellEl = el("#shell");
      if (panel.link) {
        shellEl.textContent =
          `셸 ${baseName(panel.link.shell ?? "?")} · pid ${panel.link.pid ?? "?"}` +
          ` · ${panel.leafId}`;
        shellEl.classList.add("ok");
        shellEl.classList.remove("bad");
      } else {
        shellEl.textContent = `셸 없음 · ${panel.leafId}`;
        shellEl.classList.add("bad");
        shellEl.classList.remove("ok");
      }
    },
  });

  await manager.boot();
  connectFocus(manager); // S2-4 — 이때부터 Ctrl+Alt+화살표·Ctrl+Shift+Z가 동작한다.

  // `--panes=N` — 같은 화면을 매번 같은 방법으로 만든다. A2 측정의 재현 조건이다.
  if (info.panes.count > manager.size) {
    await ensurePanes(manager, info.panes.count);
  }

  if (firstHandle) {
    reportRenderer(
      firstHandle,
      cellWidths,
      manager.rendererReport().map((r) => ({ leaf: r.leaf, verdict: r.verdict })),
    );
  }

  if (info.panes.probe) {
    await runPanesProbe(manager, info);
    return;
  }

  // S2-11 — 배치 프리셋 무인 확인. 일반 화면 위에서 돌지만 검증이므로 상태바·디스크 훑기 앞이다.
  if (info.preset_probe.enabled) {
    await runPresetProbe(manager, info);
    return;
  }

  // 계측·검증이 아닐 때만 건다 — 표본 구간에 디스크 훑기를 얹지 않는다.
  installAppDataReport();

  if (info.pty_probe.enabled) {
    const p = manager.focused();
    if (p?.handle && p.link) {
      void runPtyProbe(p.handle.term, p.link, info.pty_probe);
    } else {
      const msg = "셸이 붙은 패널이 없다";
      await invoke("pty_probe_finish", { text: msg, verdict: `미달 — ${msg}` }).catch(
        () => undefined,
      );
    }
  }
}

/**
 * `S2-2` 무인 검증 (`--panes-probe`) — §2-1 "닫으면 진짜로 없어지는가"를 통째로 돌린다.
 *
 * 4분할을 만들고 → 전부 닫는다 → 남은 것과 살아 있는 것을 센다.
 * 마지막 잎은 규격상 안 닫힌다(`layout.rs`) — 그래서 "비어 있는가"가 아니라
 * **"남긴 만큼만 있는가"**(PTY 1 · 캔버스 1)를 묻는다. 죽인 id가 목록에 남아 있으면 누수다.
 */
async function runPanesProbe(manager: PanelManager, info: AppInfo): Promise<void> {
  const finish = async (pass: boolean, verdict: string, detail: object): Promise<void> => {
    await invoke("panes_probe_finish", {
      json: JSON.stringify(detail, null, 2),
      verdict,
      pass,
    }).catch((e) => logError("panes_probe_finish 실패", e));
  };

  try {
    const target = info.panes.count;
    // 프롬프트가 그려질 시간. pty_spawn 자체는 boot에서 이미 끝났다.
    await sleep(2000);

    const peakLeaves = manager.leafIds();
    const peakPtys = await invoke<PtyInfo[]>("pty_list");
    const peakCanvases = canvasCount();
    const peakRenderers = manager.rendererReport();

    const killed: string[] = [];
    while (manager.leafIds().length > 1) {
      killed.push(...(await manager.close(manager.leafIds()[0])));
    }
    // kill → exit 이벤트 → 구독 해제가 돌 여유.
    await sleep(500);

    const afterLeaves = manager.leafIds();
    const afterPtys = await invoke<PtyInfo[]>("pty_list");
    const afterCanvases = canvasCount();

    // xterm은 패널당 캔버스를 여러 장 쓴다(M2 실측 2장 — WebGL 컨텍스트는 그중 1개다).
    // 장수를 박아 두면 xterm 판올림마다 검증이 거짓 미달을 낸다 — 비례로 잰다:
    // 패널당 장수가 일정하고, 닫은 뒤에는 남은 패널 몫만 남아야 한다.
    const perPanel = peakLeaves.length > 0 ? peakCanvases / peakLeaves.length : NaN;

    const checks = {
      opened_to_target: peakLeaves.length === target,
      pty_per_panel: peakPtys.length === peakLeaves.length,
      canvas_per_panel_uniform: Number.isInteger(perPanel) && perPanel >= 1,
      renderers_alive: peakRenderers.every((r) => r.alive),
      closed_to_one: afterLeaves.length === 1,
      pty_list_matches_survivor: afterPtys.length === 1,
      killed_ptys_gone: killed.every((k) => !afterPtys.some((p) => p.id === k)),
      canvas_disposed: afterCanvases === perPanel * afterLeaves.length,
    };
    const pass = Object.values(checks).every(Boolean);
    const failed = Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([k]) => k);

    const verdict =
      `${pass ? "통과" : "미달"} — 패널 ${peakLeaves.length}/${target}` +
      ` · PTY ${peakPtys.length}→${afterPtys.length} (기대 ${target}→1)` +
      ` · 캔버스 ${peakCanvases}→${afterCanvases} (패널당 ${perPanel}장 기준 ${perPanel * afterLeaves.length}장 기대)` +
      ` · 죽인 PTY ${killed.length}개 ${checks.killed_ptys_gone ? "모두 정리" : "누수"}` +
      ` · 렌더러 생존 ${peakRenderers.filter((r) => r.alive).length}/${peakRenderers.length}` +
      (pass ? "" : ` · 실패: ${failed.join(", ")}`);

    await finish(pass, verdict, {
      pass,
      checks,
      target,
      canvases_per_panel: perPanel,
      peak: {
        leaves: peakLeaves,
        ptys: peakPtys.map((p) => p.id),
        canvases: peakCanvases,
        renderers: peakRenderers,
      },
      after: {
        leaves: afterLeaves,
        ptys: afterPtys.map((p) => p.id),
        canvases: afterCanvases,
      },
      killed,
    });
  } catch (e) {
    logError("패널 무인 검증 중 예외", e);
    await finish(false, `미달 — 검증 중 예외: ${e}`, { pass: false, error: String(e) });
  }
}

/** 살아 있는 렌더 캔버스 수 — "정리했다고 믿는 것"과 DOM에 실제 남은 것을 구분한다. */
function canvasCount(): number {
  return canvasList().length;
}

/** 캔버스 **요소들**. 수만으로는 "새로 만든 8장"과 "그 8장"이 구분되지 않는다(`S2-11`). */
function canvasList(): Element[] {
  return [...document.querySelectorAll(".xterm-screen canvas")];
}

/**
 * `S2-11` 무인 확인 (`--preset-probe`) — **"재배열이지 재생성이 아니다"를 기계가 판정한다.**
 *
 * 이건 화면으로 구분이 안 되는 성질이다. 새 셸 8개로 다시 뜬 화면과 살아 있는 세션을
 * 옮겨 담은 화면은 똑같이 생겼다 — 스크롤백을 눈으로 뒤져야 갈린다. 그래서 신원을 대조한다.
 *
 *   ① **잎 id** — 트리가 같은 세션을 들고 있는가 (순서까지)
 *   ② **PTY id** — 프로세스가 안 죽었는가 (`pty_list`는 살아 있는 것만 준다)
 *   ③ **캔버스 요소 동일성** — xterm이 파괴·재생성되지 않았는가.
 *      수만 세면 새로 만든 8장도 8장이다. **요소가 같아야** 버퍼·WebGL 컨텍스트가 산 것이다.
 *   ④ 트리 모양이 `listPresets()`가 예고한 배치와 같은가.
 *      **검증은 엔진과 따로 계산한다**(`shapeOf`) — 같은 코드로 검사하면 그 코드가 틀렸을 때
 *      통과가 나온다.
 */
async function runPresetProbe(manager: PanelManager, info: AppInfo): Promise<void> {
  const finish = async (pass: boolean, verdict: string, detail: object): Promise<void> => {
    await invoke("preset_probe_finish", {
      json: JSON.stringify(detail, null, 2),
      verdict,
      pass,
    }).catch((e) => logError("preset_probe_finish 실패", e));
  };

  try {
    // 프롬프트가 그려질 시간. 셸 자체는 boot에서 이미 떴다.
    await sleep(2000);

    const metas = await manager.listPresets();
    const target = info.preset_probe.target;
    const targets = target === "all" ? metas : metas.filter((m) => m.id === target);
    if (targets.length === 0) {
      await finish(false, `미달 — 모르는 프리셋: ${target}`, { pass: false, target });
      return;
    }

    const baseLeaves = manager.leafIds();
    const basePtys = (await invoke<PtyInfo[]>("pty_list")).map((p) => p.id).sort();
    const baseCanvases = canvasList();
    if (baseLeaves.length < 2) {
      // 잎이 하나면 어떤 프리셋을 걸어도 같은 화면이라 아무것도 증명하지 못한다.
      await finish(false, `미달 — 세션이 ${baseLeaves.length}개다. --panes=N으로 2개 이상 필요`, {
        pass: false,
        leaves: baseLeaves,
      });
      return;
    }

    const lines: string[] = [];
    const results: object[] = [];
    let allPass = true;

    for (const meta of targets) {
      await manager.applyPreset(meta.id);
      // 재배열 뒤 격자 맞추기(fit)와 리사이즈가 가라앉을 시간.
      await sleep(300);

      const leaves = manager.leafIds();
      const ptys = (await invoke<PtyInfo[]>("pty_list")).map((p) => p.id).sort();
      const canvases = canvasList();
      const tree = await invoke<LayoutStateDto>("layout_get");
      const shape = shapeOf(tree.root);
      const want = expectedShape(meta);
      const cur = manager.currentPreset();

      const checks = {
        leaves_identical: sameList(leaves, baseLeaves),
        ptys_identical: sameList(ptys, basePtys),
        pty_per_leaf: ptys.length === leaves.length,
        canvas_identity_preserved: sameElements(canvases, baseCanvases),
        renderers_alive: manager.rendererReport().every((r) => r.alive),
        current_preset_is_target: cur?.id === meta.id,
        shape_matches_plan:
          !!shape && shape.axis === want.axis && sameList(shape.groups, want.groups),
      };
      const failed = Object.entries(checks)
        .filter(([, ok]) => !ok)
        .map(([k]) => k);
      if (failed.length) allPass = false;

      lines.push(
        `${failed.length ? "미달" : "통과"} ${meta.id} (${meta.short}) —` +
          ` 계획 ${want.axis ?? "leaf"}[${want.groups.join(",")}]` +
          ` 실제 ${shape ? `${shape.axis ?? "leaf"}[${shape.groups.join(",")}]` : "프리셋 모양 아님"}` +
          ` · 잎 ${leaves.length} · PTY ${ptys.length} · 캔버스 ${canvases.length}` +
          (failed.length ? ` · 실패: ${failed.join(", ")}` : ""),
      );
      results.push({
        id: meta.id,
        label: meta.label,
        short: meta.short,
        rule: meta.rule,
        planned: want,
        actual: shape,
        checks,
        pass: failed.length === 0,
        leaves,
        ptys,
        canvases: canvases.length,
        current_preset: cur?.id ?? null,
      });
    }

    lines.unshift(
      `${allPass ? "통과" : "미달"} — 프리셋 ${targets.length}종 ×` +
        ` 세션 ${baseLeaves.length}개 · 잎·PTY·캔버스 신원 대조`,
    );
    await finish(allPass, lines.join("\n"), {
      pass: allPass,
      target,
      sessions: baseLeaves.length,
      base: { leaves: baseLeaves, ptys: basePtys, canvases: baseCanvases.length },
      presets: results,
    });
  } catch (e) {
    logError("프리셋 무인 확인 중 예외", e);
    await finish(false, `미달 — 확인 중 예외: ${e}`, { pass: false, error: String(e) });
  }
}

/** 트리를 (뿌리 방향 · 칸별 잎 수)로 눌러 본다. 프리셋이 만들 수 있는 모양이 아니면 `null`. */
function shapeOf(root: LayoutNode): { axis: SplitDirection | null; groups: number[] } | null {
  if (root.type === "leaf") return { axis: null, groups: [1] };
  const inner: SplitDirection = root.direction === "row" ? "column" : "row";
  const groups: number[] = [];
  for (const c of root.children) {
    const n = c.node;
    if (n.type === "leaf") {
      groups.push(1);
      continue;
    }
    if (n.direction !== inner || !n.children.every((x) => x.node.type === "leaf")) return null;
    groups.push(n.children.length);
  }
  return { axis: root.direction, groups };
}

/**
 * 메타의 계획을 **정규화 뒤 모양**으로 옮긴다.
 *
 * 칸이 하나뿐인 계획(`1 × 8`)은 뿌리 분할이 걷히고 안쪽 분할이 뿌리로 올라온다
 * (`layout.rs::normalize` — 외자식 분할 제거). 그 규칙을 여기서도 알아야 비교가 성립한다.
 */
function expectedShape(meta: PresetInfo): { axis: SplitDirection | null; groups: number[] } {
  const inner: SplitDirection = meta.axis === "row" ? "column" : "row";
  if (meta.groups.length === 1) {
    const g = meta.groups[0];
    return g === 1 ? { axis: null, groups: [1] } : { axis: inner, groups: Array(g).fill(1) };
  }
  return { axis: meta.axis, groups: meta.groups };
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** 순서는 봐주고 **구성은 안 봐준다** — 같은 요소들이 그대로 있어야 한다. */
function sameElements(a: readonly Element[], b: readonly Element[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((el) => set.has(el));
}

/**
 * A-2 폭 계측 (`--font-probe`) — 재고, 남기고, 끝낸다.
 *
 * A-2가 묻는 건 결국 숫자다: 한글 글리프의 advance가 ASCII의 정확히 2배인가.
 * **육안을 대체하지 않는다** — 육안 전에 싸게 거르는 자리다 (`src/font.ts` 머리말).
 */
async function runFontProbeAndExit(info: AppInfo, cells: Record<string, number>): Promise<void> {
  const result = runFontProbe(cells, FONT_STACK, info.font_probe.stack, FONT_SIZE);
  await invoke("font_probe_finish", {
    json: JSON.stringify(result, null, 2),
    verdict: fontVerdictLines(result).join("\n"),
  });
}

/** 파일을 안 열어도 통과/미달이 보여야 한다. stderr로 나갈 줄들을 만든다. */
function fontVerdictLines(r: FontProbeResult): string[] {
  const mark = (v: string) => (v === "pass" ? "통과" : v === "warn" ? "주의" : "미달");
  const sign = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(3)}`;

  const lines: string[] = [
    `글자 ${r.fontSize}px · DPR ${r.devicePixelRatio} · 판정선 통과<${r.passDevicePx} 주의<${r.warnDevicePx} 기기픽셀`,
  ];

  for (const s of r.stacks) {
    lines.push(
      `[${s.label}] CJK ${mark(s.cjk)} · Ambiguous ${mark(s.ambiguous)}` +
        ` · ASCII ${s.asciiAdvance}px (${s.asciiEm}em)` +
        // ASCII가 0.5em이 아닌 폰트에 CJK 1.0em을 섞으면 2배가 산술적으로 불가능하다.
        (s.mixed ? " · ⚠️ ASCII와 CJK가 다른 폰트다" : ""),
    );
    // 굵은 글씨는 터미널에서 항상 보이는 자리다. Regular만 재고 끝내면 놓친다.
    lines.push(
      `   굵게: ASCII ${s.bold.asciiAdvance}px · 가 비율=${s.bold.cjkRatio.toFixed(4)}` +
        ` 오차=${sign(s.bold.errDevicePx)}px [${mark(s.bold.verdict)}]`,
    );
    // 설치 안 된 폰트는 스택에 적혀 있어도 안 돈다. 그 사실이 A-2의 전제다.
    lines.push(
      `   설치: ${s.entries.map((e) => `${e.family}${e.available ? "✓" : "✗"}`).join(" · ")}`,
    );
    for (const c of s.chars) {
      const by = c.resolvedBy
        ? c.resolvedBy + (c.inconclusive ? "?" : "")
        : c.inconclusive
          ? "판별불가"
          : "없음";
      lines.push(
        `   ${c.ch} ${c.codepoint} 칸=${c.cells} ${c.advance}px(${c.advanceEm}em)` +
          ` 비율=${c.ratio.toFixed(4)} 오차=${sign(c.errDevicePx)}px [${mark(c.verdict)}] ← ${by}`,
      );
    }
  }
  return lines;
}

/**
 * S2-1b — 앱 데이터 폴더 크기를 상태줄에 건다 (`docs/issue.md` #7).
 *
 * 상한 강제는 `S3-6`이다. 여기서 하는 건 **보이게 만드는 것**뿐이다 —
 * 지금 우리가 가진 용량 숫자는 배포물 3.14MB 하나뿐이고,
 * 사용자가 체감하는 값은 거기에 캐시가 더해진 쪽이다. wmux가 512MB가 된 자리가 정확히 여기다.
 */
function installAppDataReport(): void {
  const box = el<HTMLElement>("#appdata");
  box.hidden = false;
  box.textContent = "앱데이터 …";

  const mb = (b: number) => (b / 1024 / 1024).toFixed(1);

  const refresh = async (): Promise<void> => {
    try {
      const r = await invoke<AppDataReport>("app_data_report");
      const pct = r.total_bytes > 0 ? Math.round((r.cache_bytes / r.total_bytes) * 100) : 0;
      const over = r.total_bytes >= r.limit_bytes;

      box.textContent =
        `앱데이터 ${mb(r.total_bytes)} MB (캐시 ${pct}%)` +
        ` / KR2 ${mb(r.limit_bytes)} MB${r.truncated ? " ⚠잘림" : ""}`;

      // 총합만 보이면 "자랐다"는 알아도 "어디가"는 모른다. 경로와 내역은 툴팁에 둔다.
      box.title = [
        `총 ${mb(r.total_bytes)} MB · 캐시 계열 ${mb(r.cache_bytes)} MB (${pct}%)`,
        `파일 ${r.files}개 · 훑는 데 ${r.elapsed_ms}ms${r.isolated ? " · 격리 인스턴스" : ""}`,
        r.truncated ? "⚠️ 훑기 상한에 걸려 잘린 값이다" : "",
        "",
        ...r.roots.map((x) => `${x.label}  ${mb(x.bytes)} MB  ${x.exists ? "" : "(없음) "}${x.path}`),
      ]
        .filter(Boolean)
        .join("\n");

      box.classList.toggle("warn", over);
      box.classList.toggle("ok", !over);
    } catch (e) {
      // 조용히 비우지 않는다. 안 보이는 것과 0인 것은 다르다.
      logError("앱 데이터 크기 조회 실패", e);
      box.textContent = "앱데이터 조회 실패";
      box.classList.add("warn");
    }
  };

  void refresh();
  window.setInterval(() => void refresh(), APPDATA_REFRESH_MS);
}

/**
 * S1-2·S1-4 무인 검증 — 화면 없이 셸 왕복을 증명한다.
 *
 * 두 가지를 본다:
 *   ① 명령이 **실행**됐는가 — 표식이 두 번(입력 에코 + 출력) 나타나야 한다.
 *      한 번이면 그건 "쳐진 글자"일 뿐 셸이 돌았다는 증거가 아니다.
 *   ② **한글이 왕복하는가** — ConPTY 바이트가 글자 중간에서 끊겨도 살아남는지 본다.
 *      (`src-tauri/src/pty.rs` take_utf8이 그 자리다. 관문 A-1·A-2의 전제다)
 */
async function runPtyProbe(term: Terminal, link: PtyLink, cfg: PtyProbeConfig): Promise<void> {
  const MARK = "EQMUX-PTY-OK";
  const KOR = "한글가나다漢字";

  try {
    // 프롬프트가 그려지기 전에 치면 입력이 먹힌다. 셸 기동을 기다린다.
    await sleep(1500);
    await link.send(`${cfg.command}\r`);
    await sleep(cfg.wait_ms);

    await link.send(`echo ${MARK}-${KOR}\r`);
    await sleep(1500);

    const text = bufferText(term);
    const marks = count(text, MARK);
    const kors = count(text, KOR);
    const ok = marks >= 2 && kors >= 2;

    const verdict =
      `${ok ? "통과" : "미달"} — 셸=${link.shell ?? "?"} · 표식 ×${marks}(필요 2) · ` +
      `한글 ×${kors}(필요 2) · 버퍼 ${text.split("\n").length}줄 · 명령=${JSON.stringify(cfg.command)}`;

    await invoke("pty_probe_finish", { text, verdict });
  } catch (e) {
    logError("PTY 무인 검증 실패", e);
    await invoke("pty_probe_finish", {
      text: String(e),
      verdict: `미달 — 검증 중 예외: ${e}`,
    }).catch(() => undefined);
  }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

installGlobalHandlers();

window.addEventListener("DOMContentLoaded", () => {
  void main().catch((e) => {
    logError("기동 실패", e);
    const r = document.querySelector("#renderer");
    if (r) {
      r.textContent = `기동 실패: ${e}`;
      r.classList.add("bad");
    }
    // 화면 어딘가에도 반드시 남긴다. 조용한 실패가 제일 나쁘다.
    const t = document.querySelector("#layout");
    if (t) {
      const pre = document.createElement("pre");
      pre.style.cssText = "color:#ff7a7a;font:12px monospace;padding:8px;white-space:pre-wrap";
      pre.textContent = `기동 실패: ${e}\n${e instanceof Error ? (e.stack ?? "") : ""}`;
      t.appendChild(pre);
    }
  });
});
