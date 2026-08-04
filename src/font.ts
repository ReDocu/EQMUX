// A-2 폭 계측 — 한글 글리프의 advance width가 ASCII의 정확히 2배인가.
//
// # 왜 이게 필요한가
//
// A-2는 지금까지 **사람 눈에 묶여 있었다.** 그런데 A-2가 묻는 것은 결국 숫자다 —
// 폰트가 한글을 몇 픽셀 폭으로 그리는가. `measureText`로 잴 수 있다.
//
// # 이 계측이 하는 일과 **안 하는 일**
//
//   한다    폰트가 각 글자를 몇 픽셀 advance로 그리는지, 그 비율이 xterm이 배정한
//           칸 수와 맞는지. **그리고 그 글자를 실제로 어느 폰트가 그렸는지.**
//   안 한다 화면에서 줄이 실제로 밀리는가. xterm은 고정 격자라 advance가 어긋나도
//           칸은 안 밀린다 — 글리프가 제 칸을 넘거나 못 채울 뿐이다.
//
// **육안을 대체하지 않는다. 육안 전에 싸게 거르는 자리다.**
// 비율이 틀리면 볼 것도 없이 미달이고, 맞아도 통과는 눈이 정한다.
//
// # 어느 폰트가 그렸는지를 어떻게 아는가
//
// CSS 폰트 매칭은 **글자 단위**로 스택을 훑어 그 글자의 글리프를 가진 첫 폰트를 쓴다.
// 그래서 두 가지를 따로 확인한다.
//
//   ① 설치 여부  후보 폰트를 넣은 것과 안 넣은 것의 폭이 다르면 그 폰트는 있다.
//   ② 글리프 보유 마지막 폴백을 **서로 다른 것 둘**로 바꿔 그려서 **픽셀이 같으면**
//      그 글자는 후보 폰트가 그린 것이다. 다르면 폴백으로 흘러간 것이다.
//
// 둘 다 참인 **첫 번째** 폰트가 그 글자를 그린 폰트다. 추론이 아니라 매칭 규칙 그대로다.
//
// ⚠️ **②를 폭으로 하면 CJK에서 통째로 무너진다.** 한글·한자는 거의 모든 폰트가 1.0em이라
// 폴백을 무엇으로 바꿔도 폭이 같다 — 실제로 첫 구현이 여기서 `판별불가`를 뱉었고,
// 폭이 우연히 같다는 이유로 `漢 ← Cascadia Mono`(한자가 없는 폰트다)를 후보로 올렸다.
// 그래서 **글리프를 실제로 그려 픽셀 해시를 비교한다.** 서체가 다르면 폭이 같아도 그림이 다르다.

/** 관문 A-2 계측 대상. `terminal.ts`의 `CELL_PROBES`와 같은 집합이어야 한다. */
export const WIDTH_PROBES = ["A", "가", "漢", "ｱ", "→", "■"] as const;

/**
 * 설치 여부를 볼 때 쓰는 문자열. 폭 차이가 크게 벌어지도록 굵기가 다른 글자를 섞는다.
 * 고정폭 폰트끼리도 이 문자열의 폭은 대개 다르다.
 */
const PRESENCE_TEXT = "mmmmwwwwiiiillll0123456789";

/** ASCII 글리프가 없는 CJK 전용 폰트를 놓치지 않으려고 같이 본다. */
const PRESENCE_TEXT_CJK = "가나다라마바사아漢字混在";

/** 설치 여부 판정용 대조 일반군. 하나라도 폭이 달라지면 그 폰트는 있다. */
const GENERICS = ["monospace", "serif", "sans-serif"] as const;

/**
 * 글리프 보유 판정용 폴백 후보들.
 *
 * 한 쌍만 쓰면 **CJK에서 판별이 통째로 무너진다** — 어떤 폴백을 걸어도 한글은
 * 결국 같은 시스템 CJK 폰트로 수렴해 두 폭이 같아지기 때문이다(실제로 그랬다).
 * 그래서 풀에서 **그 글자를 서로 다른 폭으로 그리는 쌍**을 찾아 쓴다.
 */
const FALLBACK_POOL = [
  "monospace",
  "cursive",
  "serif",
  "sans-serif",
  '"Segoe UI Emoji"',
  '"Marlett"',
] as const;

/** advance를 반복 측정할 횟수. 셰이핑·커닝이 끼면 단일 측정과 갈린다. */
const REPEAT = 64;

