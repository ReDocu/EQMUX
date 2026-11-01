// 플랫폼 갈래 (macOS 지원) — WKWebView(macOS)와 WebView2(Windows)가 갈리는 키·표기·셸 판정을 한곳에 둔다.
// 판정은 navigator.platform 한 번이다. 목 모드(브라우저)도 같은 판정을 따른다 — Safari에서 보면 macOS 화면이다.
// DOM 없는 순수 함수는 인자로 플랫폼을 받아 테스트가 양쪽을 다 겨눈다.

/** platform 문자열이 macOS인가 — "MacIntel"·"MacPPC" 등. iPad 데스크톱 모드도 Mac으로 온다 */
export function macFrom(platform: string): boolean {
  return /^Mac/i.test(platform);
}

/** 이 웹뷰가 macOS인가 — 모듈 로드 때 한 번 정한다 */
export const IS_MAC = typeof navigator !== "undefined" && macFrom(navigator.platform || "");

/** 앱 단축키의 주 수정자가 눌렸는가 — macOS ⌘, 그 밖 Ctrl (U67).
 *  macOS에서 Ctrl은 셸 제어키(SIGINT·forward-char·quoted-insert)라 앱이 가져가지 않는다 (B126) */
export function modDown(e: { ctrlKey: boolean; metaKey: boolean }, mac = IS_MAC): boolean {
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** 한글·일본어 입력기 조합 중의 Enter인가 (B98·B130) — 조합을 끝내는 Enter라 제출하면 마지막 글자가 빠진다.
 *  WKWebView는 조합 확정 keydown에 isComposing을 싣고, WebView2·구형 엔진은 keyCode 229로 온다 */
export function isImeEnter(e: { isComposing?: boolean; keyCode?: number }): boolean {
  return !!e.isComposing || e.keyCode === 229;
}

/** 제출해도 되는 Enter인가 — Enter이고 조합 중이 아닐 때만 (B130) */
export function isSubmitEnter(e: { key: string; isComposing?: boolean; keyCode?: number }): boolean {
  return e.key === "Enter" && !isImeEnter(e);
}

/** 단축키 표기를 플랫폼 관례로 (U67) — 코드·사전의 원문은 Windows 표기(Ctrl+Shift+U)로 두고 macOS에서만 바꾼다.
 *  바인딩과 짝이 맞아야 한다: Ctrl+Shift+글자 → ⌘⇧글자(앱 단축키), Ctrl+Alt+숫자 → ⌘숫자(슬롯 포커스, U69),
 *  Ctrl+Alt+글자 → ⌃⌥글자(진단 표식은 Ctrl+Option 그대로), Ctrl+글자 → ⌘글자(터미널 복사·붙여넣기·검색) */
export function keyLabel(s: string, mac = IS_MAC): string {
  if (!mac || !s.includes("Ctrl+")) return s;
  return s
    .replace(/Ctrl\+Shift\+([A-Z])(?![A-Za-z])/g, "⌘⇧$1")
    .replace(/Ctrl\+Alt\+([1-9](?:~[1-9])?)/g, "⌘$1")
    .replace(/Ctrl\+Alt\+([A-Z])(?![A-Za-z])/g, "⌃⌥$1")
    .replace(/Ctrl\+([A-Z])(?![A-Za-z])/g, "⌘$1");
}
