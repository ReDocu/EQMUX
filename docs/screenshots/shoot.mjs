// EQMUX 스크린샷 재촬영 — Vite dev(브라우저 목 데이터) + headless Chrome(CDP). 의존성 없음(Node 22+ 내장 WebSocket · fetch).
//
//   1) npm run dev                                   (포트 1420)
//   2) chrome --headless=new --remote-debugging-port=9333 --disable-webgl --disable-gpu --hide-scrollbars
//             --window-size=1920,1080 --user-data-dir=<임시 폴더> about:blank
//   3) node docs/screenshots/shoot.mjs [이름 일부…]   (인자가 없으면 전부. 예: `shoot.mjs 35- 04-`)
//
// `--disable-webgl`이 있어야 터미널 글자가 찍힌다(xterm WebGL 렌더러는 headless 캡처에 안 담긴다).
// 화면마다 새 탭을 띄워 상태를 리셋한다. 결과는 이 폴더의 features/ · readme/에 바로 쓴다.
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CDP = "http://127.0.0.1:9333";
const APP = "http://localhost:1420/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 페이지 안 도우미 — S(상태 모듈) · B(목 backend) · click(글자로 누르기). Vite가 소스를 고친 뒤 `?t=` 붙은
 *  URL로 모듈을 다시 실으므로, 앱이 실제로 실은 URL을 찾아 import해야 같은 인스턴스가 잡힌다 */
const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mod = async (name) => {
    const hit = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.split("?")[0].endsWith(name)).pop();
    return import(hit ?? name);
  };
  const S = await mod("/src/state.ts");
  const B = (await mod("/src/backend/mock.ts")).backend;
  const vis = (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";
  const click = (text, sel) => {
    const el = [...document.querySelectorAll(sel)].filter(vis).find((e) => ((e.textContent ?? "") + (e.getAttribute("aria-label") ?? "")).includes(text));
    if (!el) throw new Error("no element: " + text);
    el.click();
  };
`;

async function page() {
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result);
  };
  const send = (method, params = {}) => new Promise((res, rej) => (pending.set(++id, { res, rej }), ws.send(JSON.stringify({ id, method, params }))));
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: APP });
  await sleep(2500);
  return {
    async ev(body) {
      const r = await send("Runtime.evaluate", { expression: `(async () => { ${PRELUDE}\n${body}\n })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
    },
    async mouse(x, y, button = "left") {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
    },
    type: (text) => send("Input.insertText", { text }),
    async snap(file) {
      await sleep(700);
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(file, Buffer.from(data, "base64"));
    },
    async close() {
      await fetch(`${CDP}/json/close/${t.id}`);
      ws.close();
    },
  };
}

/** 승인함에 [허용] · [거부]가 보이게 — 목 시드는 12분째라 훅 대기 시한(9.5분)이 지난 상태다 */
const FRESH_WAIT = `B.listSessions().find((s) => s.id === "noel@academy").sinceMs = 3 * 60000; B.broadcast();`;
const WS = `S.setView({ kind: "workspace", id: "academy" });`;
const PANE = { kai: [650, 330], sol: [1480, 800] }; // 2×2 그리드의 페인 한가운데 (CSS px)
const rightClick = (who) => async (p) => {
  await p.mouse(...PANE[who], "right");
  await sleep(500);
};
const menu = (who, item) => async (p) => {
  await rightClick(who)(p);
  await p.ev(`click(${JSON.stringify(item)}, ".cmenu-it");`);
  await sleep(600);
};

/** git 화면(§17)은 브라우저 dev에 실측이 없다 — 이 화면을 찍는 동안만 Tauri invoke를 흉내 내 데모 저장소를 돌려준다.
 *  커밋 · 브랜치는 git 패널 목(mock.ts GIT_COMMITS · DIFF_FILES)과 같은 이야기다. 앱 소스는 건드리지 않는다 */
