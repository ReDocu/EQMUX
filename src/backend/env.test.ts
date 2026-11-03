import { describe, expect, test } from "vitest";
import {
  appendLine,
  duplicateKeys,
  fromExample,
  keyError,
  parseDotenv,
  removeLine,
  serializeValue,
  setLine,
  withIgnore,
} from "./env";

const kv = (text: string) => parseDotenv(text).map(({ key, value }) => ({ key, value }));

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
      'QC="quoted" # note',
      "EMPTY=",
      "=nokey",
      "garbage",
    ].join("\r\n");
    expect(kv(text)).toEqual([
      { key: "PORT", value: "5173" },
      { key: "API_URL", value: "https://example.com/a?b=1" },
      { key: "SECRET", value: "a b # 안 지움" },
      { key: "TOKEN", value: "x" },
      { key: "NAME", value: "eq" },
      { key: "MULTI", value: "l1\nl2" },
      { key: "QC", value: "quoted" },
      { key: "EMPTY", value: "" },
    ]);
    expect(parseDotenv(text).map((v) => v.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("따옴표 안 줄바꿈은 multiline — 이어지는 줄을 변수로 읽지 않는다", () => {
    const vars = parseDotenv('A=1\nCERT="-----BEGIN\nX=not-a-var\n-----END"\nB=2\n');
    expect(vars.map((v) => [v.key, v.line, !!v.multiline])).toEqual([
      ["A", 0, false],
      ["CERT", 1, true],
      ["B", 4, false],
    ]);
  });
});

describe("한 줄 편집 — 다른 줄을 건드리지 않는다", () => {
  const text = "# c\r\n\r\nexport A='x'\r\nB=2 # keep\r\nC=3";
  const at = (k: string) => parseDotenv(text).find((v) => v.key === k)!;

  test("바꾸기: export 머리·CRLF 유지", () => {
    const a = at("A");
    const out = setLine(text, a.line!, "A", serializeValue("y", a.quote)!);
    expect(out).toBe("# c\r\n\r\nexport A='y'\r\nB=2 # keep\r\nC=3");
  });

  test("바꾸기: 값 뒤 줄 끝 주석은 남는다 (B190) — # 앞 공백 없는 값은 주석이 아니다", () => {
    expect(setLine(text, at("B").line!, "B", "5")).toBe("# c\r\n\r\nexport A='x'\r\nB=5 # keep\r\nC=3");
    expect(setLine('A="x y"  # note', 0, "A", "'z'")).toBe("A='z'  # note");
    expect(setLine("A=a#b", 0, "A", "c")).toBe("A=c");
    expect(setLine('A="x # y"', 0, "A", "c")).toBe("A=c");
  });

  test("빼기: 가운데 줄 · 마지막 줄(끝 줄바꿈 없음) · 첫 줄", () => {
    expect(removeLine(text, at("B").line!)).toBe("# c\r\n\r\nexport A='x'\r\nC=3");
    expect(removeLine(text, at("C").line!)).toBe("# c\r\n\r\nexport A='x'\r\nB=2 # keep");
    expect(removeLine("A=1\nB=2\n", 0)).toBe("B=2\n");
    expect(removeLine("A=1", 0)).toBe("");
  });

  test("붙이기: 끝에 줄바꿈이 없으면 먼저 넣는다, 원래 형식으로", () => {
    expect(appendLine(text, "D", "4")).toBe(`${text}\r\nD=4\r\n`);
    expect(appendLine("A=1\n", "D", "4")).toBe("A=1\nD=4\n");
    expect(appendLine("", "D", "4")).toBe("D=4\n");
  });
});

describe("serializeValue — parseDotenv 왕복", () => {
  const values = ["plain", "", "a b", " lead", "x#y", 'say "hi"', "it's", `both "' mix`, "a\nb", "C:\\path\\n", "k=v=w"];
  for (const v of values) {
    test(JSON.stringify(v), () => {
      const s = serializeValue(v);
      expect(s).toBeDefined();
      expect(kv(`K=${s}`)).toEqual([{ key: "K", value: v }]);
    });
  }

  test("따옴표가 필요 없으면 따옴표 없이, 원래 따옴표는 지킨다", () => {
    expect(serializeValue("abc")).toBe("abc");
    expect(serializeValue("abc", "'")).toBe("'abc'");
    expect(serializeValue("it's", "'")).toBe(`"it's"`);
  });

  test("같은 값으로 못 쓰는 것은 undefined ([원문 편집]으로)", () => {
    expect(serializeValue("a\n\"b")).toBeUndefined();
    expect(serializeValue("'\"`")).toBeUndefined();
    expect(serializeValue("a\rb")).toBeUndefined();
  });
});

describe("키 검사", () => {
  test("잘못된 키와 중복 키를 거부한다", () => {
    expect(keyError("API_KEY", [])).toBeUndefined();
    expect(keyError("a.b_1", [])).toBeUndefined();
    expect(keyError("1A", [])).toBeDefined();
    expect(keyError("A-B", [])).toBeDefined();
    expect(keyError("", [])).toBeDefined();
    expect(keyError("A", ["A"])).toBeDefined();
    expect(keyError("A", ["A"], "A")).toBeUndefined(); // 자기 자신은 중복이 아니다
  });

  test("중복 키를 찾는다", () => {
    expect([...duplicateKeys(parseDotenv("A=1\nB=2\nA=3\n"))]).toEqual(["A"]);
  });
});

describe("예시 · .gitignore", () => {
  test("예시에서 만들기: 키만, 값은 비운다", () => {
    expect(fromExample("# db\nDB_URL=postgres://x\nexport TOKEN='t'\n")).toBe("DB_URL=\nTOKEN=\n");
  });

  test(".gitignore 덧붙이기 — 이미 있으면 그대로", () => {
    expect(withIgnore("node_modules", ".env")).toBe("node_modules\n.env\n");
    expect(withIgnore("/.env\n", ".env")).toBe("/.env\n");
    expect(withIgnore("", ".env.local")).toBe(".env.local\n");
  });
});

test("BOM이 붙은 첫 줄 — 키에 섞이지 않고, 고쳐도 BOM이 남는다", () => {
  const text = "\uFEFFA=1\r\nB=2\r\n";
  expect(parseDotenv(text).map((v) => v.key)).toEqual(["A", "B"]);
  expect(setLine(text, 0, "A", "9")).toBe("\uFEFFA=9\r\nB=2\r\n");
});
