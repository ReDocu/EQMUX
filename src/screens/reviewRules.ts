// 임무 검토 화면 규칙 (0.6 §13-3) — [테스트 실행]은 서버 탭 셸에 명령을 치므로 종료 코드를 직접 받지 못한다.
// 명령 뒤에 표식 줄을 출력하게 붙이고, PTY 출력에서 그 줄을 찾아 읽는다. 순수 함수라 테스트가 여기를 겨눈다.

const MARK = "EQMUX_EXIT:";

/** 셸별 표식 꼬리 — 명령 바로 뒤에 붙인다. cmd는 %ERRORLEVEL%이 줄을 읽을 때 펼쳐져 못 쓴다 → undefined.
 *  입력 줄 에코에는 `$?`·`$LASTEXITCODE`가 그대로 보여 숫자 표식과 섞이지 않는다 */
export function exitMarkerSuffix(shellCmd: string, tag: string): string | undefined {
  const sh = shellCmd.toLowerCase().replace(/\\/g, "/").split("/").pop()?.replace(/\.exe$/, "") ?? "";
  if (sh === "pwsh" || sh === "powershell") return `; echo "${MARK}${tag}:$LASTEXITCODE"`;
  if (sh === "cmd") return undefined;
  return `; echo "${MARK}${tag}:$?"`; // bash · zsh · sh · fish(…$status가 맞지만 $?도 받는다)
}

// ANSI 이스케이프(CSI · OSC)는 표식 사이에 끼어들 수 있어 먼저 걷는다
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** 누적 출력에서 이 실행(tag)의 마지막 표식 종료 코드 — 없으면 undefined. 빈 `$LASTEXITCODE`(cmdlet만 돈 경우)는 0.
 *  tag가 다른 표식(같은 셸에서 먼저 돌던 실행)은 무시한다 */
export function findExitCode(buf: string, tag: string): number | undefined {
  const text = buf.replace(ANSI, "");
  const all = [...text.matchAll(new RegExp(`${MARK}${tag}:(-?\\d*)\\s*$`, "gm"))];
  const last = all.at(-1);
  if (!last) return undefined;
  return last[1] === "" ? 0 : Number(last[1]);
}
