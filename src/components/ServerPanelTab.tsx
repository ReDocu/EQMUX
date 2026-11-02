// 서버 탭 — 워크스페이스마다 dev 서버를 띄워 두는 맨 셸 하나. 에이전트 슬롯을 차지하지 않는다
// (세션 = 에이전트 = 페인 규칙 밖이라 backend 세션 목록에 넣지 않는다). 화면은 TerminalPane을
// 그대로 쓰고, REGISTRY가 id 단위로 살려 두므로 탭을 닫았다 열어도 서버는 계속 돈다.
// 포트 귀속은 Rust ports_snapshot이 PTY Job pid로 하므로 여기서 연 포트는 포트 패널에 "서버"로 뜬다.
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  clearServerExit,
  COMMANDS_FILE,
  parseCommands,
  portRanges,
  isNewPort,
  portEntries,
  refreshPorts,
  serverCommands,
  serverExit,
  serverExited,
  serverTermId,
  sessionPorts,
  typeServer,
  watchServerTerm,
} from "../backend/ports";
import { fsCreate, fsRead, fsWrite } from "../backend/panels";
import { isTauri, listAlivePty, revealPath, spawnPty } from "../backend/pty";
import { defaultShell, scopeWorkspace, setPanelNote } from "../state";
import { t, tf } from "../i18n";
import { fileManagerName } from "../labels"; // mac은 Finder (U76)
import { sessionTermSize, TerminalPane } from "./TerminalPane";
import { Icon } from "./icons";
import { notify } from "./ui";

// 사람이 [서버 터미널 만들기]를 누른 서버 셸 id — 탭을 닫았다 열어도 다시 묻지 않는다
const [opened, setOpened] = createSignal<string[]>([]);
/** 다른 탭이 서버 터미널을 대신 연다 — 확장 › MCP [명령 채우기] (P68). 탭이 그려질 때 셸이 뜬다 */
export const openServerTerm = (wsId: string) => setOpened((l) => (l.includes(serverTermId(wsId)) ? l : [...l, serverTermId(wsId)]));

