// 키 입력 지연 계측 — 관문 A-3의 판정 근거.
//
// `S1-3`은 3점(`parse` / `render` / `total`)이었다. `S1-3b`에서 **4점으로 나눈다**:
//
//   work_ms  이 키 입력에 귀속되는 **메인 스레드 실행 시간** (A-3-① 판정 대상, ≤ 8ms)
//   wait_ms  그 사이의 **유휴** — 다음 프레임을 기다린 시간 등 (total - work)
//
// ## ⚠️ 순진한 구현이 왜 틀리는가 (docs/GATE-A.md §2-1)
//
// `wait = (다음 rAF 틱) - t0` / `work = total - wait`로 자르면 **회귀를 숨긴다.**
// 메인 스레드가 바쁘면 rAF 콜백 자체가 밀리므로, 파싱이 느려질수록 그 시간이 전부 `wait`로
// 잡히고 `work`는 그대로다. 계측기가 느려짐을 못 본다.
//
// ## 그래서 반대로 잰다 — **일한 구간을 직접 재고, 나머지를 대기로 본다**
//
// 한 키 입력이 화면에 닿기까지 메인 스레드가 실제로 도는 구간은 셋이다.
//
//   [작업 K] keydown 태스크    xterm 키 처리 → onData → term.write() (파서가 여기서 동기로 돈다)
//        ↓ 유휴 (다음 프레임까지)
//   [작업 R] 프레임 콜백       xterm 렌더 → WebGL draw → onRender
//
// (xterm은 `_didUserInput`이 서 있으면 write를 **동기로** 파싱한다 — `WriteBuffer.write`.
//  안 그런 경로도 있으므로 [작업 P] 파싱 태스크를 따로 잡는 자리를 남겨 뒀다.)
//
// 각 구간의 시작·끝을 직접 찍고, 겹치는 구간을 합집합으로 합쳐 `work_ms`를 낸다.
// `total = work + wait`는 정의상 항상 성립한다.
//
//   구간 K 끝  : `queueMicrotask` — JS 스택이 완전히 풀린 시각 = 그 태스크의 끝
//   구간 R 시작: 프레임마다 도는 자체 rAF 티커. **항상 프레임의 첫 콜백**이므로
//                (콜백 안에서 곧바로 다시 등록한다) xterm 렌더보다 먼저 찍힌다.
//
// 이 구조에서 ②(입력 경로에 5ms 바쁜 루프)는 구간 K를 늘려 `work`가 오르고,
// ③(프레임 지연)은 유휴만 늘려 `wait`만 오른다. 자가 검증이 계측기 설계에 박혀 있다.
//
// ## 측정 범위
//
//   포함    keydown 핸들러 → 파싱 → 렌더 프레임(onRender)
//   미포함  OS 키보드 입력 → 브라우저 keydown 디스패치 (앱 밖이라 잴 수 없다)
//           GPU가 실제로 픽셀을 내보내는 시각 (프레젠트/스캔아웃)
//
// ## ⚠️ `S1-3`의 t0가 한 키씩 밀려 있었다
//
// 옛 코드는 `textarea`에 `capture: true`로 keydown을 달았다. 그런데 xterm도 **같은
// textarea**에 keydown을 걸고, 이벤트의 target이 그 textarea다. **AT_TARGET 단계에서는
// capture 여부와 무관하게 등록 순서로 호출된다** — xterm이 먼저 등록되므로 xterm 핸들러가
// 먼저 돌고, onData가 t0를 읽는 시점에는 **이전 키의 keydown 시각**이 들어 있었다.
// 그래서 `parse p50 ≈ 8.8ms`가 두 기계에서 똑같이 나왔다 — 그 값은 파싱 비용이 아니라
// 자동 입력 루프의 `sleep(8)`이다.
//
// 지금은 `window`의 capture 단계에서 잡는다(캡처는 target보다 항상 먼저 돈다).
// 옛 경로도 그대로 같이 재서 `legacy_total` / `diag.legacy_stale_t0`로 남긴다 —
// 기억이 아니라 숫자로 증명되어야 한다.

