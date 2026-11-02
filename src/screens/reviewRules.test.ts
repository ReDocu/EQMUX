// 임무 검토 [테스트 실행] 종료 코드 읽기 (0.6 §13-3)
import { describe, expect, test } from "vitest";
import { exitMarkerSuffix, findExitCode } from "./reviewRules";

describe("exitMarkerSuffix", () => {
  test("셸마다 맞는 종료 코드 변수, cmd는 못 쓴다", () => {
    expect(exitMarkerSuffix("pwsh.exe", "t1")).toBe('; echo "EQMUX_EXIT:t1:$LASTEXITCODE"');
    expect(exitMarkerSuffix("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "t1")).toBe('; echo "EQMUX_EXIT:t1:$LASTEXITCODE"');
    expect(exitMarkerSuffix("/bin/zsh", "t1")).toBe('; echo "EQMUX_EXIT:t1:$?"');
    expect(exitMarkerSuffix("cmd.exe", "t1")).toBeUndefined();
  });
});

describe("findExitCode", () => {
  test("입력 줄 에코($?)는 표식이 아니다 — 출력된 숫자 줄만 읽는다", () => {
    expect(findExitCode('PS> npm test; echo "EQMUX_EXIT:t1:$LASTEXITCODE"\r\n', "t1")).toBeUndefined();
    expect(findExitCode('npm test; echo "EQMUX_EXIT:t1:$?"\r\n 3 passed\r\nEQMUX_EXIT:t1:0\r\n$ ', "t1")).toBe(0);
  });
  test("ANSI가 끼어도, 여러 번 돌렸으면 마지막 것", () => {
    expect(findExitCode("EQMUX_EXIT:t1:0\r\n\x1b[31mfail\x1b[0m\r\n\x1b[0mEQMUX_EXIT:t1:1\x1b[K\r\n", "t1")).toBe(1);
  });
  test("빈 $LASTEXITCODE는 0", () => {
    expect(findExitCode("EQMUX_EXIT:t1:\r\n", "t1")).toBe(0);
  });
  test("앞 실행의 늦은 표식은 이번 결과가 아니다", () => {
    expect(findExitCode("EQMUX_EXIT:t0:1\r\n", "t1")).toBeUndefined();
    expect(findExitCode("EQMUX_EXIT:t0:1\r\nEQMUX_EXIT:t1:0\r\n", "t1")).toBe(0);
  });
});
