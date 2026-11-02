// git 화면 (§17) — 전체 화면 뷰. 왼쪽 브랜치 · 원격 · 태그 · stash, 가운데 전체 브랜치 그래프(레인은
// gitGraph.ts가 계산한다, 300개씩), 오른쪽 커밋 상세, 아래 작업 트리(파일 · 덩어리 스테이징 · 커밋).
// 쓰기(G7′)는 사람이 여기서 누를 때만 실행한다 — backend/git.ts gitRun → Rust 허용 목록.
// HEAD · 작업 트리를 바꾸는 작업(pull · 전환)은 §4-1 작업 중 경고를 먼저 거친다(gitWrite.ts workGuard).
// 버튼마다 우클릭 = [명령 복사] — 지금처럼 터미널에서 직접 칠 수도 있다.
// 3단계: merge · rebase(비대화형) · cherry-pick · revert · stash · reset, 진행 중 배너, 충돌 덩어리 고르기,
// [세션에게 해결 맡기기](사람이 고른 세션에 ask — 자동으로 보내지 않는다). reset --hard · stash 버리기는
// 사라질 것과 되돌릴 해시를 보이고, hard는 두 번 묻는다 (§17-4). 기본 버튼은 늘 [취소]다.
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import {
  commitChangedFiles,
  commitWebUrl,
  gitApplyPatch,
  gitBlame,
  gitCommitDetail,
  gitFilePatch,
  gitCommitSessions,
  gitLog,
  gitRange,
  gitRefs,
  gitRun,
  gitStatus,
  commandLine,
  failText,
  isConflict,
  LOG_PAGE,
  NOTIFY_KEY,
  runLog,
  withHeadNotice,
} from "../backend/git";
import type { BlameLine, BranchRef, ChangedFile, CommitDetail, GitRefs, LogCommit, RunResult, StatusFile, WorkStatus } from "../backend/git";
import { backend } from "../backend/mock";
import { clipWriteText, isTauri } from "../backend/pty";
import { openLink } from "../backend/browser";
import { sendConversation } from "../backend/conversation";
import { activeConflicts, conflictName } from "../backend/attention";
import { fsRead, fsWrite } from "../backend/panels";
import { maskDotenvLine } from "../backend/secrets";
import { t, tf } from "../i18n";
import { openPanel, pushLayer, scopeWorkspace, setView, tick, view } from "../state";
import type { View } from "../state";
import { sessionDisplayName } from "../types";
import { Icon } from "../components/icons";
import { ConfirmDialog, ContextMenu, notify } from "../components/ui";
import type { MenuGroup } from "../components/ui";
import { computeGraph } from "./gitGraph";
import {
  chunkPaths,
  conflictParts,
  guardSessions,
  guardWorsened,
  hunkPatch,
  hunkRange,
  isDotenvPath,
  pushArgs as pushArgsOf,
  pushRemote,
  refNameProblem,
  resolveConflicts,
  splitHunks,
  workGuard,
} from "./gitWrite";
import type { ConflictPart, ConflictPick, FilePatch, GuardLevel } from "./gitWrite";