/**
 * 설계 비율을 볼 때 쓰는 큰 글자 크기.
 *
 * 작은 크기에서는 힌팅이 advance를 정수로 눌러 실제 설계 비율을 가린다.
 * **판정은 실제 렌더 크기(14px)로 하고**, 이 값은 "폰트가 원래 2배로 만들어졌는가"를
 * 따로 보기 위한 진단이다. 둘이 갈리면 힌팅이 범인이다.
 */
const DESIGN_SIZE = 200;

export interface FontPresence {
  family: string;
  /** 이 기계에 설치돼 있는가 */
  available: boolean;
}

export interface CharMeasure {
  ch: string;
  codepoint: string;
  /** xterm이 배정한 칸 수 (`readCellWidths`). 기대 비율이 곧 이 값이다. */
  cells: number;
  /** 실제 렌더 크기에서의 advance (CSS px) */
  advance: number;
  /**
   * advance ÷ 글자 크기. **폰트가 섞였는지 한눈에 드러나는 값이다.**
   * 고정폭 라틴 폰트는 보통 0.5~0.6em, CJK 폰트의 한글·한자는 거의 항상 1.0em이다.
   * ASCII가 0.5em이 아닌 폰트에 CJK 1.0em을 섞으면 **2배가 산술적으로 불가능하다.**
   */
  advanceEm: number;
  /** `REPEAT`개를 이어 재고 나눈 값. 단일 측정과 다르면 셰이핑이 낀 것이다 */
  advanceRepeat: number;
  /** advance ÷ ASCII advance */
  ratio: number;
  /** 큰 크기에서 본 설계 비율. 힌팅이 없을 때의 값 */
  designRatio: number;
  /** ratio − cells. 0이어야 한다 */
  errRatio: number;
  /** 오차를 실제 픽셀로 환산 (기기 픽셀) */
  errDevicePx: number;
  /** 이 글자를 실제로 그린 폰트 */
  resolvedBy: string | null;
  /** `inconclusive`일 때 폭이 일치해 남은 후보들 (추론) */
  candidates: string[];
  /** 글리프 보유를 가리지 못해 `resolvedBy`가 확정이 아니라 추론이다 */
  inconclusive: boolean;
  verdict: Verdict;
}

export type Verdict = "pass" | "warn" | "fail";

export interface StackMeasure {
  label: string;
  stack: string;
  entries: FontPresence[];
  /** 기준이 되는 ASCII advance (CSS px) */
  asciiAdvance: number;
  /** ASCII advance ÷ 글자 크기. **0.5가 아니면 CJK 2배는 산술적으로 불가능하다** */
  asciiEm: number;
  chars: CharMeasure[];
  /**
   * **굵은 글씨**에서의 CJK 비율.
   *
   * Bold 페이스가 없으면 브라우저가 합성한다(faux bold). 합성이 advance를 늘리면
   * **굵은 글씨에서만 A-2가 깨진다** — 터미널에서 프롬프트·`ls` 색상이 전부 굵은 글씨라
   * 이건 드문 경우가 아니라 항상 보이는 자리다. Regular만 재고 끝내면 놓친다.
   */
  bold: { asciiAdvance: number; cjkRatio: number; errDevicePx: number; verdict: Verdict };
  /**
   * ASCII와 CJK를 서로 다른 폰트가 그렸는가.
   *
   * 섞이면 두 폰트의 em 비율이 우연히 맞아떨어지지 않는 한 2배가 안 나온다.
   * **A-2 미달의 가장 흔한 원인이 이것이다** — 폰트 하나가 둘 다 그리면 안 생긴다.
   */
  mixed: boolean;
  /** 한글·한자 — A-2의 본안 */
  cjk: Verdict;
  /** →·■ 등 EAW Ambiguous — 본안과 분리한다 (§한계) */
  ambiguous: Verdict;
}

export interface FontProbeResult {
  fontSize: number;
  devicePixelRatio: number;
  /** 판정선 (기기 픽셀). 근거는 `docs/FONT-A2.md` §2 */
  passDevicePx: number;
  warnDevicePx: number;
  stacks: StackMeasure[];
  note: string;
}

// ---------------------------------------------------------------- 판정선