export function ServerPanelTab() {
  // id 문자열로 키를 잡는다 — 워크스페이스가 바뀔 때만 페인을 갈아 끼운다
  const wsId = createMemo(() => scopeWorkspace()?.id);
  // 탭을 열면 한 번 실측한다 (B145·U91) — 다른 곳에서 띄운 서버도 '실행 중 :포트'·[실행]에 반영되게
  onMount(refreshPorts);
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
  // 저장 명령 (D2 · C7) — 파일이 없으면 만들기 안내 한 줄 (P63). [다시 읽기]가 같이 다시 읽는다.
  // 있는데 못 읽은 것(UTF-16 등)은 숨기지 않고 경고 칸에 사유를 보인다 (B191). "대상 없음"만 '파일 없음'이다
  const [saved, { refetch: reloadSaved }] = createResource(
    () => isTauri() && path,
    (p) =>
      fsRead(p, COMMANDS_FILE).then(
        (c) => parseCommands(c.text),
        (e) => (/없음$/.test(String(e)) ? null : { commands: [], skipped: 0, error: String(e) }),
      ),
  );
  /** 파일을 만든다 — 마지막 서버 명령이 있으면 그것을 첫 항목으로 (P63) */
  const createSaved = async () => {
    try {
      await fsCreate(path, "", ".eqmux", true).catch(() => {}); // 폴더가 이미 있으면 그대로 쓴다
      await fsCreate(path, ".eqmux", "commands.json", false);
      const doc = { version: 1, commands: [{ name: "dev", run: cmd() ?? "npm run dev", kind: "server" }] };
      await fsWrite(path, COMMANDS_FILE, JSON.stringify(doc, null, 2) + "\n");
      notify(tf("{f}을(를) 만들었습니다 — 파일 탭에서 고치세요", { f: COMMANDS_FILE }), "ok");
    } catch (e) {
      notify(String(e));
    }
    void reloadSaved();
  };
  /** 버튼이 꺼진 이유 — 셸 없음 · 종료됨 · 서버가 돌고 있음 (P63) */
  const blocked = () =>
    !open()
      ? t("서버 터미널을 먼저 만드세요")
      : serverExited(id)
        ? t("셸이 끝났습니다 — [셸 다시 열기]를 누르세요")
        : running().length > 0
          ? t("이 셸의 서버가 포트를 열고 있습니다 — 멈춘 뒤 다시 실행할 수 있습니다")
          : undefined;
  // 세션별 포트 범위 (§4) — 이 워크스페이스 세션 것만. [포트 다시 실측]이 같이 다시 읽는다
  const [ranges, { refetch: reloadRanges }] = createResource(async () =>
    (await portRanges()).filter((r) => r.session.endsWith(`@${props.wsId}`)),
  );
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
                title={blocked() ?? t("셸에 마지막 서버 명령을 입력합니다")}
                onClick={() => typeServer(id, `${cmd()}\r`)}
              >
                <Icon name="play" size={12} />
                {t("실행")}
              </button>
            </Show>
          }
        >
          {/* 셸만 다시 연다 — 서버 명령은 [실행]으로 사람이 친다 (자동 실행 금지, U39) */}
          <button class="btn primary" onClick={() => void reopen()}>
            <Icon name="refresh-cw" size={12} />
            {t("셸 다시 열기")}
          </button>
        </Show>
        {/* 포트는 탭을 열 때와 서버 셸에 명령을 친 몇 초 뒤에 다시 본다 (B145) — 그 밖에는 여기서 실측한다 */}
        <button
          class="btn"
          onClick={() => {
            refreshPorts();
            void reloadSaved();
            void reloadRanges();
          }}
          title={t("포트 · 저장 명령 다시 읽기")} aria-label={t("포트 · 저장 명령 다시 읽기")}>
          <Icon name="refresh-cw" size={12} />
        </button>
        <button class="btn" disabled={!path} onClick={() => void reveal()}>
          <Icon name="folder-open" size={12} />
          {fileManagerName()}
        </button>
      </div>
      <Show when={saved() === null}>
        <div class="srvp-saved muted">
          <span>{t("자주 쓰는 명령을 저장해 두면 버튼이 됩니다")}</span>
          <button class="btn ghost" title={COMMANDS_FILE} onClick={() => void createSaved()}>
            {t("commands.json 만들기")}
          </button>
        </div>
      </Show>
      <Show when={saved()}>
        {(r) => (
          <div class="srvp-saved">
            <span class="muted mono" title={COMMANDS_FILE}>
              {t("저장 명령")}
            </span>
            {/* 클론한 저장소의 파일이다 — 입력줄에 채우기만 하고 Enter는 사람이 친다 (U145). 무엇이 들어가는지 셸에서 보인다 */}
            <For each={r().commands}>
              {(c) => (
                <button
                  class="btn"
                  classList={{ primary: c.kind === "server" }}
                  disabled={!!blocked()}
                  title={blocked() ?? tf("셸 입력줄에 채웁니다 — Enter는 직접 누르세요: {run}", { run: c.run })}
                  onClick={() => typeServer(id, c.run)}
                >
                  {c.name}
                </button>
              )}
            </For>
            <Show when={r().error || r().skipped > 0}>
              <span class="srvp-saved-warn" title={r().error}>
                {r().error
                  ? tf("{f}을(를) 읽지 못했습니다 — {err}", { f: COMMANDS_FILE, err: t(r().error!) }) // 'commands 배열이 없습니다'만 사전에 있다 (U163)
                  : tf("쓸 수 없는 항목 {n}개를 건너뛰었습니다", { n: r().skipped })}
              </span>
            </Show>
          </div>
        )}
      </Show>
      <Show when={(ranges() ?? []).length > 0}>
        <div class="srvp-saved muted" title={t("세션마다 EQMUX_PORT_BASE ~ EQMUX_PORT_END로 알립니다 — 강제하지는 않습니다")}>
          <span class="mono">{t("세션 포트 범위")}</span>
          <For each={ranges()}>
            {(r) => (
              <span class="mono">
                {r.session.split("@")[0]} {r.base}–{r.end}
              </span>
            )}
          </For>
        </div>
      </Show>
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
