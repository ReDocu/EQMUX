import { describe, expect, test } from "vitest";
import { isStaleWrite, unsavedWhere } from "./panels";

describe("파일 탭 저장 · 패널 닫기 가드", () => {
  // U189 — fsx.rs write_file의 거부 문구가 바뀌면 [덮어쓰기] · [내 편집 복사]가 안 뜬다
  test("밖에서 바뀐 파일 거부를 알아본다", () => {
    expect(isStaleWrite("파일이 밖에서 바뀌었습니다 — 편집을 취소하고 다시 열어 확인하세요")).toBe(true);
    expect(isStaleWrite(new Error("1MB 초과 — 저장할 수 없습니다"))).toBe(false);
  });
  // B302 — 파일 탭만 보던 닫기 가드가 환경변수 원문 · 스킬 편집도 본다
  test("미저장 편집 자리를 모두 모은다", () => {
    expect(unsavedWhere(false, false, false)).toEqual([]);
    expect(unsavedWhere(false, true, false)).toEqual(["환경변수"]);
    expect(unsavedWhere(true, false, true)).toEqual(["파일", "스킬"]);
  });
});