/**
 * 판정선은 **비율이 아니라 픽셀**로 둔다.
 *
 * 같은 1% 오차라도 셀이 8px일 때와 20px일 때 눈에 보이는 정도가 다르다.
 * 사람이 보는 것은 비율이 아니라 글리프가 제 칸을 넘었는가이므로 픽셀이 맞다.
 *
 *   < 0.5 기기픽셀  통과  — 반올림하면 같은 픽셀에 떨어진다. 렌더 결과가 같다
 *   < 1.0 기기픽셀  주의  — 한 픽셀 미만. 경계에서 갈릴 수 있어 육안이 필요하다
 *   ≥ 1.0 기기픽셀  미달  — 글리프가 제 칸을 최소 한 픽셀 벗어난다
 */
export const PASS_DEVICE_PX = 0.5;
export const WARN_DEVICE_PX = 1.0;

function verdictOf(errDevicePx: number): Verdict {
  const e = Math.abs(errDevicePx);
  if (e < PASS_DEVICE_PX) return "pass";
  if (e < WARN_DEVICE_PX) return "warn";
  return "fail";
}

function worst(list: Verdict[]): Verdict {
  if (list.includes("fail")) return "fail";
  if (list.includes("warn")) return "warn";
  return "pass";
}

// ---------------------------------------------------------------- 스택 다루기

/** `"A", B, 'C'` → `["A", "B", "C"]`. 따옴표 안의 쉼표는 자르지 않는다. */
export function parseStack(stack: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;

  for (const c of stack) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out.filter((s) => s.length > 0);
}

/** CSS `font` 단축 속성에 넣을 수 있게 이름을 되돌린다. 일반군은 따옴표를 붙이면 안 된다. */
export function cssFamily(name: string): string {
  const generic = /^(monospace|serif|sans-serif|cursive|fantasy|system-ui)$/i.test(name);
  if (generic) return name.toLowerCase();
  // 공백·한글·숫자 시작 등은 따옴표가 필요하다. 전부 붙이는 게 안전하다.
  return `"${name.replace(/"/g, '\\"')}"`;
}

/**
 * 스택에서 지정한 폰트들을 뺀다. `--font-stack` 없이 사용자 기계 조건을 만드는 데 쓴다.
 *
 * ⚠️ **이름 하나만 빼면 대조군이 무력화된다.** `"D2Coding"`(동봉)만 빼도
 * 설치본 `"D2Coding ligature"`가 남아 그대로 통과해 버린다 — 실제로 동봉 직후 그렇게 됐다.
 * 대조군은 **계속 미달이어야** 동봉이 무엇을 막고 있는지 보여준다.
 */
export function stackWithout(stack: string, drop: string[]): string {
  const wanted = drop.map((d) => d.trim().toLowerCase());
  return parseStack(stack)
    .filter((f) => !wanted.includes(f.toLowerCase()))
    .map(cssFamily)
    .join(", ");
}

// ---------------------------------------------------------------- 측정

type Ctx = CanvasRenderingContext2D;

/**
 * @param weight `"bold "`처럼 **뒤에 공백을 포함한** CSS 폰트 굵기. 기본은 없음.
 *
 * ⚠️ `weight`를 `family` 앞에 붙이지 말 것. CSS `font` 단축 속성은 굵기가 **크기 앞**에 와야 한다.
 * `14px bold "X"`는 **문법 오류**이고, 그러면 브라우저는 대입을 조용히 무시해
 * **직전 폰트로 계속 잰다.** 실제로 여기서 한 번 당했다 — 굵기 측정이 200px 보통 글씨를 재고
 * 비율 2.0000을 뱉어서, 틀린 값이 통과처럼 보였다. 아래 확인이 그 재발 방지다.
 */
function widthOf(ctx: Ctx, text: string, family: string, size: number, weight = ""): number {
  const want = `${weight}${size}px ${family}`;
  ctx.font = want;
  // 대입이 거부되면 `ctx.font`는 옛 값 그대로다. 크기가 안 바뀌었으면 다른 걸 재고 있다.
  if (!ctx.font.includes(`${size}px`)) {
    throw new Error(`폰트 지정이 거부됐다: ${JSON.stringify(want)} → ${JSON.stringify(ctx.font)}`);
  }
  return ctx.measureText(text).width;
}

/**
 * 설치 여부. 후보를 앞에 붙인 것과 일반군 단독의 폭이 다르면 후보가 잡힌 것이다.
 * 일반군 셋 중 하나라도 달라지면 설치돼 있다고 본다 — 우연히 폭이 같을 확률을 줄인다.
 */
