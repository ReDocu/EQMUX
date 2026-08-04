// S1-3 — 터미널 렌더러를 띄우고 렌더러 상태를 드러낸다.
//
// 화면에 글자가 그려지는 것만으로는 통과가 아니다.
// DOM 렌더러로 조용히 폴백해도 글자는 그려진다 — 느릴 뿐이다.
// 그래서 렌더 경로를 항상 눈에 보이게 표시한다.

import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import {
  createTerminal,
  writeDemo,
  verdictOf,
  readCellWidths,
  CELL_PROBES,
  FONT_STACK,
  FONT_SIZE,
} from "./terminal";
import { runFontProbe, ensureFontsLoaded, type FontProbeResult } from "./font";
import { LatencyProbe, installFrameHold, type Progress } from "./latency";
import { PtyLink, bufferText } from "./pty";
import { installGlobalHandlers, logError, logInfo } from "./log";

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

interface AppInfo {
  name: string;
  version: string;
  paths: Paths;
  probe: ProbeConfig;
  pty_probe: PtyProbeConfig;
  font_probe: FontProbeConfig;
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

  // 자가 검증 ③ — 프레임 홀드는 **터미널 생성 전에** 걸어야 한다.
  // xterm이 rAF를 잡은 뒤에 갈아끼우면 이미 등록된 콜백이 옛 경로로 돈다.
  if (info.probe.enabled && info.probe.frame_hold > 1) {
    installFrameHold(info.probe.frame_hold);
  }

  // ⚠️ **터미널보다 먼저** 동봉 폰트를 붙인다. xterm은 셀 크기를 생성 시점에 한 번 재므로,
  // 그때 폰트가 없으면 격자가 폴백 기준으로 잡히고 나중에 폰트가 바뀌어도 안 고쳐진다.
  // 그러면 A-2를 통과시켜 놓고 첫 화면만 어긋난다 (`src/font.ts` ensureFontsLoaded).
  const loadedFonts = await ensureFontsLoaded(["D2Coding"], FONT_SIZE);
  if (loadedFonts.length === 0) {
    // 동봉해 놓고 안 붙은 상태다. 조용히 폴백으로 뜨면 A-2가 소리 없이 미달로 돌아간다.
    logError("동봉 폰트를 붙이지 못했다 — 폴백으로 뜬다 (A-2 미달 가능)", "D2Coding");
  }

  // 폰트 스택 강제는 계측 여부와 무관하게 먹는다 — 육안 확인도 이 스택으로 해야 한다.
  const { term, fit, status } = createTerminal(el("#term"), info.font_probe.stack);

  // 빈 버퍼에서 셀 폭을 먼저 재고 지운다. 데모 출력이 섞이면 열 위치를 못 잡는다.
  const cellWidths = await new Promise<Record<string, number>>((resolve) => {
    term.write(CELL_PROBES.join(""), () => {
      const w = readCellWidths(term);
      term.reset();
      resolve(w);
    });
  });

  // A-2 폭 계측은 여기서 끝난다. 셸도 데모도 필요 없다 — 캔버스만 있으면 잰다.
  // `cellWidths`가 나온 직후여야 한다: 기대 비율이 곧 xterm이 배정한 칸 수다.
  if (info.font_probe.enabled) {
    await runFontProbeAndExit(info, cellWidths);
    return;
  }

  // 계측 모드는 렌더 경로만 재므로 셸을 붙이지 않는다(로컬 에코).
  // PTY 왕복이 섞이면 A-3 숫자가 두 시점의 혼합이 된다 — docs/issue.md #10.
  const usePty = !info.probe.enabled;

  // 판정을 터미널에 먼저 찍는다. 아래 상태줄이나 IPC가 죽어도 이건 남는다.
  writeDemo(
    term,
    status,
    (usePty ? `셸 연결 중 — ${info.shell}` : "계측 모드 — 셸 없이 로컬 에코만 잰다.") +
      // 어떤 스택으로 그려진 화면인지 화면 안에 적는다.
      // 강제한 줄 모르고 본 육안 확인은 A-2에서 쓸 수 없다 — GATE-A §1이 그 경우였다.
      (info.font_probe.stack ? `\r\n\x1b[33m폰트 스택 강제 — ${info.font_probe.stack}\x1b[0m` : ""),
    !usePty,
  );

