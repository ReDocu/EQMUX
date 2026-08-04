// S1-4 — xterm ↔ ConPTY 양방향 스트림.
//
// ⚠️ 작성: 서이안(PM). 원래 세아 몫이다 — 팀장님 지시로 대행했다.
//
//   term.onData ──▶ invoke("pty_write") ──▶ ConPTY ──▶ 셸
//   term.write  ◀── listen("pty://data") ◀── 읽기 스레드
//
// 여기서 지키는 것 두 가지:
//   ① 출력을 가공하지 않는다. 이스케이프 시퀀스는 xterm이 해석한다.
//   ② 크기를 항상 셸에 알린다. 안 알리면 vim·htop이 옛 크기로 그려 화면이 어긋난다.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import { logError, logInfo } from "./log";

export interface PtyInfo {
  id: string;
  shell: string;
  pid: number | null;
  cwd: string;
}

interface DataEvent {
  id: string;
  data: string;
}

interface ExitEvent {
  id: string;
  code: number | null;
}

export interface PtyLinkOptions {
  cwd?: string;
  /** 셸이 끝났을 때. 기본값은 터미널에 한 줄 남기는 것뿐이다. */
  onExit?: (code: number | null) => void;
}

/** 살아 있는 셸 하나와 터미널 하나를 잇는다. S2에서 패널마다 하나씩 생긴다. */
export class PtyLink {
  private readonly term: Terminal;
  private readonly fit: FitAddon;
  private info: PtyInfo | null = null;
  private unlisten: UnlistenFn[] = [];
  private closed = false;

  constructor(term: Terminal, fit: FitAddon) {
    this.term = term;
    this.fit = fit;
  }

  get id(): string | null {
    return this.info?.id ?? null;
  }

  get shell(): string | null {
    return this.info?.shell ?? null;
  }

  async start(opts: PtyLinkOptions = {}): Promise<PtyInfo> {
    // 이벤트를 먼저 건다. 셸은 뜨자마자 프롬프트를 뱉으므로,
    // spawn 뒤에 걸면 첫 출력을 놓친다 — 화면이 빈 채로 시작한다.
    this.unlisten.push(
      await listen<DataEvent>("pty://data", (ev) => {
        if (!this.info || ev.payload.id !== this.info.id) return;
        this.term.write(ev.payload.data);
      }),
    );
    this.unlisten.push(
      await listen<ExitEvent>("pty://exit", (ev) => {
        if (!this.info || ev.payload.id !== this.info.id) return;
        this.closed = true;
        this.term.write(`\r\n\x1b[90m[셸 종료 — code=${ev.payload.code ?? "?"}]\x1b[0m\r\n`);
        opts.onExit?.(ev.payload.code);
      }),
    );

    this.info = await invoke<PtyInfo>("pty_spawn", {
      cols: this.term.cols,
      rows: this.term.rows,
      cwd: opts.cwd ?? null,
      shell: null,
    });
    logInfo(`PTY 연결 — ${this.info.shell} (pid=${this.info.pid ?? "?"})`);

    // 입력. 여기서 가공하지 않는다 — 조합 중인 한글도 그대로 셸로 간다.
    this.term.onData((data) => {
      if (this.closed || !this.info) return;
      void invoke("pty_write", { id: this.info.id, data }).catch((e) =>
        logError("pty_write 실패", e),
      );
    });

    // xterm이 스스로 크기를 바꾼 시점에만 알린다. ResizeObserver에서 바로 보내면
    // 같은 크기를 여러 번 통보해 셸이 화면을 계속 다시 그린다.
    this.term.onResize(({ cols, rows }) => {
      if (this.closed || !this.info) return;
      void invoke("pty_resize", { id: this.info.id, cols, rows }).catch((e) =>
        logError("pty_resize 실패", e),
      );
    });

    return this.info;
  }

  /** 창 크기가 바뀌었을 때. fit이 크기를 바꾸면 위 onResize가 셸에 전달한다. */
  refit(): void {
    try {
      this.fit.fit();
    } catch {
      /* 최소화되면 크기가 0이 된다 — 무시한다 */
    }
  }

  /** 명령 한 줄을 셸에 보낸다. 무인 검증(--pty-probe)이 쓴다. */
  async send(line: string): Promise<void> {
    if (!this.info) throw new Error("PTY가 아직 없다");
    await invoke("pty_write", { id: this.info.id, data: line });
  }

  async dispose(): Promise<void> {
    for (const un of this.unlisten) un();
    this.unlisten = [];
    if (this.info && !this.closed) {
      await invoke("pty_kill", { id: this.info.id }).catch(() => undefined);
    }
  }
}

/**
 * 터미널 버퍼에 실제로 찍힌 글자를 읽어 온다 — 무인 검증의 증거.
 *
 * 이벤트로 받은 문자열이 아니라 **xterm이 파싱해 버퍼에 넣은 결과**를 읽는다.
 * 그래야 "왔다"가 아니라 "그려졌다"를 말할 수 있다.
 */
export function bufferText(term: Terminal): string {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    // trimRight=true — 오른쪽 공백까지 담으면 파일이 폭만큼 부풀어 읽기 어렵다.
    lines.push(buf.getLine(i)?.translateToString(true) ?? "");
  }
  // 끝쪽 빈 줄은 버린다. 셸 프롬프트 뒤로 빈 줄이 수십 개 붙는다.
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}
