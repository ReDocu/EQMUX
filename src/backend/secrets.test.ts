import { describe, expect, test } from "vitest";
import { maskDotenvLine, maskSecrets, PATTERNS } from "./secrets";

// 같은 cases를 Rust secrets.rs 테스트도 돌린다 — 두 구현이 같은 결과를 낸다
describe("maskSecrets — secretPatterns.json cases", () => {
  for (const [input, want] of PATTERNS.cases) {
    test(input, () => expect(maskSecrets(input)).toBe(want));
  }
});

describe("maskDotenvLine", () => {
  test("값만 가리고 주석·빈 값·빈 줄은 그대로", () => {
    expect(maskDotenvLine("export API_KEY='x'")).toBe("export API_KEY=••••••••");
    expect(maskDotenvLine("PORT=5173")).toBe("PORT=••••••••");
    expect(maskDotenvLine("# API_KEY=x")).toBe("# API_KEY=x");
    expect(maskDotenvLine("EMPTY=")).toBe("EMPTY=");
    expect(maskDotenvLine("")).toBe("");
  });
});
