// 확장 그룹 (0.6 §12) — 사이드 패널 [MCP | 플러그인 | 스킬]. 엔진(Claude Code)의 확장을 보고 관리한다.
// 원칙: 상태를 바꾸는 것은 사람의 버튼이다. 전체(user) 범위를 바꾸는 버튼은 확인창을 거친다(결정 X1).
// 워크스페이스 범위의 플러그인은 local로 바꾼다(X2 — project는 커밋되어 팀원에게 번진다).
// 세션별 표는 읽기만 한다(3단계) — 세션별 쓰기(역할 frontmatter extensions)는 4단계다.
// 바꾼 것은 새로 띄우는 세션부터 먹는다. 자동 재시작은 하지 않는다.
import { createEffect, createMemo, createResource, createSignal, For, lazy, on, Show } from "solid-js";
import type { JSX } from "solid-js";
import { agentClis, agentClisReady, refreshAgentClis } from "../backend/agentprobe";
import {
  duplicateNames,
  listPlugins,
  mcpCheck,
  mcpCommand,
  mcpScan,
  parseAlwaysOn,
  parseMcpList,
  pluginDetails,
  sessionCell,
  setPluginEnabled,
  skillCopy,
  skillCreate,
  skillsList,
  validSkillName,
} from "../backend/extensions";
import type { Cell, ExtScope, McpHealth, PluginRow, SkillRow } from "../backend/extensions";
import { backend } from "../backend/mock";
import { fsDelete, fsRead, fsWrite } from "../backend/panels";
import { serverExited, serverTermId } from "../backend/ports";
import { isTauri, listAlivePty, onPtyOutput, revealPath, writePty } from "../backend/pty";
import { scopeWorkspace, setPanelTab } from "../state";
import { agentAttached, cliOf, sessionName } from "../types";
import type { Session } from "../types";
import { t, tf } from "../i18n";
import { markdownHtml } from "./markdownHtml";
import { mdLinkClick, resolveRel } from "./MdViewTab";
import { openServerTerm } from "./ServerPanelTab";
import { ConfirmDialog, notify, Segmented } from "./ui";

// CodeMirror는 무겁다 — 편집을 열 때만 받는다 (EnvPanelTab과 같은 방식)
const CodeEditor = lazy(() => import("./CodeEditor").then((m) => ({ default: m.CodeEditor })));

/** 사이드 패널이 부르는 자리 — 하위 탭(mcp · plugins · skills)은 패널 공통 세그먼트가 나눈다 */
export function ExtensionsPanelTab(props: { kind: "mcp" | "plugins" | "skills" }) {
  return (
    <>
      <Show when={props.kind === "mcp"}>
        <McpPanelTab />
      </Show>
      <Show when={props.kind === "plugins"}>
        <PluginsPanelTab />
      </Show>
      <Show when={props.kind === "skills"}>
        <SkillsPanelTab />
      </Show>
    </>
  );
}

// 탭을 닫았다 열어도 고른 범위는 남긴다 (앱 수명 동안)
const [pluginScope, setPluginScope] = createSignal<ExtScope>("workspace");
const [skillScope, setSkillScope] = createSignal<ExtScope>("workspace");

function ScopeChips(props: { value: ExtScope; onChange: (v: ExtScope) => void }) {
  return (
    <Segmented
      label={t("범위")}
      items={[
        { value: "all" as ExtScope, label: t("전체") },
        { value: "workspace" as ExtScope, label: t("이 워크스페이스") },
        { value: "session" as ExtScope, label: t("세션별") },
      ]}
      value={props.value}
      onChange={props.onChange}
    />
  );
}

