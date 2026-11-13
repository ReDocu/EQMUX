import { expect, test } from "vitest";

// B329 · S45 — macOS 11–13.2의 시스템 WebKit(Safari 16.4 미만)이 못 읽는 것이 앱 코드에 다시 들어오지 않게 한다.
//  정규식 뒤돌아보기는 리터럴 하나로 번들 전체가 파싱에서 죽어 빈 창이 된다(0.5.1 termPaths · 0.6 gitWrite 두 번 회귀).
//  .at · Object.hasOwn은 Safari 15.4부터다. 시험 파일은 node에서만 돌아 번들에 들어가지 않으니 뺀다.
const BANNED: [RegExp, string][] = [
  [/\(\?<[=!]/, "정규식 뒤돌아보기 (?<= · (?<!"],
  [/\.at\(/, "Array/String .at()"],
  [/Object\.hasOwn\(/, "Object.hasOwn()"],
];

// 원문 그대로(?raw) 읽는다 — 모듈로 실행하지 않는다
const SOURCES = import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** 주석 줄과 줄 끝 주석을 걷어 낸 코드 — 문구 속 예시까지 막지 않게 */
function code(text: string): string[] {
  return text.split("\n").map((l) => {
    const t = l.trim();
    if (t.startsWith("*") || t.startsWith("/*") || t.startsWith("//")) return "";
    const c = l.indexOf(" // ");
    return c >= 0 ? l.slice(0, c) : l;
  });
}

test("B329 앱 코드에 Safari 16.4 미만이 못 읽는 문법 · API가 없다", () => {
  const hits: string[] = [];
  expect(Object.keys(SOURCES).length).toBeGreaterThan(50); // 글롭이 비어 시험이 헛도는 것을 막는다
  for (const [file, text] of Object.entries(SOURCES)) {
    code(text).forEach((line, i) => {
      for (const [re, what] of BANNED) if (re.test(line)) hits.push(`${file}:${i + 1} ${what}`);
    });
  }
  expect(hits).toEqual([]);
});
