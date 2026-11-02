// 환경변수 (실행 › 환경변수) — 워크스페이스 루트의 .env 계열 파일을 읽고, 만들고, 고치고, 지운다 (§16).
// 값은 비밀이 많아 화면이 기본으로 가린다 (EnvPanelTab). 쓰기는 탐색기 CRUD(fsx.rs)를 그대로 쓴다.
// 원문 보존: 변수 하나를 고칠 때 파일을 다시 쓰지 않고 그 한 줄만 바꾼다 — 주석·순서·export·줄바꿈이 남는다.
import { invoke } from "@tauri-apps/api/core";
import { MOCK_ENV } from "./mock";
import { fsCreate, fsDelete, fsRead, fsWrite } from "./panels";
import type { FileContent } from "./panels";
import { isTauri } from "./pty";

/** 살펴보는 파일 — 흔한 dotenv 이름들. ponytail: 고정 목록, 다른 이름이 필요하면 여기에 더한다 */
export const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.test",
];
/** 예시 파일 — 커밋되는 파일이라 읽기만 한다. [예시에서 만들기]의 원천 */
export const EXAMPLE_FILES = [".env.example", ".env.sample"];

export interface EnvVar {
  key: string;
  value: string;
  /** 원문 줄 번호 (0부터) — 고치기·지우기가 이 줄만 건드린다 */
  line?: number;
  /** 원래 따옴표 — 직렬화가 가능하면 같은 모양을 지킨다 */
  quote?: string;
  /** 따옴표 안 줄바꿈 — 탭에서는 고치지 않는다 (V4, [원문 편집]으로) */
  multiline?: boolean;
}

export interface EnvFile {
  file: string;
  vars: EnvVar[];
  /** 읽은 시점 mtime — 저장 때 외부 변경 충돌을 잡는다 */
  mtimeMs?: number;
  /** .env.example 계열 — 읽기 전용 */
  example?: boolean;
  /** 있는데 못 읽었다(1MB 초과 · UTF-8 아님 · 권한) — 카드에 이유만 보이고 고치지 않는다 */
  error?: string;
}

/** dotenv 한 파일 → 변수 목록. 주석·빈 줄·`export ` 머리를 걸러내고, 따옴표 값은 벗긴다.
 *  여러 줄 값(따옴표 안 줄바꿈)은 첫 줄만 값으로 두고 multiline으로 표시한다 — 이어지는 줄을 변수로 읽지 않는다 */