import type { Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";

import { echoOf } from "./terminal";

export interface Sample {
  /** t1 - t0 · 파싱 완료까지 (3점 계측과 같은 정의) */
  parse: number;
  /** t2 - t1 · 파싱 완료 → 렌더 완료 (3점 계측과 같은 정의) */
  render: number;
  /** t2 - t0 */
  total: number;
  /** 이 키에 귀속된 메인 스레드 실행 시간 — **A-3-① 판정 대상** */
  work: number;
  /** total - work. 프레임 대기 등 유휴 */
  wait: number;
  /** 구간별 내역 (진단용) */
  segInput: number;
  segParse: number;
  segRender: number;
  frameWait: number;
  /** 옛(S1-3) t0 기준 총지연. 비교용 — 표본이 없으면 NaN */
  legacyTotal: number;
  /**
   * **순진한 구현**(GATE-A §2-1)이 냈을 값. `total - (t0 이후 첫 프레임 틱 - t0)`.
   * 우리 값과 나란히 내보내 **그 구현이 회귀를 못 잡는다는 것을 데이터로 보인다.**
   */
  naiveWork: number;
  /** 이 표본이 몇 개짜리 렌더 배치에 묶였는가 */
  batch: number;
}

export interface Summary {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface Progress {
  n: number;
  total: Summary;
  work: Summary;
  wait: Summary;
  path: string;
}

export interface ProbeOptions {
  autoSamples: number | null;
  /** 자가 검증 ② — 입력 처리 경로에 넣을 인위적 바쁜 루프(ms) */
  injectMs: number;
  /** 자가 검증 ③ — rAF 콜백을 K프레임마다 한 번만 흘린다(유효 주사율 1/K) */
  frameHold: number;
  /** 합성 키 간격(ms) */
  gapMs: number;
  /** A-3-③ 기록 항목 */
  gpu: string | null;
  onUpdate?: (p: Progress) => void;
}

type Interval = [number, number];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  // 최근접 순위법. 표본이 적을 때 보간법보다 해석이 단순하다.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function summarize(values: number[]): Summary {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return {
    n: s.length,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s.length ? s[s.length - 1] : NaN,
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN,
  };
}

function round(s: Summary): Summary {
  const r = (v: number): number => (Number.isFinite(v) ? +v.toFixed(3) : v);
  return { n: s.n, p50: r(s.p50), p95: r(s.p95), p99: r(s.p99), max: r(s.max), mean: r(s.mean) };
}

/**
 * 구간 합집합의 길이. 구간이 겹쳐도(동기 파싱이면 P ⊂ K다) 이중 계산되지 않는다.
 * `[lo, hi]` 밖은 잘라낸다 — work가 total을 넘을 수 없어야 한다.
 */