const FAKE_GIT = `
  const now = Math.floor(Date.now() / 1000);
  const H = (h) => (h + "c4e19a7b03d5f6e82a1b9c7d40e35f6a8b2c1d0e").slice(0, 40);
  const c = (hash, parents, subject, ago, refs = [], author = "ReDocu") => ({ hash: H(hash), parents: parents.map(H), author, time: now - ago, subject, refs });
  const LOG = [
    c("8f31c2a", ["3d92b41"], "auth: 토큰 서명을 sealed 방식으로 교체", 600, ["HEAD -> feature/auth-refactor"]),
    c("e41d07b", ["3d92b41"], "회귀: 세션 만료 경계 테스트 추가", 1500, ["eqmux/sol"]),
    c("3d92b41", ["07c0aa9"], "auth: 세션 만료(expiresAt) 도입", 3600),
    c("07c0aa9", ["9ab3e10"], "auth: v1 토큰 경로 정리 준비", 86400, ["origin/main", "main", "origin/feature/auth-refactor"]),
    c("9ab3e10", ["2c6d8f4", "d447777"], "Merge branch 'feature/vitest'", 150000),
    c("d447777", ["71e0b93"], "테스트: vitest 기반으로 전환", 172800),
    c("2c6d8f4", ["71e0b93"], "docs: 인증 흐름 정리", 200000),
    c("71e0b93", ["5e0c1d2"], "ci: lint · typecheck 단계 추가", 400000, ["tag: v0.2.0"]),
    c("5e0c1d2", ["b7a94c0"], "auth: 로그인 실패 횟수 제한", 450000),
    c("b7a94c0", ["3f8d621"], "api: /me 응답에 역할 포함", 480000, [], "Mina"),
    c("3f8d621", ["c02e7ab"], "fix: 리프레시 토큰 중복 발급", 520000),
    c("c02e7ab", ["94d1f30"], "api: 세션 목록 엔드포인트", 560000, [], "Mina"),
    c("94d1f30", ["a5bafbe"], "auth: 로그인 · 로그아웃 뼈대", 590000),
    c("a5bafbe", [], "Initial commit", 604800),
  ];
  const br = (name, hash, upstream, ahead, head = false) => ({ name, hash: H(hash), upstream, ahead, behind: 0, gone: false, head });
  const f = (path, x, y) => ({ path, from: null, x, y });
  const ANSWERS = {
    git_log: (a) => (a.skip ? [] : LOG),
    git_refs: () => ({
      local: [br("feature/auth-refactor", "8f31c2a", "origin/feature/auth-refactor", 2, true), br("main", "07c0aa9", "origin/main", 0), br("eqmux/sol", "e41d07b", "", 0)],
      remote: [{ name: "origin/main", hash: H("07c0aa9") }, { name: "origin/feature/auth-refactor", hash: H("07c0aa9") }],
      tags: [{ name: "v0.2.0", hash: H("71e0b93") }],
      stashes: [],
      head: H("8f31c2a"),
    }),
    git_status: () => ({
      files: [f("src/auth/session.ts", "M", " "), f("src/auth/guard.ts", "A", " "), f("src/auth/token.ts", " ", "M"), f("tests/auth/session.test.ts", " ", "M"), f("package.json", " ", "M"), f("src/auth/legacy.ts", " ", "D")],
      headPushed: false, hasHead: true, progress: null,
    }),
    git_commit_sessions: () => ({ [H("8f31c2a")]: ["noel@academy"], [H("3d92b41")]: ["kai@academy"], [H("e41d07b")]: ["sol@academy"] }),
    git_commit_detail: (a) => { const k = LOG.find((x) => x.hash === a.hash); return { hash: k.hash, parents: k.parents, author: k.author, email: "redocu@users.noreply.github.com", authorTime: k.time, committer: k.author, commitTime: k.time, body: k.subject + "\\n\\nverifyToken이 만료를 확인하고, 만료된 토큰은 401로 끝낸다.\\n세션 TTL은 SESSION_TTL 하나로 모은다." }; },
    commit_changed_files: () => [{ status: "M", path: "src/auth/session.ts", stat: "+9 −5" }, { status: "M", path: "src/auth/token.ts", stat: "+14 −6" }, { status: "A", path: "src/auth/guard.ts", stat: "+18 −0" }, { status: "M", path: "tests/auth/session.test.ts", stat: "+7 −2" }],
  };
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd, args) => { if (ANSWERS[cmd]) return ANSWERS[cmd](args ?? {}); throw new Error("데모 — " + cmd); },
  };
`;

