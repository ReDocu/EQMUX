// 터미널 경로 집기 (M30) — 더블클릭 덩어리와 호버 링크가 같이 쓰는 모양 판정. DOM 없는 순수 함수라 테스트가 여기를 겨눈다.
// 실재 여부는 Rust(reveal_path)가 판정한다. 여기서는 "어디부터 어디까지가 경로인가"만 본다.

/** 경로에 올 수 없는 글자 = 확실한 경계. 공백은 경로 안에 올 수 있으니 경계가 아니다 */
const PATH_BREAK = /["'`<>|*?\t]/;

/** 절대 경로의 시작 — 드라이브 문자·UNC, 그리고 POSIX `/`·`~/` (B129).
 *  드라이브 문자는 앞이 글자·숫자가 아닐 때만 — URL `https://`의 `s:/`를 경로로 잡던 것을 막는다.
 *  POSIX는 줄 처음이나 공백·괄호·`=`·`[`·따옴표·`:` 뒤에서만 — `a/b`·`1/2`를 경로로 잡지 않고, URL의 `://`는 `//`라서 빠진다.
 *  `//`로 시작하는 것(코드 주석)도 빼낸다. 앞 글자는 캡처로 받는다 — 뒤돌아보기(?<=)는 오래된 WebKit이 파싱에서 던진다 */
const ABS_START = /(^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\\/\s]|(^|[\s(=['":])~?\/(?!\/)/g;

/** 줄 안에서 index를 품은 경로 후보. 뒤에 딸려온 군더더기는 Rust가 실재 확인으로 떼어 내므로
 *  여기서는 넉넉히 집는다. 절대 경로는 클릭 앞의 드라이브 문자·UNC·`/`까지 되짚어 시작을 잡는다
 *  (경로 안 공백을 낱말 경계로 자르면 "Program Files"·"My Folder"가 통째로 날아간다). */
export function pathChunkAt(line: string, index: number): string | undefined {
  const ch = line[index];
  if (!ch || ch === " " || PATH_BREAK.test(ch)) return undefined;
  let s = index;
  while (s > 0 && !PATH_BREAK.test(line[s - 1])) s--;
  let e = index;
  while (e + 1 < line.length && !PATH_BREAK.test(line[e + 1])) e++;
  const span = line.slice(s, e + 1);
  const at = index - s;
  let begin = -1;
  ABS_START.lastIndex = 0;
  for (let m = ABS_START.exec(span); m; m = ABS_START.exec(span)) {
    const start = m.index + (m[1] ?? m[2] ?? "").length; // 캡처한 앞 글자를 뺀 자리
    if (start > at) break;
    begin = start;
  }
  let chunk: string;
  if (begin >= 0) {
    chunk = span.slice(begin);
  } else {
    // 상대 경로 — 공백으로 끊은 낱말 하나 (cwd 기준 해석은 Rust가 한다)
    let ws = at;
    while (ws > 0 && span[ws - 1] !== " ") ws--;
    let we = at;
    while (we + 1 < span.length && span[we + 1] !== " ") we++;
    chunk = span.slice(ws, we + 1);
  }
  chunk = chunk.trimEnd();
  return /[\\/]/.test(chunk) ? chunk : undefined;
}

/** 링크로 만들 절대 경로 — 따옴표로 감싼 것(공백 포함 가능)과 맨몸(공백에서 끊김).
 *  드라이브 문자·UNC에 더해 POSIX `/…`·`~/…` (B129) — 붙여넣은 이미지 경로(macOS `/var/folders/…/eqmux-pastes/…`)도 여기서 잡힌다 */
const PATH_LINK =
  /"((?:[A-Za-z]:[\\/]|\\\\|~?\/(?!\/))[^"]+)"|(^|[^A-Za-z0-9])((?:[A-Za-z]:[\\/]|\\\\)[^\s"'`<>|*?]+)|(^|[\s(=['":])(~?\/(?!\/)[^\s"'`<>|*?]+)/g;

/** 논리 줄의 절대 경로들 — begin은 text의 첫 글자 인덱스(따옴표·앞 공백은 범위에서 뺀다) */
export function findPathLinks(text: string): { text: string; begin: number }[] {
  const out: { text: string; begin: number }[] = [];
  PATH_LINK.lastIndex = 0;
  for (let m = PATH_LINK.exec(text); m; m = PATH_LINK.exec(text)) {
    if (m[1]) out.push({ text: m[1], begin: m.index + 1 });
    else if (m[3]) out.push({ text: m[3], begin: m.index + m[2].length });
    else if (m[5]) out.push({ text: m[5], begin: m.index + m[4].length });
  }
  return out;
}