  const v = verdictOf(status);
  const rendEl = el("#renderer");
  rendEl.textContent = v.text;
  rendEl.classList.add(v.sgr === "32" ? "ok" : v.sgr === "33" ? "warn" : "bad");

  el("#gpu").textContent = status.unmaskedRenderer ?? "(렌더러 문자열 없음)";

  // 창 크기에 맞춘다. S2에서 패널 분할이 들어오면 이 자리를 레이아웃이 가져간다.
  const ro = new ResizeObserver(() => {
    try {
      fit.fit();
    } catch {
      /* 창이 최소화되면 크기가 0이 된다 — 무시한다 */
    }
  });
  ro.observe(el("#term"));

  if (info.probe.enabled) {
    const latEl = el("#latency");
    latEl.hidden = false;
    const probe = new LatencyProbe(term, {
      autoSamples: info.probe.auto_samples,
      injectMs: info.probe.inject_ms,
      frameHold: info.probe.frame_hold,
      gapMs: info.probe.gap_ms,
      gpu: status.unmaskedRenderer,
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
    probe.start();
    logInfo(
      `계측 시작 — 목표 ${info.probe.auto_samples ?? "수동"}회` +
        ` · inject=${info.probe.inject_ms}ms · hold=${info.probe.frame_hold} · gap=${info.probe.gap_ms}ms`,
    );
  } else {
    await startPty(term, fit, info);
    // 계측 모드에서는 걸지 않는다. 500표본을 재는 동안 옆에서 폴더를 훑으면 그 잡음이 A-3에 얹힌다.
    installAppDataReport();
  }

  console.log("[eqmux] renderer", status);

  // 화면 없이도 렌더 경로를 확인할 수 있어야 한다.
  // 레이아웃 높이도 같이 실어 보낸다 — 상태줄이 화면 밖으로 밀리면 여기서 드러난다.
  const h = (sel: string) => Math.round(el(sel).getBoundingClientRect().height);
  void invoke("report_renderer", {
    status: JSON.stringify({
      ...status,
      verdict: v.text,
      // 논리 셀 폭. 한글·한자가 2가 아니면 A-2는 볼 것도 없이 실패다.
      cellWidths,
      // 컨테이너가 아니라 터미널이 실제로 쓰는 폰트를 적는다.
      // 컨테이너 값을 적으면 셀 폭과 무관한 폰트가 로그에 남아 사람을 속인다.
      fontFamily: term.options.fontFamily,
      layout: {
        innerHeight: window.innerHeight,
        bar: h(".bar"),
        term: h("#term"),
        status: h(".status"),
        rows: term.rows,
        cols: term.cols,
      },
    }),
  });
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
 * S1-4 — 셸을 붙인다.
 *
 * 실패해도 창은 살려 둔다. 검은 창만 남으면 사용자는 원인을 알 방법이 없다 —
 * 터미널·상태줄·stderr 세 곳에 같은 이유를 남긴다.
 */
async function startPty(term: Terminal, fit: FitAddon, info: AppInfo): Promise<void> {
  const shellEl = el("#shell");
  const link = new PtyLink(term, fit);

  try {
    const p = await link.start();
    shellEl.textContent = `셸 ${baseName(p.shell)} · pid ${p.pid ?? "?"}`;
    shellEl.classList.add("ok");
  } catch (e) {
    const msg = `셸 실행 실패 — ${e}`;
    shellEl.textContent = "셸 실행 실패";
    shellEl.classList.add("bad");
    logError("PTY 연결 실패", e);
    term.write(`\r\n\x1b[31m[${msg}]\x1b[0m\r\n`);
    if (info.pty_probe.enabled) {
      await invoke("pty_probe_finish", { text: msg, verdict: `미달 — ${msg}` }).catch(
        () => undefined,
      );
    }
    return;
  }

  term.focus();
  window.addEventListener("beforeunload", () => void link.dispose());

  if (info.pty_probe.enabled) {
    void runPtyProbe(term, link, info.pty_probe);
  }
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
    const t = document.querySelector("#term");
    if (t) {
      const pre = document.createElement("pre");
      pre.style.cssText = "color:#ff7a7a;font:12px monospace;padding:8px;white-space:pre-wrap";
      pre.textContent = `기동 실패: ${e}\n${e instanceof Error ? (e.stack ?? "") : ""}`;
      t.appendChild(pre);
    }
  });
});
