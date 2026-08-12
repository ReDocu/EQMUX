// 실터미널 페인 — xterm.js 렌더 + PTY 브리지.
// Tauri 안: 실제 pwsh PTY에 부착. 밖(vite dev): 목 라인을 그리고 로컬 에코만 한다.
import { onCleanup, onMount } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  getScrollback,
  isTauri,
  onPtyExit,
  onPtyOutput,
  resizePty,
  scrollbackTail,
  spawnPty,
  writePty,
} from "../backend/pty";

const EQ_THEME = {
  background: "#080b10",
  foreground: "#aab7c8",
  cursor: "#6e9eff",
  cursorAccent: "#080b10",
  selectionBackground: "#233a61",
  black: "#0b0f14",
  blue: "#6e9eff",
  cyan: "#55d1cf",
  green: "#6bd38e",
  magenta: "#b68af2",
  red: "#ef6b73",
  yellow: "#ddb34c",
  white: "#e8eef8",
};

export function TerminalPane(props: { sessionId: string; cwd: string; wsId?: string; mockLines?: string[] }) {
  let host!: HTMLDivElement;

  onMount(() => {
    const term = new Terminal({
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 5000,
      theme: EQ_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    const cleanups: (() => void)[] = [];

    if (isTauri()) {
      // 실제 PTY — 재부착이면 인메모리 버퍼 복원, 앱 재시작이면 스토어에서 재생 (FR-C-31)
      cleanups.push(onPtyOutput(props.sessionId, (data) => term.write(data)));
      cleanups.push(
        onPtyExit(props.sessionId, (code) => {
          term.write(`\r\n\x1b[31m프로세스 종료 · exit ${code ?? "?"}\x1b[0m\r\n`);
        }),
      );
      const d = term.onData((data) => writePty(props.sessionId, data));
      cleanups.push(() => d.dispose());

      void (async () => {
        const backlog = getScrollback(props.sessionId);
        if (backlog) {
          term.write(backlog);
        } else {
          const tail = await scrollbackTail(props.wsId ?? "default", props.sessionId, 500);
          if (tail.length > 0) {
            // 재생과 새 출력 사이의 시각적 경계 (FR-C-32) — 살아있는 척하지 않는다
            term.writeln(`\x1b[90m─── 이전 세션 스크롤백 · 마지막 ${tail.length}줄 재생 ───\x1b[0m`);
            for (const line of tail) term.writeln(`\x1b[2m${line}\x1b[0m`);
            term.writeln("\x1b[90m─── 새 세션 시작 ───\x1b[0m");
          }
        }
        await spawnPty(props.sessionId, props.cwd, term.cols, term.rows, props.wsId);
      })();
    } else {
      // 목 폴백 — 브라우저 dev에서는 정적 라인 + 로컬 에코
      const prompt = `\x1b[38;5;110mPS ${props.cwd}>\x1b[0m `;
      for (const line of props.mockLines ?? []) term.writeln(line);
      term.write(prompt);
      let input = "";
      const d = term.onData((data) => {
        if (data === "\r") {
          term.write(`\r\n\x1b[90m(목 세션 — Tauri에서 실행하면 실제 셸이 붙습니다)\x1b[0m\r\n${prompt}`);
          input = "";
        } else if (data === "\x7f") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            term.write("\b \b");
          }
        } else if (data >= " " || data === "\t") {
          input += data;
          term.write(data);
        }
      });
      cleanups.push(() => d.dispose());
    }

    // 페인 크기 추적 — 배치 변경·줌·전체 화면 모두 여기서 흡수된다.
    // 디바운스 + 실제 변경시에만 PTY resize — ConPTY는 resize마다 전체 리페인트를 쏟아낸다.
    let lastCols = term.cols;
    let lastRows = term.rows;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fit.fit();
        if (isTauri() && (term.cols !== lastCols || term.rows !== lastRows)) {
          lastCols = term.cols;
          lastRows = term.rows;
          resizePty(props.sessionId, term.cols, term.rows);
        }
      }, 120);
    });
    ro.observe(host);
    cleanups.push(() => {
      clearTimeout(resizeTimer);
      ro.disconnect();
    });

    onCleanup(() => {
      cleanups.forEach((c) => c());
      term.dispose();
      // PTY는 죽이지 않는다 — 세션은 페인보다 오래 산다 (줌·탭 전환·재부착)
    });
  });

  return <div class="xterm-host" ref={host} />;
}
