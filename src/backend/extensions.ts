// 엔진 확장 브리지 (0.6 §12) — 사이드 패널 "확장" 그룹 [MCP | 플러그인 | 스킬].
// 플러그인·MCP 점검은 Rust engine_plugin(허용 목록 · -y 거부 · 60초 상한)으로 엔진 CLI를 부르고,
// 출력 해석은 여기서 한다. 스킬 편집·삭제는 panels.ts의 fs_*를 스킬 루트에 그대로 쓴다(휴지통 · mtime).
// 브라우저 dev(!isTauri)에서는 빈 결과 — 다른 패널과 같은 폴백이다.
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./pty";

export type Engine = "claude" | "codex";
/** 화면의 범위 칩 — 전체(user) · 이 워크스페이스(local, 결정 X2) · 세션별(읽기만, 3단계) */
export type ExtScope = "all" | "workspace" | "session";

/** 엔진 CLI 호출 — 실패는 던진다(화면이 사유를 보인다) */
export function enginePlugin(cli: Engine, args: string[], cwd?: string): Promise<string> {
  if (!isTauri()) return Promise.reject(new Error("앱에서만 됩니다"));
  return invoke<string>("engine_plugin", { cli, args, cwd: cwd ?? null });
}

// ── 플러그인 ──

export interface PluginRow {
  id: string;
  version: string;
  /** 설치 범위 — user · project · local */
  scope: string;
  /** cwd 기준으로 실제로 켜져 있는가 — 모든 범위의 설정을 합친 결과다(실측: local에서 끄면 false) */
  enabled: boolean;
  installPath?: string;
}

/** `claude plugin list --json` → 행. 모양이 어긋난 항목은 버린다 (엔진 출력이 바뀌어도 화면이 깨지지 않게) */
export function parsePluginList(json: string): PluginRow[] {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (!x || typeof x !== "object" || typeof (x as { id?: unknown }).id !== "string") return [];
    const o = x as Record<string, unknown>;
    return [
      {
        id: o.id as string,
        version: typeof o.version === "string" ? o.version : "",
        scope: typeof o.scope === "string" ? o.scope : "",
        enabled: o.enabled === true,
        installPath: typeof o.installPath === "string" ? o.installPath : undefined,
      },
    ];
  });
}

/** `claude plugin details` 텍스트의 "Always-on: ~985 tok" → 985. `~1.2k`도 읽는다. 없으면 undefined */
export function parseAlwaysOn(text: string): number | undefined {
  const m = /Always-on:\s*~?([\d.,]+)\s*(k)?\s*tok/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  return Math.round(m[2] ? n * 1000 : n);
}

/** cwd가 워크스페이스면 그 폴더 기준, 없으면 홈 기준(= 전체 범위 상태) */
export async function listPlugins(cwd?: string): Promise<PluginRow[]> {
  if (!isTauri()) return [];
  return parsePluginList(await enginePlugin("claude", ["plugin", "list", "--json"], cwd));
}

export function pluginDetails(id: string, cwd?: string): Promise<string> {
  return enginePlugin("claude", ["plugin", "details", id], cwd);
}

/** 켜기·끄기 — 전체는 user, 이 워크스페이스는 local(결정 X2: project는 커밋되어 팀에 번진다) */
export function setPluginEnabled(id: string, on: boolean, scope: "user" | "local", cwd?: string): Promise<string> {
  return enginePlugin("claude", ["plugin", on ? "enable" : "disable", id, "--scope", scope, "--json"], cwd);
}

// ── MCP ──

export interface McpRow {
  name: string;
  scope: "user" | "local" | "project";
  transport: string;
  target: string;
  envKeys: string[];
  headerKeys: string[];
  approval: "approved" | "pending" | "disabled";
}

/** errors — 있는데 못 읽은 설정 파일("경로: 사유"). 화면이 '없음'과 갈라 보인다 (B218) */
export async function mcpScan(wsPath?: string): Promise<{ rows: McpRow[]; errors: string[] }> {
  if (!isTauri()) return { rows: [], errors: [] };
  return invoke<{ rows: McpRow[]; errors: string[] }>("mcp_scan", { wsPath: wsPath ?? null }).catch((e) => ({
    rows: [],
    errors: [String(e)],
  }));
}

export type McpHealth = "ok" | "fail" | "pending" | "auth" | "unknown";

/** `claude mcp list` 한 줄 — "이름: 대상 - ✔ Connected". JSON 출력이 없어 줄로 읽는다.
 *  모르는 모양의 줄은 state "unknown"으로 원문을 그대로 남긴다 (형식이 바뀌어도 원문은 보인다) */
