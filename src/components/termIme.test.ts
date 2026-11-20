import { describe, expect, test } from "vitest";
import { hangulReplacement } from "./termIme";

// 2026-11-20 macOS 15 WKWebView 2벌식 실측 — 키마다 오는 input 이벤트 (inputType, 바뀐 뒤 값)
type Ev = ["insertText" | "insertReplacementText", string];
const HANGUL_TRACE: Ev[] = [
  ["insertText", "ㅎ"],
  ["insertReplacementText", "하"],
  ["insertReplacementText", "한"],
  ["insertReplacementText", "한"], // 다음 음절로 넘어가며 확정
  ["insertText", "한ㄱ"],
  ["insertReplacementText", "한그"],
  ["insertReplacementText", "한글"],
  ["insertReplacementText", "한글"],
];
const HANA_TRACE: Ev[] = [
  ["insertText", "ㅎ"],
  ["insertReplacementText", "하"],
  ["insertReplacementText", "한"],
  ["insertReplacementText", "하"], // ㄴ이 다음 음절로 넘어간다
  ["insertText", "하나"],
];

/** 셸 줄 편집기 흉내 — xterm이 insertText로 보낸 것 + 바꿔 끼우기에서 보낸 DEL · 글자 */
function shellLine(trace: Ev[]): string {
  const line: string[] = [];
  let before = "";
  for (const [type, after] of trace) {
    if (type === "insertText") {
      line.push(...Array.from(after.slice(before.length))); // xterm 기본: ev.data를 그대로 보낸다
    } else {
      const r = hangulReplacement(before, after);
      if (r) {
        line.splice(line.length - r.erase, r.erase);
        line.push(...Array.from(r.text));
      }
    }
    before = after;
  }
  return line.join("");
}

describe("macOS 2벌식 바꿔 끼우기 → 터미널", () => {
  test("실측 순서대로 치면 셸에 한글 · 하나가 그대로 간다 ('ㅎㄱ' · 'ㅎ나'가 아니다)", () => {
    expect(shellLine(HANGUL_TRACE)).toBe("한글");
    expect(shellLine(HANA_TRACE)).toBe("하나");
  });
  test("조합 단계는 DEL 하나 + 새 음절", () => {
    expect(hangulReplacement("ㅎ", "하")).toEqual({ erase: 1, text: "하" });
    expect(hangulReplacement("echo 하", "echo 한")).toEqual({ erase: 1, text: "한" });
  });
  test("조합 중 백스페이스로 받침을 지우면 DEL + 앞 단계", () => {
    expect(hangulReplacement("한", "하")).toEqual({ erase: 1, text: "하" });
    expect(hangulReplacement("하", "ㅎ")).toEqual({ erase: 1, text: "ㅎ" });
  });
  test("확정만 하고 글자가 그대로면 아무것도 보내지 않는다", () => {
    expect(hangulReplacement("한", "한")).toBeUndefined();
  });
  test("한글이 아닌 자동 치환은 건드리지 않는다", () => {
    expect(hangulReplacement("a --", "a —")).toBeUndefined();
    expect(hangulReplacement('say "', "say “")).toBeUndefined();
  });
  test("끝이 아닌 자리의 변경은 건드리지 않는다 — DEL로는 그 자리에 닿지 않는다", () => {
    expect(hangulReplacement("하나둘", "한나둘")).toBeUndefined();
  });
});
