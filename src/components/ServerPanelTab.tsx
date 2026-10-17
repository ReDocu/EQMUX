// 서버 탭 — 워크스페이스마다 dev 서버를 띄워 두는 맨 셸 하나. 에이전트 슬롯을 차지하지 않는다
// (세션 = 에이전트 = 페인 규칙 밖이라 backend 세션 목록에 넣지 않는다). 화면은 TerminalPane을
// 그대로 쓰고, REGISTRY가 id 단위로 살려 두므로 탭을 닫았다 열어도 서버는 계속 돈다.
// 포트 귀속은 Rust ports_snapshot이 PTY Job pid로 하므로 여기서 연 포트는 포트 패널에 "서버"로 뜬다.
import { createEffect, createMemo, createResource, createSignal, onCleanup, Show } from "solid-js";
import {
  clearServerExit,
  isNewPort,
  portEntries,
  refreshPorts,
  serverCommands,
  serverExit,
  serverExited,
  serverTermId,
  sessionPorts,
  watchServerTerm,
} from "../backend/ports";
import { listAlivePty, revealPath, spawnPty, writePty } from "../backend/pty";
import { defaultShell, scopeWorkspace, setPanelNote } from "../state";
import { t, tf } from "../i18n";
import { sessionTermSize, TerminalPane } from "./TerminalPane";
import { Icon } from "./icons";
import { notify } from "./ui";

// 사람이 [서버 터미널 만들기]를 누른 서버 셸 id — 탭을 닫았다 열어도 다시 묻지 않는다
const [opened, setOpened] = createSignal<string[]>([]);

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
  // 셸은 바로 띄우지 않고 권한다 — 누르거나 이미 살아 있을 때만 터미널을 붙인다
  const open = () => opened().includes(id) || !!alive()?.includes(id);

  const reopen = async () => {
    const size = sessionTermSize(id);
    try {
      await spawnPty(id, path, size.cols, size.rows, props.wsId, shell);
      clearServerExit(id);
    } catch (e) {
      notify(tf("서버를 다시 실행하지 못했습니다 — {err}", { err: String(e) }));
    }
  };

  // 세그먼트 줄 오른쪽 요약 (0.5 시안 N4bJu) — 이 워크스페이스 세션 포트 수와 새 포트 수
  createEffect(() => {
    const mine = sessionPorts().filter((e) => e.session?.endsWith(`@${props.wsId}`)); // id 관례 `이름@wsId`
    setPanelNote(tf("포트 {n} · 새 {m}", { n: mine.length, m: mine.filter(isNewPort).length }));
  });
  onCleanup(() => setPanelNote(""));
  const cmd = () => serverCommands()[props.wsId];
  // 이 서버 셸이 연 포트 — 돌고 있으면 [실행]을 끈다. 돌고 있는 서버 위에 명령 줄이 하나 더 들어가지 않게 (B77)
  const running = () => portEntries().filter((e) => e.session === id).map((e) => `:${e.port}`);
  const reveal = async () => {
    if (!(await revealPath(path))) notify(t("폴더를 열 수 없습니다 — 경로가 없어졌습니다"));
  };

  return (
    <div class="srvp">
      {/* 명령 줄 (시안) — 마지막 서버 명령 · 실행/다시 실행 · 탐색기. 자동으로 치지 않는다 (1-7) */}
      <div class="srvp-cmd">
        <div class="srvp-cmd-box mono" classList={{ empty: !cmd() }} title={cmd() ?? undefined}>
          {cmd() ?? t("마지막 서버 명령 없음 — 이 셸에서 포트를 연 명령을 기억합니다")}
        </div>
        <Show
          when={serverExited(id)}
          fallback={
            <Show
              when={running().length === 0}
              fallback={
                <button class="btn" disabled title={t("이 셸의 서버가 포트를 열고 있습니다 — 멈춘 뒤 다시 실행할 수 있습니다")}>
                  {tf("돌고 있음 · 포트 {ports}", { ports: running().join(" ") })}
                </button>
              }
            >
              <button
                class="btn primary"
                disabled={!cmd() || !open()}
                title={t("셸에 마지막 서버 명령을 입력합니다")}
                onClick={() => writePty(id, `${cmd()}\r`)}
              >
                <Icon name="play" size={12} />
                {t("실행")}
              </button>
            </Show>
          }
        >
          {/* 셸만 다시 연다 — 서버 명령은 [실행]으로 사람이 친다 (자동 실행 금지, U39) */}
          <button class="btn primary" onClick={() => void reopen()}>
            {t("↻ 셸 다시 열기")}
          </button>
        </Show>
        {/* 포트는 자동으로 다시 보지 않는다 — 서버를 띄우거나 멈춘 뒤 여기서 실측한다 */}
        <button class="btn" onClick={refreshPorts} title={t("다시 실측")} aria-label={t("다시 실측")}>
          <Icon name="refresh-cw" size={12} />
        </button>
        <button class="btn" disabled={!path} onClick={() => void reveal()}>
          <Icon name="folder-open" size={12} />
          {t("탐색기")}
        </button>
      </div>
      <Show when={serverExited(id)}>
        <div class="srvp-state">
          <span class="srvp-state-dot" />
          {tf("종료됨 (exit {code})", { code: serverExit(id) ?? "?" })}
        </div>
      </Show>
      <Show when={alive()}>
        {(list) => (
          <Show
            when={open()}
            fallback={
              <div class="srvp-empty">
                <span class="muted">{t("dev 서버를 띄울 셸이 아직 없습니다")}</span>
                <button class="btn primary" onClick={() => setOpened((l) => [...l, id])}>
                  <Icon name="play" size={12} />
                  {t("서버 터미널 만들기")}
                </button>
              </div>
            }
          >
            <TerminalPane sessionId={id} cwd={path} wsId={props.wsId} shell={shell} revive={list().includes(id)} />
          </Show>
        )}
      </Show>
    </div>
  );
}
