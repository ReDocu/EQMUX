// 비밀값 가리기 (§2 로그 마스킹 · B150) — 화면에 보이기 전에 흔한 비밀값 모양을 •로 바꾼다.
// 패턴은 secretPatterns.json 하나를 Rust(secrets.rs, `eqmux read`)와 같이 읽는다. 정규식이 아니라
// 같은 바이트 훑기를 양쪽에 두고, 같은 cases를 양쪽 테스트가 돌린다 — 두 구현이 갈라지지 않게.
// 잡는 것: 알려진 토큰 머리(sk- · ghp_ · AKIA …) · 이름에 SECRET/TOKEN/PASSWORD 등이 든 KEY=값 ·
// URL 안의 user:pass@ · Bearer 토큰.
// ponytail: PEM 본문 줄(base64)과 머리 없는 임의 문자열은 못 잡는다 — 모양으로 알 수 없는 값이다
import raw from "./secretPatterns.json?raw";

interface Patterns {
  mask: string;
  prefixes: [string, number][];
  keywords: string[];
  minValue: number;
  cases: [string, string][];
}
export const PATTERNS: Patterns = JSON.parse(raw);

const isTok = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45; // 0-9 A-Z a-z _ -
const isKey = (c: number) => isTok(c) || c === 46; // .
const isSpace = (c: number) => c === 32 || c === 9;
const isWs = (c: number) => isSpace(c) || c === 10 || c === 13;
const isQuote = (c: number) => c === 34 || c === 39 || c === 96; // " ' `
// 값 끝 — 공백 · 따옴표 · , ; &
const endsValue = (c: number) => isWs(c) || isQuote(c) || c === 44 || c === 59 || c === 38;
// ASCII만 내린다 — toLowerCase는 일부 유니코드에서 길이가 바뀌어 위치가 어긋난다
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));

function* indicesOf(s: string, needle: string) {
  for (let i = s.indexOf(needle); i >= 0; i = s.indexOf(needle, i + 1)) yield i;
}

/** 가릴 구간 [시작, 끝) — 겹치면 합친다 */
function spans(s: string): [number, number][] {
  const n = s.length;
  const c = (i: number) => s.charCodeAt(i);
  const out: [number, number][] = [];
  const run = (from: number, ok: (ch: number) => boolean) => {
    let k = from;
    while (k < n && ok(c(k))) k++;
    return k;
  };

  // 1) 알려진 토큰 머리 — 머리는 남기고 뒤를 가린다
  for (const [prefix, min] of PATTERNS.prefixes) {
    for (const i of indicesOf(s, prefix)) {
      if (i > 0 && isTok(c(i - 1))) continue;
      const j = i + prefix.length;
      const k = run(j, isTok);
      if (k - j >= min) out.push([j, k]);
    }
  }

  // 2) 이름에 키워드가 든 KEY=값 · KEY: 값 · "key": "값"
  for (let i = 0; i < n; i++) {
    if (!isKey(c(i)) || (i > 0 && isKey(c(i - 1)))) continue;
    const k = run(i, isKey);
    // 하이픈 꼴(x-api-key · --api-key · private-key)도 밑줄 꼴 키워드에 걸리게 (B308)
    const word = s.slice(i, k).toUpperCase().replace(/-/g, "_");
    i = k - 1;
    const hits = PATTERNS.keywords.filter((w) => word.includes(w));
    if (!hits.length) continue;
    let p = k;
    if (p < n && isQuote(c(p))) p++; // JSON 키의 닫는 따옴표
    p = run(p, isSpace);
    if (p >= n || (c(p) !== 61 && c(p) !== 58)) continue; // = :
    p = run(p + 1, isSpace);
    // 따옴표로 연 값은 같은 따옴표(또는 줄 끝)까지다 — "my secret pass"를 공백에서 끊지 않는다 (B308)
    const open = p < n && isQuote(c(p)) ? c(p) : 0;
    if (open) p++;
    let e = open ? run(p, (ch) => ch !== open && ch !== 10 && ch !== 13) : run(p, (ch) => !endsValue(ch));
    // 이름의 키워드가 TOKEN뿐이고 값이 숫자만이면 토큰 수다 — max_tokens=128000 (B196). 비밀번호 숫자는 그대로 가린다
    if (hits.every((w) => w === "TOKEN") && /^\d+$/.test(s.slice(p, e))) continue;
    // 따옴표 없는 값이 , ; &에서 짧게 끊겼으면 공백까지 본다 — DB_PASSWORD=Pa;ss!w0rd (B308)
    if (!open && e - p < PATTERNS.minValue) e = run(p, (ch) => !isWs(ch) && !isQuote(ch));
    if (e - p >= PATTERNS.minValue) out.push([p, e]);
  }

  // 3) URL 안의 비밀번호 — scheme://user:pass@
  for (const i of indicesOf(s, "://")) {
    const p = run(i + 3, (ch) => ch !== 58 && ch !== 47 && ch !== 64 && !isWs(ch)); // : / @
    if (p === i + 3 || p >= n || c(p) !== 58) continue;
    const q = run(p + 1, (ch) => ch !== 64 && ch !== 47 && !isWs(ch));
    if (q < n && c(q) === 64 && q > p + 1) out.push([p + 1, q]);
  }

  // 4) Bearer 토큰 (JWT의 . 와 base64의 / + = 포함)
  const lower = asciiLower(s);
  for (const i of indicesOf(lower, "bearer ")) {
    if (i > 0 && isTok(c(i - 1))) continue;
    const j = run(i + 7, isSpace);
    const k = run(j, (ch) => isTok(ch) || ch === 46 || ch === 47 || ch === 43 || ch === 61);
    if (k - j >= 8) out.push([j, k]);
  }

  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const sp of out) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([...sp]);
  }
  return merged;
}

/** 비밀값 모양을 가린 문자열 — 없으면 원문 그대로 */
export function maskSecrets(s: string): string {
  const sp = spans(s);
  if (sp.length === 0) return s;
  let out = "";
  let last = 0;
  for (const [a, b] of sp) {
    out += s.slice(last, a) + PATTERNS.mask;
    last = b;
  }
  return out + s.slice(last);
}

/** dotenv 줄의 값을 통째로 가린다 — diff처럼 .env 원문을 보일 때 (B154). 주석·빈 줄은 그대로 */
export function maskDotenvLine(line: string): string {
  const m = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.]*\s*=\s*)(.*)$/.exec(line);
  return m && m[2] !== "" ? m[1] + PATTERNS.mask : line;
}
