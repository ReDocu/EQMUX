// diff 화면 키 (U10·U11·U66) — 맨 ↑↓는 코드 스크롤에 남긴다. 파일 이동은 Alt+↑↓ 또는 [ ],
// 변경 점프 n/p는 수정키가 없을 때만 (Ctrl+N 같은 조합에서 튀지 않게). 입력 필드에서는 양보한다
export type DiffKeyAction = "close" | "next" | "prev" | "fileNext" | "filePrev";

export function diffKeyAction(
  e: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey">,
  inInput: boolean,
): DiffKeyAction | undefined {
  if (inInput) return undefined;
  if (e.ctrlKey || e.metaKey) return undefined;
  if (e.altKey) return e.key === "ArrowDown" ? "fileNext" : e.key === "ArrowUp" ? "filePrev" : undefined;
  switch (e.key) {
    case "Escape":
      return "close";
    case "n":
      return "next";
    case "p":
      return "prev";
    case "]":
      return "fileNext";
    case "[":
      return "filePrev";
  }
  return undefined;
}