export function parseMcpList(text: string): { name: string; state: McpHealth; status: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^Checking MCP/i.test(l))
    .map((l) => {
      const colon = l.indexOf(": ");
      const dash = l.lastIndexOf(" - ");
      if (colon <= 0 || dash < colon) return { name: l, state: "unknown" as McpHealth, status: l };
      const status = l.slice(dash + 3).trim();
      const state: McpHealth = /connected/i.test(status) && !/fail|not/i.test(status)
        ? "ok"
        : /pending|approval/i.test(status)
          ? "pending"
          : /auth/i.test(status)
            ? "auth"
            : /fail|error|✗/i.test(status)
              ? "fail"
              : "unknown";
      return { name: l.slice(0, colon), state, status };
    });
}

/** 상태 점검 — 서버 프로세스를 띄우므로 사람이 누를 때만 부른다 */
export function mcpCheck(wsPath?: string): Promise<string> {
  return enginePlugin("claude", ["mcp", "list"], wsPath);
}

/** 서버 탭 입력줄에 채울 명령 — 앱이 실행하지 않는다(Enter는 사람이).
 *  add는 자리표시라 주석 줄로 채운다 (P68) — 그대로 Enter해도 아무것도 돌지 않고, PowerShell `<` 연산자 오류도 없다.
 *  (zsh는 interactivecomments가 꺼져 있으면 '#: command not found'로 끝난다 — 역시 아무것도 돌지 않는다.)
 *  사람은 맨 앞 `# `(cmd는 `rem `)를 지우고 <이름> · <명령>을 고친다. shell은 ShellChoice.label */
export const mcpCommand = {
  add: (scope: "local" | "user", shell?: string) =>
    `${shell === "cmd" ? "rem" : "#"} claude mcp add --scope ${scope} <이름> -- <명령>`,
  remove: (name: string, scope: string) => `claude mcp remove --scope ${scope} ${quoteArg(name)}`,
};

/** 서버 이름에 공백이 있으면 따옴표 — 셸 하나에서 그대로 붙여 넣을 수 있게 */
function quoteArg(s: string): string {
  return /^[\w.@:/-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
}

// ── 스킬 ──

export interface SkillRow {
  scope: "user" | "project" | "plugin";
  source?: string;
  name: string;
  description: string;
  dir: string;
  /** fs_read/fs_write/fs_delete의 wsPath로 쓰는 스킬 루트 */
  root: string;
  rel: string;
  mtimeMs: number;
  problems: string[];
}

export interface SkillScan {
  userRoot: string;
  projectRoot?: string | null;
  rows: SkillRow[];
}

export async function skillsList(wsPath: string | undefined, plugins: PluginRow[]): Promise<SkillScan> {
  if (!isTauri()) return { userRoot: "", rows: [] };
  const pluginDirs = plugins.filter((p) => p.installPath).map((p) => ({ id: p.id, path: p.installPath! }));
  return invoke<SkillScan>("skills_list", { wsPath: wsPath ?? null, pluginDirs });
}

/** 스킬 이름 — Rust valid_skill_name과 같은 규칙 (입력칸에서 먼저 막는다) */
export const validSkillName = (n: string): boolean => /^[a-z0-9][a-z0-9-]{0,63}$/.test(n);

export function skillTemplate(name: string): string {
  return `---\nname: ${name}\ndescription: 언제 이 스킬을 쓰는지 한두 문장으로 적는다\n---\n\n# ${name}\n\n## 할 일\n\n## 하지 말 것\n`;
}

export function skillCreate(scope: "user" | "project", wsPath: string | undefined, name: string): Promise<SkillRow> {
  return invoke<SkillRow>("skill_create", { scope, wsPath: wsPath ?? null, name, content: skillTemplate(name) });
}

export function skillCopy(fromRoot: string, dir: string, toScope: "user" | "project", wsPath?: string): Promise<SkillRow> {
  return invoke<SkillRow>("skill_copy", { fromRoot, dir, toScope, wsPath: wsPath ?? null });
}

/** 이름이 둘 이상의 위치에 있는 스킬 — 어느 쪽이 이기는지는 엔진이 정하므로 표시만 한다 */
export function duplicateNames(rows: SkillRow[]): Set<string> {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

// ── 세션별 적용 현황 (3단계 · 읽기만) ──

export type Cell = "on" | "off" | "none";

/** 한 세션 칸 — Claude 세션이면 그 워크스페이스에서 켜진 플러그인이 실린다.
 *  세션별로 끄기(plugins_off)는 4단계라 아직 없다 — 역할 frontmatter를 읽게 되면 "off"를 낸다.
 *  Codex 세션은 세션별 범위를 실측 전까지 숨긴다(결정 X5) — "none" */
export function sessionCell(p: PluginRow, engine: Engine): Cell {
  if (engine !== "claude") return "none";
  return p.enabled ? "on" : "none";
}
