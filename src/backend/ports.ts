// 포트 감시 (M31) — netstat 실측 스냅숏 하나를 앱 전체가 나눠 쓴다.
//
// 왜 패널 밖으로 꺼냈나. 폴링이 패널 안에 있으면 (1) 포트 패널과 브라우저 패널이 같은
// netstat를 따로 돌리고, (2) 두 패널을 다 닫아 둔 동안에는 아무도 보지 않아 "세션이
// 방금 포트를 열었다"는 사실이 어디에도 남지 않는다. 감시는 앱 셸(App.tsx)이 켜고
// 패널은 결과를 읽기만 한다 — 그래야 패널을 열었을 때 "그동안 뭐가 열렸는지"가 있다.
//
// 관측 전용이라는 포트 패널의 원칙은 그대로다 (PRD H): 프로세스 종료도, 자동 열기도 없다.
// 새 포트는 뱃지로 알리기만 하고 여는 것은 언제나 사용자의 클릭이다 (PRD §2 — 자동 실행 경로 없음).
import { createSignal } from "solid-js";
import { portsSnapshot } from "./panels";
import type { PortRow } from "./panels";
import { forgetAgent, isTauri, killPty, onPtyExit, setUserInputHook } from "./pty";

/** 패널이 보고 있을 때 / 아닐 때 주기. 뒤에서도 계속 보되 덜 자주 본다 —
 *  netstat는 프로세스 실행이라 공짜가 아니다 */
const FAST_MS = 5_000;
const SLOW_MS = 20_000;
/** 최초 관측 뒤 이만큼은 NEW로 표시한다 — 사용자가 눈으로 집어내는 창.
 *  경과 판정은 폴 시점에만 다시 계산되므로 해상도는 폴 주기다 (정밀할 이유가 없다) */
const NEW_WINDOW_MS = 60_000;

/** 한 포트 = 한 항목. 같은 서버가 127.0.0.1과 [::1] 두 줄로 잡히는 일이 흔해서
 *  (pid, port)로 접는다 — 칩이 두 개 뜨면 사용자는 포트가 두 개인 줄 안다. */
export interface PortEntry {
  /** pid:port — 표시 단위이자 NEW 추적의 키 */
  key: string;
  port: number;
  /** 대표 바인딩 — 열기 좋은 쪽(루프백)을 고른다 */
  host: string;
  /** 실제 바인딩 전부 — 외부 노출 판정은 이걸 본다 (대표 하나로 접으면 노출을 놓친다) */
  hosts: string[];
  pid: number;
  process: string;
  /** 세션 귀속 (Job Object pid 일치). 없으면 시스템 포트 */
  session?: string;
  /** 최초 관측 시각(ms). 0 = 감시 시작 시점에 이미 열려 있던 것 — NEW가 아니다 */
  firstSeen: number;
}

const [entries, setEntries] = createSignal<PortEntry[]>([]);
/** 실측이 한 번이라도 들어왔나 — 화면이 "· 실측"과 목 폴백을 가르는 판정 */
const [live, setLive] = createSignal(false);
/** 사용자가 이미 본 포트 — 탭 뱃지를 끄는 기준. Set은 통째로 갈아 끼워 반응성을 지킨다 */
const [acked, setAcked] = createSignal<ReadonlySet<string>>(new Set());

/** 서버 탭의 PTY id (ServerPanelTab) — `이름@wsId` 관례를 따르되 페르소나 id와 겹치지 않게 #을 붙인다 */
export const serverTermId = (wsId: string): string => `#server@${wsId}`;
export const isServerTermId = (id: string): boolean => id.startsWith("#server@");

// 서버 PTY 종료 기억 (BR-03) — 탭 밖(모듈)에서 잡아 둔다. 탭 컴포넌트의 구독은 탭을 떠나면
// 풀려서, 다른 탭에 있는 사이 끝난 셸은 돌아와도 `다시 열기`가 뜨지 않았다.
// 값 = exit 코드, 키가 없으면 살아 있다(또는 아직 띄우지 않았다).
const [serverExits, setServerExits] = createSignal<ReadonlyMap<string, number | null>>(new Map());
const serverWatch = new Map<string, () => void>();