export function busyLength(intervals: Interval[], lo: number, hi: number): number {
  const clipped = intervals
    .map(([a, b]): Interval => [Math.max(a, lo), Math.min(b, hi)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);

  let sum = 0;
  let curA = NaN;
  let curB = NaN;
  for (const [a, b] of clipped) {
    if (Number.isNaN(curA)) {
      curA = a;
      curB = b;
    } else if (a <= curB) {
      curB = Math.max(curB, b);
    } else {
      sum += curB - curA;
      curA = a;
      curB = b;
    }
  }
  if (!Number.isNaN(curA)) sum += curB - curA;
  return sum;
}

/**
 * 자가 검증 ③ — **프레임을 강제로 늦춘다.**
 *
 * rAF 콜백을 모아 두었다가 `hold`프레임마다 한 번만 흘려보낸다. 유효 주사율이 1/hold로
 * 떨어지고, **메인 스레드 작업은 늘지 않는다**(바쁜 루프를 돌리는 게 아니라 기다리기만 한다).
 * 등록 순서가 보존되므로 티커 → xterm 렌더 순서도 그대로다.
 *
 * ⚠️ 이것은 *주사율이 낮은 모니터로 창을 옮긴 것*과 같지 않다. 브라우저는 여전히 원래
 * 주사율로 프레임을 만들고, 우리가 그중 대부분을 건너뛴다. **키 입력이 픽셀에 닿기까지의
 * 시간 구조**는 같지만, 물리적 주사율 변경의 대체물이라는 사실을 결과에 함께 적는다.
 *
 * 터미널 생성 **전에** 불러야 한다. xterm이 rAF를 잡기 전에 갈아끼워야 한다.
 */
export function installFrameHold(hold: number): void {
  if (!Number.isFinite(hold) || hold <= 1) return;

  const realRaf = window.requestAnimationFrame.bind(window);
  const pending: { id: number; cb: FrameRequestCallback }[] = [];
  const cancelled = new Set<number>();
  let nextId = 1;
  let frame = 0;

  const pump = (): void => {
    realRaf((ts) => {
      frame++;
      if (frame % hold === 0 && pending.length > 0) {
        const batch = pending.splice(0);
        for (const p of batch) {
          if (!cancelled.has(p.id)) p.cb(ts);
        }
      }
      pump();
    });
  };
  pump();

  window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    const id = nextId++;
    pending.push({ id, cb });
    return id;
  }) as typeof window.requestAnimationFrame;

  window.cancelAnimationFrame = ((id: number): void => {
    cancelled.add(id);
  }) as typeof window.cancelAnimationFrame;

  console.warn(`[eqmux][probe] 프레임 홀드 ${hold} — 유효 주사율이 1/${hold}로 떨어진다`);
}

/** 인위적 부하. `performance.now()`를 도는 순수 CPU 소모 — 자가 검증 ② 전용. */
function burn(ms: number): number {
  const end = performance.now() + ms;
  let spin = 0;
  while (performance.now() < end) spin++;
  return spin;
}

interface Pending {
  t0: number;
  /** 옛(S1-3) 경로가 t0로 읽었을 값 */
  legacyT0: number | null;
  /** term.write() 직전 */
  wStart: number;
  /** 파싱 완료 (write 콜백) */
  t1: number;
  /** 파싱이 write 호출 안에서 동기로 끝났는가 */
  syncParse: boolean;
  /** 비동기 파싱일 때 파싱 태스크의 시작 근사 */
  pStart: number;
  /** 입력 태스크의 끝 (마이크로태스크) */
  kEnd: number;
  /** 입력 태스크의 동기 끝 (write 반환 직후) */
  kEndSync: number;
  /** t0 이후 처음 도착한 프레임 틱 — 순진한 구현의 컷 지점 */
  firstTick: number;
}

export class LatencyProbe {
  private readonly term: Terminal;
  private readonly opts: ProbeOptions;

  /** 이번 키의 t0. window capture에서 찍는다 — xterm 핸들러보다 확실히 먼저다. */
  private current: Pending | null = null;
  /** 옛 코드와 같은 자리(textarea capture)에서 찍는 값. 밀림을 숫자로 증명하려고 남긴다. */
  private legacyPending: number | null = null;

  private awaitingRender: Pending[] = [];
  private samples: Sample[] = [];
  private lines: string[] = [];

  /** 프레임 시작 시각 — 자체 rAF 티커가 매 프레임 첫 콜백으로 찍는다. */
  private frameTick = 0;
  private prevFrameTick = 0;
  private frameIntervals: number[] = [];

  private orphanT0 = 0;
  private asyncParse = 0;
  private legacyStale = 0;
  private batches = 0;
  private sink = 0;

  /** 합성 keydown이 xterm까지 도달했는가. 안 되면 term.input()으로 내려간다. */
  private inputPath: "keydown" | "term.input" = "keydown";
  private sawData = false;
  private finished = false;

  constructor(term: Terminal, opts: ProbeOptions) {
    this.term = term;
    this.opts = opts;
  }

