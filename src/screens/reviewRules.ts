// 임무 검토 화면 규칙 (0.6 §13-3) — [테스트 실행]은 서버 탭 셸에 명령을 치므로 종료 코드를 직접 받지 못한다.
// 명령 뒤에 표식 줄을 출력하게 붙이고, PTY 출력에서 그 줄을 찾아 읽는다. 순수 함수라 테스트가 여기를 겨눈다.

const MARK = "EQMUX_EXIT:";

/** 셸별 표식 꼬리 — 명령 바로 뒤에 붙인다. cmd는 %ERRORLEVEL%이 줄을 읽을 때 펼쳐져 못 쓴다 → undefined.
 *  입력 줄 에코에는 `$?`·`$LASTEXITCODE`가 그대로 보여 숫자 표식과 섞이지 않는다 */
export function exitMarkerSuffix(shellCmd: string): string | undefined {
  const sh = shellCmd.toLowerCase().replace(/\\/g, "/").split("/").pop()?.replace(/\.exe$/, "") ?? "";
  if (sh === "pwsh" || sh === "powershell") return `; echo "${MARK}$LASTEXITCODE"`;
  if (sh === "cmd") return undefined;
  return `; echo "${MARK}$?"`; // bash · zsh · sh · fish(…$status가 맞지만 $?도 받는다)
}

// ANSI 이스케이프(CSI · OSC)는 표식 사이에 끼어들 수 있어 먼저 걷는다
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** 누적 출력에서 마지막 표식의 종료 코드 — 없으면 undefined. 빈 `$LASTEXITCODE`(cmdlet만 돈 경우)는 0으로 본다 */
export function findExitCode(buf: string): number | undefined {
  const text = buf.replace(ANSI, "");
  const all = [...text.matchAll(/EQMUX_EXIT:(-?\d*)\s*$/gm)];
  const last = all.at(-1);
  if (!last) return undefined;
  return last[1] === "" ? 0 : Number(last[1]);
}