type Ask = { title: string; body: string; danger?: boolean; ok: string; cancel?: string; run: () => void };
/** 확인창 하나를 띄우고 결과를 기다리는 작은 배관 — 버튼마다 상태 신호를 따로 두지 않게 */
function useConfirm() {
  const [ask, setAsk] = createSignal<Ask>();
  const view = (): JSX.Element => (
    <Show when={ask()}>
      {(a) => (
        <ConfirmDialog
          title={a().title}
          body={<p>{a().body}</p>}
          danger={a().danger}
          confirmLabel={a().ok}
          cancelLabel={a().cancel}
          onConfirm={() => {
            const run = a().run;
            setAsk(undefined);
            run();
          }}
          onCancel={() => setAsk(undefined)}
        />
      )}
    </Show>
  );
  return { ask: setAsk, view };
}

const ALL_SCOPE_NOTE = "모든 워크스페이스의 새 세션에 적용됩니다";
const RESTART_NOTE = "새로 띄우는 세션부터 적용됩니다 — 이미 떠 있는 세션은 재시작해야 반영됩니다";

const engineOf = (s: Session) => s.spawnCli ?? cliOf(s);
/** 플러그인이 실리는 세션 — 살아 있는 Claude 세션만 (B193). Codex는 세션별 범위를 실측 전까지 뺀다(결정 X5),
 *  꺼진 세션은 아무것도 싣지 않는다 */
const wsSessions = (wsId: string | undefined): Session[] =>
  wsId ? backend.listSessions().filter((s) => s.workspaceId === wsId && agentAttached(s) && engineOf(s) === "claude") : [];

/** claude CLI가 PATH에 없다 (B182) — 실측이 끝났을 때만 참. CLI를 불러 보기 전에 원인을 먼저 말한다 */
const claudeMissing = () => isTauri() && agentClisReady() && !agentClis().some((a) => a.cmd === "claude" && a.installed);

function EngineMissing() {
  return (
    <div class="engine-missing mono">
      <div class="st-dead">{tf("PATH에 {cmd}가 없습니다 — 설치 후 설정 > CLI 에이전트에서 다시 확인하세요", { cmd: "claude" })}</div>
      <button class="btn ghost" onClick={() => void refreshAgentClis()}>
        {t("다시 감지")}
      </button>
    </div>
  );
}

/** 하위 탭 머리의 [다시 읽기] (U131) — 글리프만 있으면 스크린 리더가 '⟳'로 읽는다 */
function ReloadButton(props: { onClick: () => void }) {
  return (
    <button class="btn ghost" title={t("다시 읽기")} aria-label={t("다시 읽기")} onClick={props.onClick}>
      ⟳
    </button>
  );
}

const sessionLabel = (s: Session) => sessionName(s, backend.listPersonas().find((p) => p.id === s.personaId));

// ── 플러그인 ──

