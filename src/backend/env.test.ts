import { describe, expect, test } from "vitest";
import { parseDotenv } from "./env";

describe("parseDotenv", () => {
  test("주석·빈 줄·export·따옴표·줄 끝 주석", () => {
    const text = [
      "# 설정",
      "",
      "PORT=5173",
      "export API_URL = https://example.com/a?b=1",
      'SECRET="a b # 안 지움"',
      "TOKEN='x'",
      "NAME=eq # 줄 끝 주석",
      'MULTI="l1\\nl2"',
      "EMPTY=",
      "=nokey",
      "garbage",
    ].join("\r\n");
    expect(parseDotenv(text)).toEqual([
      { key: "PORT", value: "5173" },
      { key: "API_URL", value: "https://example.com/a?b=1" },
      { key: "SECRET", value: "a b # 안 지움" },
      { key: "TOKEN", value: "x" },
      { key: "NAME", value: "eq" },
      { key: "MULTI", value: "l1\nl2" },
      { key: "EMPTY", value: "" },
    ]);
  });
});
