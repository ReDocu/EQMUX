// 워크스페이스 이름 바꾸기 (S23) — 이름을 더블클릭한 그 자리의 입력칸. 앱 바 탭 · 연결 화면 행 · 관제 카드가 같이 쓴다.
// Enter · 칸 밖 클릭은 저장, Esc는 취소, 비우면 폴더 이름. 폴더는 건드리지 않고 등록 정보의 이름만 바꾼다
import { createSignal, Show } from "solid-js";
import { folderName, renameWorkspace, wsNameAfter } from "../backend/workspaces";
import { t, tErr, tf } from "../i18n";
import { isSubmitEnter } from "../platform"; // 한글 조합 중 Enter는 제출이 아니다 (B130)
import { notify } from "./ui";
import type { Workspace } from "../types";

export function WsNameInput(props: { ws: Workspace; onDone: () => void }) {
  const [draft, setDraft] = createSignal(props.ws.name);
  const next = () => wsNameAfter(draft(), props.ws.path);
  let ended = false; // Enter 뒤 언마운트의 blur가 한 번 더 저장하지 않게
  // 안내 줄은 칸 바로 아래 고정 위치 — 앱 바 탭 줄은 가로 스크롤이라 그 안에 두면 잘린다
  const [at, setAt] = createSignal({ x: 0, y: 0 });
  const end = (save: boolean) => {
    if (ended) return;
    ended = true;
    props.onDone();
    if (save && next() !== props.ws.name)
      renameWorkspace(props.ws.id, draft()).catch((e) => notify(tf("이름을 바꾸지 못했습니다 — {err}", { err: tErr(e) })));
  };
  return (
    // 탭 · 행의 클릭(전환 · 선택)과 더블클릭으로 새지 않게 끊는다
    <span class="ws-rename" onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
      <input
        class="ws-rename-input"
        value={draft()}
        maxLength={64}
        placeholder={folderName(props.ws.path)}
        aria-label={t("워크스페이스 이름")}
        ref={(el) =>
          queueMicrotask(() => {
            el.focus();
            el.select();
            const r = el.getBoundingClientRect();
            setAt({ x: r.left, y: r.bottom + 4 });
          })
        }
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // 탭의 Enter · Space(전환)와 화면 단축키로 새지 않게
          if (isSubmitEnter(e)) {
            e.preventDefault();
            end(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            end(false);
          }
        }}
        onBlur={() => end(true)}
      />
      {/* 저장 전에 한 줄로 — 다른 프로젝트가 이 워크스페이스의 세션을 부르는 주소가 바뀐다 */}
      <Show when={next() !== props.ws.name}>
        <span class="ws-rename-note" role="status" style={{ left: `${at().x}px`, top: `${at().y}px` }}>
          {tf("다른 프로젝트에서 부르는 주소가 바뀝니다 — 이름@{name} · 있는 세션 이름은 그대로입니다", { name: next() })}
        </span>
      </Show>
    </span>
  );
}
