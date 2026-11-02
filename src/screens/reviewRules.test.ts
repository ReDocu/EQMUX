// 임무 검토 [테스트 실행] 종료 코드 읽기 (0.6 §13-3)
import { describe, expect, test } from "vitest";
import { exitMarkerSuffix, findExitCode } from "./reviewRules";

describe("exitMarkerSuffix", () => {
  test("셸마다 맞는 종료 코드 변수, cmd는 못 쓴다", () => {
    expect(exitMarkerSuffix("pwsh.exe")).toBe('; echo "EQMUX_EXIT:$LASTEXITCODE"');
    expect(exitMarkerSuffix("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe('; echo "EQMUX_EXIT:$LASTEXITCODE"');
    expect(exitMarkerSuffix("/bin/zsh")).toBe('; echo "EQMUX_EXIT:$?"');
    expect(exitMarkerSuffix("cmd.exe")).toBeUndefined();
  });
});

describe("findExitCode", () => {
  test("입력 줄 에코($?)는 표식이 아니다 — 출력된 숫자 줄만 읽는다", () => {
    expect(findExitCode('PS> npm test; echo "EQMUX_EXIT:$LASTEXITCODE"\r\n')).toBeUndefined();
    expect(findExitCode('npm test; echo "EQMUX_EXIT:$?"\r\n 3 passed\r\nEQMUX_EXIT:0\r\n$ ')).toBe(0);
  });
  test("ANSI가 끼어도, 여러 번 돌렸으면 마지막 것", () => {
    expect(findExitCode("EQMUX_EXIT:0\r\n\x1b[31mfail\x1b[0m\r\n\x1b[0mEQMUX_EXIT:1\x1b[K\r\n")).toBe(1);
  });
  test("빈 $LASTEXITCODE는 0", () => {
    expect(findExitCode("EQMUX_EXIT:\r\n")).toBe(0);
  });
});