/** 서버 PTY의 exit를 앱 수명 동안 잡는다 — 여러 번 불러도 구독은 하나다 */
export function watchServerTerm(id: string): void {
  if (serverWatch.has(id)) return;
  serverWatch.set(
    id,
    onPtyExit(id, (code) => setServerExits((m) => new Map(m).set(id, code))),
  );
}

/** 끝났으면 exit 코드(null = 알 수 없음), 살아 있으면 undefined */
export const serverExit = (id: string): number | null | undefined => serverExits().get(id);
export const serverExited = (id: string): boolean => serverExits().has(id);

export function clearServerExit(id: string): void {
  if (!serverExits().has(id)) return;
  setServerExits((m) => {
    const next = new Map(m);
    next.delete(id);
    return next;
  });
}

// ── 마지막 서버 명령 (0.5 서버 탭 상태 저장, 1-7) — 사람이 친 줄을 기억했다가 버튼으로만 다시 친다 ──
// ponytail: 셸의 줄 편집 상태를 모르니 키 입력으로 줄을 재구성한다. 화살표(히스토리)·Tab 완성·Ctrl+C가
// 섞인 줄은 믿을 수 없어 기록하지 않는다 — 정확히 하려면 셸 통합(OSC 133)이 필요하다.

export interface LineState {
  buf: string;
  broken: boolean;
}

/** 키 입력 한 덩이를 줄 상태에 먹인다. Enter로 끝난 믿을 만한 줄이 있으면 commit에 담는다. 순수 함수 */
export function feedLine(st: LineState, data: string): { st: LineState; commit?: string } {
  let { buf, broken } = st;
  let commit: string | undefined;
  for (const ch of data) {
    if (ch === "\r" || ch === "\n") {
      const line = buf.trim();
      if (!broken && line) commit = line;
      buf = "";
      broken = false;
    } else if (ch === "\x7f" || ch === "\b") buf = buf.slice(0, -1);
    else if (ch === "\x1b" || ch === "\t" || ch === "\x03" || ch === "\x15") broken = true;
    else if (ch >= " ") buf += ch;
  }
  return { st: { buf, broken }, commit };
}

/** 워크스페이스 id → 마지막 서버 명령. layout.json에 남는다 (기기별 — 명령은 그 PC의 셸 기준이다) */
const [serverCommands, setServerCommands] = createSignal<Record<string, string>>({});
export { serverCommands, setServerCommands };

const lineState = new Map<string, LineState>();
/** 워크스페이스 id → 서버 셸에서 Enter로 끝난 마지막 줄. 포트가 열리기 전까지는 후보일 뿐이다 (B77) */
const candidates = new Map<string, string>();
/** 직전 스냅숏에서 서버 셸이 포트를 열고 있던 워크스페이스 */
let serverOpenBefore: ReadonlySet<string> = new Set();
setUserInputHook((id, data) => {
  if (!isServerTermId(id)) return;
  const r = feedLine(lineState.get(id) ?? { buf: "", broken: false }, data);
  lineState.set(id, r.st);
  if (r.commit) candidates.set(id.slice(id.indexOf("@") + 1), r.commit);
});

/** 서버 명령 확정 (B77) — 서버 셸이 포트를 새로 연 워크스페이스에서만 그 직전 줄(후보)을 서버 명령으로
 *  올린다. 예전엔 Enter로 끝난 줄을 무엇이든 기억해서, 서버를 멈추고 친 cls·git status가 [실행]에 걸렸다.
 *  이미 열려 있던 포트는 보지 않는다 — 돌고 있는 서버에 친 줄(nodemon `rs` 등)이 올라가지 않게. 순수 함수 */
export function promoteServerCommands(
  before: ReadonlySet<string>,
  now: ReadonlySet<string>,
  cands: ReadonlyMap<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ws of now) {
    const c = cands.get(ws);
    if (!before.has(ws) && c) out[ws] = c;
  }
  return out;
}

