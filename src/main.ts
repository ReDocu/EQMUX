// S1-3 — 터미널 렌더러를 띄우고 렌더러 상태를 드러낸다.
//
// 화면에 글자가 그려지는 것만으로는 통과가 아니다.
// DOM 렌더러로 조용히 폴백해도 글자는 그려진다 — 느릴 뿐이다.
// 그래서 렌더 경로를 항상 눈에 보이게 표시한다.

import { invoke } from "@tauri-apps/api/core";

import {
  createTerminal,
  writeDemo,
  echoOf,
  verdictOf,
  readCellWidths,
  CELL_PROBES,
} from "./terminal";
import { LatencyProbe, type Summary } from "./latency";
import { installGlobalHandlers, logError, logInfo } from "./log";

interface Paths {
  state_file: string;
  workspace_root: string;
  webview_data_dir: string | null;
  isolated: boolean;
}

interface ProbeConfig {
  enabled: boolean;
  auto_samples: number | null;
  out_path: string;
}

interface AppInfo {
  name: string;
  version: string;
  paths: Paths;
  probe: ProbeConfig;
}

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

  const { term, fit, status } = createTerminal(el("#term"));

  // 빈 버퍼에서 셀 폭을 먼저 재고 지운다. 데모 출력이 섞이면 열 위치를 못 잡는다.
  const cellWidths = await new Promise<Record<string, number>>((resolve) => {
    term.write(CELL_PROBES.join(""), () => {
      const w = readCellWidths(term);
      term.reset();
      resolve(w);
    });
  });

  // 판정을 터미널에 먼저 찍는다. 아래 상태줄이나 IPC가 죽어도 이건 남는다.
  writeDemo(term, status);

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
      onUpdate: (s: Summary, path: string) => {
        latEl.textContent =
          `지연 n=${s.n} · p50 ${fmt(s.p50)} · p95 ${fmt(s.p95)} · p99 ${fmt(s.p99)} ms` +
          ` · max ${fmt(s.max)} · [${path}]`;
        // A-3 기준선을 화면에서 바로 읽을 수 있게 한다.
        latEl.classList.toggle("ok", s.p99 <= 16);
        latEl.classList.toggle("bad", s.p99 > 16);
      },
    });
    probe.start();
    logInfo(`계측 시작 — 목표 ${info.probe.auto_samples ?? "수동"}회`);
  } else {
    // 계측이 꺼져 있으면 여기서 에코를 담당한다 (계측 모드에서는 프로브가 쓴다).
    term.onData((d) => term.write(echoOf(d)));
    term.focus();
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
