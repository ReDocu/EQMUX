// 직무 8종 고정 — id별 배지·색의 단일 원본. 시드 내용의 원본은 Rust library.rs seed()다.
// 직무는 추가·삭제하지 않는다 (고정 로스터) — 편집(문구·권한)은 라이브러리 화면에서 가능.
// 색은 styles.css의 .badge.<color>와 1:1이며, 페르소나 점(원형 4색)과 모양으로 구분된다.

export type JobBadgeColor = "blue" | "cyan" | "purple" | "pink" | "green" | "red" | "slate" | "orange";

export const JOB_META: Record<string, { badge: string; color: JobBadgeColor }> = {
  lead: { badge: "LEAD", color: "blue" },
  plan: { badge: "PLAN", color: "cyan" },
  dev: { badge: "DEV", color: "purple" },
  design: { badge: "DESIGN", color: "pink" },
  qa: { badge: "QA", color: "green" },
  debug: { badge: "FIXER", color: "red" },
  docs: { badge: "DOCS", color: "slate" },
  release: { badge: "RELEASE", color: "orange" },
};

/** 알 수 없는 id(외부에서 만든 파일·WS 오버라이드) 폴백 — 이름 대문자 + 파랑 */
export const jobMeta = (id: string, name?: string): { badge: string; color: JobBadgeColor } =>
  JOB_META[id] ?? { badge: (name ?? id).toUpperCase(), color: "blue" };