/** 이번 스냅숏 — 서버 셸이 포트를 연 워크스페이스를 보고 후보를 확정한다 */
function noteServerPorts(rows: readonly PortEntry[]): void {
  const now = new Set(rows.filter((e) => e.session && isServerTermId(e.session)).map((e) => e.session!.slice(e.session!.indexOf("@") + 1)));
  const up = promoteServerCommands(serverOpenBefore, now, candidates);
  serverOpenBefore = now;
  for (const ws of Object.keys(up)) candidates.delete(ws);
  if (Object.entries(up).some(([ws, c]) => serverCommands()[ws] !== c)) setServerCommands((m) => ({ ...m, ...up }));
}

/** 워크스페이스 등록 해제 (BR-04) — 서버 PTY를 죽이고 화면 인스턴스·추적 상태까지 버린다.
 *  구독을 먼저 풀어야 뒤늦은 pty-exit가 "종료됨"을 다시 심지 않는다 */
export function killServerTerm(wsId: string): void {
  const id = serverTermId(wsId);
  serverWatch.get(id)?.();
  serverWatch.delete(id);
  clearServerExit(id);
  lineState.delete(id);
  candidates.delete(wsId);
  if (wsId in serverCommands()) {
    const { [wsId]: _gone, ...rest } = serverCommands();
    setServerCommands(rest);
  }
  killPty(id);
  forgetAgent(id);
}

export const portEntries = entries;
export const portsLive = live;

export function sessionPorts(): PortEntry[] {
  return entries().filter((e) => e.session !== undefined);
}

export function systemPorts(): PortEntry[] {
  return entries().filter((e) => e.session === undefined);
}

/** 열기 좋은 순서 — 낮을수록 먼저. 와일드카드는 루프백으로 접어 열 수 있으니 IPv6보다 앞이다 */
function hostRank(h: string): number {
  if (h === "127.0.0.1" || h === "localhost") return 0;
  if (h === "0.0.0.0") return 1;
  if (h === "[::1]") return 2;
  if (h === "[::]") return 3;
  return 4; // 실제 LAN 주소 — 루프백이 아니므로 마지막
}

/** 표시·복사용 주소. 와일드카드 바인딩은 실제로 접속 가능한 루프백으로 바꿔 준다 */
export function portAddress(p: { host: string; port: number }): string {
  const h = p.host === "0.0.0.0" || p.host === "localhost" ? "127.0.0.1" : p.host === "[::]" ? "[::1]" : p.host;
  return `${h}:${p.port}`;
}

/** 브라우저 패널에 넘길 주소. IPv6는 netstat가 이미 대괄호를 씌워 준다 ([::1]) */
export function portUrl(p: { host: string; port: number }): string {
  return `http://${portAddress(p)}`;
}

/** 루프백 밖 바인딩인가 — 포트 패널의 "외부 노출" 집계가 쓴다 */
export function isExposed(e: PortEntry): boolean {
  return e.hosts.some((h) => hostRank(h) === 4);
}

/** 방금 열린 포트인가 — 감시 시작 뒤 NEW_WINDOW_MS 안에 처음 보인 것 */
export function isNewPort(e: PortEntry): boolean {
  return e.firstSeen > 0 && Date.now() - e.firstSeen < NEW_WINDOW_MS;
}

/** 아직 사용자가 확인하지 않은 세션 포트 수 — 사이드 패널의 포트 탭 뱃지 */
export function unseenPortCount(): number {
  const seen = acked();
  return entries().filter((e) => e.session !== undefined && !seen.has(e.key)).length;
}

/** 포트 패널을 보고 있다 = 확인했다. 뱃지만 끈다 (행의 NEW 칩은 시간이 끈다) */
export function markPortsSeen(): void {
  const seen = acked();
  const next = new Set(seen);
  let changed = false;
  for (const e of entries()) {
    if (e.session !== undefined && !next.has(e.key)) {
      next.add(e.key);
      changed = true;
    }
  }
  if (changed) setAcked(next);
}

// ── 폴링 ──────────────────────────────────────────────────────────────

/** key → 최초 관측 시각. 스냅숏마다 갈아 끼워 사라진 포트를 흘려보낸다 */
let firstSeen = new Map<string, number>();
/** 첫 스냅숏은 기준선이다 — 앱을 켰을 때 이미 열려 있던 포트까지 NEW로 알리지 않는다 */
let baselined = false;

