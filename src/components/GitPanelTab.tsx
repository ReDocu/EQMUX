// git 패널 (PAlmZ) — 타이틀바 + 저장소·브랜치 툴바 + 커밋 그래프.
// Tauri에서는 활성 워크스페이스의 저장소를 실측한다 (PRD H). 브랜치는 표시만 한다.
// §17 G7′ — pull · push는 누르면 실행한다(허용 목록 · pull은 §4-1 작업 중 경고). commit은
// git 화면(스테이징 · 메시지)을 연다. 버튼 우클릭 = [명령 복사] — 터미널에서 직접 칠 수도 있다.
// UI 리파인 §git: 카드 스택 → 한 줄 툴바 · 밀도 높은 커밋 행(뱃지 복수 + 우측 메타) ·
// 커밋 행 클릭 = 부모 커밋 ↔ 이 커밋 diff.
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { commandLine, commitWebUrl, failText, gitOverview, gitRefs, gitRun, remoteWebUrl, withHeadNotice } from "../backend/git";
import type { GitOverview } from "../backend/git";
import { GIT_STATE, backend } from "../backend/mock";
import { clipWriteText, isTauri, revealPath } from "../backend/pty";
import { openLink } from "../backend/browser";
import { t, tf } from "../i18n";
import { pushLayer, scopeWorkspace, setPanelNote, setPanelOpen, setView, tick, view } from "../state";
import { Icon } from "./icons";
import { ConfirmDialog, ContextMenu, Eyebrow, notify } from "./ui";
import { sessionDisplayName } from "../types";
import { guardSessions, guardWorsened, pushArgs, workGuard } from "../screens/gitWrite";

interface CommitRow {
  hash: string;
  message: string;
  author: string;
  when: string;
  badges: string[];
}

/** refs 장식("HEAD -> main, origin/main, tag: v1")을 뱃지 목록으로 — 레퍼런스처럼 복수 표시, 3개까지 */
function refBadges(refs: string): string[] {
  return refs
    .split(",")
    .map((s) => s.trim().replace(/^HEAD -> /, ""))
    .filter((s) => s && s !== "HEAD")
    .slice(0, 3);
}