export function parseDotenv(text: string): EnvVar[] {
  const out: EnvVar[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const q = value[0];
    const v: EnvVar = { key, value, line: i };
    if (q === '"' || q === "'" || q === "`") {
      v.quote = q;
      const close = value.indexOf(q, 1);
      // 닫는 따옴표 뒤에는 공백·줄 끝 주석만 온다 — `A="quoted" # note` (B146)
      if (close > 0 && /^\s*(#.*)?$/.test(value.slice(close + 1))) {
        value = value.slice(1, close);
        if (q === '"') value = value.replace(/\\n/g, "\n");
      } else if (close < 0) {
        // 닫는 따옴표가 뒤 줄에 있다 — 거기까지 건너뛴다
        v.multiline = true;
        while (i + 1 < lines.length && !lines[++i].trimEnd().endsWith(q));
      }
    } else {
      value = value.replace(/\s+#.*$/, ""); // 따옴표 없는 값의 줄 끝 주석
    }
    v.value = value;
    out.push(v);
  }
  return out;
}

/** 값 → dotenv 표기. dotenv(npm)와 같은 값으로 읽히는 모양만 쓴다:
 *  dotenv는 큰따옴표 안의 `\n`만 풀고 `\"`·`\\`는 풀지 않으므로, 따옴표 문자를 이스케이프하지 않고
 *  그 문자가 없는 따옴표를 고른다. 원래 따옴표(prefer)가 쓸 수 있으면 그것을 지킨다.
 *  어느 모양으로도 같은 값이 안 나오면 undefined — [원문 편집]으로 넘긴다 */
export function serializeValue(value: string, prefer?: string): string | undefined {
  if (value.includes("\r")) return undefined;
  if (value.includes("\n")) {
    // 줄바꿈은 큰따옴표 + \n뿐이다. 값에 " 또는 \가 있으면 왕복이 깨진다
    return /["\\]/.test(value) ? undefined : `"${value.replace(/\n/g, "\\n")}"`;
  }
  if (!/[\s#"'`\\]/.test(value) && !prefer) return value;
  // \는 큰따옴표 안에서 \n으로 읽힐 수 있다 — 작은따옴표·백틱만
  const ok = (q: string) => !value.includes(q) && (q !== '"' || !value.includes("\\"));
  const order = [prefer, "'", '"', "`"].filter((q): q is string => !!q);
  const q = order.find(ok);
  return q ? `${q}${value}${q}` : undefined;
}

/** 키 검사 — 문제가 있으면 사유(번역 키), 없으면 undefined. self는 편집 중인 원래 키 */
export function keyError(key: string, existing: string[], self?: string): string | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) return "키는 영문자나 _로 시작하고 영문자·숫자·_·.만 쓸 수 있습니다";
  if (key !== self && existing.includes(key)) return "같은 키가 이미 있습니다";
  return undefined;
}

/** 두 번 이상 나오는 키 */
export function duplicateKeys(vars: EnvVar[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of vars) (seen.has(v.key) ? dup : seen).add(v.key);
  return dup;
}

// ── 한 줄 편집 — 줄바꿈 형식(CRLF·LF)과 다른 줄은 그대로 둔다 ──

const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");

/** [줄0, 구분0, 줄1, 구분1, …] — 구분자를 같이 잡아 원래 줄바꿈을 지킨다 */
const splitKeep = (text: string) => text.split(/(\r?\n)/);

/** 값 뒤 줄 끝 주석(` # …`) — parseDotenv가 값에서 떼는 것과 같은 규칙. 없으면 "" */
function commentTail(line: string): string {
  const eq = line.indexOf("=");
  if (eq < 0) return "";
  const rest = line.slice(eq + 1);
  const q = rest.trimStart()[0];
  if (q === '"' || q === "'" || q === "`") {
    const open = rest.indexOf(q);
    const close = rest.indexOf(q, open + 1);
    const after = close < 0 ? "" : rest.slice(close + 1);
    return /^\s*#/.test(after) ? after : "";
  }
  return /\s+#.*$/.exec(rest)?.[0] ?? "";
}

/** line번 줄을 KEY=VALUE로 바꾼다 — 원래 줄의 앞 공백 · `export ` 머리 · 줄 끝 주석은 남긴다 (B190) */
export function setLine(text: string, line: number, key: string, rendered: string): string {
  const parts = splitKeep(text);
  const old = parts[line * 2] ?? "";
  const head = /^\s*(export\s+)?/.exec(old)?.[0] ?? "";
  parts[line * 2] = `${head}${key}=${rendered}${commentTail(old)}`;
  return parts.join("");
}

/** line번 줄을 뺀다 — 그 줄의 줄바꿈도 같이. 마지막 줄이면 앞 줄바꿈을 뺀다 */
export function removeLine(text: string, line: number): string {
  const parts = splitKeep(text);
  const i = line * 2;
  if (i >= parts.length) return text;
  if (i + 1 < parts.length) parts.splice(i, 2);
  else parts.splice(Math.max(0, i - 1), i === 0 ? 1 : 2);
  return parts.join("");
}

/** 파일 끝에 한 줄 — 끝에 줄바꿈이 없으면 먼저 넣는다 */
export function appendLine(text: string, key: string, rendered: string): string {
  const eol = eolOf(text);
  const sep = text === "" || text.endsWith("\n") ? "" : eol;
  return `${text}${sep}${key}=${rendered}${eol}`;
}

/** 예시 파일 → 키만 옮기고 값은 비운 새 파일 */
export function fromExample(text: string): string {
  const eol = eolOf(text);
  return parseDotenv(text)
    .map((v) => `${v.key}=${eol}`)
    .join("");
}

/** .gitignore에 name을 덧붙인 결과 — 이미 그 줄이 있으면 그대로 */
export function withIgnore(gitignore: string, name: string): string {
  if (gitignore.split(/\r?\n/).some((l) => l.trim() === name || l.trim() === `/${name}`)) return gitignore;
  return appendRaw(gitignore, name);
}
const appendRaw = (text: string, line: string) => {
  const eol = eolOf(text);
  const sep = text === "" || text.endsWith("\n") ? "" : eol;
  return `${text}${sep}${line}${eol}`;
};

// ── 입출력 — 브라우저 dev는 메모리에서만 고친다 ──

/** 브라우저 dev 목 — MOCK_ENV를 원문으로 펼쳐 둔 것. 앱 수명 동안만 */
const mockTexts = new Map<string, string>(
  MOCK_ENV.map((f) => [f.file, f.vars.map((v) => `${v.key}=${serializeValue(v.value) ?? ""}\n`).join("")]),
);

function readText(wsPath: string, file: string): Promise<FileContent> {
  if (isTauri()) return fsRead(wsPath, file);
  const text = mockTexts.get(file);
  return text === undefined ? Promise.reject(new Error("없음")) : Promise.resolve({ text, mtimeMs: 0 });
}

/** 워크스페이스 루트의 .env 계열 중 있는 것만. 없는 파일은 건너뛰고, 있는데 못 읽은 파일은 이유를 담아 남긴다 —
 *  숨기면 빈 상태의 [.env 만들기]가 떠서 "같은 이름이 이미 있습니다"로 실패한다 */
export async function loadEnvFiles(wsPath: string): Promise<EnvFile[]> {
  const read = await Promise.all(
    [...ENV_FILES, ...EXAMPLE_FILES].map((file) =>
      readText(wsPath, file).then(
        (c): EnvFile => ({
          file,
          vars: parseDotenv(c.text),
          mtimeMs: c.mtimeMs,
          ...(EXAMPLE_FILES.includes(file) ? { example: true } : {}),
        }),
        // "대상 없음"(fsx resolve_existing) · 목 모드 "없음" = 파일이 없다
        (e): EnvFile | undefined =>
          /없음$/.test(String(e)) ? undefined : { file, vars: [], error: String(e), ...(EXAMPLE_FILES.includes(file) ? { example: true } : {}) },
      ),
    ),
  );
  return read.filter((f): f is EnvFile => !!f);
}

/** 읽은 뒤 다른 곳(에이전트·에디터)이 고쳤다 — 화면이 다시 읽어야 한다 */
export const STALE = "STALE";

/** 그 파일의 원문을 다시 읽어 change로 바꿔 쓴다. 읽은 시점(f.mtimeMs)과 다르면 STALE로 거부한다 */
export async function editEnvFile(wsPath: string, f: EnvFile, change: (text: string) => string): Promise<void> {
  const cur = await readText(wsPath, f.file);
  if (f.mtimeMs !== undefined && cur.mtimeMs !== f.mtimeMs) throw new Error(STALE);
  const next = change(cur.text);
  if (!isTauri()) {
    mockTexts.set(f.file, next);
    return;
  }
  await fsWrite(wsPath, f.file, next, f.mtimeMs).catch((e) => {
    throw new Error(/밖에서 바뀌었/.test(String(e)) ? STALE : String(e));
  });
}

/** 원문 통째로 저장 ([원문 편집]) — 같은 mtime 계약 */
export async function writeEnvText(wsPath: string, file: string, text: string, mtimeMs?: number): Promise<void> {
  if (!isTauri()) {
    mockTexts.set(file, text);
    return;
  }
  await fsWrite(wsPath, file, text, mtimeMs);
}

export function readEnvText(wsPath: string, file: string): Promise<FileContent> {
  return readText(wsPath, file);
}

/** 새 파일 — 이름은 ENV_FILES 중 하나여야 한다 */
export async function createEnvFile(wsPath: string, file: string, text: string): Promise<void> {
  if (!ENV_FILES.includes(file)) throw new Error(file);
  if (!isTauri()) {
    mockTexts.set(file, text);
    return;
  }
  await fsCreate(wsPath, "", file, false);
  if (text) await fsWrite(wsPath, file, text);
}

/** 휴지통으로 — 영구 삭제 아님 */
export async function deleteEnvFile(wsPath: string, file: string): Promise<void> {
  if (!isTauri()) {
    mockTexts.delete(file);
    return;
  }
  await fsDelete(wsPath, file);
}

// ── git 추적 · 무시 (§16-3) ──

export interface GitPathStatus {
  path: string;
  tracked: boolean;
  ignored: boolean;
}

/** 커맨드가 없거나(저장소 아님 포함) 실패하면 undefined — 칩을 숨긴다 */
export async function gitPathStatus(wsPath: string, paths: string[]): Promise<GitPathStatus[] | undefined> {
  if (!isTauri() || paths.length === 0) return undefined;
  return invoke<GitPathStatus[]>("git_path_status", { wsPath, paths }).catch(() => undefined);
}

/** 루트 .gitignore에 name 한 줄 — 없으면 만든다 */
export async function addToGitignore(wsPath: string, name: string): Promise<void> {
  const cur = await fsRead(wsPath, ".gitignore").catch(() => undefined);
  if (!cur) await fsCreate(wsPath, "", ".gitignore", false);
  await fsWrite(wsPath, ".gitignore", withIgnore(cur?.text ?? "", name), cur?.mtimeMs);
}
