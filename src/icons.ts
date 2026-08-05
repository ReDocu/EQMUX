// 아이콘 — design.pen이 쓰는 lucide 글리프를 인라인 SVG로 동봉한다. (이안)
//
// 왜 파일로 두는가: CSP가 `default-src 'self'`뿐이라 아이콘 폰트 CDN도, 외부 SVG도 없다.
// 라이브러리를 통째로 실으면 KR2(용량)에 얹힌다 — 디자인이 실제로 쓰는 글리프만 옮긴다.
// 경로 데이터는 lucide (ISC) 원본 그대로다. 크기는 CSS가 정한다 (svg.icon 기본 12px).
//
// ⚠️ 여기 문자열은 **우리가 적은 상수**만 들어간다 — innerHTML에 바깥 값이 섞이면 안 된다.

export type IconName =
  | "plus"
  | "terminal"
  | "square-terminal"
  | "activity"
  | "loader-circle"
  | "pause"
  | "power"
  | "layout-grid"
  | "layout-dashboard"
  | "folder"
  | "shield"
  | "maximize-2"
  | "minimize-2"
  | "ellipsis"
  | "radio"
  | "briefcase-business"
  | "git-branch"
  | "file-text"
  | "globe"
  | "x"
  | "users"
  | "user-pen"
  | "folder-open"
  | "folder-git-2"
  | "chevron-left"
  | "chevron-right"
  | "arrow-down"
  | "arrow-up"
  | "git-commit-horizontal"
  | "diff";

/** lucide 24×24 좌표계의 내부 마크업. 바깥 <svg> 속성은 `icon()`이 공통으로 붙인다. */
const INNER: Record<IconName, string> = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  "square-terminal":
    '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  "loader-circle": '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  "layout-grid":
    '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  "layout-dashboard":
    '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  "maximize-2":
    '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  "minimize-2":
    '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  radio:
    '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/>',
  "briefcase-business":
    '<path d="M12 12h.01"/><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M22 13a18.15 18.15 0 0 1-20 0"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  "git-branch":
    '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  "file-text":
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  "user-pen":
    '<path d="M11.5 15H7a4 4 0 0 0-4 4v2"/><path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/><circle cx="10" cy="7" r="4"/>',
  "folder-open":
    '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  "folder-git-2":
    '<path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5"/><circle cx="13" cy="12" r="2"/><path d="M18 19c-2.8 0-5-2.2-5-5v8"/><circle cx="20" cy="19" r="2"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  "git-commit-horizontal":
    '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
  diff: '<path d="M12 3v14"/><path d="M5 10h14"/><path d="M5 21h14"/>',
};

const tpl = document.createElement("template");

/** 아이콘 SVG 요소를 만든다. 색은 `currentColor` — 붙는 자리의 글자색을 따라간다. */
export function icon(name: IconName, cls?: string): SVGSVGElement {
  tpl.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
    ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"` +
    ` class="icon${cls ? ` ${cls}` : ""}">${INNER[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

/**
 * 버튼 안의 아이콘을 갈아 끼운다 — 같은 이름이면 DOM을 안 만진다
 * (500ms 주기 갱신이 hot path에 얹히는 걸 막는 규칙. `pane-header.ts`의 setText와 같다).
 */
export function setIcon(host: HTMLElement, name: IconName, cls?: string): void {
  if (host.dataset.icon === name) return;
  host.dataset.icon = name;
  host.querySelector(":scope > svg.icon")?.remove();
  host.prepend(icon(name, cls));
}