export function GitPanelTab() {
  // 스코프 = 현재 워크스페이스 문맥 (state.scopeWorkspace — 대화·임무 탐색기와 같은 단일 소스)
  const ws = () => {
    const scoped = scopeWorkspace();
    return scoped && !scoped.pathMissing ? scoped : undefined;
  };

  // 10초 폴링이 같은 값을 다시 주면 알리지 않는다 (CPU·RAM C5) — 새 객체마다 커밋 행이 전부 다시 만들어졌다
  const [real, setReal] = createSignal<GitOverview | undefined>(undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const [failed, setFailed] = createSignal(false);

  let loadReq = 0; // 워크스페이스 전환·10초 폴링의 늦은 응답이 현재 저장소 표시를 덮지 않게
  const load = async () => {
    const target = ws();
    if (!target || target.pathMissing) {
      setReal(undefined);
      setFailed(false); // 스코프 없음은 읽기 실패가 아니다 — 이전 워크스페이스의 실패 표시를 지운다
      return;
    }
    const req = ++loadReq;
    const o = await gitOverview(target.path);
    if (req !== loadReq) return; // 그새 워크스페이스가 바뀌었다
    setReal(o);
    setFailed(o === undefined);
  };

  onMount(() => {
    if (!isTauri()) return;
    createEffect(on(createMemo(() => ws()?.id), () => void load())); // 메모 — on()은 같은 값에도 돌아 방송마다 git을 다시 띄웠다 (B249 계열)
    // 숨김 중 쉰다 (CPU 점검 2) — 한 번에 git 5개를 띄우는 호출이다. 다시 보이면 다음 틱(≤10초)에 따라잡는다
    const t = setInterval(() => !document.hidden && void load(), 10_000);
    onCleanup(() => clearInterval(t));
  });

  // 실측/목 폴백 공용 뷰모델 — 화면은 이것만 본다. 메모 (C5) — 렌더 한 번에 20여 곳·커밋 행마다 불린다
  const g = createMemo(() => {
    const r = real();
    if (isTauri() && r) {
      return {
        repo: ws()?.name ?? "—",
        branch: r.branch,
        ahead: r.ahead,
        behind: r.behind,
        changed: r.changed,
        added: r.added,
        modified: r.modified,
        deleted: r.deleted,
        commits: r.commits.map<CommitRow>((c) => ({ ...c, badges: refBadges(c.refs) })),
        real: true,
      };
    }
    if (isTauri()) {
      // 워크스페이스 문맥 없음 · 읽기 실패 — 목 데이터를 실물처럼 보여주지 않는다 (빈 상태가 정직하다)
      return {
        repo: ws()?.name ?? "—",
        branch: "—",
        ahead: 0,
        behind: 0,
        changed: 0,
        added: 0,
        modified: 0,
        deleted: 0,
        commits: [] as CommitRow[],
        real: true,
      };
    }
    // 목 모드 (U166) — GIT_STATE는 Academy 하나뿐이다. 머리 줄 이름 · 브랜치는 지금 워크스페이스 것을 쓴다
    return {
      repo: ws()?.name ?? GIT_STATE.repo,
      branch: ws()?.branch ?? GIT_STATE.branch,
      ahead: GIT_STATE.ahead,
      behind: GIT_STATE.behind,
      changed: GIT_STATE.changed,
      added: GIT_STATE.added,
      modified: GIT_STATE.modified,
      deleted: GIT_STATE.deleted,
      commits: GIT_STATE.commits.map<CommitRow>((c) => ({ ...c, badges: c.tag ? [c.tag] : [] })),
      real: false,
    };
  });

  // 세그먼트 줄 오른쪽 요약 (0.5 시안) — `sub_main · ↑2 ↓0`
  createEffect(() => {
    const v = g();
    setPanelNote(`${v.branch} · ↑${v.ahead} ↓${v.behind}${v.real ? "" : ` · ${t("목 데이터")}`}`);
  });
  onCleanup(() => setPanelNote(""));
  const reveal = async () => {
    const w = ws();
    if (w && !(await revealPath(w.path))) notify(t("폴더를 열 수 없습니다 — 경로가 없어졌습니다"));
  };

  const openDiff = () => {
    // 진입 시점 뷰를 기억한다 — diff의 ✕/Esc가 관제 센터가 아니라 여기로 복귀한다 (U11)
    const cur = view();
    setView({ kind: "gitdiff", wsId: ws()?.id, back: cur.kind === "gitdiff" ? cur.back : cur });
    setPanelOpen(false);
  };

  /** 커밋 행 클릭 (UI 리파인 §git) — 부모 커밋 ↔ 이 커밋 비교로 진입. 복귀 규칙은 openDiff와 동일 (U11) */
  const openCommitDiff = (c: Pick<CommitRow, "hash" | "message">) => {
    const cur = view();
    setView({
      kind: "gitdiff",
      wsId: ws()?.id,
      commit: { hash: c.hash, message: c.message },
      back: cur.kind === "gitdiff" ? cur.back : cur,
    });
    setPanelOpen(false);
  };

  /** git 화면 열기 (§17) — 진입 시점 뷰를 기억해 ✕/Esc가 여기로 돌아온다 (diff와 같은 규칙) */
  const openGitScreen = () => {
    const cur = view();
    setView({ kind: "git", wsId: ws()?.id, back: cur.kind === "git" ? cur.back : cur });
    setPanelOpen(false);
  };

  // ── pull · push 버튼 (§17 G7′) — 누르면 실행. pull은 §4-1 작업 중 경고를 거친다 ──
  const [actNote, setActNote] = createSignal<string | undefined>(undefined);
  const [authFail, setAuthFail] = createSignal(false);
  // 실행 중인 워크스페이스 id들 (B240) — A에서 시작한 push가 B의 버튼을 잠그지 않는다
  const [runningIn, setRunningIn] = createSignal<string[]>([]);
  const running = () => !!ws() && runningIn().includes(ws()!.id);
  // B240 — 워크스페이스를 바꾸면 이전 저장소의 개요 · 실행 결과 줄을 바로 지운다 (새 응답까지 A의 커밋이 B 이름 아래 남았다)
  createEffect(on(createMemo(() => ws()?.id), () => batch(() => (setReal(undefined), setActNote(undefined), setAuthFail(false))), { defer: true }));
  const [guardAsk, setGuardAsk] = createSignal<{ level: "busy" | "waiting"; names: string[] } | undefined>();
  const runCmd = async (args: string[]) => {
    const w = ws();
    if (!w || runningIn().includes(w.id)) return;
    setRunningIn([...runningIn(), w.id]);
    batch(() => (setActNote(tf("실행 중 — {cmd}", { cmd: commandLine(args) })), setAuthFail(false)));
    // 바뀐 뒤 알림 (§17-3 · B175) — git 화면과 같은 설정 · 같은 HEAD 해시 비교. push는 HEAD를 안 바꿔 알림이 안 간다
    const r = await withHeadNotice(w.id, w.path, () => gitRun(w.id, w.path, args));
    setRunningIn(runningIn().filter((x) => x !== w.id));
    if (ws()?.id !== w.id) return; // 그새 다른 워크스페이스로 갔다 — 결과는 실행 로그에만 (B240)
    batch(() => {
      setAuthFail(r.auth);
      setActNote(
        r.ok
          ? tf("{cmd} 완료", { cmd: r.command })
          : r.auth
            ? t("로그인이 필요합니다 — 터미널에서 `git fetch`를 한 번 실행해 로그인하세요")
            : `${r.command} — ${failText(r.output)}`,
      );
    });
    void load();
  };
  /** B180 — git 화면과 같은 push: 업스트림 없는 새 브랜치면 `push -u <원격> <브랜치>` */
  const push = async () => {
    const w = ws();
    if (w) void runCmd(pushArgs(await gitRefs(w.path)));
  };
  const guardNames = () => {
    const w = ws();
    if (!w) return [];
    return guardSessions(backend.listSessions(), w.id).map(
      (s) =>
        `${sessionDisplayName(s, backend.listPersonas().find((p) => p.id === s.personaId)?.name ?? s.id)} · ${t(s.status === "waiting" ? "승인 대기" : "작업 중")}`,
    );
  };
  const PULL = ["pull", "--ff-only"];
  const pull = () => {
    const w = ws();
    if (!w) return;
    const g = workGuard(backend.listSessions(), w.id);
    if (g.level === "none") return void runCmd(PULL);
    setGuardAsk({ level: g.level, names: guardNames() });
  };
  /** 버튼 우클릭 = [명령 복사] (§17-4) */
  const [copyMenuAt, setCopyMenu] = createSignal<{ x: number; y: number; cmd: string } | undefined>();
  const copyMenu = (args: string[]) => (e: MouseEvent) => {
    e.preventDefault();
    setCopyMenu({ x: e.clientX, y: e.clientY, cmd: commandLine(args) });
  };

  // ── 저장소 드롭다운 (UI 리파인 §git) — 워크스페이스 전환 = 패널 스코프 전환 ──
  const [repoMenu, setRepoMenu] = createSignal(false);
  let repoWrap!: HTMLDivElement;
  createEffect(() => {
    if (!repoMenu()) return;
    const off = pushLayer(() => setRepoMenu(false)); // Esc (U162)
    const down = (e: MouseEvent) => !repoWrap.contains(e.target as Node) && setRepoMenu(false);
    document.addEventListener("mousedown", down);
    onCleanup(() => (off(), document.removeEventListener("mousedown", down)));
  });
  const repoChoices = () => {
    tick();
    return backend.listWorkspaces().filter((w) => !w.pathMissing);
  };

  // 커밋 행 우클릭 메뉴 (UI 리파인 §06)
  const [cmMenu, setCmMenu] = createSignal<{ x: number; y: number; c: CommitRow } | undefined>(undefined);

  return (
    <div class="gitp">
      <Show when={isTauri() && (failed() || !ws())}>
        <div class="card conn-error mono" style={{ "font-size": "11px" }}>
          {t(ws() ? "저장소를 읽을 수 없습니다 — git 저장소가 아니거나 git CLI가 없습니다" : "워크스페이스 문맥이 없습니다 — 워크스페이스 탭을 먼저 여세요")}
        </div>
      </Show>

      {/* 머리 줄 (0.5 시안 AYgJv) — 저장소 드롭다운 · 원격 저장소 · 탐색기 · 새로 읽기.
          저장소 선택 = 그 워크스페이스로 전환 (스코프 단일 소스 유지) */}
      <div class="gitp-head">
      <div class="gitp-repo-wrap" ref={repoWrap}>
        <button
          class="card inset gitp-repo mono"
          style={{ cursor: "pointer" }}
          title={ws()?.path ?? t("저장소 = 활성 워크스페이스")}
          aria-haspopup="listbox"
          aria-expanded={repoMenu()}
          onClick={() => setRepoMenu(!repoMenu())}
        >
          <span class="gitp-repo-name">{ws() ? `${g().repo} · ${ws()!.path}` : g().repo}</span>
          <Icon name="chevron-down" size={12} class="muted" />
        </button>
        <Show when={repoMenu()}>
          <div class="card gitp-pop">
            <For each={repoChoices()}>
              {(w) => (
                <button
                  class="btn ghost mono"
                  style={{ "justify-content": "flex-start", "font-size": "11px", padding: "2px 6px", display: "flex", gap: "6px" }}
                  title={w.path}
                  onClick={() => {
                    setRepoMenu(false);
                    if (w.id !== ws()?.id) setView({ kind: "workspace", id: w.id });
                  }}
                >
                  <span>{w.id === ws()?.id ? "●" : "○"}</span>
                  <span style={{ flex: 1, "text-align": "left" }}>{w.name}</span>
                </button>
              )}
            </For>
            <div class="muted" style={{ "font-size": "10px" }}>
              {t("저장소 선택 = 워크스페이스 전환 — 패널 스코프가 함께 바뀝니다")}
            </div>
          </div>
        </Show>
      </div>
        {/* 원격 저장소 (0.5 바로 가기) — 웹 주소로 못 바꾸는 원격(로컬 경로·없음)이면 숨긴다 */}
        <Show when={remoteWebUrl(ws()?.remote)}>
          {(web) => (
            <button class="btn" title={web()} onClick={() => openLink(web())}>
              <Icon name="external-link" size={12} />
              {t("원격 저장소")}
            </button>
          )}
        </Show>
        <button class="btn" disabled={!ws()} onClick={() => void reveal()}>
          <Icon name="folder-open" size={12} />
          {t("탐색기")}
        </button>
        <button class="btn ghost gitp-refresh" title={t("새로 읽기")} aria-label={t("새로 읽기")} onClick={() => void load()}>
          <Icon name="refresh-cw" size={12} />
        </button>
      </div>
      {/* 원격 주소 — 토큰·사용자 정보를 뗀 주소만 (시안의 `origin:` 한 줄) */}
      <Show when={ws()?.remote}>
        {(r) => <div class="gitp-remote-hint mono">origin: {remoteWebUrl(r()) ?? r()}</div>}
      </Show>

      {/* 한 줄 툴바 (UI 리파인 §git) — 브랜치 · ↑↓ · Pull · Commit · Push.
          Pull · Push는 누르면 실행(§17 G7′ · git 화면과 같은 인자), Commit은 git 화면을 연다. 우클릭 = 명령 복사 */}
      <div class="gitp-toolbar">
        <div class="gitp-branch-wrap">
          <div class="card inset gitp-branch mono">
            <span class="gitp-branch-name">⎇ {g().branch}</span>
          </div>
        </div>
        <span class="mono gitp-sync" title={t("업스트림 대비 ahead / behind")}>
          <span class="st-waiting">↑{g().ahead}</span> <span class="muted">↓{g().behind}</span>
        </span>
        <span style={{ flex: 1 }} />
        {/* diff는 목록 아래 "변경 N건 diff" 막대가 맡는다 (0.5 시안) — 툴바에서 빼야 한 줄에 들어간다 */}
        <button
          class="gitp-act mono"
          disabled={!ws() || running()}
          title={t("git pull --ff-only 실행 — 우클릭: 명령 복사")}
          onClick={pull}
          onContextMenu={copyMenu(PULL)}
        >
          ↓ {t("Pull")}
        </button>
        <button class="gitp-act mono" disabled={!ws()} title={t("git 화면에서 스테이지하고 커밋합니다")} onClick={openGitScreen}>
          {t("Commit")}
        </button>
        <button
          class="gitp-act mono"
          disabled={!ws() || running()}
          title={t("git push 실행 — 업스트림이 없으면 -u로 올립니다 · 우클릭: 명령 복사")}
          onClick={() => void push()}
          onContextMenu={copyMenu(["push"])}
        >
          ↑ {t("Push")}
          <Show when={g().ahead > 0}>
            <span class="n">{g().ahead}</span>
          </Show>
        </button>
      </div>
      {/* 변경 요약 (0.5 시안 · U165) — 합계 = 추가 + 수정 + 삭제. 키는 git 패널 고유 키다 (B241 — '수정'은 역할 묶음 'Fixes') */}
      <div class="gitp-sum">
        <div class="gitp-sum-tile" title={t("추가 + 수정 + 삭제 — 추적 안 된 파일은 추가, 이름 바꾸기는 수정으로 셉니다")}>
          <span>{t("변경 합계")}</span>
          <b class="mono" style={{ color: "var(--eq-amber)" }}>{g().changed}</b>
        </div>
        <div class="gitp-sum-tile">
          <span>{t("더한 파일")}</span>
          <b class="mono" style={{ color: "var(--eq-purple)" }}>{g().added}</b>
        </div>
        <div class="gitp-sum-tile">
          <span>{t("고친 파일")}</span>
          <b class="mono">{g().modified}</b>
        </div>
        <div class="gitp-sum-tile">
          <span>{t("지운 파일")}</span>
          <b class="mono">{g().deleted}</b>
        </div>
      </div>

      {/* 실행 결과 — 한 줄 */}
      <Show when={actNote()}>
        <div class="mono muted" style={{ "font-size": "10px" }}>
          {actNote()}
          <Show when={authFail()}>
            {" "}
            <button class="btn ghost" style={{ "font-size": "10px", padding: "0 4px" }} onClick={() => void clipWriteText("git fetch")}>
              {t("`git fetch` 복사")}
            </button>
          </Show>
        </div>
      </Show>

      <Eyebrow>{t("커밋 그래프")}</Eyebrow>
      {/* 밀도 높은 커밋 행 (UI 리파인 §git) — 뱃지+메시지 왼쪽 · 작성자·시간·해시 오른쪽 한 줄.
          클릭 = 부모 커밋 ↔ 이 커밋 diff */}
      <div class="gitp-commits">
        <For each={g().commits}>
          {(c, i) => (
            <div
              class="gitp-commit"
              role="button"
              tabIndex={0}
              title={tf("{msg} — 클릭: 부모 커밋과 나란히 비교(diff)", { msg: c.message })}
              onClick={() => openCommitDiff(c)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                openCommitDiff(c);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setCmMenu({ x: e.clientX, y: e.clientY, c });
              }}
            >
              <div class="gitp-graph">
                <div class="gitp-line" classList={{ first: i() === 0, last: i() === g().commits.length - 1 }} />
                <div class="gitp-dot" />
              </div>
              <span class="gitp-commit-hash mono">{c.hash}</span>
              <div class="gitp-commit-main">
                <div class="gitp-commit-top">
                  <span class="gitp-commit-txt">{c.message}</span>
                  <For each={c.badges}>
                    {(b) => (
                      <span class="gitp-ref mono" classList={{ remote: b.includes("/") }}>
                        {b}
                      </span>
                    )}
                  </For>
                </div>
                <div class="gitp-commit-meta mono">
                  {c.author} · {c.when}
                </div>
              </div>
            </div>
          )}
        </For>
        <Show when={g().commits.length === 0}>
          <div class="muted" style={{ "font-size": "11px", padding: "8px" }}>
            {t("커밋이 없습니다")}
          </div>
        </Show>
      </div>
      <button class="gitp-diff-bar" disabled={!ws()} onClick={openDiff}>
        <span>{tf("변경 {n}건 · diff 보기", { n: g().changed })}</span>
        <Icon name="arrow-right" size={12} />
      </button>

      <button class="gitp-diff-bar" disabled={!ws()} onClick={openGitScreen}>
        <span>{t("git 화면 열기 — 그래프 · 브랜치 · 스테이징")}</span>
        <Icon name="arrow-right" size={12} />
      </button>

      {/* 정책 고지 1회 — G7′. 사람이 누를 때만 실행한다 */}
      <div class="gitp-foot mono muted">{t("누를 때만 실행 · Pull은 --ff-only · 우클릭하면 명령 복사")}</div>

      <Show when={guardAsk()}>
        {(a) => (
          <ConfirmDialog
            title={a().level === "busy" ? t("에이전트가 작업 중입니다") : t("승인을 기다리는 에이전트가 있습니다")}
            body={<p>{t("이 폴더의 모든 세션 발밑 파일이 바뀝니다.")}</p>}
            info={[commandLine(PULL), ...a().names]}
            danger={a().level === "busy"}
            confirmLabel={t("그래도 실행")}
            onCancel={() => setGuardAsk(undefined)}
            onConfirm={() => {
              const before = a().level;
              setGuardAsk(undefined);
              const w = ws();
              const now = w ? workGuard(backend.listSessions(), w.id) : undefined;
              // 확인창이 떠 있는 사이 더 나빠졌으면 다시 묻는다 (§4-1 경쟁 조건)
              if (now && now.level !== "none" && guardWorsened(before, now.level)) setGuardAsk({ level: now.level, names: guardNames() });
              else void runCmd(PULL);
            }}
          />
        )}
      </Show>
      <Show when={copyMenuAt()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            onClose={() => setCopyMenu(undefined)}
            groups={[[{ label: tf("명령 복사 — {cmd}", { cmd: m().cmd }), action: () => void clipWriteText(m().cmd) }]]}
          />
        )}
      </Show>

      <Show when={cmMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            header={`${m().c.hash}${m().c.badges[0] ? ` · ${m().c.badges[0]}` : ""}`}
            onClose={() => setCmMenu(undefined)}
            groups={[
              [
                { label: t("해시 복사"), action: () => clipWriteText(m().c.hash) },
                { label: t("메시지 복사"), action: () => clipWriteText(m().c.message) },
                // 원격에서 보기 (0.5) — GitHub·GitLab·Bitbucket만. 푸시 안 한 커밋은 404일 수 있다
                ...((url) =>
                  url
                    ? [{ label: t("원격에서 보기 (푸시 안 한 커밋은 없을 수 있음)"), action: () => openLink(url) }]
                    : [])(commitWebUrl(ws()?.remote, m().c.hash)),
              ],
              [
                // 커밋 기준 diff (UI 리파인 §git) — 행 클릭과 같은 동작. B11의 "워크트리 비교만"은 여기서 풀렸다
                { label: t("부모 커밋과 비교 (diff)"), action: () => openCommitDiff(m().c) },
                { label: t("워크트리 diff 열기"), action: openDiff },
                { label: t("git 화면 열기"), action: openGitScreen },
              ],
              // 메뉴에 없는 것은 git 화면에 있다 — 이 메뉴는 보기 · 복사만
              [{ label: t("브랜치 · 태그 · merge · rebase · cherry-pick · revert · reset은 git 화면에서"), note: true }],
            ]}
          />
        )}
      </Show>
    </div>
  );
}