  start(): void {
    // ① t0 — window의 capture 단계. 캡처는 target 단계보다 항상 먼저 돈다.
    //    (textarea에 걸면 xterm이 먼저 등록돼 있어 우리가 뒤로 밀린다 — 파일 머리말 참고)
    window.addEventListener(
      "keydown",
      () => {
        this.current = freshPending(performance.now());
      },
      { capture: true },
    );

    // 옛 경로 재현 — 같은 자리에 같은 방식으로 달아 두고 값이 밀리는지 본다.
    this.term.textarea?.addEventListener(
      "keydown",
      () => {
        this.legacyPending = performance.now();
      },
      { capture: true },
    );

    this.startFrameTicker();

    this.term.onData((data) => {
      this.sawData = true;

      const p = this.current ?? freshPending(performance.now());
      if (!this.current) this.orphanT0++;
      this.current = null;

      // 옛 코드의 t0 선택을 그대로 흉내낸다: 값을 읽고 비운다.
      const legacyT0 = this.legacyPending;
      this.legacyPending = null;
      p.legacyT0 = legacyT0;
      if (legacyT0 === null || legacyT0 < p.t0) this.legacyStale++;

      // 자가 검증 ② — 입력 처리 경로에 인위적 부하를 넣는다.
      if (this.opts.injectMs > 0) this.sink += burn(this.opts.injectMs);

      // 파싱이 비동기로 밀릴 경우를 대비한 파싱 태스크 시작 표식.
      // 같은 0ms 타이머는 등록 순서로 돌므로, xterm이 write 안에서 거는 타이머보다 먼저 온다.
      let marked = 0;
      setTimeout(() => {
        marked = performance.now();
      }, 0);

      let inWrite = true;
      p.wStart = performance.now();
      // PTY가 없으므로 로컬 에코가 곧 출력이다. S1-4 이후엔 PTY 왕복이 여기에 들어간다.
      this.term.write(echoOf(data), () => {
        p.t1 = performance.now();
        p.syncParse = inWrite;
        if (!inWrite) {
          this.asyncParse++;
          p.pStart = marked || p.wStart;
        }
      });
      inWrite = false;
      p.kEndSync = performance.now();

      // 마이크로태스크는 JS 스택이 완전히 풀린 뒤 = 이 태스크의 끝에 돈다.
      // xterm이 onData 뒤에 하는 잔여 작업(preventDefault·커서 처리)까지 들어온다.
      queueMicrotask(() => {
        p.kEnd = performance.now();
      });

      this.awaitingRender.push(p);
    });

    this.term.onRender(() => {
      if (this.awaitingRender.length === 0) return;
      const t2 = performance.now();
      const batch = this.awaitingRender.splice(0);
      this.batches++;

      // 이 프레임의 시작. 티커는 프레임의 첫 콜백이므로 렌더보다 먼저 찍혀 있다.
      const tick = this.frameTick <= t2 ? this.frameTick : this.prevFrameTick;

      for (const p of batch) {
        const kEnd = Math.max(p.kEnd || p.kEndSync, p.kEndSync);
        const t1 = p.t1 || kEnd;
        const renderStart = Math.min(Math.max(tick, t1), t2);

        const intervals: Interval[] = [
          [p.t0, kEnd],
          [p.syncParse ? p.wStart : p.pStart, t1],
          [renderStart, t2],
        ];
        const total = t2 - p.t0;
        const work = busyLength(intervals, p.t0, t2);

        const sample: Sample = {
          parse: t1 - p.t0,
          render: t2 - t1,
          total,
          work,
          wait: total - work,
          segInput: kEnd - p.t0,
          segParse: t1 - (p.syncParse ? p.wStart : p.pStart),
          segRender: t2 - renderStart,
          frameWait: renderStart - t1,
          legacyTotal: p.legacyT0 === null ? NaN : t2 - p.legacyT0,
          // 순진한 구현: wait = 첫 프레임 틱 - t0, work = 나머지.
          naiveWork: p.firstTick ? total - (p.firstTick - p.t0) : NaN,
          batch: batch.length,
        };
        this.samples.push(sample);
        this.lines.push(
          JSON.stringify({
            kind: "sample",
            path: this.inputPath,
            work_ms: +sample.work.toFixed(3),
            wait_ms: +sample.wait.toFixed(3),
            total_ms: +sample.total.toFixed(3),
            parse_ms: +sample.parse.toFixed(3),
            render_ms: +sample.render.toFixed(3),
            seg_input_ms: +sample.segInput.toFixed(3),
            seg_parse_ms: +sample.segParse.toFixed(3),
            seg_render_ms: +sample.segRender.toFixed(3),
            frame_wait_ms: +sample.frameWait.toFixed(3),
            legacy_total_ms: Number.isFinite(sample.legacyTotal)
              ? +sample.legacyTotal.toFixed(3)
              : null,
            naive_work_ms: Number.isFinite(sample.naiveWork)
              ? +sample.naiveWork.toFixed(3)
              : null,
            batch: sample.batch,
            sync_parse: p.syncParse,
          }),
        );
      }

      this.opts.onUpdate?.({
        n: this.samples.length,
        total: summarize(this.samples.map((s) => s.total)),
        work: summarize(this.samples.map((s) => s.work)),
        wait: summarize(this.samples.map((s) => s.wait)),
        path: this.inputPath,
      });

      if (this.opts.autoSamples && this.samples.length >= this.opts.autoSamples) {
        void this.finish();
      }
    });

    if (this.opts.autoSamples) {
      void this.drive(this.opts.autoSamples);
    }
  }

