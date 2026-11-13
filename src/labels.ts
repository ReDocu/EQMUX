// 화면 표기 갈래 (0.6 §11-3) — 플랫폼마다 다른 이름(U76)과 제품 고정 직무 이름(U112)을 한곳에서 번역한다.
// 순수 함수: mac 인자는 테스트용(기본은 이 웹뷰 판정)
import { t, tf } from "./i18n";
import { fmtAgo } from "./backend/attention";
import type { StateReason } from "./types";
import { IS_MAC } from "./platform";

/** OS 파일 관리자 이름 — macOS "Finder", 그 밖 "탐색기" (U76). 앱 안 '파일 탐색기'는 이것을 쓰지 않는다 */
export const fileManagerName = (mac = IS_MAC): string => (mac ? "Finder" : t("탐색기"));

/** 경로를 OS 파일 관리자에서 여는 버튼 · 메뉴 문구 — "Finder에서 보기" / "탐색기에서 열기" (U76) */
export const revealLabel = (mac = IS_MAC): string => (mac ? t("Finder에서 보기") : t("탐색기에서 열기"));

/** 직무 표시 이름 (U112) — 8종은 제품 고정이라 사전(roles.ts)에 있다. 사용자가 바꾼 이름은 사전에 없어 그대로 나온다 */
export const jobName = (j: { name: string } | undefined, fallback = "—"): string => (j ? t(j.name) : fallback);

/** 상태 판정 근거 한 줄 (0.6 §4) — 훅 이름은 기술 이름 그대로, 나머지 출처만 번역한다. now는 테스트용 */
export function reasonText(r: StateReason, now = Date.now()): string {
  const ago = fmtAgo(Math.max(0, now - r.ts));
  if (r.note === "stalled") return tf("{event} 뒤로 훅 없음 · {ago}", { event: r.event, ago });
  const what =
    r.event === "registry"
      ? t(r.note === "adopted" ? "직접 띄운 claude를 붙임" : "세션 레지스트리 재확인")
      : r.event === "pty-exit"
        ? tf("프로세스 종료 · {note}", { note: r.note ?? "?" })
        : r.event === "process-gone"
          ? t("붙였던 claude가 사라짐")
          : r.event;
  return `${what} · ${ago}`;
}
