// 임무 검토 화면 규칙 (0.6 §13-3) — [테스트 실행]은 서버 탭 셸에 명령을 치므로 종료 코드를 직접 받지 못한다.
// 명령 뒤에 표식 줄을 출력하게 붙이고, PTY 출력에서 그 줄을 찾아 읽는다. 순수 함수라 테스트가 여기를 겨눈다.

const MARK = "EQMUX_EXIT:";

/** 셸별 표식 꼬리 — 명령 바로 뒤에 붙인다. cmd는 %ERRORLEVEL%이 줄을 읽을 때 펼쳐져 못 쓴다 → undefined.
 *  입력 줄 에코에는 `$?`·`$LASTEXITCODE`가 그대로 보여 숫자 표식과 섞이지 않는다 */
const shellBase = (shellCmd: string) => shellCmd.toLowerCase().replace(/\\/g, "/").split("/").pop()?.replace(/\.exe$/, "") ?? "";
export const isPowerShell = (shellCmd: string): boolean => ["pwsh", "powershell"].includes(shellBase(shellCmd));

export function exitMarkerSuffix(shellCmd: string, tag: string): string | undefined {
  const sh = shellBase(shellCmd);
  if (isPowerShell(sh)) return `; echo "${MARK}${tag}:$LASTEXITCODE"`;
  if (sh === "cmd") return undefined;
  return `; echo "${MARK}${tag}:$?"`; // bash · zsh · sh · fish(…$status가 맞지만 $?도 받는다)
}

// ANSI 이스케이프(CSI · OSC)는 표식 사이에 끼어들 수 있어 먼저 걷는다
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** 누적 출력에서 이 실행(tag)의 마지막 표식 종료 코드 — 없으면 undefined. tag가 다른 표식(같은 셸에서 먼저 돌던 실행)은 무시한다.
 *  빈 값은 PowerShell에서만 0이다(cmdlet만 돈 `$LASTEXITCODE`). 다른 셸의 `$?`는 비지 않으니, 비었으면 셸을 잘못 안 것이다 (B276) */
export function findExitCode(buf: string, tag: string, emptyIsZero = false): number | undefined {
  const text = buf.replace(ANSI, "");
  const all = [...text.matchAll(new RegExp(`${MARK}${tag}:(-?\\d*)\\s*$`, "gm"))];
  const last = all.at(-1);
  if (!last) return undefined;
  if (last[1] === "") return emptyIsZero ? 0 : undefined;
  return Number(last[1]);
}
