// 라이브러리 이름 검증 (B97) — 빈 이름·대소문자만 다른 중복을 막고, 자기 자신은 겹침에서 뺀다
import { expect, test } from "vitest";
import { libNameError } from "./library";

const all = [
  { id: "kai", name: "카이" },
  { id: "noel", name: "Noel" },
];

test("libNameError", () => {
  expect(libNameError("  ", "kai", all)).toBe("이름을 입력하세요");
  expect(libNameError(" noel ", "kai", all)).toBe("이미 쓰는 이름입니다");
  expect(libNameError("카이", "kai", all)).toBeUndefined(); // 제 이름 그대로 저장
  expect(libNameError("카이2", "kai", all)).toBeUndefined();
});
