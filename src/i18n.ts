// UI 로컬라이제이션 — 코드의 한국어 원문이 곧 키다 (한국어 우선 코드베이스 관례).
// 영어 모드(설정 language="en")일 때만 사전에서 치환하고, 사전에 없는 키는 한국어 그대로 폴백한다.
// 규칙:
//  - t()/tf()는 반드시 렌더 시점(컴포넌트·콜백)에서 부른다 — 모듈 상수에서 부르면 언어 전환에 안 따라온다
//  - 사전 키는 코드의 한국어 문자열과 바이트 단위로 동일해야 한다 (중점 "·", 공백 포함)
//  - 데이터는 번역하지 않는다 — 이벤트 로그 원장, 페르소나/직무 파일 내용, 터미널 출력, git 결과
import { settings } from "./backend/settings";
import { dict as common } from "./i18n/common";
import { dict as settingsDict } from "./i18n/settings";
import { dict as control } from "./i18n/control";
import { dict as git } from "./i18n/git";
import { dict as roles } from "./i18n/roles";
import { dict as missions } from "./i18n/missions";
import { dict as session } from "./i18n/session";
import { dict as shell } from "./i18n/shell";
import { dict as panels } from "./i18n/panels";

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
);

/** 한국어 원문 → 현재 언어 문자열. 영어 사전에 없으면 한국어 폴백 (미번역이 깨짐이 되지 않게) */
export function t(ko: string): string {
  return settings().language === "en" ? (EN[ko] ?? ko) : ko;
}

/** 자리표시자 치환 번역 — 키와 사전 값이 {name} 자리표시자를 공유한다.
 *  어순이 언어마다 다른 문장에만 쓴다. 단순 병기는 JSX에서 t() 조각으로 충분하다 */
export function tf(ko: string, vars: Record<string, string | number>): string {
  let s = t(ko);
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