  /**
   * 프레임 시작 시각을 찍는 티커.
   *
   * 콜백 맨 앞에서 자기 자신을 다시 등록한다 → **다음 프레임에서도 첫 번째 콜백**이 된다.
   * xterm의 렌더 rAF는 그보다 늦게 등록되므로 항상 티커 뒤에 온다.
   * 덤으로 rAF 간격 중앙값 = **실효 주사율**이 나온다 (A-3-③ 기록 항목).
   */
  private startFrameTicker(): void {
    const tick = (): void => {
      const now = performance.now();
      if (!this.finished) window.requestAnimationFrame(tick);
      if (this.frameTick) this.frameIntervals.push(now - this.frameTick);
      this.prevFrameTick = this.frameTick;
      this.frameTick = now;
      // 순진한 구현이 컷할 지점(t0 이후 첫 틱)을 같이 남긴다. 표본은 보통 1~3개다.
      for (const p of this.awaitingRender) {
        if (!p.firstTick) p.firstTick = now;
      }
    };
    window.requestAnimationFrame(tick);
  }

  /** 합성 입력을 한 글자씩 보낸다. 한 프레임에 몰면 측정이 왜곡된다. */
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
      await sleep(this.opts.gapMs);
    }
    // 마지막 표본의 렌더를 기다린다.
    await sleep(300);
    if (!this.finished) await this.finish();
  }

  private sendKey(ch: string): void {
    if (this.inputPath === "term.input") {
      // keydown 이벤트가 없는 경로다. t0를 여기서 직접 찍는다.
      this.current = freshPending(performance.now());
      this.term.input(ch);
      return;
    }
    const ta = this.term.textarea;
    if (!ta) {
      this.inputPath = "term.input";
      this.current = freshPending(performance.now());
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

    const of = (f: (s: Sample) => number): Summary => summarize(this.samples.map(f));
    const total = of((s) => s.total);
    const work = of((s) => s.work);
    const wait = of((s) => s.wait);
    const frames = summarize(this.frameIntervals);

    // A-3-②의 상한은 **이 기계에서 실제로 잰** 프레임 간격 2개다.
    const twoFrames = Number.isFinite(frames.p50) ? 2 * frames.p50 : NaN;

    // ⚠️ 자가 검증 실행의 `gate`는 **판정이 아니다.**
    //
    //   ② `--latency-probe-inject-ms=5` → 없는 부하를 일부러 넣은 값이다. 그래도 5.3ms라
    //      8ms 아래여서 `a3_1_pass: true`가 찍힌다.
    //   ③ `--latency-probe-frame-hold=4` → 유효 주사율을 1/4로 낮추므로 ②의 상한
    //      (2프레임)이 33.4ms에서 **133.4ms로 벌어진다.** 통과가 아니라 무의미한 통과다.
    //
    // 두 경우 모두 `config`를 읽으면 알 수 있지만, **요약 JSON에서 `a3_*_pass`만 집어가는
    // 것이 정확히 우리가 문서에 권한 사용법이다**(README·§7). 집어가는 자리에 표시를 둔다.
    const selfCheck = this.opts.injectMs > 0 || this.opts.frameHold > 1;

    await this.flush();

    const summary = JSON.stringify({
      kind: "summary",
      input_path: this.inputPath,
      note: "OS→브라우저 keydown 디스패치 구간은 포함되지 않는다",
      scope:
        "work_ms = 이 키 입력에 귀속된 메인 스레드 실행 시간(입력 태스크 + 파싱 + 렌더 프레임 내 작업)의 합집합. " +
        "wait_ms = total - work (프레임 대기 등 유휴). 다른 키의 처리 시간은 work가 아니라 wait에 들어간다.",
      config: {
        samples: this.opts.autoSamples,
        inject_ms: this.opts.injectMs,
        frame_hold: this.opts.frameHold,
        gap_ms: this.opts.gapMs,
      },
      machine: {
        gpu: this.opts.gpu,
        frame_interval_ms: round(frames),
        refresh_hz_est: Number.isFinite(frames.p50) ? +(1000 / frames.p50).toFixed(1) : null,
      },
      gate: {
        // 이 실행의 gate를 관문 A-3 판정에 인용해도 되는가.
        verdict_valid: !selfCheck,
        verdict_invalid_reason: selfCheck
          ? `자가 검증 실행이다 — inject=${this.opts.injectMs}ms · frame_hold=${this.opts.frameHold}. 판정에 인용하지 않는다`
          : null,
        a3_1_work_p99: +work.p99.toFixed(3),
        a3_1_limit_ms: 8,
        a3_1_pass: work.p99 <= 8,
        a3_2_total_p99: +total.p99.toFixed(3),
        a3_2_limit_ms: Number.isFinite(twoFrames) ? +twoFrames.toFixed(2) : null,
        a3_2_pass: total.p99 <= twoFrames,
      },
      diag: {
        // 옛 계측이 t0를 한 키씩 밀려 읽었는가 — 숫자로 남긴다.
        legacy_stale_t0: this.legacyStale,
        orphan_t0: this.orphanT0,
        async_parse: this.asyncParse,
        renders: this.batches,
        mean_batch: this.batches ? +(this.samples.length / this.batches).toFixed(2) : null,
      },
      work: round(work),
      wait: round(wait),
      total: round(total),
      parse: round(of((s) => s.parse)),
      render: round(of((s) => s.render)),
      seg_input: round(of((s) => s.segInput)),
      seg_parse: round(of((s) => s.segParse)),
      seg_render: round(of((s) => s.segRender)),
      frame_wait: round(of((s) => s.frameWait)),
      legacy_total: round(of((s) => s.legacyTotal)),
      // 순진한 구현이 냈을 값. inject를 걸어도 이 값이 안 오르면 그 구현은 회귀를 못 잡는다.
      naive_work: round(of((s) => s.naiveWork)),
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

function freshPending(t0: number): Pending {
  return {
    t0,
    legacyT0: null,
    wStart: t0,
    t1: 0,
    syncParse: false,
    pStart: t0,
    kEnd: 0,
    kEndSync: t0,
    firstTick: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