/** 스냅숏 한 장 → 표시 항목. 순수 함수다 (단위 테스트가 여기를 겨눈다).
 *  prev = 직전까지의 key → 최초 관측 시각. baselined=false면 전부 기준선(0)으로 접는다.
 *  정렬은 새 포트가 위 — 사용자가 방금 연 것이 목록 맨 앞에 있어야 한다. */
export function foldPortRows(
  rows: readonly PortRow[],
  prev: ReadonlyMap<string, number>,
  now: number,
  baselined: boolean,
): PortEntry[] {
  const byKey = new Map<string, PortEntry>();
  for (const r of rows) {
    const key = `${r.pid}:${r.port}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        key,
        port: r.port,
        host: r.host,
        hosts: [r.host],
        pid: r.pid,
        process: r.process,
        session: r.session ?? undefined,
        firstSeen: baselined ? (prev.get(key) ?? now) : 0,
      });
      continue;
    }
    cur.hosts.push(r.host);
    if (hostRank(r.host) < hostRank(cur.host)) cur.host = r.host;
    cur.session ??= r.session ?? undefined;
  }
  return [...byKey.values()].sort((a, b) => b.firstSeen - a.firstSeen || a.port - b.port);
}

/** 확인 표시 정리 — 살아 있는 키만 남긴다. 닫힌 포트의 기억이 남아 있으면 OS가 pid를
 *  재사용했을 때 새 포트가 이미 확인된 것으로 둔갑한다.
 *  기준선 스냅숏은 통째로 확인 처리한다 (감시 시작 전부터 있던 것 = 알릴 사건이 아니다). */
export function reconcileAcked(
  acked: ReadonlySet<string>,
  alive: ReadonlySet<string>,
  baselined: boolean,
): Set<string> {
  const next = new Set([...acked].filter((k) => alive.has(k)));
  if (!baselined) for (const k of alive) next.add(k);
  return next;
}

function apply(snap: PortRow[]): void {
  const folded = foldPortRows(snap, firstSeen, Date.now(), baselined);
  firstSeen = new Map(folded.map((e) => [e.key, e.firstSeen]));
  setAcked(reconcileAcked(acked(), new Set(firstSeen.keys()), baselined));
  baselined = true;
  setEntries(folded);
  setLive(true);
  noteServerPorts(folded);
}

let timer: ReturnType<typeof setTimeout> | undefined;
let inflight = false;
/** 패널이 보고 있다고 잡아 둔 수 — 0이면 느린 주기로 내려간다 */
let fastHolders = 0;

function schedule(ms: number): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => void poll(), ms);
}

async function poll(): Promise<void> {
  if (inflight) return; // 진행 중인 폴이 끝나면서 다음 차례를 잡는다 (여기서 잡으면 두 줄이 된다)
  inflight = true;
  try {
    // 창이 숨겨진 동안은 netstat를 띄우지 않는다 (최적화 D7) — 느린 주기로 다시 보기만 한다
    const snap = document.hidden ? undefined : await portsSnapshot();
    if (snap) apply(snap);
  } finally {
    inflight = false;
    schedule(fastHolders > 0 ? FAST_MS : SLOW_MS);
  }
}

/** 포트 패널 `다시 실측` — 다음 주기를 기다리지 않고 지금 한 번 본다 */
export function refreshPorts(): void {
  if (started) schedule(0);
}

/** 앱 셸이 켠다 (App.tsx) — 패널 수명과 무관하게 계속 돈다 */
let started = false;
export function startPortWatch(): void {
  if (started || !isTauri()) return;
  started = true;
  void poll();
  document.addEventListener("visibilitychange", () => !document.hidden && schedule(0)); // 다시 보이면 바로
}

/** 패널이 마운트되는 동안 빠른 주기로 올린다. 반환은 해제 함수 (onCleanup에 건다) */
export function holdFastPoll(): () => void {
  fastHolders += 1;
  if (fastHolders === 1 && started) schedule(0); // 패널을 연 순간의 최신값부터
  let released = false;
  return () => {
    if (released) return;
    released = true;
    fastHolders -= 1;
  };
}
