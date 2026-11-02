// git 화면 (§17) — 전체 화면 뷰. 왼쪽 브랜치 · 원격 · 태그 · stash, 가운데 전체 브랜치 그래프(레인은
// gitGraph.ts가 계산한다, 300개씩), 오른쪽 커밋 상세, 아래 작업 트리(파일 · 덩어리 스테이징 · 커밋).
// 쓰기(G7′)는 사람이 여기서 누를 때만 실행한다 — backend/git.ts gitRun → Rust 허용 목록.
// HEAD · 작업 트리를 바꾸는 작업(pull · 전환)은 §4-1 작업 중 경고를 먼저 거친다(gitWrite.ts workGuard).
// 버튼마다 우클릭 = [명령 복사] — 지금처럼 터미널에서 직접 칠 수도 있다.
// 3단계(merge · rebase · cherry-pick · revert · stash 쓰기 · reset)는 2라운드다 — 메뉴에 두지 않는다.
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import {
  commitChangedFiles,
  commitWebUrl,
  gitApplyPatch,
  gitBlame,
  gitCommitDetail,
  gitFilePatch,
  gitLog,
  gitRefs,
  gitRun,
  gitStatus,
  commandLine,
  LOG_PAGE,
  runLog,
} from "../backend/git";
import type { BlameLine, ChangedFile, CommitDetail, GitRefs, LogCommit, RunResult, StatusFile, WorkStatus } from "../backend/git";
import { backend } from "../backend/mock";
import { clipWriteText, isTauri } from "../backend/pty";
import { openLink } from "../backend/browser";
import { sendConversation } from "../backend/conversation";
import { t, tf } from "../i18n";
import { openPanel, pushLayer, scopeWorkspace, setView, tick, view } from "../state";
import type { View } from "../state";
import { sessionDisplayName } from "../types";
import { Icon } from "../components/icons";
import { ConfirmDialog, ContextMenu, notify } from "../components/ui";
import type { MenuGroup } from "../components/ui";
import { computeGraph } from "./gitGraph";
import { guardSessions, guardWorsened, hunkPatch, hunkRange, refNameProblem, splitHunks, workGuard } from "./gitWrite";
import type { FilePatch, GuardLevel } from "./gitWrite";

const ROW_H = 24;
const LANE_W = 12;
const LANE_COLORS = [
  "var(--eq-blue)",
  "var(--eq-purple)",
  "var(--eq-amber)",
  "var(--eq-green)",
  "var(--eq-pink)",
  "var(--eq-cyan)",
  "var(--eq-orange)",
  "var(--eq-red)",
];
const laneColor = (n: number) => LANE_COLORS[n % LANE_COLORS.length];
const NOTIFY_KEY = "eqmux.git.notifyAgents"; // 바뀐 뒤 에이전트 알림 (§17-3) — 기본 꺼짐, 메시지 한 건만큼 토큰이 든다