export function PluginsPanelTab() {
  const ws = () => scopeWorkspace();
  const cwd = () => (pluginScope() === "all" ? undefined : ws()?.path);
  const [rows, { refetch }] = createResource(
    () => ({ cwd: cwd(), scope: pluginScope(), missing: claudeMissing() }),
    (k) =>
      k.missing
        ? []
        : listPlugins(k.cwd).catch((e) => (notify(tf("플러그인 목록을 읽지 못했습니다 — {err}", { err: String(e) })), [])),
  );
  const [busy, setBusy] = createSignal<string>();
  const [changed, setChanged] = createSignal(false);
  const [details, setDetails] = createSignal<{ id: string; text: string }>();
  const confirm = useConfirm();

  const toggle = (p: PluginRow) => {
    const all = pluginScope() === "all";
    const run = async () => {
      setBusy(p.id);
      try {
        await setPluginEnabled(p.id, !p.enabled, all ? "user" : "local", cwd());
        setChanged(true);
        void refetch();
      } catch (e) {
        notify(tf("바꾸지 못했습니다 — {err}", { err: String(e) }));
      } finally {
        setBusy(undefined);
      }
    };
    if (!all) return void run();
    confirm.ask({
      title: tf(p.enabled ? "{id} 끄기 — 전체" : "{id} 켜기 — 전체", { id: p.id }),
      body: t(ALL_SCOPE_NOTE),
      ok: t(p.enabled ? "끄기" : "켜기"),
      run: () => void run(),
    });
  };

  const openDetails = async (p: PluginRow) => {
    if (details()?.id === p.id) return setDetails(undefined);
    try {
      setDetails({ id: p.id, text: await pluginDetails(p.id, cwd()) });
    } catch (e) {
      notify(tf("상세를 읽지 못했습니다 — {err}", { err: String(e) }));
    }
  };

  return (
    <div class="extp">
      <div class="extp-head">
        <ScopeChips value={pluginScope()} onChange={(v) => (setPluginScope(v), setChanged(false))} />
        <ReloadButton onClick={() => void refetch()} />
      </div>
      <Show when={isTauri()} fallback={<div class="muted">{t("앱에서만 됩니다")}</div>}>
        <Show when={!claudeMissing()} fallback={<EngineMissing />}>
        <Show when={pluginScope() === "all" || ws()} fallback={<div class="muted">{t("워크스페이스를 먼저 여세요")}</div>}>
          <Show when={pluginScope() !== "session"} fallback={<SessionTable plugins={rows() ?? []} skills={[]} />}>
            <div class="muted extp-note">
              {t(pluginScope() === "all" ? "전체 — 사용자 설정(--scope user)을 바꿉니다" : "이 워크스페이스 — 나만 쓰는 local 설정을 바꿉니다 (커밋되지 않음)")}
            </div>
            <Show when={!rows.loading} fallback={<div class="muted">{t("읽는 중…")}</div>}>
              <Show when={(rows() ?? []).length > 0} fallback={<div class="muted">{t("설치된 플러그인이 없습니다")}</div>}>
                <div class="extp-list">
                  <For each={rows()}>
                    {(p) => (
                      <>
                        <div class="extp-row">
                          <span class="extp-dot" classList={{ on: p.enabled }} role="img" aria-label={t(p.enabled ? "켜짐" : "꺼짐")} />
                          <span class="extp-name mono" title={p.installPath}>
                            {p.id}
                          </span>
                          <span class="muted mono">{p.version}</span>
                          <span class="badge mono">{p.scope}</span>
                          {/* 글자는 누르면 할 동작이다 (U117) — 지금 상태는 앞의 점이 보인다 */}
                          <button class="btn" disabled={busy() === p.id} onClick={() => toggle(p)}>
                            {t(p.enabled ? "끄기" : "켜기")}
                          </button>
                          <button
                            class="btn ghost"
                            title={t("상세")}
                            aria-label={tf("{id} 상세", { id: p.id })}
                            aria-expanded={details()?.id === p.id}
                            onClick={() => void openDetails(p)}
                          >
                            ⋯
                          </button>
                        </div>
                        <Show when={details()?.id === p.id}>
                          <PluginDetails text={details()!.text} sessions={wsSessions(ws()?.id).length} />
                        </Show>
                      </>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
            <Show when={changed()}>
              <div class="extp-banner">{t(RESTART_NOTE)}</div>
            </Show>
          </Show>
        </Show>
        </Show>
      </Show>
      {confirm.view()}
    </div>
  );
}

function PluginDetails(props: { text: string; sessions: number }) {
  const cost = () => parseAlwaysOn(props.text);
  return (
    <div class="card inset extp-details">
      <Show when={cost() !== undefined && props.sessions > 0}>
        <div class="extp-cost">{tf("이 워크스페이스 세션 {n}개 × ~{tok} tok = ~{sum} tok", { n: props.sessions, tok: cost()!, sum: cost()! * props.sessions })}</div>
      </Show>
      <pre class="mono">{props.text}</pre>
    </div>
  );
}

// ── 세션별 적용 현황 (읽기만) ──

/** 상시 토큰 비용 캐시 — id@버전 단위. details는 CLI 한 번이라 탭을 오갈 때마다 다시 부르지 않는다 */
const costCache = new Map<string, number | undefined>();

function SessionTable(props: { plugins: PluginRow[]; skills: SkillRow[] }) {
  const ws = () => scopeWorkspace();
  const sessions = createMemo(() => wsSessions(ws()?.id));
  const engine = (s: Session) => s.spawnCli ?? cliOf(s);
  const [costs] = createResource(
    () => props.plugins.filter((p) => p.enabled),
    async (on) => {
      await Promise.all(
        on
          .filter((p) => !costCache.has(`${p.id}@${p.version}`))
          .map((p) =>
            pluginDetails(p.id, ws()?.path).then(
              (txt) => costCache.set(`${p.id}@${p.version}`, parseAlwaysOn(txt)),
              () => costCache.set(`${p.id}@${p.version}`, undefined),
            ),
          ),
      );
      return new Map(costCache);
    },
  );
  const sum = (s: Session) =>
    props.plugins
      .filter((p) => sessionCell(p, engine(s)) === "on")
      .reduce((n, p) => n + (costs()?.get(`${p.id}@${p.version}`) ?? 0), 0);
  const mark = (c: Cell) => (c === "on" ? "✓" : c === "off" ? "⊘" : "–");
  const skillCell = (s: Session): Cell => (engine(s) === "claude" ? "on" : "none");

  return (
    <Show when={sessions().length > 0} fallback={<div class="muted">{t("이 워크스페이스에 에이전트 세션이 없습니다")}</div>}>
      <div class="muted extp-note">{t("읽기 전용 — 세션별로 싣고 끄는 기능은 다음 단계입니다. Codex 세션은 실측 전까지 표시하지 않습니다")}</div>
      <div class="extp-table-wrap">
        <table class="extp-table">
          <thead>
            <tr>
              <th />
              <For each={sessions()}>
                {(s) => (
                  <th title={s.id}>
                    <div>{sessionLabel(s)}</div>
                    <div class="muted mono">{engine(s) === "claude" ? `~${sum(s).toLocaleString()} tok` : "Codex"}</div>
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={props.plugins}>
              {(p) => (
                <tr>
                  <td class="mono">{p.id}</td>
                  <For each={sessions()}>{(s) => <td class="extp-cell">{mark(sessionCell(p, engine(s)))}</td>}</For>
                </tr>
              )}
            </For>
            <For each={props.skills.filter((k) => k.scope !== "plugin")}>
              {(k) => (
                <tr>
                  <td class="mono">
                    {k.name} <span class="muted">· {t(k.scope === "user" ? "전체 스킬" : "워크스페이스 스킬")}</span>
                  </td>
                  <For each={sessions()}>{(s) => <td class="extp-cell">{mark(skillCell(s))}</td>}</For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}

// ── 스킬 ──

export function SkillsPanelTab() {
  const ws = () => scopeWorkspace();
  const [plugins] = createResource(
    () => isTauri() && !claudeMissing() && (ws()?.path ?? ""),
    (p) => listPlugins(p || undefined).catch(() => []),
  );
  // 결과에 워크스페이스 경로를 붙인다 (B216) — 플러그인 목록을 기다리는 동안 리소스는 이전 값을 들고 있어,
  // 다른 워크스페이스의 프로젝트 스킬이 남았다(행의 root가 절대 경로라 [편집]·[삭제]도 그쪽 파일에 간다)
  const [scanRes, { refetch }] = createResource(
    () => (plugins.loading ? undefined : { ws: ws()?.path, plugins: plugins() ?? [] }),
    async (k) => ({ ws: k.ws, ...(await skillsList(k.ws, k.plugins)) }),
  );
  const scan = () => (scanRes()?.ws === ws()?.path ? scanRes() : undefined);
  const loading = () => plugins.loading || scanRes.loading || (isTauri() && !scan());
  const [sel, setSel] = createSignal<SkillRow>();
  createEffect(on(createMemo(() => ws()?.path), () => setSel(undefined), { defer: true })); // 메모 — 없으면 방송마다 상세가 닫혔다 (B249 계열)
  // 만들기 · 저장 · 삭제 · 복사 모두에서 켠다 (B192) — 상세 안에 두면 다시 읽기가 상세를 새로 만들며 꺼졌다
  const [changed, setChanged] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const confirm = useConfirm();
  const dups = createMemo(() => duplicateNames(scan()?.rows ?? []));
  const visible = createMemo(() => {
    const rows = scan()?.rows ?? [];
    return skillScope() === "all" ? rows.filter((r) => r.scope !== "project") : rows.filter((r) => r.scope === "project");
  });

  const create = () => {
    const name = newName().trim();
    if (!validSkillName(name)) return notify(t("이름은 소문자 · 숫자 · 하이픈, 64자 이하만 씁니다"));
    const all = skillScope() === "all";
    const run = async () => {
      try {
        const row = await skillCreate(all ? "user" : "project", ws()?.path, name);
        setNewName("");
        setChanged(true);
        await refetch();
        setSel(row);
      } catch (e) {
        notify(t(String(e)));
      }
    };
    if (!all) return void run();
    confirm.ask({ title: tf("전체 스킬 만들기 — {name}", { name }), body: t(ALL_SCOPE_NOTE), ok: t("만들기"), run: () => void run() });
  };

  return (
    <div class="extp">
      <div class="extp-head">
        <ScopeChips value={skillScope()} onChange={(v) => (setSkillScope(v), setSel(undefined))} />
        <ReloadButton onClick={() => void refetch()} />
      </div>
      <Show when={isTauri()} fallback={<div class="muted">{t("앱에서만 됩니다")}</div>}>
        <Show when={skillScope() === "all" || ws()} fallback={<div class="muted">{t("워크스페이스를 먼저 여세요")}</div>}>
          {/* 플러그인 스킬은 claude plugin list로 찾는다 — CLI가 없으면 조용히 빠지지 않게 이유를 보인다 (B182) */}
          <Show when={claudeMissing()}>
            <EngineMissing />
          </Show>
          <Show when={skillScope() !== "session"} fallback={<SessionTable plugins={plugins() ?? []} skills={scan()?.rows ?? []} />}>
            <div class="extp-new">
              <input
                class="panel-search mono"
                placeholder={t(skillScope() === "all" ? "새 전체 스킬 이름" : "새 워크스페이스 스킬 이름")}
                aria-label={t(skillScope() === "all" ? "새 전체 스킬 이름" : "새 워크스페이스 스킬 이름")}
                aria-describedby="extp-skill-rule"
                value={newName()}
                onInput={(e) => setNewName(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
              <button class="btn" disabled={!newName().trim()} onClick={create}>
                {t("＋ 새 스킬")}
              </button>
            </div>
            <div id="extp-skill-rule" class="muted extp-note">
              {t("이름은 소문자 · 숫자 · 하이픈, 64자 이하만 씁니다")}
            </div>
            <Show when={changed()}>
              <div class="extp-banner">{t(RESTART_NOTE)}</div>
            </Show>
            <Show when={!loading()} fallback={<div class="muted">{t("읽는 중…")}</div>}>
            <Show when={visible().length > 0} fallback={<div class="muted">{t("스킬이 없습니다")}</div>}>
              <div class="extp-list">
                <For each={visible()}>
                  {(r) => (
                    <button class="extp-row extp-skill" classList={{ active: sel()?.root === r.root && sel()?.dir === r.dir }} onClick={() => setSel(r)}>
                      <span class="extp-name mono">
                        <Show when={r.problems.length > 0}>
                          <span class="st-waiting" title={r.problems.join(" · ")}>
                            ⚠{" "}
                          </span>
                        </Show>
                        {r.name}
                      </span>
                      <span class="muted extp-desc">{r.description || r.problems.join(" · ")}</span>
                      <Show when={r.scope === "plugin"}>
                        <span class="badge mono" title={t("플러그인 스킬 — 읽기 전용")}>
                          {r.source}
                        </span>
                      </Show>
                      <Show when={dups().has(r.name)}>
                        <span class="badge amber" title={t("같은 이름이 다른 위치에도 있습니다 — 어느 쪽이 쓰이는지는 엔진이 정합니다")}>
                          {t("같은 이름")}
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            </Show>
            <Show when={sel()} keyed>
              {(r) => (
                <SkillDetail
                  row={r}
                  wsPath={ws()?.path}
                  confirm={confirm.ask}
                  onChanged={async (next) => {
                    setChanged(true);
                    await refetch();
                    setSel(next);
                  }}
                />
              )}
            </Show>
          </Show>
        </Show>
      </Show>
      {confirm.view()}
    </div>
  );
}

function SkillDetail(props: {
  row: SkillRow;
  wsPath?: string;
  confirm: (a: Ask) => void;
  onChanged: (next?: SkillRow) => void | Promise<void>;
}) {
  const r = props.row;
  const readOnly = r.scope === "plugin";
  const [file, { refetch }] = createResource(() => fsRead(r.root, r.rel).catch(() => undefined));
  const [editing, setEditing] = createSignal<{ text: string; mtimeMs: number }>();

  const save = () => {
    const ed = editing();
    if (!ed) return;
    const run = async () => {
      try {
        await fsWrite(r.root, r.rel, ed.text, ed.mtimeMs);
        setEditing(undefined);
        await refetch();
        void props.onChanged({ ...r });
      } catch (e) {
        notify(t(String(e))); // mtime 충돌이면 "파일이 밖에서 바뀌었습니다" — 파일이 이긴다
      }
    };
    if (r.scope !== "user") return void run();
    props.confirm({ title: tf("전체 스킬 저장 — {name}", { name: r.name }), body: t(ALL_SCOPE_NOTE), ok: t("저장"), run: () => void run() });
  };

  // [취소]도 고친 내용이 있으면 묻는다 (P77) — [저장] 바로 옆이라 손이 닿기 쉽다
  const cancelEdit = () =>
    editing()?.text === file()?.text
      ? setEditing(undefined)
      : props.confirm({
          title: t("저장하지 않은 편집이 있습니다"),
          body: t("버리면 고친 내용이 사라집니다. 남기려면 [계속 편집]을 누르고 [저장]하세요."),
          danger: true,
          ok: t("변경 버리기"),
          cancel: t("계속 편집"),
          run: () => setEditing(undefined),
        });

  const remove = () =>
    props.confirm({
      title: tf("스킬 삭제 — {name}", { name: r.name }),
      body: t("폴더째 휴지통으로 옮깁니다") + (r.scope === "user" ? ". " + t(ALL_SCOPE_NOTE) : ""),
      danger: true,
      ok: t("휴지통으로"),
      run: async () => {
        try {
          await fsDelete(r.root, r.dir);
          void props.onChanged(undefined);
        } catch (e) {
          notify(t(String(e)));
        }
      },
    });

  const copy = (to: "user" | "project") => {
    const run = async () => {
      try {
        void props.onChanged(await skillCopy(r.root, r.dir, to, props.wsPath));
      } catch (e) {
        notify(t(String(e)));
      }
    };
    if (to === "project") return void run();
    props.confirm({ title: tf("전체로 복사 — {name}", { name: r.name }), body: t(ALL_SCOPE_NOTE), ok: t("복사"), run: () => void run() });
  };

  return (
    <div class="card inset extp-detail">
      <div class="extp-detail-head">
        <span class="mono muted" title={`${r.root}/${r.rel}`}>
          {r.rel}
        </span>
        <Show when={!readOnly}>
          <Show
            when={editing()}
            fallback={
              <button class="btn" disabled={!file()} onClick={() => setEditing({ text: file()!.text, mtimeMs: file()!.mtimeMs })}>
                {t("편집")}
              </button>
            }
          >
            <button class="btn primary" onClick={save}>
              {t("저장")}
            </button>
            <button class="btn ghost" onClick={cancelEdit}>
              {t("취소")}
            </button>
          </Show>
          <button class="btn ghost" onClick={remove}>
            {t("삭제")}
          </button>
        </Show>
        <Show when={r.scope !== "project" && props.wsPath}>
          <button class="btn ghost" onClick={() => copy("project")}>
            {t("워크스페이스로 복사")}
          </button>
        </Show>
        <Show when={r.scope === "project"}>
          <button class="btn ghost" onClick={() => copy("user")}>
            {t("전체로 복사")}
          </button>
        </Show>
      </div>
      <Show
        when={editing()}
        fallback={
          <div
            class="mdview-body"
            innerHTML={file() ? markdownHtml(file()!.text) : ""}
            // 링크가 메인 웹뷰를 끌고 가지 않게 문서 탭과 같이 가로챈다 (B250). 상대 링크는 스킬 폴더 기준으로 탐색기에서 연다
            onClick={(e) =>
              mdLinkClick(e, (href) => {
                void revealPath(resolveRel(r.rel, href), r.root).then((ok) => ok || notify(t("폴더를 열 수 없습니다 — 경로가 없어졌습니다")));
              })
            }
          />
        }
      >
        {(ed) => (
          <CodeEditor
            value={ed().text}
            fileName="SKILL.md"
            onChange={(text) => setEditing({ ...editing()!, text })}
            onSave={save}
          />
        )}
      </Show>
    </div>
  );
}

// ── MCP ──

/** 막 띄운 셸이 프롬프트를 낼 때까지 — 출력이 0.5초 잠잠하면 끝, 상한 10초.
 *  ponytail: 출력 정적으로 프롬프트를 짐작한다. 정확히 하려면 셸 통합(OSC 133)이 필요하다 */
function shellQuiet(id: string): Promise<void> {
  return new Promise((done) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      off();
      clearTimeout(quiet);
      clearTimeout(cap);
      done();
    };
    const off = onPtyOutput(id, () => {
      clearTimeout(quiet);
      quiet = setTimeout(finish, 500);
    });
    const cap = setTimeout(finish, 10_000);
  });
}

export function McpPanelTab() {
  const ws = () => scopeWorkspace();
  const [scanned, { refetch }] = createResource(() => ws()?.path ?? "", (p) => mcpScan(p || undefined));
  const rows = () => scanned()?.rows;
  // 점검 결과는 잰 워크스페이스에 묶는다 (B217) — 옮긴 뒤에도 남아, 이름이 같은 다른 저장소 행에 점이 붙었다
  const [checked, setChecked] = createSignal<{ path?: string; at: string; map: Map<string, { state: McpHealth; status: string }> }>();
  const health = () => (checked()?.path === ws()?.path ? checked()!.map : undefined);
  const checkedAt = () => (health() ? checked()!.at : undefined);
  const [checking, setChecking] = createSignal(false);

  const check = async () => {
    const path = ws()?.path;
    setChecking(true);
    try {
      const parsed = parseMcpList(await mcpCheck(path));
      setChecked({ path, at: new Date().toLocaleTimeString(), map: new Map(parsed.map((x) => [x.name, { state: x.state, status: x.status }])) });
    } catch (e) {
      notify(tf("점검하지 못했습니다 — {err}", { err: String(e) }));
    } finally {
      setChecking(false);
    }
  };

  /** 점검에서만 보이는 서버 — 플러그인 · claude.ai 커넥터는 설정 파일에 없다 */
  const extra = () => [...(health() ?? new Map()).entries()].filter(([n]) => !(rows() ?? []).some((r) => r.name === n));

  /** 명령을 서버 탭 입력줄에 채운다 — Enter는 사람이 누른다.
   *  서버 터미널이 아직 없으면 열고, 셸 출력이 잠잠해지면(프롬프트) 채운다 (P68) — 예전엔 토스트만 띄웠다 */
  const fill = async (cmd: string) => {
    const w = ws();
    if (!w) return;
    const id = serverTermId(w.id);
    setPanelTab("server");
    if (!(await listAlivePty()).includes(id)) {
      // 서버 셸에서 exit했으면 openServerTerm은 아무것도 하지 않는다 — 10초 기다려 죽은 PTY에 쓰지 말고 알린다 (B260)
      if (serverExited(id)) return void notify(t("셸이 끝났습니다 — [셸 다시 열기]를 누르세요"));
      const ready = shellQuiet(id);
      openServerTerm(w.id);
      await ready;
    }
    writePty(id, cmd);
  };

  const dot = (name: string) => {
    const h = health()?.get(name);
    return h ? { ok: "●", fail: "✕", pending: "⏸", auth: "🔑", unknown: "?" }[h.state] : "○";
  };
  /** 상태 점의 접근 가능한 이름 (U131) — 글리프만으로는 읽히지 않는다 */
  const dotLabel = (name: string) => {
    const h = health()?.get(name);
    return t(h ? { ok: "연결됨", fail: "실패", pending: "승인 필요", auth: "인증 필요", unknown: "알 수 없음" }[h.state] : "점검 전");
  };

  return (
    <div class="extp">
      <div class="extp-head">
        <span class="muted">{checkedAt() ? tf("마지막 점검 {time}", { time: checkedAt()! }) : t("점검 전 — 설정 파일에서 읽은 목록입니다")}</span>
        <button class="btn" disabled={checking() || !isTauri() || claudeMissing()} title={t("서버 프로세스를 띄워 연결을 봅니다")} onClick={() => void check()}>
          {t(checking() ? "점검 중…" : "점검")}
        </button>
        <button
          class="btn ghost"
          disabled={!ws()}
          title={t("서버 탭 터미널 입력줄에 채웁니다 — <이름> · <명령>을 고친 뒤 Enter를 누르세요")}
          onClick={() => void fill(mcpCommand.add("local"))}
        >
          {t("추가 명령 채우기")}
        </button>
        <ReloadButton onClick={() => void refetch()} />
      </div>
      <Show when={isTauri()} fallback={<div class="muted">{t("앱에서만 됩니다")}</div>}>
        <Show when={claudeMissing()}>
          <EngineMissing />
        </Show>
        {/* 있는데 못 읽은 설정 파일 (B218) — '서버 없음'과 가른다 */}
        <For each={scanned()?.errors ?? []}>
          {(e) => (
            <div class="st-waiting extp-note" role="alert">
              {tf("MCP 설정을 읽지 못했습니다 — {err}", { err: e })}
            </div>
          )}
        </For>
        <Show
          when={(rows() ?? []).length + extra().length > 0}
          fallback={<Show when={!scanned()?.errors.length}><div class="muted">{t("설정된 MCP 서버가 없습니다")}</div></Show>}
        >
          <div class="extp-list">
            <For each={rows()}>
              {(r) => (
                <div class="extp-row" title={health()?.get(r.name)?.status}>
                  <span class="extp-dot-t" role="img" aria-label={dotLabel(r.name)}>
                    {dot(r.name)}
                  </span>
                  <span class="extp-name mono">{r.name}</span>
                  <span class="badge mono">{r.scope}</span>
                  <span class="muted mono">{r.transport}</span>
                  <span class="muted mono extp-desc" title={r.target}>
                    {r.target}
                  </span>
                  <Show when={r.envKeys.length + r.headerKeys.length > 0}>
                    <span class="muted mono" title={t("값은 읽지 않습니다 — 키 이름만")}>
                      {[...r.envKeys, ...r.headerKeys].join(", ")}
                    </span>
                  </Show>
                  <Show when={r.approval !== "approved"}>
                    <span class="st-waiting">{t(r.approval === "pending" ? "승인 대기 — 페인에서 /mcp" : "이 프로젝트에서 거부됨")}</span>
                  </Show>
                  <button class="btn ghost" disabled={!ws()} onClick={() => void fill(mcpCommand.remove(r.name, r.scope))}>
                    {t("제거 명령 채우기")}
                  </button>
                </div>
              )}
            </For>
            <For each={extra()}>
              {([name, h]) => (
                <div class="extp-row" title={h.status}>
                  <span class="extp-dot-t" role="img" aria-label={dotLabel(name)}>
                    {dot(name)}
                  </span>
                  <span class="extp-name mono">{name}</span>
                  <span class="muted">{t("점검에서만 보임 — 플러그인 · 커넥터")}</span>
                  <span class="muted mono extp-desc">{h.status}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