export function isAvailable(ctx: Ctx, family: string, size = 72): boolean {
  const name = cssFamily(family);
  if (!name.startsWith('"')) return true; // 일반군은 항상 있다
  // ASCII가 없는 CJK 전용 폰트도 있다. 두 문자열 중 하나라도 반응하면 설치된 것이다.
  return [PRESENCE_TEXT, PRESENCE_TEXT_CJK].some((text) =>
    GENERICS.some((g) => {
      const base = widthOf(ctx, text, g, size);
      const test = widthOf(ctx, text, `${name}, ${g}`, size);
      return test !== base;
    }),
  );
}

/**
 * 이 폰트가 이 글자의 글리프를 **직접** 가졌는가.
 *
 * 마지막 폴백을 서로 다른 둘로 바꿔 **그린다.** 픽셀이 같으면 후보가 그린 것이고,
 * 다르면 후보에 글리프가 없어 폴백으로 흘러간 것이다.
 * 두 폴백이 이 글자를 원래 똑같이 그리면 판별할 수 없다.
 */
function hasGlyph(
  sig: Signer,
  family: string,
  ch: string,
): { has: boolean; inconclusive: boolean } {
  const name = cssFamily(family);

  // 이 글자를 **다르게 그리는** 폴백 쌍을 찾는다. 없으면 판별 불가다.
  for (let i = 0; i < FALLBACK_POOL.length; i++) {
    for (let j = i + 1; j < FALLBACK_POOL.length; j++) {
      const fa = FALLBACK_POOL[i];
      const fb = FALLBACK_POOL[j];
      if (sig(ch, fa) === sig(ch, fb)) continue;

      return { has: sig(ch, `${name}, ${fa}`) === sig(ch, `${name}, ${fb}`), inconclusive: false };
    }
  }
  return { has: false, inconclusive: true };
}

/** 글자 하나를 그려 픽셀 해시를 낸다. 폭이 같아도 서체가 다르면 값이 갈린다. */
type Signer = (ch: string, family: string) => string;

/** 서명용 렌더 크기. 크면 서체 차이가 잘 드러나고, 캔버스 비용은 무시할 만하다. */
const SIG_SIZE = 40;
const SIG_BOX = 64;