/** 그래프 시각 — 오늘이면 시:분, 올해면 월-일, 아니면 연-월-일 */
function fmtTime(sec: number): string {
  const d = new Date(sec * 1000);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 이름 입력 창 — ConfirmDialog는 Enter를 [취소]로 받으므로(안전 기본) 입력이 있는 창은 따로 둔다 */
function NamePrompt(props: {
  title: string;
  label: string;
  initial?: string;
  withMessage?: boolean; // 태그 — 메시지가 있으면 주석 태그
  confirmLabel: string;
  onConfirm: (name: string, message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = createSignal(props.initial ?? "");
  const [msg, setMsg] = createSignal("");
  let box!: HTMLDivElement;
  let input!: HTMLInputElement;
  const problem = () => refNameProblem(name());
  onMount(() => {
    input.focus();
    input.select();
    onCleanup(pushLayer(() => props.onCancel(), () => box));
  });
  const submit = () => !problem() && props.onConfirm(name().trim(), msg().trim());
  return (
    <div class="overlay" onClick={(e) => (e.stopPropagation(), props.onCancel())}>
      <div ref={box} class="dialog eq-confirm" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div class="eq-confirm-t">{props.title}</div>
        <div class="eq-confirm-b">
          <label class="gx-field">
            <span>{props.label}</span>
            <input
              ref={input}
              class="mono"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.isComposing && submit()}
            />
          </label>
          <Show when={props.withMessage}>
            <label class="gx-field">
              <span>{t("메시지 (비우면 가벼운 태그)")}</span>
              <input class="mono" value={msg()} onInput={(e) => setMsg(e.currentTarget.value)} />
            </label>
          </Show>
          <Show when={name().trim() && problem()}>
            <div class="gx-warn">{t(problem()!)}</div>
          </Show>
        </div>
        <div class="eq-confirm-f">
          <button class="btn" onClick={() => props.onCancel()}>
            {t("취소")}
          </button>
          <button class="btn primary" disabled={!!problem()} onClick={submit}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Confirm {
  title: string;
  body: JSX.Element;
  info?: string[];
  danger?: boolean;
  confirmLabel: string;
  onConfirm: () => void;
}

interface Prompt {
  title: string;
  label: string;
  initial?: string;
  withMessage?: boolean;
  confirmLabel: string;
  onConfirm: (name: string, message: string) => void;
}

export function GitScreen(props: { wsId?: string; file?: string }) {
  const ws = () => {
    tick();
    const byProp = props.wsId ? backend.listWorkspaces().find((w) => w.id === props.wsId) : undefined;
    if (byProp) return byProp.pathMissing ? undefined : byProp;
    const scoped = scopeWorkspace();
    return scoped && !scoped.pathMissing ? scoped : undefined;
  };

  // ── 그래프 (1단계) ──
  const [commits, setCommits] = createSignal<LogCommit[]>([]);
  const [logErr, setLogErr] = createSignal<string | undefined>();
  const [more, setMore] = createSignal(false); // 다음 쪽이 있을 수 있다
  const [loading, setLoading] = createSignal(false);
  const [allBranches, setAllBranches] = createSignal(true);
  const [query, setQuery] = createSignal("");
  const [queryKind, setQueryKind] = createSignal<"message" | "author">("message");
  const [file, setFile] = createSignal<string | undefined>(props.file);
  const [blameOn, setBlameOn] = createSignal(false);
  const filtering = () => !!query().trim();
  // 검색 결과는 부모가 빠져 있어 레인이 거짓말을 한다 — 거를 때는 선 없이 목록만 보인다
  const graph = createMemo(() => (filtering() ? [] : computeGraph(commits())));
  const graphWidth = createMemo(() => Math.max(1, ...graph().map((r) => r.width)));

  let logReq = 0;
  const loadLog = async (reset: boolean) => {
    const w = ws();
    if (!w) return;
    const req = reset ? ++logReq : logReq;
    setLoading(true);
    const q = query().trim();
    const r = await gitLog(w.path, reset ? 0 : commits().length, {
      all: allBranches(),
      grep: queryKind() === "message" ? q : undefined,
      author: queryKind() === "author" ? q : undefined,
      file: file(),
    });
    if (req !== logReq) return; // 그새 조건이 바뀌었다
    setLoading(false);
    if (typeof r === "string") {
      setLogErr(r);
      return;
    }
    batch(() => {
      setLogErr(undefined);
      setCommits(reset ? r : [...commits(), ...r]);
      setMore(r.length === LOG_PAGE);
    });
  };

  // ── 사이드바 · 작업 트리 ──
  const [refs, setRefs] = createSignal<GitRefs | undefined>();
  const [work, setWork] = createSignal<WorkStatus | undefined>();
  const head = () => refs()?.local.find((b) => b.head);
  const loadSide = async () => {
    const w = ws();
    if (!w) return;
    const [r, s] = await Promise.all([gitRefs(w.path), gitStatus(w.path)]);
    setRefs(r);
    setWork(s);
  };
  const reloadAll = () => {
    void loadSide();
    void loadLog(true);
  };

  createEffect(on([() => ws()?.id, allBranches, file], () => reloadAll()));
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      [query, queryKind],
      () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => void loadLog(true), 250);
      },
      { defer: true },
    ),
  );
  onMount(() => {
    // 작업 트리는 에이전트가 계속 바꾼다 — 보일 때만 10초마다 (git 패널과 같은 주기)
    const iv = setInterval(() => !document.hidden && void loadSide(), 10_000);
    onCleanup(() => clearInterval(iv));
  });

  // ── 상세 ──
  const [sel, setSel] = createSignal<string | undefined>();
  const [detail, setDetail] = createSignal<CommitDetail | undefined>();
  const [detailFiles, setDetailFiles] = createSignal<ChangedFile[]>([]);
  createEffect(
    on(sel, async (h) => {
      const w = ws();
      setDetail(undefined);
      setDetailFiles([]);
      if (!h || !w) return;
      const [d, f] = await Promise.all([gitCommitDetail(w.path, h), commitChangedFiles(w.path, h)]);
      if (sel() !== h) return;
      setDetail(d);
      setDetailFiles(f ?? []);
    }),
  );

  // ── blame ──
  const [blame, setBlame] = createSignal<BlameLine[] | string>([]);
  createEffect(
    on([blameOn, file], async ([on_, f]) => {
      const w = ws();
      if (!on_ || !f || !w) return;
      setBlame(t("읽는 중…"));
      setBlame(await gitBlame(w.path, f));
    }),
  );

  // ── 쓰기 공통 (2단계) ──
  const [confirm, setConfirm] = createSignal<Confirm | undefined>();
  const [prompt, setPrompt] = createSignal<Prompt | undefined>();
  const [running, setRunning] = createSignal<string | undefined>(); // 실행 중인 명령 — 버튼을 잠근다
  const [authHelp, setAuthHelp] = createSignal<string | undefined>(); // 인증 실패한 명령
  const [logOpen, setLogOpen] = createSignal(false);
  const [notifyAgents, setNotifyAgents] = createSignal(localStorage.getItem(NOTIFY_KEY) === "1");
  createEffect(() => localStorage.setItem(NOTIFY_KEY, notifyAgents() ? "1" : "0"));

  const run = async (args: string[], opts: { quiet?: boolean } = {}): Promise<RunResult | undefined> => {
    const w = ws();
    if (!w || running()) return undefined;
    setRunning(commandLine(args));
    const r = await gitRun(w.id, w.path, args);
    setRunning(undefined);
    if (r.auth) setAuthHelp(r.command);
    else if (!r.ok) notify(`${r.command} — ${r.output.split("\n").find((l) => l.trim()) ?? t("실패")}`);
    else if (!opts.quiet) notify(tf("{cmd} 완료", { cmd: r.command }));
    reloadAll();
    return r;
  };

  /** 바뀐 뒤 알림 (§17-3) — 켜 두었을 때만, 그 폴더의 에이전트 전부에게 한 건 */
  const announce = (from: string, to: string) => {
    const w = ws();
    if (!w || !notifyAgents() || from === to) return;
    void sendConversation(w.id, "@all", "report", tf("브랜치·HEAD가 {a} → {b}로 바뀌었습니다. 작업 중인 파일을 다시 읽으세요.", { a: from, b: to }));
  };
  const headLabel = () => (work()?.hasHead ? t("분리된 HEAD") : "—"); // 브랜치 없이 커밋에 서 있다

  const guardNow = (): { level: GuardLevel; busy: number; waiting: number } => {
    const w = ws();
    return w ? workGuard(backend.listSessions(), w.id) : { level: "none", busy: 0, waiting: 0 };
  };

  /** §4-1 — busy면 강한 경고, waiting만이면 약한 경고, 아니면 바로 실행. 누른 순간 한 번 더 본다 */
  const guarded = (label: string, args: string[]) => {
    const go = async () => {
      const before = head()?.name ?? head()?.hash ?? "";
      const r = await run(args);
      await loadSide();
      const after = head()?.name ?? head()?.hash ?? "";
      if (r?.ok) announce(before || label, after);
    };
    const ask = (g: ReturnType<typeof guardNow>) => {
      if (g.level === "none") return void go();
      const w = ws()!;
      const names = guardSessions(backend.listSessions(), w.id).map((s) => `${sessionDisplayName(s, backend.listPersonas().find((p) => p.id === s.personaId)?.name ?? s.id)} · ${t(s.status === "waiting" ? "승인 대기" : "작업 중")}${s.activity ? ` · ${s.activity}` : ""}`);
      const changed = work()?.files.length ?? 0;
      setConfirm({
        title: g.level === "busy" ? t("에이전트가 작업 중입니다") : t("승인을 기다리는 에이전트가 있습니다"),
        body: (
          <>
            <p>{t("이 폴더의 모든 세션 발밑 파일이 바뀝니다.")}</p>
            <Show when={changed > 0}>
              <p>{tf("커밋 안 된 변경 {n}건 — 앱은 몰래 stash하지 않습니다. git이 거부하면 그 오류를 그대로 보입니다.", { n: changed })}</p>
            </Show>
          </>
        ),
        info: [commandLine(args), ...names],
        danger: g.level === "busy",
        confirmLabel: t("그래도 실행"),
        onConfirm: () => {
          setConfirm(undefined);
          const now = guardNow();
          if (guardWorsened(g.level, now.level)) ask(now); // 창이 떠 있는 사이 바뀌었다 — 다시 묻는다
          else void go();
        },
      });
    };
    ask(guardNow());
  };

  // ── 툴바 동작 ──
  const doFetch = () => void run(["fetch", "--all", "--prune"]);
  const doPull = () => guarded("pull", ["pull", "--ff-only"]);
  const pushArgs = () => {
    const b = head();
    return b && !b.upstream ? ["push", "-u", "origin", b.name] : ["push"];
  };
  const doPush = () => void run(pushArgs());
  const doForcePush = () =>
    setConfirm({
      title: t("강제 push (--force-with-lease)"),
      body: <p>{t("원격 브랜치를 내 것으로 덮습니다. 그사이 다른 사람이 올린 커밋이 있으면 git이 거부합니다.")}</p>,
      info: [commandLine(["push", "--force-with-lease"]), tf("되돌릴 해시: {h}", { h: head()?.hash.slice(0, 10) ?? "—" })],
      danger: true,
      confirmLabel: t("강제 push"),
      onConfirm: () => (setConfirm(undefined), void run(["push", "--force-with-lease"])),
    });

  const switchTo = (name: string) => {
    if (name === head()?.name) return;
    guarded(name, ["switch", name]);
  };
  const newBranch = (at?: string) =>
    setPrompt({
      title: at ? tf("{h}에서 브랜치 만들기", { h: at.slice(0, 8) }) : t("현재 HEAD에서 브랜치 만들기"),
      label: t("브랜치 이름"),
      confirmLabel: t("만들기"),
      onConfirm: (n) => (setPrompt(undefined), void run(at ? ["branch", n, at] : ["branch", n])),
    });
  const renameBranch = (old: string) =>
    setPrompt({
      title: tf("{b} 이름 바꾸기", { b: old }),
      label: t("새 이름"),
      initial: old,
      confirmLabel: t("바꾸기"),
      onConfirm: (n) => (setPrompt(undefined), void run(["branch", "-m", old, n])),
    });
  const deleteBranch = async (name: string, hash: string) => {
    const r = await run(["branch", "-d", name], { quiet: true });
    if (!r || r.ok || !/not fully merged|완전히 병합되지/i.test(r.output)) return;
    // 병합 안 된 브랜치 — 무엇이 사라지는지와 되돌릴 해시를 보이고 한 번 더 묻는다 (§17-4)
    setConfirm({
      title: tf("병합 안 된 브랜치 {b} 삭제", { b: name }),
      body: <p>{t("이 브랜치에만 있는 커밋이 어느 브랜치에서도 보이지 않게 됩니다.")}</p>,
      info: [commandLine(["branch", "-D", name]), tf("되돌릴 해시: {h} (git branch {b} {h})", { h: hash.slice(0, 10), b: name })],
      danger: true,
      confirmLabel: t("삭제"),
      onConfirm: () => (setConfirm(undefined), void run(["branch", "-D", name])),
    });
  };
  const newTag = (at?: string) =>
    setPrompt({
      title: at ? tf("{h}에 태그 달기", { h: at.slice(0, 8) }) : t("HEAD에 태그 달기"),
      label: t("태그 이름"),
      withMessage: true,
      confirmLabel: t("태그 달기"),
      onConfirm: (n, m) => {
        setPrompt(undefined);
        void run([...(m ? ["tag", "-a", n, "-m", m] : ["tag", n]), ...(at ? [at] : [])]);
      },
    });

  // ── 작업 트리 · 스테이징 ──
  const unstaged = () => (work()?.files ?? []).filter((f) => f.y !== " ");
  const staged = () => (work()?.files ?? []).filter((f) => f.x !== " " && f.x !== "?");
  const stageFiles = (fs: StatusFile[]) => fs.length && void run(["add", "--", ...fs.map((f) => f.path)], { quiet: true });
  const unstageFiles = (fs: StatusFile[]) =>
    fs.length && void run(["restore", "--staged", "--", ...fs.flatMap((f) => (f.from ? [f.from, f.path] : [f.path]))], { quiet: true });

  const [hunkFile, setHunkFile] = createSignal<{ path: string; staged: boolean } | undefined>();
  const [hunks, setHunks] = createSignal<FilePatch | undefined>();
  const loadHunks = async () => {
    const w = ws();
    const h = hunkFile();
    if (!w || !h) return setHunks(undefined);
    setHunks(splitHunks(await gitFilePatch(w.path, h.path, h.staged)));
  };
  createEffect(on(hunkFile, () => void loadHunks()));
  createEffect(on(work, () => hunkFile() && void loadHunks(), { defer: true }));
  const applyHunk = async (i: number) => {
    const w = ws();
    const p = hunks();
    const h = hunkFile();
    if (!w || !p || !h || running()) return;
    setRunning("git apply --cached");
    const r = await gitApplyPatch(w.id, w.path, hunkPatch(p, i), h.staged);
    setRunning(undefined);
    if (!r.ok) notify(`${t("덩어리 적용 실패")} — ${r.output}`);
    void loadSide();
  };

  const [message, setMessage] = createSignal("");
  const [amend, setAmend] = createSignal(false);
  const commitArgs = () => (amend() ? ["commit", "--amend", ...(message().trim() ? ["-m", message().trim()] : ["--no-edit"])] : ["commit", "-m", message().trim()]);
  const canCommit = () => !running() && (amend() ? !!work()?.hasHead : staged().length > 0 && !!message().trim());
  const doCommit = () => {
    const go = async () => {
      const r = await run(commitArgs());
      if (r?.ok) batch(() => (setMessage(""), setAmend(false)));
    };
    if (amend() && work()?.headPushed) {
      // 푸시한 커밋의 amend — 원격과 갈라진다 (§17-4 파괴적 작업)
      setConfirm({
        title: t("이미 푸시한 커밋을 고칩니다"),
        body: <p>{t("amend하면 원격의 커밋과 갈라져 다음 push가 거부됩니다(강제 push가 필요). 같은 브랜치를 쓰는 팀원 작업과 어긋날 수 있습니다.")}</p>,
        info: [commandLine(commitArgs()), tf("되돌릴 해시: {h}", { h: head()?.hash.slice(0, 10) ?? "—" })],
        danger: true,
        confirmLabel: t("그래도 amend"),
        onConfirm: () => (setConfirm(undefined), void go()),
      });
    } else void go();
  };

  // ── 메뉴 ──
  const [menu, setMenu] = createSignal<{ x: number; y: number; header?: string; groups: MenuGroup[] } | undefined>();
  const openMenu = (e: MouseEvent, header: string | undefined, groups: MenuGroup[]) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, header, groups });
  };
  /** 버튼 우클릭 = [명령 복사] (§17-4) */
  const copyMenu = (args: string[]) => (e: MouseEvent) =>
    openMenu(e, undefined, [[{ label: tf("명령 복사 — {cmd}", { cmd: commandLine(args) }), action: () => void clipWriteText(commandLine(args)) }]]);

  const openCommitDiff = (hash: string, subject: string) => {
    const cur = view();
    setView({ kind: "gitdiff", wsId: ws()?.id, commit: { hash: hash.slice(0, 12), message: subject }, back: cur });
  };
  const commitMenu = (e: MouseEvent, c: LogCommit) =>
    openMenu(e, `${c.hash.slice(0, 8)} · ${c.subject}`, [
      [
        { label: t("여기서 브랜치 만들기"), action: () => newBranch(c.hash) },
        { label: t("여기에 태그 달기"), action: () => newTag(c.hash) },
      ],
      [
        { label: t("해시 복사"), action: () => void clipWriteText(c.hash) },
        { label: t("메시지 복사"), action: () => void clipWriteText(c.subject) },
        ...((url) => (url ? [{ label: t("원격에서 보기 (푸시 안 한 커밋은 없을 수 있음)"), action: () => openLink(url) }] : []))(
          commitWebUrl(ws()?.remote, c.hash),
        ),
        { label: t("부모 커밋과 비교 (diff)"), action: () => openCommitDiff(c.hash, c.subject) },
      ],
      [{ label: t("cherry-pick · revert · reset은 다음 단계 — 터미널에서"), note: true }],
    ]);
  const branchMenu = (e: MouseEvent, b: { name: string; hash: string; head: boolean }) =>
    openMenu(e, b.name, [
      [
        { label: t("전환"), disabled: b.head, action: () => switchTo(b.name) },
        { label: t("이름 변경"), action: () => renameBranch(b.name) },
        { label: t("여기서 브랜치 만들기"), action: () => newBranch(b.hash) },
      ],
      [{ label: t("해시 복사"), action: () => void clipWriteText(b.hash) }],
      [{ label: t("삭제"), danger: true, disabled: b.head, action: () => void deleteBranch(b.name, b.hash) }],
      [{ label: t("merge · rebase는 다음 단계 — 터미널에서"), note: true }],
    ]);

  // ── 닫기 · 키 ──
  const close = () => {
    const v = view();
    const back: View | undefined = v.kind === "git" ? v.back : undefined;
    setView(back ?? { kind: "control" });
    if (back) openPanel("git");
  };
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "Escape" || el?.matches?.("input, textarea, select") || confirm() || prompt() || menu()) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const onGraphScroll = (e: Event) => {
    const el = e.currentTarget as HTMLElement;
    if (more() && !loading() && el.scrollTop + el.clientHeight > el.scrollHeight - ROW_H * 20) void loadLog(false);
  };

  const fileRow = (f: StatusFile, isStaged: boolean) => (
    <div
      class="gx-wfile mono"
      classList={{ on: hunkFile()?.path === f.path && hunkFile()?.staged === isStaged }}
      title={f.from ? `${f.from} → ${f.path}` : f.path}
      onClick={() => setHunkFile({ path: f.path, staged: isStaged })}
    >
      <span class="gx-st">{isStaged ? f.x : f.y === "?" ? "?" : f.y}</span>
      <span class="gx-wpath">{f.path}</span>
      <button
        class="btn ghost gx-mini"
        disabled={!!running()}
        title={isStaged ? t("스테이지 내리기") : t("스테이지")}
        onClick={(e) => (e.stopPropagation(), isStaged ? unstageFiles([f]) : stageFiles([f]))}
      >
        {isStaged ? "−" : "+"}
      </button>
    </div>
  );

  return (
    <div class="screen gx">
      {/* 툴바 — Fetch · Pull · Push ▾ │ 브랜치 · 태그 │ 검색 · 범위 │ 로그 · 닫기 */}
      <div class="gx-toolbar">
        <span class="gx-title">
          <Icon name="git-branch" size={14} /> {ws()?.name ?? "—"}
        </span>
        <span class="mono muted gx-head">⎇ {head()?.name ?? headLabel()}</span>
        <Show when={head()}>
          {(b) => (
            <span class="mono gx-sync" title={b().upstream || t("업스트림 없음")}>
              ↑{b().ahead} ↓{b().behind}
            </span>
          )}
        </Show>
        <span class="gx-sep" />
        <button class="btn" disabled={!!running() || !ws()} onClick={doFetch} onContextMenu={copyMenu(["fetch", "--all", "--prune"])}>
          {t("Fetch")}
        </button>
        <button class="btn" disabled={!!running() || !ws()} onClick={doPull} onContextMenu={copyMenu(["pull", "--ff-only"])} title="git pull --ff-only">
          ↓ {t("Pull")}
          <Show when={(head()?.behind ?? 0) > 0}>
            <span class="n">{head()!.behind}</span>
          </Show>
        </button>
        <button class="btn" disabled={!!running() || !ws()} onClick={doPush} onContextMenu={copyMenu(pushArgs())} title={commandLine(pushArgs())}>
          ↑ {t("Push")}
          <Show when={(head()?.ahead ?? 0) > 0}>
            <span class="n">{head()!.ahead}</span>
          </Show>
        </button>
        <button
          class="btn ghost gx-mini"
          disabled={!!running() || !ws()}
          title={t("Push 메뉴")}
          onClick={(e) =>
            openMenu(e, "push", [
              [{ label: commandLine(pushArgs()), action: doPush }],
              [{ label: t("강제 push (--force-with-lease)…"), danger: true, action: doForcePush }],
            ])
          }
        >
          ▾
        </button>
        <span class="gx-sep" />
        <button class="btn" disabled={!!running() || !ws()} onClick={() => newBranch()}>
          + {t("브랜치")}
        </button>
        <button class="btn" disabled={!!running() || !ws() || !work()?.hasHead} onClick={() => newTag()}>
          + {t("태그")}
        </button>
        <span style={{ flex: 1 }} />
        <select class="gx-qkind" value={queryKind()} onChange={(e) => setQueryKind(e.currentTarget.value as "message" | "author")}>
          <option value="message">{t("메시지")}</option>
          <option value="author">{t("작성자")}</option>
        </select>
        <input
          class="panel-search mono gx-search"
          placeholder={t("검색…")}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            if (query()) setQuery("");
            else e.currentTarget.blur();
          }}
        />
        <button class="btn ghost" classList={{ on: allBranches() }} disabled={!!file()} onClick={() => setAllBranches(!allBranches())}>
          {allBranches() ? t("모든 브랜치") : t("현재 브랜치")}
        </button>
        <button class="btn ghost" classList={{ on: logOpen() }} onClick={() => setLogOpen(!logOpen())} title={t("앱이 실행한 git 명령")}>
          {tf("실행 로그 {n}", { n: runLog().filter((r) => r.wsId === ws()?.id).length })}
        </button>
        <button class="btn ghost" title={t("닫기 (Esc)")} aria-label={t("닫기 (Esc)")} onClick={close}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <Show when={running()}>
        <div class="gx-banner mono">{tf("실행 중 — {cmd}", { cmd: running()! })}</div>
      </Show>
      <Show when={authHelp()}>
        {(cmd) => (
          <div class="gx-banner warn">
            <span>{tf("{cmd} — 로그인이 필요합니다. 앱은 비밀번호·토큰을 받지 않습니다. 터미널에서 `git fetch`를 한 번 실행해 로그인하세요.", { cmd: cmd() })}</span>
            <button class="btn ghost" onClick={() => void clipWriteText("git fetch")}>
              {t("`git fetch` 복사")}
            </button>
            <button class="btn ghost" onClick={() => setAuthHelp(undefined)}>
              {t("닫기")}
            </button>
          </div>
        )}
      </Show>
      <Show when={!ws()}>
        <div class="card conn-error mono">{t("워크스페이스 문맥이 없습니다 — 워크스페이스 탭을 먼저 여세요")}</div>
      </Show>
      <Show when={!isTauri()}>
        <div class="card conn-error mono">{t("브라우저 dev — 실측 없음")}</div>
      </Show>

      <div class="gx-body">
        {/* 왼쪽 — 로컬(↑↓) · 원격 · 태그 · stash */}
        <div class="gx-side">
          <div class="gx-sec">{t("로컬")}</div>
          <For each={refs()?.local ?? []}>
            {(b) => (
              <div
                class="gx-ref mono"
                classList={{ head: b.head, on: sel() === b.hash }}
                title={`${b.name}${b.upstream ? ` → ${b.upstream}` : ""}${b.gone ? ` (${t("업스트림 사라짐")})` : ""} — ${t("더블클릭: 전환")}`}
                onClick={() => setSel(b.hash)}
                onDblClick={() => switchTo(b.name)}
                onContextMenu={(e) => branchMenu(e, b)}
              >
                <span class="gx-dot">{b.head ? "●" : ""}</span>
                <span class="gx-refname">{b.name}</span>
                <Show when={b.ahead}>
                  <span class="st-waiting">↑{b.ahead}</span>
                </Show>
                <Show when={b.behind}>
                  <span class="muted">↓{b.behind}</span>
                </Show>
              </div>
            )}
          </For>
          <details class="gx-group">
            <summary class="gx-sec">{tf("원격 ({n})", { n: refs()?.remote.length ?? 0 })}</summary>
            <For each={refs()?.remote ?? []}>
              {(r) => (
                <div class="gx-ref mono" classList={{ on: sel() === r.hash }} onClick={() => setSel(r.hash)} onContextMenu={(e) => openMenu(e, r.name, [[{ label: t("해시 복사"), action: () => void clipWriteText(r.hash) }, { label: t("여기서 브랜치 만들기"), action: () => newBranch(r.hash) }]])}>
                  <span class="gx-refname">{r.name}</span>
                </div>
              )}
            </For>
          </details>
          <details class="gx-group">
            <summary class="gx-sec">{tf("태그 ({n})", { n: refs()?.tags.length ?? 0 })}</summary>
            <For each={refs()?.tags ?? []}>
              {(r) => (
                <div
                  class="gx-ref mono"
                  classList={{ on: sel() === r.hash }}
                  onClick={() => setSel(r.hash)}
                  onContextMenu={(e) =>
                    openMenu(e, r.name, [
                      [{ label: t("해시 복사"), action: () => void clipWriteText(r.hash) }],
                      [{ label: t("태그 삭제"), danger: true, action: () => void run(["tag", "-d", r.name]) }],
                    ])
                  }
                >
                  <span class="gx-refname">{r.name}</span>
                </div>
              )}
            </For>
          </details>
          <details class="gx-group">
            <summary class="gx-sec">{tf("Stash ({n})", { n: refs()?.stashes.length ?? 0 })}</summary>
            <For each={refs()?.stashes ?? []}>
              {(r) => (
                <div class="gx-ref mono" title={t("적용 · 꺼내기 · 버리기는 다음 단계 — 터미널에서")} onClick={() => setSel(r.hash)}>
                  <span class="gx-refname">{r.name}</span>
                </div>
              )}
            </For>
          </details>
        </div>

        {/* 가운데 — 그래프 (또는 파일 히스토리 · blame) */}
        <div class="gx-main">
          <Show when={file()}>
            {(f) => (
              <div class="gx-filebar mono">
                <span>{tf("파일 히스토리 — {f}", { f: f() })}</span>
                <button class="btn ghost" classList={{ on: blameOn() }} onClick={() => setBlameOn(!blameOn())}>
                  blame
                </button>
                <button class="btn ghost" onClick={() => (setFile(undefined), setBlameOn(false))}>
                  {t("전체 이력으로")}
                </button>
              </div>
            )}
          </Show>
          <Show when={logErr()}>
            <div class="card conn-error mono">{logErr()}</div>
          </Show>
          <Show
            when={blameOn() && file()}
            fallback={
              <div class="gx-graph" onScroll={onGraphScroll}>
                <For each={commits()}>
                  {(c, i) => {
                    const row = () => graph()[i()];
                    return (
                      <div
                        class="gx-row"
                        classList={{ on: sel() === c.hash }}
                        style={{ height: `${ROW_H}px` }}
                        onClick={() => setSel(c.hash)}
                        onDblClick={() => openCommitDiff(c.hash, c.subject)}
                        onContextMenu={(e) => commitMenu(e, c)}
                      >
                        <Show when={row()}>
                          {(r) => (
                            <svg class="gx-svg" width={graphWidth() * LANE_W} height={ROW_H}>
                              <For each={r().lines}>
                                {(l) => {
                                  const x1 = l.from * LANE_W + LANE_W / 2;
                                  const x2 = l.to * LANE_W + LANE_W / 2;
                                  const [y1, y2] = l.half === "top" ? [0, ROW_H / 2] : [ROW_H / 2, ROW_H];
                                  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={laneColor(l.color)} stroke-width="1.6" />;
                                }}
                              </For>
                              <circle cx={r().col * LANE_W + LANE_W / 2} cy={ROW_H / 2} r={c.parents.length > 1 ? 3 : 4} fill={laneColor(r().color)} />
                            </svg>
                          )}
                        </Show>
                        <span class="gx-subject">
                          <For each={c.refs}>
                            {(ref) => (
                              <span
                                class="gitp-ref mono"
                                classList={{ remote: !ref.startsWith("tag: ") && ref.includes("/") && !ref.startsWith("HEAD -> "), tag: ref.startsWith("tag: "), headref: ref.startsWith("HEAD") }}
                              >
                                {ref.replace(/^HEAD -> /, "● ")}
                              </span>
                            )}
                          </For>
                          {c.subject}
                        </span>
                        <span class="gx-meta mono">{c.author}</span>
                        <span class="gx-meta mono">{fmtTime(c.time)}</span>
                        <span class="gx-meta mono muted">{c.hash.slice(0, 7)}</span>
                      </div>
                    );
                  }}
                </For>
                <Show when={!loading() && commits().length === 0 && !logErr()}>
                  <div class="muted gx-empty">{t(filtering() ? "검색 결과 없음" : "커밋이 없습니다")}</div>
                </Show>
                <Show when={loading()}>
                  <div class="muted gx-empty">{t("읽는 중…")}</div>
                </Show>
              </div>
            }
          >
            <div class="gx-blame mono">
              <Show when={Array.isArray(blame())} fallback={<div class="muted gx-empty">{blame() as string}</div>}>
                <For each={blame() as BlameLine[]}>
                  {(l, i) => (
                    <div class="gx-bl" classList={{ cont: i() > 0 && (blame() as BlameLine[])[i() - 1].hash === l.hash }}>
                      <span class="gx-bl-who" title={`${l.hash} · ${l.author}`} onClick={() => setSel(l.hash)}>
                        {l.hash} {l.author} {l.time ? fmtTime(l.time) : ""}
                      </span>
                      <span class="gx-bl-no">{i() + 1}</span>
                      <span class="gx-bl-tx">{l.text}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>

        {/* 오른쪽 — 커밋 상세 */}
        <div class="gx-detail">
          <Show when={detail()} fallback={<div class="muted gx-empty">{t("커밋을 고르세요")}</div>}>
            {(d) => (
              <>
                <div class="mono gx-d-hash">
                  {d().hash.slice(0, 10)}
                  <button class="btn ghost gx-mini" title={t("해시 복사")} onClick={() => void clipWriteText(d().hash)}>
                    <Icon name="copy" size={11} />
                  </button>
                </div>
                <div class="gx-d-body">{d().body}</div>
                <div class="mono muted gx-d-meta">
                  <div>
                    {d().author} &lt;{d().email}&gt; · {new Date(d().authorTime * 1000).toLocaleString()}
                  </div>
                  <Show when={d().committer !== d().author}>
                    <div>{tf("커밋한 사람 {n}", { n: d().committer })}</div>
                  </Show>
                  <div>
                    {t("부모")}{" "}
                    <For each={d().parents}>
                      {(p) => (
                        <button class="btn ghost gx-mini mono" onClick={() => setSel(p)}>
                          {p.slice(0, 7)}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
                <button class="btn" disabled={d().parents.length === 0} onClick={() => openCommitDiff(d().hash, d().body.split("\n")[0])}>
                  {t("부모 커밋과 비교 (diff)")}
                </button>
                <div class="gx-sec">{tf("변경 파일 {n}", { n: detailFiles().length })}</div>
                <For each={detailFiles()}>
                  {(f) => (
                    <div class="gx-dfile mono" title={f.path}>
                      <span class="gx-st">{f.status}</span>
                      <span class="gx-wpath" onClick={() => openCommitDiff(d().hash, d().body.split("\n")[0])}>
                        {f.path}
                      </span>
                      <span class="muted">{f.stat}</span>
                      <button class="btn ghost gx-mini" title={t("이 파일의 히스토리")} onClick={() => (setFile(f.path), setBlameOn(false))}>
                        <Icon name="file-text" size={11} />
                      </button>
                    </div>
                  )}
                </For>
              </>
            )}
          </Show>
        </div>
      </div>

      {/* 아래 — 작업 트리: 스테이지 안 됨 · 스테이지됨 · 덩어리 · 커밋 */}
      <div class="gx-work">
        <div class="gx-wcol">
          <div class="gx-sec">
            {tf("스테이지 안 됨 ({n})", { n: unstaged().length })}
            <button class="btn ghost gx-mini" disabled={!unstaged().length || !!running()} onClick={() => stageFiles(unstaged())}>
              {t("모두 ↓")}
            </button>
          </div>
          <div class="gx-wlist">
            <For each={unstaged()}>{(f) => fileRow(f, false)}</For>
          </div>
        </div>
        <div class="gx-wcol">
          <div class="gx-sec">
            {tf("스테이지됨 ({n})", { n: staged().length })}
            <button class="btn ghost gx-mini" disabled={!staged().length || !!running()} onClick={() => unstageFiles(staged())}>
              {t("모두 ↑")}
            </button>
          </div>
          <div class="gx-wlist">
            <For each={staged()}>{(f) => fileRow(f, true)}</For>
          </div>
        </div>
        <div class="gx-wcol gx-hunks">
          <Show when={hunkFile()} fallback={<div class="muted gx-empty">{t("파일을 누르면 덩어리별로 스테이지할 수 있습니다")}</div>}>
            {(h) => (
              <>
                <div class="gx-sec mono">
                  {h().path}
                  <button class="btn ghost gx-mini" onClick={() => setHunkFile(undefined)}>
                    <Icon name="x" size={11} />
                  </button>
                </div>
                <Show when={hunks()?.hunks.length} fallback={<div class="muted gx-empty">{t("덩어리가 없습니다 — 새 파일·바이너리는 파일 단위로 스테이지하세요")}</div>}>
                  <div class="gx-wlist">
                    <For each={hunks()!.hunks}>
                      {(hk, i) => (
                        <div class="gx-hunk mono">
                          <div class="gx-hunk-head">
                            <span>{hunkRange(hk)}</span>
                            <button class="btn ghost gx-mini" disabled={!!running()} onClick={() => void applyHunk(i())}>
                              {h().staged ? t("덩어리 내리기") : t("덩어리 스테이지")}
                            </button>
                          </div>
                          <pre>
                            <For each={hk.split("\n").slice(1, 40)}>
                              {(l) => <div classList={{ add: l.startsWith("+"), del: l.startsWith("-") }}>{l}</div>}
                            </For>
                          </pre>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </>
            )}
          </Show>
        </div>
        <div class="gx-wcol gx-commit">
          <textarea
            class="mono"
            placeholder={amend() ? t("비우면 메시지를 그대로 둡니다") : t("커밋 메시지")}
            value={message()}
            onInput={(e) => setMessage(e.currentTarget.value)}
          />
          <label class="gx-check">
            <input type="checkbox" checked={amend()} disabled={!work()?.hasHead} onChange={(e) => setAmend(e.currentTarget.checked)} />
            amend
            <Show when={amend() && work()?.headPushed}>
              <span class="gx-warn">{t("이미 푸시한 커밋")}</span>
            </Show>
          </label>
          <button class="btn primary" disabled={!canCommit()} onClick={doCommit} onContextMenu={copyMenu(commitArgs())}>
            {amend() ? t("amend") : tf("커밋 ({n})", { n: staged().length })}
          </button>
          <label class="gx-check" title={t("pull · 전환 뒤 그 폴더의 에이전트에게 '파일을 다시 읽어라'를 보냅니다 — 메시지 한 건만큼 토큰이 듭니다")}>
            <input type="checkbox" checked={notifyAgents()} onChange={(e) => setNotifyAgents(e.currentTarget.checked)} />
            {t("바뀐 뒤 에이전트에게 알리기")}
          </label>
          <div class="muted gx-foot">{t("pre-commit 훅은 그대로 돕니다 · --no-verify · --force는 쓰지 않습니다")}</div>
        </div>
      </div>

      {/* 실행 로그 (§17-4) — 명령과 결과. 같은 명령을 복사해 터미널에서 쳐도 결과가 같다 */}
      <Show when={logOpen()}>
        <div class="gx-runlog mono">
          <For each={runLog().filter((r) => r.wsId === ws()?.id)} fallback={<div class="muted">{t("아직 실행한 git 명령이 없습니다")}</div>}>
            {(r) => (
              <div class="gx-runrow" classList={{ fail: !r.ok }}>
                <span class="muted">{new Date(r.ts).toLocaleTimeString()}</span>
                <span class="gx-runcmd">{r.command}</span>
                <button class="btn ghost gx-mini" title={t("명령 복사")} onClick={() => void clipWriteText(r.command)}>
                  <Icon name="copy" size={11} />
                </button>
                <Show when={r.output}>
                  <pre>{r.output}</pre>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={confirm()}>
        {(c) => (
          <ConfirmDialog
            title={c().title}
            body={c().body}
            info={c().info}
            danger={c().danger}
            confirmLabel={c().confirmLabel}
            onConfirm={c().onConfirm}
            onCancel={() => setConfirm(undefined)}
          />
        )}
      </Show>
      <Show when={prompt()}>
        {(p) => (
          <NamePrompt
            title={p().title}
            label={p().label}
            initial={p().initial}
            withMessage={p().withMessage}
            confirmLabel={p().confirmLabel}
            onConfirm={p().onConfirm}
            onCancel={() => setPrompt(undefined)}
          />
        )}
      </Show>
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} header={m().header} groups={m().groups} onClose={() => setMenu(undefined)} />}
      </Show>
    </div>
  );
}
