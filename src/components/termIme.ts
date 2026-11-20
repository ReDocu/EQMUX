// macOS 한글 입력기 → 터미널 (2026-11-20 실측, macOS 15 · 2벌식).
// WKWebView의 2벌식은 조합 이벤트를 내지 않는다. 음절의 첫 자모는 insertText로,
// 그 뒤 조합 단계(ㅎ → 하 → 한)는 앞 글자를 바꿔 끼우는 insertReplacementText로 온다.
// xterm은 insertText만 PTY로 보낸다. keyCode 229 keydown은 입력 뒤에 와서 '바뀐 것 없음'으로 끝난다.
// 그래서 '한글'이 'ㅎㄱ'으로 갔다. 바꿔 끼운 글자 수만큼 DEL을 보내고 새 글자를 보낸다.

const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힣ힰ-퟿]/;

/** 입력칸 값이 before → after로 바뀌었을 때 셸에 보낼 것 — 끝에서 지울 글자 수와 새 글자.
 *  한글이 낀 끝자리 변경만 다룬다. 자동 치환(-- → —)이나 가운데 변경은 undefined (xterm 기본 동작 그대로) */
export function hangulReplacement(before: string, after: string): { erase: number; text: string } | undefined {
  const a = Array.from(before);
  const b = Array.from(after);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  // 끝자리만 — 뒤에 같은 글자가 남았으면 가운데를 바꾼 것이다 (DEL로는 그 자리에 닿지 않는다)
  if (p < a.length && p < b.length && a[a.length - 1] === b[b.length - 1]) return undefined;
  const removed = a.slice(p).join("");
  const text = b.slice(p).join("");
  if (!removed && !text) return undefined;
  if (!HANGUL.test(removed + text)) return undefined;
  return { erase: a.length - p, text };
}

/** xterm 입력칸에 단다 — 한글 바꿔 끼우기를 DEL + 새 글자로 보낸다. send는 term.input(…, true) */
export function attachHangulReplace(textarea: HTMLTextAreaElement, send: (data: string) => void): void {
  let before = textarea.value;
  textarea.addEventListener("beforeinput", () => (before = textarea.value), true);
  textarea.addEventListener(
    "input",
    (ev) => {
      if ((ev as InputEvent).inputType === "insertReplacementText") {
        const r = hangulReplacement(before, textarea.value);
        // DEL과 글자를 따로 보낸다 — 한 덩어리면 TUI가 붙여넣기 한 줄로 읽을 수 있다
        if (r && r.erase > 0) send("\x7f".repeat(r.erase));
        if (r && r.text) send(r.text);
      }
      before = textarea.value;
    },
    true,
  );
}
