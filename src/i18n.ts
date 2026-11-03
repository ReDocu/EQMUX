// UI 로컬라이제이션 — 코드의 한국어 원문이 곧 키다 (한국어 우선 코드베이스 관례).
// 영어 모드(설정 language="en")일 때만 사전에서 치환하고, 사전에 없는 키는 한국어 그대로 폴백한다.
// 규칙:
//  - t()/tf()는 반드시 렌더 시점(컴포넌트·콜백)에서 부른다 — 모듈 상수에서 부르면 언어 전환에 안 따라온다
//  - 사전 키는 코드의 한국어 문자열과 바이트 단위로 동일해야 한다 (중점 "·", 공백 포함)
//  - 데이터는 번역하지 않는다 — 이벤트 로그 원장, 페르소나/직무 파일 내용, 터미널 출력, git 결과
import { settings } from "./backend/settings";
import { IS_MAC, keyLabel } from "./platform";
import { dict as common } from "./i18n/common";
import { dict as settingsDict } from "./i18n/settings";
import { dict as control } from "./i18n/control";
import { dict as git } from "./i18n/git";
import { dict as roles } from "./i18n/roles";
import { dict as missions } from "./i18n/missions";
import { dict as session } from "./i18n/session";
import { dict as shell } from "./i18n/shell";
import { dict as panels } from "./i18n/panels";
import { dict as history } from "./i18n/history"; // §4 과거 세션 검색 (W3)
import { dict as jump } from "./i18n/jump"; // §4 건너뛰기 팔레트 · 단축키 표 (W3)
import { dict as extensions } from "./i18n/extensions"; // §12 확장 그룹 (W1)

const EN: Record<string, string> = Object.assign(
  {},
  common,
  settingsDict,
  control,
  git,
  roles,
  missions,
  session,
  shell,
  panels,
  history,
  jump,
  extensions,
);

/** macOS에서만 문장째 바꾸는 원문 (U67) — 표기 치환(keyLabel)으로는 뜻이 맞지 않는 Windows 전제 설명.
 *  값은 [한국어, 영어]. 키는 위 사전과 같은 한국어 원문이다 */
const MAC: Record<string, [string, string]> = {
  "읽기 전용입니다. xterm은 Ctrl+Shift+글자를 터미널로 보내지 않아 셸 단축키와 겹치지 않습니다.": [
    "읽기 전용입니다. 앱 단축키는 ⌘ 계열이라 셸의 Ctrl 키(인터럽트·커서 이동)와 겹치지 않습니다.",
    "Read-only. App shortcuts use ⌘, so they never clash with the shell's Ctrl keys (interrupt, cursor movement).",
  ],
};

/** 한국어 원문 → 현재 언어 문자열. 영어 사전에 없으면 한국어 폴백 (미번역이 깨짐이 되지 않게).
 *  단축키 표기는 macOS에서 ⌘⇧U처럼 바뀐다 (U67) — 원문·사전은 Windows 표기 하나로 둔다 */
export function t(ko: string): string {
  const en = settings().language === "en";
  const mac = IS_MAC ? MAC[ko] : undefined;
  if (mac) return mac[en ? 1 : 0];
  return keyLabel(en ? (EN[ko] ?? ko) : ko);
}

/** 자리표시자 치환 번역 — 키와 사전 값이 {name} 자리표시자를 공유한다.
 *  어순이 언어마다 다른 문장에만 쓴다. 단순 병기는 JSX에서 t() 조각으로 충분하다 */
export function tf(ko: string, vars: Record<string, string | number>): string {
  let s = t(ko);
  // 자리표시자 뒤 '을(를)'·'이(가)'는 넣은 낱말의 받침으로 고른다 (U176) — 영어 문장에는 없어 그대로다
  for (const [k, v] of Object.entries(vars))
    s = s.replace(new RegExp(`\\{${k}\\}(${JOSA.source})?`, "g"), (_, p?: string) => String(v) + (p ? josa(String(v), p) : ""));
  return s;
}

const JOSA = /을\(를\)|이\(가\)|은\(는\)|와\(과\)/;

/** 받침이 있으면 앞 조사, 없으면 뒤 조사 — '을(를)' → '을' | '를'. 판정이 안 서면 원문 그대로 (U176).
 *  끝의 기호는 건너뛴다(`stash@{0}` → 0). 숫자는 읽는 소리로(일·삼·육·칠·팔·십·영 → 받침).
 *  ponytail: 영어 낱말은 끝 글자로 어림한다 — l·m·n·ng로 끝나거나 L·M·N·R 한 글자면 받침.
 *  file(파일)처럼 묵음 e는 틀린다. 정확히 하려면 발음 사전이 필요하다 */
export function josa(word: string, pair: string): string {
  const w = word.replace(/[^\p{L}\p{N}]+$/u, "");
  const c = w.slice(-1);
  const code = c.charCodeAt(0);
  let batchim: boolean | undefined;
  if (code >= 0xac00 && code <= 0xd7a3) batchim = (code - 0xac00) % 28 !== 0;
  else if (/\d/.test(c)) batchim = "013678".includes(c); // 10 · 100 · 1000 · 10000(십 · 백 · 천 · 만)도 0으로 끝나 받침
  else if (/[a-z]/i.test(c)) batchim = /^r$/i.test(w) || /(?:[lmn]|ng)$/i.test(w);
  if (batchim === undefined) return pair;
  // '와(과)'만 받침 쪽이 뒤다 — 책과 · 나무와 (을(를) · 이(가) · 은(는)은 받침 쪽이 앞)
  const [withB, without] = pair === "와(과)" ? [pair[2], pair[0]] : [pair[0], pair[2]];
  return batchim ? withB : without;
}
