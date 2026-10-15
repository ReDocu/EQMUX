// 서버 탭 — 워크스페이스마다 dev 서버를 띄워 두는 맨 셸 하나. 에이전트 슬롯을 차지하지 않는다
// (세션 = 에이전트 = 페인 규칙 밖이라 backend 세션 목록에 넣지 않는다). 화면은 TerminalPane을
// 그대로 쓰고, REGISTRY가 id 단위로 살려 두므로 탭을 닫았다 열어도 서버는 계속 돈다.
// 포트 귀속은 Rust ports_snapshot이 PTY Job pid로 하므로 여기서 연 포트는 포트 패널에 "서버"로 뜬다.
import { createMemo, createResource, Show } from "solid-js";
import { clearServerExit, serverCommands, serverExit, serverExited, serverTermId, watchServerTerm } from "../backend/ports";
import { listAlivePty, spawnPty, writePty } from "../backend/pty";
import { defaultShell, scopeWorkspace } from "../state";
import { t, tf } from "../i18n";
import { sessionTermSize, TerminalPane } from "./TerminalPane";
import { notify } from "./ui";

export function ServerPanelTab() {
  // id 문자열로 키를 잡는다 — 워크스페이스가 바뀔 때만 페인을 갈아 끼운다
  const wsId = createMemo(() => scopeWorkspace()?.id);
  return (
    <Show when={wsId()} keyed fallback={<div class="muted">{t("워크스페이스를 먼저 여세요")}</div>}>
      {(id) => <ServerTerm wsId={id} />}
    </Show>
  );
}

function ServerTerm(props: { wsId: string }) {
  const id = serverTermId(props.wsId);
  const path = scopeWorkspace()?.path ?? "";
  const shell = defaultShell().cmd;
  watchServerTerm(id); // 종료 기억은 모듈이 한다 (BR-03) — 탭을 떠나 있어도 잡힌다
  // 웹뷰 재시작 뒤에는 PTY가 Rust에 살아 있다 — 새로 띄우지 않고 붙는다 (BR-06).
  // 이미 그려 둔 터미널(REGISTRY)이 있으면 TerminalPane이 revive를 보지 않으므로 탭 전환에는 영향이 없다
  const [alive] = createResource(() => listAlivePty());

  const reopen = async () => {
    const size = sessionTermSize(id);
    try {
      await spawnPty(id, path, size.cols, size.rows, props.wsId, shell);
      clearServerExit(id);
    } catch (e) {
      notify(tf("서버를 다시 실행하지 못했습니다 — {err}", { err: String(e) }));
    }
  };

  return (
    <div style={{ display: "flex", "flex-direction": "column", flex: 1, "min-height": 0 }}>
      <div class="panel-head-row">
        <span class="panel-title">{t("서버")}</span>
        {/* 마지막 서버 명령 (1-7) — 자동으로 치지 않는다. 사람이 누를 때만 셸에 그 줄을 넣는다 */}
        <Show when={!serverExited(id) && serverCommands()[props.wsId]}>
          {(cmd) => (
            <button
              class="btn ghost mono"
              title={t("셸에 마지막 서버 명령을 입력합니다 — 이미 서버가 돌고 있으면 누르지 마세요")}
              onClick={() => writePty(id, `${cmd()}\r`)}
            >
              ▶ {cmd()}
            </button>
          )}
        </Show>
        <Show when={serverExited(id)}>
          <span class="muted mono" style={{ "font-size": "11px" }}>
            {tf("종료됨 (exit {code})", { code: serverExit(id) ?? "?" })}
          </span>
          <button class="btn ghost" onClick={() => void reopen()}>
            {t("↻ 다시 실행")}
          </button>
        </Show>
      </div>
      <Show when={alive()}>
        {(list) => (
          <TerminalPane sessionId={id} cwd={path} wsId={props.wsId} shell={shell} revive={list().includes(id)} />
        )}
      </Show>
    </div>
  );
}
