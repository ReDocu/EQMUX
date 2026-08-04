// 키 입력 지연 계측 — 관문 A-3(p99 ≤ 16ms)의 판정 근거.
//
// 해원이 BASELINE.md §5에서 요청한 3점 계측을 그대로 구현한다.
//
//   t0  keydown            — 키가 xterm에 도달한 시각
//   t1  write 처리 완료    — 파서가 데이터를 소화한 시각
//   t2  렌더 완료          — 화면에 실제로 그려진 시각 (WebGL 프레임)
//
// 측정 범위를 분명히 해 둔다:
//   포함    keydown 핸들러 → 파싱 → 렌더 프레임
//   미포함  OS 키보드 입력 → 브라우저 keydown 디스패치 (앱 밖이라 잴 수 없다)
//
// 자동 입력(--latency-probe-run=N)은 합성 KeyboardEvent를 쓴다.
// `isTrusted`가 false지만 xterm은 이를 보지 않는다. 다만 위 "미포함" 구간이
// 빠진다는 사실은 결과에도 함께 기록한다 — 나중에 이 숫자를 인용할 사람이 알아야 한다.

import type { Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";

import { echoOf } from "./terminal";

export interface Sample {
  /** 파싱까지 (ms) */
  parse: number;
  /** 렌더까지 (ms) */
  render: number;
  /** 전체 t2 - t0 (ms) */
  total: number;
}

export interface Summary {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface ProbeOptions {
  autoSamples: number | null;
  onUpdate?: (s: Summary, mode: string) => void;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  // 최근접 순위법. 표본이 적을 때 보간법보다 해석이 단순하다.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function summarize(values: number[]): Summary {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s.length ? s[s.length - 1] : NaN,
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN,
  };
}

export class LatencyProbe {
  private readonly term: Terminal;
  private readonly opts: ProbeOptions;

  private pendingKeydown: number | null = null;
  private awaitingRender: { t0: number; t1: number }[] = [];
  private samples: Sample[] = [];
  private lines: string[] = [];

  /** 합성 keydown이 xterm까지 도달했는가. 안 되면 term.input()으로 내려간다. */
  private inputPath: "keydown" | "term.input" = "keydown";
  private sawData = false;
  private finished = false;

  constructor(term: Terminal, opts: ProbeOptions) {
    this.term = term;
    this.opts = opts;
  }

  start(): void {
    const textarea = this.term.textarea;
    if (textarea) {
      // capture 단계에서 잡아야 xterm 핸들러보다 먼저 t0을 찍는다.
      textarea.addEventListener("keydown", () => {
        this.pendingKeydown = performance.now();
      }, { capture: true });
    }

    this.term.onData((data) => {
      this.sawData = true;
      const t0 = this.pendingKeydown ?? performance.now();
      this.pendingKeydown = null;
      // PTY가 없으므로 로컬 에코가 곧 출력이다. S1-4 이후엔 PTY 왕복이 여기에 들어간다.
      this.term.write(echoOf(data), () => {
        this.awaitingRender.push({ t0, t1: performance.now() });
      });
    });

    this.term.onRender(() => {
      if (this.awaitingRender.length === 0) return;
      const t2 = performance.now();
      const batch = this.awaitingRender.splice(0);
      for (const p of batch) {
        const sample: Sample = {
          parse: p.t1 - p.t0,
          render: t2 - p.t1,
          total: t2 - p.t0,
        };
        this.samples.push(sample);
        this.lines.push(
          JSON.stringify({
            kind: "sample",
            path: this.inputPath,
            parse_ms: +sample.parse.toFixed(3),
            render_ms: +sample.render.toFixed(3),
            total_ms: +sample.total.toFixed(3),
          }),
        );
      }
      this.opts.onUpdate?.(summarize(this.samples.map((s) => s.total)), this.inputPath);
      if (this.opts.autoSamples && this.samples.length >= this.opts.autoSamples) {
        void this.finish();
      }
    });

    if (this.opts.autoSamples) {
      void this.drive(this.opts.autoSamples);
    }
  }

  /** 합성 입력을 한 글자씩, 표본이 끝날 때마다 보낸다. 한 프레임에 몰면 측정이 왜곡된다. */
  private async drive(n: number): Promise<void> {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
    for (let i = 0; i < n && !this.finished; i++) {
      const ch = chars[i % chars.length];
      this.sendKey(ch);

      if (i === 0) {
        // 합성 keydown이 먹었는지 한 번만 확인하고, 안 먹었으면 경로를 바꾼다.
        await sleep(60);
        if (!this.sawData) {
          this.inputPath = "term.input";
          console.warn("[eqmux][probe] 합성 keydown이 xterm에 닿지 않았다 — term.input()으로 전환");
        }
      }
      await sleep(8);
    }
    // 마지막 표본의 렌더를 기다린다.
    await sleep(200);
    if (!this.finished) await this.finish();
  }

  private sendKey(ch: string): void {
    if (this.inputPath === "term.input") {
      this.pendingKeydown = performance.now();
      this.term.input(ch);
      return;
    }
    const ta = this.term.textarea;
    if (!ta) {
      this.inputPath = "term.input";
      this.pendingKeydown = performance.now();
      this.term.input(ch);
      return;
    }
    ta.focus();
    ta.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ch,
        code: `Key${ch.toUpperCase()}`,
        keyCode: ch.toUpperCase().charCodeAt(0),
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  async flush(): Promise<void> {
    if (this.lines.length === 0) return;
    const batch = this.lines.splice(0);
    try {
      await invoke<string>("probe_append", { lines: batch });
    } catch (e) {
      console.error("[eqmux][probe] 기록 실패", e);
    }
  }

  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;

    const total = summarize(this.samples.map((s) => s.total));
    const parse = summarize(this.samples.map((s) => s.parse));
    const render = summarize(this.samples.map((s) => s.render));

    await this.flush();

    const summary = JSON.stringify({
      kind: "summary",
      input_path: this.inputPath,
      note: "OS→브라우저 keydown 디스패치 구간은 포함되지 않는다",
      total,
      parse,
      render,
    });

    if (this.opts.autoSamples) {
      // 무인 측정이면 여기서 앱이 끝난다.
      try {
        await invoke("probe_finish", { summary });
      } catch (e) {
        console.error("[eqmux][probe] 종료 처리 실패", e);
      }
    } else {
      await invoke("probe_append", { lines: [summary] }).catch(() => undefined);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
