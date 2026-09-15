// 브라우저 패널 브리지 (M17 확장) — 자식 웹뷰(browser.rs)의 프런트 소비 표면.
// Tauri 밖(순수 vite dev)에서는 모든 함수가 no-op이고, 패널은 localhost iframe 폴백을 그린다.
// browser_open만 오류를 던진다 — 사용자가 방금 누른 동작이라 사유를 화면에 보여줘야 한다.
// 나머지(재배치·표시·탐색·닫기)는 베스트 에포트 — 실패해도 패널이 깨질 일이 없다.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./pty";
import { openInBrowserPanel } from "../state";

export interface BrowserBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 패널 영역 rect → 정수 논리 픽셀 바운드 (CSS px == WebView2 논리 px) */
export function rectBounds(el: HTMLElement): BrowserBounds {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

/** 열기 — 실패 사유(잘못된 주소 등)를 던진다 */
export function browserOpen(url: string, b: BrowserBounds): Promise<void> {
  return invoke("browser_open", { url, ...b });
}

export async function browserBounds(b: BrowserBounds): Promise<void> {
  if (!isTauri()) return;
  await invoke("browser_bounds", { ...b }).catch(() => undefined);
}

export async function browserVisible(visible: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("browser_visible", { visible }).catch(() => undefined);
}

export async function browserNav(action: "back" | "forward" | "reload"): Promise<void> {
  if (!isTauri()) return;
  await invoke("browser_nav", { action }).catch(() => undefined);
}

export async function browserClose(): Promise<void> {
  if (!isTauri()) return;
  await invoke("browser_close").catch(() => undefined);
}

/** `eqmux browser open`(PRD I)이 보낸 열기 요청 — 패널을 브라우저 탭으로 띄우고 주소를 건넨다.
 *  Rust가 웹뷰를 직접 못 여는 이유는 포트 패널과 같다: 바운드는 패널의 DOM 자리에서만 읽힌다. */
export function startBrowserRequests(): void {
  if (!isTauri()) return;
  void listen<{ url: string }>("browser-request", (e) => openInBrowserPanel(e.payload.url));
}

/** 웹뷰 안 탐색 → 주소 바 동기화 (browser-nav 이벤트). 반환은 해제 함수 */
export function onBrowserNav(cb: (url: string) => void): () => void {
  if (!isTauri()) return () => undefined;
  const un = listen<{ url: string }>("browser-nav", (e) => cb(e.payload.url));
  return () => void un.then((f) => f());
}