function makeSigner(): Signer {
  const canvas = document.createElement("canvas");
  canvas.width = SIG_BOX;
  canvas.height = SIG_BOX;
  // 매 글자마다 읽으므로 GPU 왕복을 피한다.
  const c = canvas.getContext("2d", { willReadFrequently: true });
  if (!c) throw new Error("2D 컨텍스트를 만들 수 없다 — 글리프 판별 불가");

  const cache = new Map<string, string>();

  return (ch: string, family: string): string => {
    const key = `${family} ${ch}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    c.clearRect(0, 0, SIG_BOX, SIG_BOX);
    c.font = `${SIG_SIZE}px ${family}`;
    c.textBaseline = "alphabetic";
    c.fillStyle = "#000";
    c.fillText(ch, 4, SIG_SIZE + 4);

    const data = c.getImageData(0, 0, SIG_BOX, SIG_BOX).data;
    // FNV-1a. 알파 채널만 본다 — 색은 늘 같으므로 모양만 남는다.
    let h = 0x811c9dc5;
    for (let i = 3; i < data.length; i += 4) {
      h ^= data[i];
      h = Math.imul(h, 0x01000193);
    }
    const out = (h >>> 0).toString(16);
    cache.set(key, out);
    return out;
  };
}

/**
 * 이 글자를 실제로 그리는 폰트. CSS 매칭 규칙 그대로 — 스택 순서로 훑어
 * **설치돼 있고 글리프를 가진** 첫 폰트다.
 */
function resolveFont(
  sig: Signer,
  entries: FontPresence[],
  ch: string,
): { font: string | null; candidates: string[]; inconclusive: boolean } {
  const unknown: string[] = [];

  for (const e of entries) {
    if (!e.available) continue;
    const g = hasGlyph(sig, e.family, ch);
    // 확정 — 이 폰트가 그렸다. 스택 순서로 훑었으므로 CSS 매칭 결과 그대로다.
    if (g.has) return { font: e.family, candidates: [e.family], inconclusive: false };
    // 판별 불가만 후보로 남긴다. **글리프가 없다고 확정된 폰트는 뺀다** —
    // 안 빼면 한자가 없는 폰트가 폭이 같다는 이유로 `漢`의 후보로 올라온다(첫 구현이 그랬다).
    if (g.inconclusive) unknown.push(e.family);
  }

  // 아무도 확정되지 않았다. 남은 후보만 적고 **추론임을 표시한다.**
  // 확정하려면 `--font-stack`으로 스택을 하나로 강제해 실험하면 된다 — 그러라고 있는 플래그다.
  return { font: unknown[0] ?? null, candidates: unknown, inconclusive: unknown.length > 0 };
}

function codepointOf(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * 스택 하나를 잰다.
 *
 * `cells`는 xterm이 배정한 칸 수다. **기대 비율이 곧 그 값이다** —
 * 폰트가 2칸짜리 글자를 ASCII 2배 폭으로 그리면 맞고, 아니면 제 칸을 벗어난다.
 */
export function measureStack(
  ctx: Ctx,
  sig: Signer,
  label: string,
  stack: string,
  cells: Record<string, number>,
  size: number,
  dpr: number,
): StackMeasure {
  const entries: FontPresence[] = parseStack(stack).map((family) => ({
    family,
    available: isAvailable(ctx, family),
  }));

  const asciiAdvance = widthOf(ctx, "A", stack, size);
  const asciiDesign = widthOf(ctx, "A", stack, DESIGN_SIZE);

  const chars: CharMeasure[] = WIDTH_PROBES.map((ch) => {
    const advance = widthOf(ctx, ch, stack, size);
    const advanceRepeat = widthOf(ctx, ch.repeat(REPEAT), stack, size) / REPEAT;
    const design = widthOf(ctx, ch, stack, DESIGN_SIZE);

    // 칸 수를 못 읽었으면 EAW 기본값으로 1을 쓴다. 그 사실은 결과에 남는다.
    const cellCount = cells[ch] ?? 1;
    const ratio = asciiAdvance > 0 ? advance / asciiAdvance : NaN;
    const errRatio = ratio - cellCount;
    const errDevicePx = errRatio * asciiAdvance * dpr;

    const r = resolveFont(sig, entries, ch);

    return {
      ch,
      codepoint: codepointOf(ch),
      cells: cellCount,
      advance: round3(advance),
      advanceEm: round4(advance / size),
      advanceRepeat: round3(advanceRepeat),
      ratio: round4(ratio),
      designRatio: round4(asciiDesign > 0 ? design / asciiDesign : NaN),
      errRatio: round4(errRatio),
      errDevicePx: round3(errDevicePx),
      resolvedBy: r.font,
      candidates: r.candidates,
      inconclusive: r.inconclusive,
      verdict: verdictOf(errDevicePx),
    };
  });

  const asciiFont = chars.find((c) => c.ch === "A")?.resolvedBy ?? null;
  const cjkFont = chars.find((c) => c.ch === "가")?.resolvedBy ?? null;

  // 굵은 글씨도 같은 잣대로 잰다. 굵기는 **크기 앞**에 온다(위 `widthOf` 주석).
  const boldAscii = widthOf(ctx, "A", stack, size, "bold ");
  const boldCjk = widthOf(ctx, "가", stack, size, "bold ");
  const boldRatio = boldAscii > 0 ? boldCjk / boldAscii : NaN;
  const boldCells = cells["가"] ?? 2;
  const boldErr = (boldRatio - boldCells) * boldAscii * dpr;

  // 한글·한자가 A-2의 본안이다. →·■는 EAW Ambiguous라 따로 센다 (문서 §한계).
  const isCjk = (c: CharMeasure) => c.ch === "가" || c.ch === "漢";
  const isAmbiguous = (c: CharMeasure) => c.ch === "→" || c.ch === "■";

  return {
    label,
    stack,
    entries,
    asciiAdvance: round3(asciiAdvance),
    asciiEm: round4(asciiAdvance / size),
    chars,
    bold: {
      asciiAdvance: round3(boldAscii),
      cjkRatio: round4(boldRatio),
      errDevicePx: round3(boldErr),
      verdict: verdictOf(boldErr),
    },
    mixed: asciiFont !== null && cjkFont !== null && asciiFont !== cjkFont,
    cjk: worst(chars.filter((c) => isCjk(c) || c.ch === "A" || c.ch === "ｱ").map((c) => c.verdict)),
    ambiguous: worst(chars.filter(isAmbiguous).map((c) => c.verdict)),
  };
}

function round3(v: number): number {
  return Number.isFinite(v) ? +v.toFixed(3) : v;
}
function round4(v: number): number {
  return Number.isFinite(v) ? +v.toFixed(4) : v;
}

/**
 * 잴 스택 목록을 만든다.
 *
 * `D2Coding 제외`가 핵심이다 — **스택에서 D2Coding만 빼면 이 기계가 곧 사용자 기계 조건**이다.
 * 폰트가 없는 다른 기계를 기다리지 않아도 폴백 경로를 재현할 수 있다.
 */
export function defaultStacks(base: string, forced: string | null): { label: string; stack: string }[] {
  const list = [
    { label: "현행 전체", stack: base },
    {
      // 동봉본과 설치본을 **둘 다** 뺀다. 하나만 빼면 다른 하나가 잡혀 대조군이 죽는다.
      label: "D2Coding 전부 제외 (동봉 없었다면)",
      stack: stackWithout(base, ["D2Coding", "D2Coding ligature"]),
    },
    { label: "Cascadia Mono 단독 (대조군)", stack: '"Cascadia Mono", monospace' },
  ];
  // 강제 스택이 목록에 없으면 그것도 잰다. 실제로 뜬 것과 잰 것이 갈리면 안 된다.
  if (forced && !list.some((s) => s.stack === forced)) {
    list.unshift({ label: "강제 스택 (--font-stack)", stack: forced });
  }
  return list;
}

/**
 * 동봉 폰트(@font-face)를 **실제로 내려받을 때까지 기다린다.**
 *
 * ⚠️ **이걸 안 하면 조용히 틀린다.** 캔버스 `measureText`는 아직 로드되지 않은 @font-face를
 * **폴백으로 대체하고, 로드를 유발하지도 않는다.** 그래서 동봉해 놓고도 계측은 "폰트 없음"을
 * 재게 된다. 실제로 첫 실행에서 `설치: D2Coding✗`가 나왔다 — 동봉은 됐는데 안 붙은 상태였다.
 *
 * xterm에도 같은 문제가 있다. **셀 크기를 생성 시점에 한 번 잰다** —
 * 그때 폰트가 없으면 격자가 폴백 기준으로 잡히고, 나중에 폰트가 바뀌면 글리프와 칸이 어긋난다.
 * 그래서 **터미널을 만들기 전에** 부른다.
 *
 * 로컬 파일이라 즉시 끝나지만, 실패해도 앱을 세우지는 않는다 — 폴백으로 뜨고 계측이 미달을 알린다.
 */
export async function ensureFontsLoaded(families: string[], size: number): Promise<string[]> {
  const loaded: string[] = [];
  await Promise.all(
    families.flatMap((f) =>
      ["", "bold "].map(async (w) => {
        try {
          const faces = await document.fonts.load(`${w}${size}px ${cssFamily(f)}`);
          if (faces.length > 0) loaded.push(`${w}${f}`.trim());
        } catch {
          /* 설치본을 가리키는 이름은 여기서 아무것도 안 돌려준다 — 정상이다 */
        }
      }),
    ),
  );
  return loaded;
}

/** 계측 전체를 돌린다. 터미널이 없어도 된다 — 캔버스만 있으면 잰다. */
export function runFontProbe(
  cells: Record<string, number>,
  base: string,
  forced: string | null,
  fontSize: number,
): FontProbeResult {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D 컨텍스트를 만들 수 없다 — 폭 계측 불가");

  const dpr = window.devicePixelRatio || 1;
  const sig = makeSigner();

  return {
    fontSize,
    devicePixelRatio: dpr,
    passDevicePx: PASS_DEVICE_PX,
    warnDevicePx: WARN_DEVICE_PX,
    stacks: defaultStacks(base, forced).map((s) =>
      measureStack(ctx, sig, s.label, s.stack, cells, fontSize, dpr),
    ),
    note:
      "폰트가 몇 픽셀 advance로 그리는가를 잰 것이다. 화면에서 줄이 밀리는가는 재지 않았다 — " +
      "xterm은 고정 격자라 advance가 어긋나도 칸은 안 밀리고 글리프가 제 칸을 넘거나 못 채운다. " +
      "육안을 대체하지 않는다. 비율이 틀리면 볼 것도 없이 미달이고, 맞으면 육안으로 넘긴다.",
  };
}