/** [파일(폴더/이름), 페이지 안 준비 코드, { settings, after(p) }] */
const SHOTS = [
  ["features/01-workspace-connection", `S.setOverlay("connect"); await wait(500); [...document.querySelectorAll(".ws-row")].find((r) => r.textContent.includes("Academy")).click();`],
  ["features/02-launch-mode", `S.setView({ kind: "launch", wsId: "atlas" });`],
  ["features/03-terminal-setup", `S.setView({ kind: "terminalSetup", wsId: "atlas" });`],
  ["features/04-dashboard", FRESH_WAIT],
  ["features/05-session-detail", `S.openSessionDetail("academy", "noel@academy");`],
  ["features/06-terminal-grid", WS],
  ["features/07-layout-picker", WS + `await wait(300); S.setLayoutPickerOpen(true);`],
  ["features/08-layout-main-right", WS + `await wait(300); S.setPaneLayout("main-right");`],
  ["features/09-terminal-fullscreen", `S.focusSession("academy", "kai@academy");`],
  ["features/10-team-casting", `S.setView({ kind: "casting", wsId: "academy" });`],
  ["features/11-team-composition", `S.setView({ kind: "composition", wsId: "academy" });`],
  ["features/12-role-library", WS + `S.setOverlay("roles"); await wait(500); click("리드", "button.rl-job");`],
  ["features/13-missions", WS + `S.setOverlay("explorer");`],
  ["features/14-mission-explorer", WS + `S.openPanel("files"); await wait(700); click("auth-refactor.md", "button.msnp-tree-row");`],
  ["features/15-panel-conversation", WS + `S.openPanel("conversation");`],
  ["features/16-panel-git", WS + `S.openPanel("git");`],
  ["features/17-panel-ports", WS + `S.openPanel("ports");`],
  ["features/18-panel-logs", WS + `S.openPanel("logs");`],
  ["features/19-panel-browser", WS + `S.openPanel("browser");`],
  ["features/20-git-diff", `S.setView({ kind: "gitdiff", wsId: "academy" });`],
  ["features/21-transcript", WS + `await wait(500); click("트랜스크립트", "button");`],
  ["features/22-settings", `S.setOverlay("settings");`],
  ["features/23-exit-dialog", WS + `S.setExitOpen(true);`],
  ["features/24-theme-light", WS, { settings: { theme: "light" } }],
  ["features/25-terminal-search", WS, { after: menu("kai", "검색") }],
  ["features/26-pane-menu", WS, { after: rightClick("kai") }],
  ["features/28-git-commit-diff", WS + `S.openPanel("git"); await wait(700); document.querySelector(".gitp-commit").click();`],
  ["features/29-english-ui", FRESH_WAIT, { settings: { language: "en" } }],
  ["features/30-notification-center", `click("알림 센터", "button.tool");`],
  ["features/31-completion-report", WS, { after: menu("sol", "줌") }],
  [
    "features/32-cross-project-message",
    WS + `S.openPanel("conversation"); await wait(700);
      [...document.querySelectorAll("textarea, input")].filter((el) => vis(el) && !el.closest(".xterm") && el.closest("[class*=panel], [class*=conv]")).pop().focus();`,
    { after: async (p) => (await p.type("@"), await sleep(500)) },
  ],
  ["features/33-run-panel", WS + `S.openPanel("env");`],
  ["features/35-git-screen", FAKE_GIT + `S.setView({ kind: "git", wsId: "academy" }); await wait(1200);`, { after: async (p) => (await p.mouse(600, 161), await sleep(600)) }], // 세 번째 커밋 행을 고른다
  ["features/36-mission-review", `S.setView({ kind: "review", wsId: "academy", missionId: "auth-refactor" });`],
  ["features/37-jump-palette", WS + `(await mod("/src/components/JumpPalette.tsx")).toggleJump();`],
  ["readme/casting", `S.setView({ kind: "casting", wsId: "eqmux" });`],
];

/** 같은 화면을 다른 이름으로도 쓴다 — 원본 → 사본 */
const COPIES = {
  "features/16-panel-git": ["features/34-rail-branches"],
  "features/04-dashboard": ["readme/dashboard"],
  "features/06-terminal-grid": ["readme/workspace"],
  "features/15-panel-conversation": ["readme/conversation"],
  "features/20-git-diff": ["readme/gitdiff"],
};

const want = process.argv.slice(2);
let failed = 0;
for (const [name, setup, opt = {}] of SHOTS) {
  if (want.length && !want.some((w) => name.includes(w))) continue;
  const p = await page();
  try {
    await p.ev(`
      (await mod("/src/backend/settings.ts")).updateSettings(${JSON.stringify({ firstRunSeen: true, ...opt.settings })});
      await wait(300);
      ${setup}
      await wait(900);
    `);
    await opt.after?.(p);
    await p.snap(join(HERE, `${name}.png`));
    for (const c of COPIES[name] ?? []) copyFileSync(join(HERE, `${name}.png`), join(HERE, `${c}.png`));
    console.log("shot", name, ...(COPIES[name] ?? []));
  } catch (e) {
    failed++;
    console.error("FAIL", name, String(e).slice(0, 300));
  }
  await p.close();
  await sleep(150);
}
process.exitCode = failed ? 1 : 0;
