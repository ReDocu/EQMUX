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

/** 직함 추천 칩 (0.5) — 직무별 고정 목록. 설정 항목이 아니다. 화면은 t()로 UI 언어로 보이고,
 *  누른 말(번역된 문구)이 그대로 직함이 된다 */
export const TITLE_SUGGEST: Record<string, string[]> = {
  lead: ["테크 리드", "프로젝트 리드"],
  plan: ["기획자", "시스템 기획자", "콘텐츠 기획자"],
  dev: ["클라이언트 개발자", "서버 개발자", "프런트엔드 개발자", "백엔드 개발자", "툴 개발자"],
  design: ["UI 디자이너", "UX 디자이너"],
  qa: ["QA 엔지니어", "테스트 자동화 담당"],
  debug: ["장애 대응 담당"],
  docs: ["테크니컬 라이터"],
  release: ["릴리즈 매니저", "빌드 엔지니어"],
};
