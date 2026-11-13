import { describe, expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { docText, eolOf } from "./CodeEditor";

// B296 — CRLF 원문을 한 글자 고쳐 저장해도 줄바꿈이 LF로 바뀌지 않는다
describe("편집기 줄바꿈 보존", () => {
  const edit = (original: string) => {
    const s = EditorState.create({ doc: original });
    return docText(s.update({ changes: { from: 0, insert: "X" } }).state.doc, eolOf(original));
  };
  test("CRLF 원문은 CRLF로 나온다", () => {
    expect(edit("a=1\r\nb=2\r\n")).toBe("Xa=1\r\nb=2\r\n");
  });
  test("LF 원문은 LF 그대로", () => {
    expect(edit("a=1\nb=2\n")).toBe("Xa=1\nb=2\n");
  });
  test("CRLF 문서에 붙여 넣은 \\n 줄도 CRLF로 맞춘다", () => {
    const s = EditorState.create({ doc: "a\r\nb" });
    const next = s.update({ changes: { from: 1, insert: "\nc" } }).state.doc;
    expect(docText(next, eolOf("a\r\nb"))).toBe("a\r\nc\r\nb");
  });
});