const ROW_H = 24;
const HUNK_LINES = 39; // 덩어리 미리보기 줄 수 — 넘으면 접고 '펼치기'를 둔다 (U114)
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
  free?: boolean; // 참조 이름이 아니다 (stash 메시지) — 이름 검사를 하지 않는다
  check?: string; // 체크 상자 하나 (기본 켜짐) — [+ 브랜치]의 "만든 뒤 전환" (P61)
  confirmLabel: string;
  onConfirm: (name: string, message: string, checked: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = createSignal(props.initial ?? "");
  const [msg, setMsg] = createSignal("");
  const [checked, setChecked] = createSignal(true);
  let box!: HTMLDivElement;
  let input!: HTMLInputElement;
  const problem = () => (props.free ? undefined : refNameProblem(name()));
  onMount(() => {
    input.focus();
    input.select();
    onCleanup(pushLayer(() => props.onCancel(), () => box));
  });
  const submit = () => !problem() && props.onConfirm(name().trim(), msg().trim(), checked());
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
          <Show when={props.check}>
            <label class="gx-check">
              <input type="checkbox" checked={checked()} onChange={(e) => setChecked(e.currentTarget.checked)} />
              {props.check}
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

/** [세션에게 해결 맡기기] 창 — 받을 세션을 고르고 ask 문구를 고친다. 글 상자의 Enter는 줄바꿈이다 */
function DelegateDialog(props: {
  targets: { id: string; name: string }[];
  to: string;
  body: string;
  onChange: (to: string, body: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  let box!: HTMLDivElement;
  onMount(() => onCleanup(pushLayer(() => props.onCancel(), () => box)));
  return (
    <div class="overlay" onClick={(e) => (e.stopPropagation(), props.onCancel())}>
      <div ref={box} class="dialog eq-confirm" role="dialog" aria-modal="true" aria-label={t("세션에게 충돌 해결 맡기기")} onClick={(e) => e.stopPropagation()}>
        <div class="eq-confirm-t">{t("세션에게 충돌 해결 맡기기")}</div>
        <div class="eq-confirm-b">
          <label class="gx-field">
            <span>{t("받을 세션")}</span>
            <select value={props.to} onChange={(e) => props.onChange(e.currentTarget.value, props.body)}>
              <For each={props.targets}>{(s) => <option value={s.id}>{s.name}</option>}</For>
            </select>
          </label>
          <label class="gx-field">
            <span>{t("ask 메시지 — 고쳐서 보낼 수 있습니다")}</span>
            <textarea class="mono" rows={7} value={props.body} onInput={(e) => props.onChange(props.to, e.currentTarget.value)} />
          </label>
        </div>
        <div class="eq-confirm-f">
          <button class="btn" onClick={() => props.onCancel()}>
            {t("취소")}
          </button>
          <button class="btn primary" disabled={!props.to || !props.body.trim()} onClick={() => props.onSend()}>
            {t("보내기")}
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
  free?: boolean;
  check?: string;
  confirmLabel: string;
  onConfirm: (name: string, message: string, checked: boolean) => void;
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
  // 이미 열린 git 화면에 탐색기가 다른 파일을 보내면 그 파일로 바꾼다 (같은 컴포넌트가 남는다)
  createEffect(on(() => props.file, (f) => f && setFile(f), { defer: true }));
  /** §17-3 세션 배지 — 해시 → 세션 id (편집 기록으로 추정). 쪽마다 덧붙인다 */
  const [bySession, setBySession] = createSignal<Record<string, string[]>>({});
  const [blameOn, setBlameOn] = createSignal(false);
  const filtering = () => !!query().trim();
  // 검색 결과 · 파일 히스토리(--follow)는 부모가 빠져 있어 레인이 계단이 된다 — 선 없이 목록만 보인다 (B176)
  const graph = createMemo(() => (filtering() || file() ? [] : computeGraph(commits())));
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
      if (reset) setBySession({});
    });
    const tags = await gitCommitSessions(w.id, w.path, r.map((c) => c.hash));
    if (req === logReq && Object.keys(tags).length) setBySession({ ...bySession(), ...tags });
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
    else if (!r.ok) notify(`${r.command} — ${failText(r.output)}`);
    else if (!opts.quiet) notify(tf("{cmd} 완료", { cmd: r.command }), "ok");
    reloadAll();
    return r;
  };

  const headLabel = () => (work()?.hasHead ? t("분리된 HEAD") : "—"); // 브랜치 없이 커밋에 서 있다

  const guardNow = (): { level: GuardLevel; busy: number; waiting: number } => {
    const w = ws();
    return w ? workGuard(backend.listSessions(), w.id) : { level: "none", busy: 0, waiting: 0 };
  };

  /** §4-1 — busy면 강한 경고, waiting만이면 약한 경고, 아니면 바로 실행. 누른 순간 한 번 더 본다 */
  const guarded = (args: string[], after?: (r: RunResult | undefined) => void) => {
    // 바뀐 뒤 알림 (§17-3) — HEAD 해시 전후 비교 (B175: 이름만 보면 같은 브랜치 pull · reset이 빠졌다)
    const go = async () => {
      const w = ws();
      const r = w ? await withHeadNotice(w.id, w.path, () => run(args)) : undefined;
      await loadSide();
      after?.(r);
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

  // ── 3단계: 이력 조작 ──
  const short = (h: string) => h.slice(0, 8);
  const headHash = () => head()?.hash ?? commits().find((c) => c.refs.some((r) => r.startsWith("HEAD")))?.hash ?? "";
  /** 확인창 하나를 띄우고, 누르면 §4-1 경고를 거쳐 실행한다 */
  const confirmThen = (c: Omit<Confirm, "onConfirm">, args: string[]) =>
    setConfirm({ ...c, onConfirm: () => (setConfirm(undefined), guarded(args)) });

  const cherryPick = (c: LogCommit) =>
    confirmThen(
      { title: tf("{h} cherry-pick", { h: short(c.hash) }), body: <p>{c.subject}</p>, info: [commandLine(["cherry-pick", c.hash])], confirmLabel: t("cherry-pick") },
      ["cherry-pick", c.hash],
    );
  const revert = (c: LogCommit) =>
    confirmThen(
      {
        title: tf("{h} 되돌리기 (revert)", { h: short(c.hash) }),
        body: <p>{t("이 커밋을 거꾸로 적용하는 새 커밋을 만듭니다. 이력은 지우지 않습니다.")}</p>,
        info: [commandLine(["revert", "--no-edit", c.hash]), c.subject],
        confirmLabel: t("revert"),
      },
      ["revert", "--no-edit", c.hash],
    );
  const mergeIn = (name: string) =>
    confirmThen(
      {
        title: tf("{b}을(를) 현재 브랜치로 merge", { b: name }),
        body: <p>{t("충돌이 나면 위 배너에서 충돌을 보고 [계속] 또는 [중단]을 고릅니다.")}</p>,
        info: [commandLine(["merge", "--no-edit", name])],
        confirmLabel: t("merge"),
      },
      ["merge", "--no-edit", name],
    );
  const rebaseOnto = (name: string) =>
    confirmThen(
      {
        title: tf("현재 브랜치를 {b} 위로 rebase", { b: name }),
        body: <p>{t("현재 브랜치의 커밋을 새로 만듭니다(해시가 바뀝니다). 이미 푸시한 커밋이면 다음 push에 강제 push가 필요합니다.")}</p>,
        info: [commandLine(["rebase", name]), tf("되돌릴 해시: {h}", { h: short(headHash()) })],
        danger: !!head()?.upstream,
        confirmLabel: t("rebase"),
      },
      ["rebase", name],
    );
  const checkoutDetached = (c: LogCommit) =>
    confirmThen(
      {
        title: tf("{h} 체크아웃 (브랜치 없이)", { h: short(c.hash) }),
        body: <p>{t("분리된 HEAD가 됩니다. 여기서 만든 커밋은 브랜치를 만들어 두지 않으면 잃기 쉽습니다.")}</p>,
        info: [commandLine(["switch", "--detach", c.hash])],
        confirmLabel: t("체크아웃"),
      },
      ["switch", "--detach", c.hash],
    );

  /** reset — soft · mixed는 한 번, hard는 무엇이 사라지는지 보이고 두 번 묻는다 (§17-4) */
  const resetTo = async (c: LogCommit, mode: "soft" | "mixed" | "hard") => {
    const w = ws();
    if (!w) return;
    const args = ["reset", `--${mode}`, c.hash];
    const from = headHash();
    const lost = from ? await gitRange(w.path, c.hash, from) : [];
    const dirty = work()?.files.length ?? 0;
    const info = [
      commandLine(args),
      tf("되돌릴 해시: {h} (git reset --hard {h})", { h: short(from) }),
      ...(lost.length ? [tf("브랜치에서 빠지는 커밋 {n}개", { n: lost.length }), ...lost.slice(0, 8).map((x) => `  ${short(x.hash)} ${x.subject}`)] : []),
      ...(lost.length > 8 ? [`  …`] : []),
    ];
    const what =
      mode === "soft"
        ? t("HEAD만 옮깁니다. 변경 내용은 스테이지된 채로 남습니다.")
        : mode === "mixed"
          ? t("HEAD를 옮기고 스테이지를 비웁니다. 작업 트리 파일은 그대로입니다.")
          : t("HEAD를 옮기고 스테이지와 작업 트리를 그 커밋으로 덮어씁니다.");
    if (mode !== "hard") {
      return confirmThen({ title: tf("{h}로 reset --{m}", { h: short(c.hash), m: mode }), body: <p>{what}</p>, info, confirmLabel: t("reset") }, args);
    }
    setConfirm({
      title: tf("{h}로 reset --hard", { h: short(c.hash) }),
      body: (
        <>
          <p>{what}</p>
          <Show when={dirty > 0}>
            <p class="gx-warn">{tf("커밋 안 된 변경 {n}건이 사라집니다 — 되돌릴 방법이 없습니다.", { n: dirty })}</p>
          </Show>
        </>
      ),
      info,
      danger: true,
      confirmLabel: t("다음"),
      onConfirm: () => {
        setConfirm(undefined);
        setTimeout(() => setConfirm(second), 400);
      },
    });
    const second: Confirm = {
          title: t("정말로 reset --hard 할까요?"),
          body: <p>{dirty > 0 ? tf("커밋 안 된 변경 {n}건은 되살릴 수 없습니다. 커밋은 위 해시로 되돌릴 수 있습니다.", { n: dirty }) : t("커밋은 위 해시로 되돌릴 수 있습니다.")}</p>,
          info: [commandLine(args), tf("되돌릴 해시: {h}", { h: short(from) })],
          danger: true,
          confirmLabel: t("reset --hard"),
          onConfirm: () => (setConfirm(undefined), guarded(args)),
    };
  };

  // ── stash ──
  const stashPush = () =>
    setPrompt({
      title: t("작업 트리를 stash에 넣기 (추적 안 된 파일 포함)"),
      label: t("메시지"),
      free: true,
      confirmLabel: t("stash"),
      onConfirm: (m) => {
        setPrompt(undefined);
        guarded(["stash", "push", "-u", ...(m ? ["-m", m] : [])]);
      },
    });
  /** `stash@{0}: 메시지` → `stash@{0}` */
  const stashRef = (name: string) => name.split(":")[0];
  const stashDrop = (r: { name: string; hash: string }) =>
    setConfirm({
      title: tf("{s} 버리기", { s: stashRef(r.name) }),
      body: <p>{t("stash 목록에서 지웁니다. 아래 해시로 한동안 되살릴 수 있습니다(git gc 전까지).")}</p>,
      info: [commandLine(["stash", "drop", stashRef(r.name)]), tf("되살리기: git stash apply {h}", { h: r.hash.slice(0, 10) })],
      danger: true,
      confirmLabel: t("버리기"),
      onConfirm: () => (setConfirm(undefined), void run(["stash", "drop", stashRef(r.name)])),
    });

  // ── 진행 중 상태 (§17-4 배너) · 충돌 ──
  const progress = () => work()?.progress ?? null;
  const conflicts = () => (work()?.files ?? []).filter(isConflict);
  const continueArgs = () => (progress() === "merge" ? ["commit", "--no-edit"] : [progress()!, "--continue"]);
  // B178 — 빈 cherry-pick · rebase · revert: 충돌도 스테이지된 것도 없으면 --continue는 같은 이유로 다시 실패한다
  const emptyStep = () => !!progress() && progress() !== "merge" && !conflicts().length && !staged().length;
  const doContinue = () => {
    const w = ws();
    if (!w) return;
    // 스테이지된 해결 결과로 merge 커밋을 만든다 — merge는 commit --no-edit, 나머지는 --continue
    guarded(continueArgs());
  };
  const doAbort = () =>
    confirmThen(
      {
        title: tf("{op} 중단", { op: progress()! }),
        body: <p>{t("시작하기 전 상태로 돌아갑니다. 그사이 고친 충돌 해결은 사라집니다.")}</p>,
        info: [commandLine([progress()!, "--abort"])],
        confirmLabel: t("중단 (--abort)"),
      },
      [progress()!, "--abort"],
    );

  // 충돌 파일 하나 — 작업 트리 원문의 표식을 덩어리별로 고른다
  const [conflictText, setConflictText] = createSignal<{ path: string; parts: ConflictPart[]; mtime: number } | undefined>();
  const [picks, setPicks] = createSignal<(ConflictPick | undefined)[]>([]);
  const openConflict = async (path: string) => {
    const w = ws();
    if (!w) return;
    setHunkFile({ path, staged: false });
    const c = await fsRead(w.path, path).catch(() => undefined);
    setConflictText(c ? { path, parts: conflictParts(c.text), mtime: c.mtimeMs } : { path, parts: [], mtime: 0 });
    setPicks([]);
  };
  const conflictBlocks = () => conflictText()?.parts.filter((p) => p.kind === "conflict") ?? [];
  const saveConflict = async () => {
    const w = ws();
    const c = conflictText();
    if (!w || !c) return;
    try {
      await fsWrite(w.path, c.path, resolveConflicts(c.parts, picks()), c.mtime);
    } catch (e) {
      notify(`${t("저장 실패 — 파일이 그사이 바뀌었을 수 있습니다. 다시 여세요")} (${String(e)})`);
      return;
    }
    // 다 골랐으면 스테이지까지 — 남은 표식이 있으면 git이 아직 충돌로 본다
    if (picks().filter(Boolean).length === conflictBlocks().length) await run(["add", "--", c.path], { quiet: true });
    setConflictText(undefined);
    setHunkFile(undefined);
  };

  // [세션에게 해결 맡기기] — 사람이 세션을 고르고 문구를 고친 뒤 보낸다
  const [delegate, setDelegate] = createSignal<{ to: string; body: string } | undefined>();
  const delegateTargets = () => backend.listSessions().filter((s) => s.workspaceId === ws()?.id && s.status !== "dead" && s.status !== "shell");
  const openDelegate = () =>
    setDelegate({
      to: delegateTargets()[0]?.id ?? "",
      body: tf(
        "git {op} 중 충돌이 났습니다. 아래 파일의 충돌 표식(<<<<<<< ======= >>>>>>>)을 고치고 `git add`까지만 해 주세요. 커밋 · --continue는 사람이 git 화면에서 합니다.\n{files}",
        { op: progress() ?? "stash", files: conflicts().map((f) => `- ${f.path}`).join("\n") },
      ),
    });
  const sendDelegate = async () => {
    const w = ws();
    const d = delegate();
    if (!w || !d?.to) return;
    const err = await sendConversation(w.id, d.to, "ask", d.body);
    if (err) return notify(err);
    setDelegate(undefined);
    notify(tf("{n}에게 보냈습니다", { n: conflictName(d.to) }), "ok");
  };

  // B154 — .env 계열은 덩어리 · blame에서도 값을 가린다
  const [revealEnv, setRevealEnv] = createSignal(false);
  const maskFor = (path: string | undefined) => !revealEnv() && isDotenvPath(path);
  const diffLine = (l: string, mask: boolean) => (mask && /^[ +-]/.test(l) ? l[0] + maskDotenvLine(l.slice(1)) : l);

  // ── 툴바 동작 ──
  const doFetch = () => void run(["fetch", "--all", "--prune"]);
  const doPull = () => guarded(["pull", "--ff-only"]);
  const pushArgs = () => pushArgsOf(refs());
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
    guarded(["switch", name]);
  };
  const newBranch = (at?: string) =>
    setPrompt({
      title: at ? tf("{h}에서 브랜치 만들기", { h: at.slice(0, 8) }) : t("현재 HEAD에서 브랜치 만들기"),
      label: t("브랜치 이름"),
      check: t("만든 뒤 전환"),
      confirmLabel: t("만들기"),
      onConfirm: async (n, _m, sw) => {
        setPrompt(undefined);
        const r = await run(at ? ["branch", n, at] : ["branch", n]);
        if (r?.ok && sw) guarded(["switch", n]); // P61 — 만들기만 하면 원래 브랜치에 커밋하기 쉽다
      },
    });
  /** P61 — 원격 브랜치를 따라가는 로컬 브랜치를 만들고 전환한다. 이미 있으면 그리로 전환 */
  const trackRemote = (remote: string) => {
    const local = remote.slice(remote.indexOf("/") + 1);
    if (refs()?.local.some((b) => b.name === local)) return switchTo(local);
    guarded(["switch", "--track", remote]);
  };
  const setUpstream = (b: BranchRef) =>
    setPrompt({
      title: tf("{b}의 업스트림 설정", { b: b.name }),
      label: t("원격 브랜치 (예: origin/main)"),
      initial: b.upstream || `${pushRemote((refs()?.remote ?? []).map((r) => r.name))}/${b.name}`,
      confirmLabel: t("업스트림 설정"),
      onConfirm: (up) => (setPrompt(undefined), void run(["branch", "-u", up, b.name])),
    });
  const renameBranch = (old: string) =>
    setPrompt({
      title: tf("{b} 이름 바꾸기", { b: old }),
      label: t("새 이름"),
      initial: old,
      confirmLabel: t("바꾸기"),
      onConfirm: (n) => (setPrompt(undefined), void run(["branch", "-m", old, n])),
    });
  /** U124 — 병합 여부와 상관없이 한 번 묻고, 성공하면 되살릴 명령을 알린다 */
  const deleteBranch = (name: string, hash: string) =>
    setConfirm({
      title: tf("브랜치 {b} 삭제", { b: name }),
      body: <p>{t("병합된 브랜치만 지웁니다. 병합 안 된 브랜치면 한 번 더 묻습니다.")}</p>,
      info: [commandLine(["branch", "-d", name]), tf("되살리기: git branch {b} {h}", { b: name, h: hash.slice(0, 10) })],
      danger: true,
      confirmLabel: t("삭제"),
      onConfirm: () => (setConfirm(undefined), void deleteMerged(name, hash)),
    });
  const deleted = (name: string, hash: string) => notify(tf("{b} 삭제 — 되살리기: git branch {b} {h}", { b: name, h: hash.slice(0, 10) }), "ok");
  const deleteMerged = async (name: string, hash: string) => {
    const r = await run(["branch", "-d", name], { quiet: true });
    if (r?.ok) return deleted(name, hash);
    if (!r || !/not fully merged|완전히 병합되지/i.test(r.output)) return;
    // 병합 안 된 브랜치 — 무엇이 사라지는지와 되돌릴 해시를 보이고 한 번 더 묻는다 (§17-4)
    setConfirm({
      title: tf("병합 안 된 브랜치 {b} 삭제", { b: name }),
      body: <p>{t("이 브랜치에만 있는 커밋이 어느 브랜치에서도 보이지 않게 됩니다.")}</p>,
      info: [commandLine(["branch", "-D", name]), tf("되돌릴 해시: {h} (git branch {b} {h})", { h: hash.slice(0, 10), b: name })],
      danger: true,
      confirmLabel: t("삭제"),
      onConfirm: async () => {
        setConfirm(undefined);
        if ((await run(["branch", "-D", name], { quiet: true }))?.ok) deleted(name, hash);
      },
    });
  };
  const deleteTag = (r: { name: string; hash: string }) =>
    setConfirm({
      title: tf("태그 {t} 삭제", { t: r.name }),
      body: <p>{t("로컬 태그만 지웁니다. 원격에 올린 태그는 그대로입니다.")}</p>,
      info: [commandLine(["tag", "-d", r.name]), tf("되살리기: git tag {t} {h}", { t: r.name, h: r.hash.slice(0, 10) })],
      danger: true,
      confirmLabel: t("삭제"),
      onConfirm: async () => {
        setConfirm(undefined);
        if ((await run(["tag", "-d", r.name], { quiet: true }))?.ok)
          notify(tf("{t} 삭제 — 되살리기: git tag {t} {h}", { t: r.name, h: r.hash.slice(0, 10) }), "ok");
      },
    });
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
  // B171 — git은 표식(<<<<<<<)이 남은 충돌 파일도 add를 받아 해결로 친다. 표식이 남은 파일은 빼고 [충돌 보기]로 보낸다
  const stageFiles = async (fs: StatusFile[]) => {
    const w = ws();
    if (!w || !fs.length) return;
    const marked: string[] = [];
    for (const f of fs.filter(isConflict)) {
      const c = await fsRead(w.path, f.path).catch(() => undefined); // 못 읽음 = 한쪽이 지운 파일 — 표식 없음
      if (c && conflictParts(c.text).some((p) => p.kind === "conflict")) marked.push(f.path);
    }
    if (marked.length) {
      notify(tf("충돌 표식이 남은 파일 {n}개는 스테이지하지 않았습니다 — [충돌 보기]에서 먼저 푸세요", { n: marked.length }));
      void openConflict(marked[0]);
    }
    const rest = fs.filter((f) => !marked.includes(f.path));
    await runChunked(["add", "--"], rest.map((f) => f.path));
  };
  /** B179 — 경로를 한 번에 다 붙이면 Windows 명령 줄 상한(32,767자)을 넘는다. 묶음마다 돌리고 실패하면 멈춘다 */
  const runChunked = async (head: string[], paths: string[]) => {
    for (const c of chunkPaths(paths)) {
      const r = await run([...head, ...c], { quiet: true });
      if (!r?.ok) return;
    }
  };
  const unstageFiles = (fs: StatusFile[]) => {
    if (!fs.length) return;
    const paths = fs.flatMap((f) => (f.from ? [f.from, f.path] : [f.path]));
    // HEAD가 없으면(첫 커밋 전) restore --staged가 안 된다 — 인덱스에서만 뺀다
    void runChunked(work()?.hasHead ? ["restore", "--staged", "--"] : ["rm", "--cached", "-q", "--"], paths);
  };

  const [hunkFile, setHunkFile] = createSignal<{ path: string; staged: boolean } | undefined>();
  const [hunks, setHunks] = createSignal<FilePatch | undefined>();
  const [openHunks, setOpenHunks] = createSignal<number[]>([]); // U114 — 39줄 넘는 덩어리 중 펼친 것
  /** 덩어리 본문 줄 — 머리(@@) 다음부터, 끝 줄바꿈이 만든 빈 줄은 뺀다 */
  const hunkBody = (hk: string) => {
    const l = hk.split("\n").slice(1);
    return l[l.length - 1] === "" ? l.slice(0, -1) : l;
  };
  const loadHunks = async () => {
    const w = ws();
    const h = hunkFile();
    if (!w || !h) return setHunks(undefined);
    setHunks(splitHunks(await gitFilePatch(w.path, h.path, h.staged)));
  };
  createEffect(on(hunkFile, () => (setOpenHunks([]), void loadHunks())));
  createEffect(on(work, () => hunkFile() && void loadHunks(), { defer: true }));
  const applyHunk = async (i: number) => {
    const w = ws();
    const p = hunks();
    const h = hunkFile();
    if (!w || !p || !h || running()) return;
    setRunning("git apply --cached");
    const r = await gitApplyPatch(w.id, w.path, hunkPatch(p, i), h.staged);
    setRunning(undefined);
    if (!r.ok) notify(`${t("덩어리 적용 실패")} — ${failText(r.output)}`);
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
      [
        { label: t("체크아웃 (브랜치 없이)"), action: () => checkoutDetached(c) },
        { label: t("cherry-pick"), action: () => cherryPick(c) },
        { label: t("revert (되돌리는 새 커밋)"), action: () => revert(c) },
        {
          label: t("여기로 reset"),
          sub: [
            { label: t("--soft (변경을 스테이지에 남김)"), action: () => void resetTo(c, "soft") },
            { label: t("--mixed (변경을 작업 트리에 남김)"), action: () => void resetTo(c, "mixed") },
            { label: t("--hard (변경을 버림)…"), danger: true, action: () => void resetTo(c, "hard") },
          ],
        },
      ],
    ]);
  const branchMenu = (e: MouseEvent, b: BranchRef) =>
    openMenu(e, b.name, [
      [
        { label: t("전환"), disabled: b.head, action: () => switchTo(b.name) },
        { label: t("이름 변경"), action: () => renameBranch(b.name) },
        { label: t("여기서 브랜치 만들기"), action: () => newBranch(b.hash) },
        { label: t("업스트림 설정…"), action: () => setUpstream(b) },
      ],
      [{ label: t("해시 복사"), action: () => void clipWriteText(b.hash) }],
      [
        { label: t("현재 브랜치로 merge"), disabled: b.head, action: () => mergeIn(b.name) },
        { label: t("현재 브랜치를 그 위로 rebase"), disabled: b.head || !head(), action: () => rebaseOnto(b.name) },
      ],
      [{ label: t("삭제…"), danger: true, disabled: b.head, action: () => deleteBranch(b.name, b.hash) }],
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
      onClick={() => (isConflict(f) ? void openConflict(f.path) : (setConflictText(undefined), setHunkFile({ path: f.path, staged: isStaged })))}
    >
      <span class="gx-st" classList={{ conflict: isConflict(f) }}>{isConflict(f) ? "!" : isStaged ? f.x : f.y === "?" ? "?" : f.y}</span>
      <span class="gx-wpath">{f.path}</span>
      {/* §17-3 동시 편집 표시 — §13-1 경고가 살아 있는 파일 */}
      <Show when={activeConflicts().find((c) => c.workspace === ws()?.id && c.path === f.path)}>
        {(c) => (
          <span class="gx-who warn" title={t("여러 세션이 이 파일을 동시에 편집 중 (편집 도구 기준)")}>
            ⚠ {c().sessions.map(conflictName).join(" · ")}
          </span>
        )}
      </Show>
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
        <span class="mono muted gx-head" title={head()?.name}>
          ⎇ {head()?.name ?? headLabel()}
        </span>
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
        {/* P62 — 갈라졌으면 --ff-only pull은 실패한다. 다음 할 일(merge · rebase)을 Pull 옆에 바로 둔다 */}
        <Show when={head()?.upstream && head()!.ahead > 0 && head()!.behind > 0 ? head()!.upstream : undefined}>
          {(up) => (
            <button
              class="btn ghost gx-mini"
              disabled={!!running()}
              title={t("원격과 갈라졌습니다 — merge 또는 rebase")}
              aria-label={t("원격과 갈라졌습니다 — merge 또는 rebase")}
              onClick={(e) =>
                openMenu(e, tf("{u}와 갈라짐", { u: up() }), [
                  [
                    { label: t("업스트림을 merge"), action: () => mergeIn(up()) },
                    { label: t("업스트림 위로 rebase"), action: () => rebaseOnto(up()) },
                  ],
                ])
              }
            >
              ▾
            </button>
          )}
        </Show>
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
        <button class="btn" disabled={!!running() || !ws() || !work()?.hasHead} onClick={() => newBranch()}>
          + {t("브랜치")}
        </button>
        <button class="btn" disabled={!!running() || !ws() || !work()?.hasHead} onClick={() => newTag()}>
          + {t("태그")}
        </button>
        <button
          class="btn"
          disabled={!!running() || !ws() || !work()?.hasHead || !work()?.files.length}
          title={t("작업 트리 변경을 stash에 넣습니다 — 사이드바 Stash에서 적용 · 꺼내기")}
          onClick={stashPush}
          onContextMenu={copyMenu(["stash", "push", "-u"])}
        >
          {t("Stash")}
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
      {/* U126 — stash 적용 · 꺼내기 충돌은 진행 중 표식이 없다. 충돌 파일만 있어도 배너를 띄운다 */}
      <Show when={progress() || conflicts().length > 0}>
          <div class="gx-banner warn">
            <span>
              {progress()
                ? tf("{op} 진행 중", { op: progress()! }) +
                  (conflicts().length
                    ? tf(" — 충돌 {n}개", { n: conflicts().length })
                    : emptyStep()
                      ? t(" — 이 커밋의 변경이 이미 있습니다. [건너뛰기]로 넘어갑니다")
                      : t(" — 충돌을 다 풀었습니다. [계속]으로 마칩니다"))
                : tf("충돌 {n}개 — 고른 뒤 스테이지하세요", { n: conflicts().length })}
            </span>
            <Show when={conflicts().length}>
              <button class="btn ghost" onClick={() => void openConflict(conflicts()[0].path)}>
                {t("충돌 보기")}
              </button>
              <button class="btn ghost" disabled={!delegateTargets().length} onClick={openDelegate}>
                {t("세션에게 해결 맡기기")}
              </button>
            </Show>
            <Show when={progress()}>
              {(op) => (
                <>
                  <Show when={emptyStep()}>
                    <button
                      class="btn primary"
                      disabled={!!running()}
                      title={commandLine([op(), "--skip"])}
                      onClick={() => guarded([op(), "--skip"])}
                      onContextMenu={copyMenu([op(), "--skip"])}
                    >
                      {t("건너뛰기 (--skip)")}
                    </button>
                  </Show>
                  <button
                    class="btn"
                    classList={{ primary: !emptyStep() }}
                    disabled={!!running() || conflicts().length > 0 || emptyStep()}
                    title={commandLine(continueArgs())}
                    onClick={doContinue}
                    onContextMenu={copyMenu(continueArgs())}
                  >
                    {t("계속")}
                  </button>
                  <button class="btn" disabled={!!running()} onClick={doAbort} onContextMenu={copyMenu([op(), "--abort"])}>
                    {t("중단 (--abort)")}
                  </button>
                </>
              )}
            </Show>
          </div>
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
                <div
                  class="gx-ref mono"
                  classList={{ on: sel() === r.hash }}
                  title={t("더블클릭: 따라가는 로컬 브랜치를 만들고 전환")}
                  onClick={() => setSel(r.hash)}
                  onDblClick={() => !r.name.endsWith("/HEAD") && trackRemote(r.name)}
                  onContextMenu={(e) =>
                    openMenu(e, r.name, [
                      [
                        { label: t("따라가는 로컬 브랜치 만들고 전환"), disabled: r.name.endsWith("/HEAD"), action: () => trackRemote(r.name) },
                        { label: t("여기서 브랜치 만들기"), action: () => newBranch(r.hash) },
                        { label: t("해시 복사"), action: () => void clipWriteText(r.hash) },
                      ],
                      [
                        { label: t("현재 브랜치로 merge"), action: () => mergeIn(r.name) },
                        { label: t("현재 브랜치를 그 위로 rebase"), disabled: !head(), action: () => rebaseOnto(r.name) },
                      ],
                    ])
                  }>
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
                      [{ label: t("태그 삭제…"), danger: true, action: () => deleteTag(r) }],
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
                <div
                  class="gx-ref mono"
                  title={t("우클릭: 적용 · 꺼내기 · 버리기")}
                  onClick={() => setSel(r.hash)}
                  onContextMenu={(e) =>
                    openMenu(e, r.name, [
                      [
                        { label: t("적용 (apply — 목록에 남김)"), action: () => guarded(["stash", "apply", stashRef(r.name)]) },
                        {
                          label: t("꺼내기 (pop — 적용하고 목록에서 뺌)"),
                          action: () =>
                            guarded(["stash", "pop", stashRef(r.name)], (res) => {
                              // U126 — 충돌이 나면 git은 stash를 목록에 남긴다. 풀고 나서 버려야 다시 적용되지 않는다
                              if (res && !res.ok && /stash entry is kept|CONFLICT/.test(res.output))
                                notify(tf("{s}이(가) 목록에 남았습니다 — 충돌을 푼 뒤 버리세요", { s: stashRef(r.name) }));
                            }),
                        },
                      ],
                      [{ label: t("버리기…"), danger: true, action: () => stashDrop(r) }],
                    ])
                  }
                >
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
                <Show when={blameOn() && isDotenvPath(f())}>
                  <button class="btn ghost" onClick={() => setRevealEnv(!revealEnv())}>
                    {t(revealEnv() ? "값 가리기" : "값 보기")}
                  </button>
                </Show>
                <button class="btn ghost" onClick={() => (setFile(undefined), setBlameOn(false))}>
                  {t("전체 이력으로")}
                </button>
              </div>
            )}
          </Show>
          <Show when={logErr()}>
            <div class="card conn-error mono">{t(logErr()!)}</div>
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
                                title={ref}
                                classList={{ remote: !ref.startsWith("tag: ") && ref.includes("/") && !ref.startsWith("HEAD -> "), tag: ref.startsWith("tag: "), headref: ref.startsWith("HEAD") }}
                              >
                                {ref.replace(/^HEAD -> /, "● ")}
                              </span>
                            )}
                          </For>
                          {c.subject}
                        </span>
                        <For each={bySession()[c.hash] ?? []}>
                          {(sid) => (
                            <span class="gx-who mono" title={t("이 커밋의 파일을 편집 도구로 고친 세션 (편집 기록 기준 추정)")}>
                              {conflictName(sid)}
                            </span>
                          )}
                        </For>
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
                      <span class="gx-bl-tx">{maskFor(file()) ? maskDotenvLine(l.text) : l.text}</span>
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
                  <Show when={isDotenvPath(h().path)}>
                    <button class="btn ghost gx-mini" onClick={() => setRevealEnv(!revealEnv())}>
                      {t(revealEnv() ? "값 가리기" : "값 보기")}
                    </button>
                  </Show>
                  <button class="btn ghost gx-mini" onClick={() => (setHunkFile(undefined), setConflictText(undefined))}>
                    <Icon name="x" size={11} />
                  </button>
                </div>
                <Show when={conflictText()?.path === h().path ? conflictText() : undefined}>
                  {(c) => (
                    <div class="gx-wlist">
                      <Show
                        when={conflictBlocks().length}
                        fallback={
                          <div class="muted gx-empty">
                            {t("충돌 표식이 없습니다 — 한쪽이 지운 파일이거나 이미 고쳤습니다. 남길 내용이면 스테이지하세요.")}{" "}
                            <button class="btn ghost gx-mini" onClick={() => void run(["add", "--", c().path], { quiet: true })}>
                              {t("스테이지")}
                            </button>
                          </div>
                        }
                      >
                        <For each={conflictBlocks()}>
                          {(b, i) =>
                            b.kind === "conflict" && (
                              <div class="gx-hunk mono">
                                <div class="gx-hunk-head">
                                  <span>{tf("충돌 {n}", { n: i() + 1 })}</span>
                                  <span>
                                    <For each={["ours", "theirs", "both"] as const}>
                                      {(k) => (
                                        <button
                                          class="btn ghost gx-mini"
                                          classList={{ on: picks()[i()] === k }}
                                          onClick={() => setPicks((p) => Object.assign([...p], { [i()]: k }))}
                                        >
                                          {t(k === "ours" ? "우리 것" : k === "theirs" ? "저쪽 것" : "둘 다")}
                                        </button>
                                      )}
                                    </For>
                                  </span>
                                </div>
                                <pre class="gx-ours" title={b.oursLabel}>
                                  {maskFor(c().path) ? b.ours.split("\n").map(maskDotenvLine).join("\n") : b.ours}
                                </pre>
                                <pre class="gx-theirs" title={b.theirsLabel}>
                                  {maskFor(c().path) ? b.theirs.split("\n").map(maskDotenvLine).join("\n") : b.theirs}
                                </pre>
                              </div>
                            )
                          }
                        </For>
                        <button class="btn primary" disabled={!picks().some(Boolean)} onClick={() => void saveConflict()}>
                          {picks().filter(Boolean).length === conflictBlocks().length ? t("저장하고 스테이지") : t("고른 것만 저장")}
                        </button>
                      </Show>
                    </div>
                  )}
                </Show>
                <Show when={conflictText()?.path !== h().path && hunks()?.hunks.length} fallback={
                    <Show when={conflictText()?.path !== h().path}>
                      <div class="muted gx-empty">{t("덩어리가 없습니다 — 새 파일·바이너리는 파일 단위로 스테이지하세요")}</div>
                    </Show>
                  }
                >
                  <div class="gx-wlist">
                    <For each={hunks()!.hunks}>
                      {(hk, i) => {
                        const body = hunkBody(hk);
                        const folded = () => body.length > HUNK_LINES && !openHunks().includes(i());
                        return (
                          <div class="gx-hunk mono">
                            <div class="gx-hunk-head">
                              <span>{hunkRange(hk)}</span>
                              <button
                                class="btn ghost gx-mini"
                                disabled={!!running()}
                                title={folded() ? tf("보이지 않는 줄까지 덩어리 전체 {n}줄을 옮깁니다", { n: body.length }) : undefined}
                                onClick={() => void applyHunk(i())}
                              >
                                {h().staged ? t("덩어리 내리기") : t("덩어리 스테이지")}
                              </button>
                            </div>
                            <pre>
                              <For each={folded() ? body.slice(0, HUNK_LINES) : body}>
                                {(l) => <div classList={{ add: l.startsWith("+"), del: l.startsWith("-") }}>{diffLine(l, maskFor(h().path))}</div>}
                              </For>
                            </pre>
                            {/* U114 — 잘린 덩어리는 잘렸다고 보인다. [덩어리 스테이지]는 전체를 옮긴다 */}
                            <Show when={folded()}>
                              <button class="btn ghost gx-mini" onClick={() => setOpenHunks([...openHunks(), i()])}>
                                ⋯ {tf("{n}줄 접힘 — 펼치기", { n: body.length - HUNK_LINES })}
                              </button>
                            </Show>
                          </div>
                        );
                      }}
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

      <Show when={confirm()} keyed>
        {(c) => (
          <ConfirmDialog
            title={c.title}
            body={c.body}
            info={c.info}
            danger={c.danger}
            confirmLabel={c.confirmLabel}
            onConfirm={c.onConfirm}
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
            free={p().free}
            check={p().check}
            confirmLabel={p().confirmLabel}
            onConfirm={p().onConfirm}
            onCancel={() => setPrompt(undefined)}
          />
        )}
      </Show>
      <Show when={delegate()}>
        {(d) => (
          <DelegateDialog
            targets={delegateTargets().map((x) => ({ id: x.id, name: conflictName(x.id) }))}
            to={d().to}
            body={d().body}
            onChange={(to, body) => setDelegate({ to, body })}
            onSend={() => void sendDelegate()}
            onCancel={() => setDelegate(undefined)}
          />
        )}
      </Show>
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} header={m().header} groups={m().groups} onClose={() => setMenu(undefined)} />}
      </Show>
    </div>
  );
}
