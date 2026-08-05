// S2-13 — 워크스페이스 상태바 · 컨텍스트 바.
//
// 설계: docs/BRIEF-2026-08-05-S2-13.md · 디자인 실물 design.pen `n3r5tO`(하단) · `iWCIx`(상단 우측)
//
// 이 파일의 제1규칙은 **A-3를 건드리지 않는 것**이다.
// 출력량 표시는 PTY 출력마다 자라는 값이라, 순진하게 만들면 수신 콜백마다 DOM을 만지게 되고
// 그 경로가 곧 키 입력 지연(A-3)이 지나가는 자리다. 관문 A를 방금 통과했는데
// 상태바 하나로 되돌릴 수는 없다. 그래서:
//
//   수신 콜백 = 숫자 더하기만  /  DOM = 주기적으로, 값이 변했을 때만
//
// `#18` 경계: panels.ts · terminal.ts · pty.ts · layout.rs 는 세아 소유라 여기서 안 건드린다.
// 그래서 얻지 못하는 값이 셋 있다 — §"세아에게 요청한 것" 참조. 없는 값은 **비워 둔다.**
// 패널 수를 PTY 수인 척 보여주지 않는다.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { icon, type IconName } from "./icons";
import { logError } from "./log";
import type { PanelManager } from "./panels";

/**
 * 표시 갱신 주기(ms).
 *
 * 출력이 쏟아지는 동안에도 상태바는 초당 두 번만 바뀐다. 사람이 읽을 수 있는 상한이
 * 그 언저리고, 그 위로는 전부 A-3에 얹히는 비용일 뿐이다.
 */
const REFRESH_MS = 500;

/** `encodeInto` 스크래치. 이 길이까지는 한 번에 담긴다(UTF-8 최대 4바이트/문자). */
const SCRATCH_CHARS = 16_384;

interface OutputMeter {
  bytes(): number;
  dispose(): void;
}

/**
 * PTY 출력 누적 바이트.
 *
 * ⚠️ 프런트가 받는 것은 이미 String이라 **원래 바이트 수를 다시 세야 한다.**
 * `TextEncoder.encode()`는 청크마다 Uint8Array를 새로 만든다 — 출력이 쏟아질 때
 * 그 할당이 전부 이 경로에 쌓인다. 그래서 버퍼를 하나 잡아 두고 `encodeInto`로 재사용한다
 * (길이만 필요하고 내용은 버린다).
 *
 * 세아가 `pty.rs`에서 세어 올려 주면 이 클래스는 통째로 사라진다 — 그쪽이 정답이다.
 * 여기 있는 이유는 경계를 넘지 않고 먼저 재 보기 위해서다(브리프 §2).
 */
function installOutputMeter(): OutputMeter {
  const enc = new TextEncoder();
  const scratch = new Uint8Array(SCRATCH_CHARS * 4);
  let total = 0;
  let unlisten: UnlistenFn | null = null;

  void listen<{ id: string; data: string }>("pty://data", (ev) => {
    const s = ev.payload.data;
    // 짧은 청크는 할당 없이. 긴 청크는 드물고, 드문 쪽에 비용을 몰아 준다.
    total += s.length <= SCRATCH_CHARS ? enc.encodeInto(s, scratch).written : enc.encode(s).length;
  })
    .then((un) => {
      unlisten = un;
    })
    .catch((e) => logError("출력량 계측 리스너 등록 실패", e));

  return {
    bytes: () => total,
    dispose: () => {
      unlisten?.();
      unlisten = null;
    },
  };
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 경로를 끝에서부터 남긴다.
 *
 * 상태바는 `white-space: nowrap; overflow: hidden`이라 왼쪽부터 잘리면 **가장 중요한
 * 끝 폴더가 먼저 사라진다.** 앞을 접고 뒤를 남긴다.
 */
function tailPath(p: string, max = 44): string {
  if (p.length <= max) return p;
  return `…${p.slice(-(max - 1))}`;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/** 값이 그대로면 DOM을 안 만진다. 상태바가 hot path에 얹히는 걸 막는 마지막 관문이다. */
function setText(elm: HTMLElement, text: string): void {
  if (elm.textContent !== text) elm.textContent = text;
  if (elm.hidden !== (text === "")) elm.hidden = text === "";
}

/**
 * 아이콘 달린 조각 — 디자인(`n3r5tO`·`iWCIx`)의 [아이콘 + 라벨] 구조.
 * 아이콘은 설치 때 한 번 만들고, 갱신은 라벨 span만 만진다(setText와 같은 규칙).
 * 반환된 setter가 라벨과 조각 전체의 숨김을 함께 다룬다 — 값이 없으면 아이콘만 남는 일이 없다.
 */
function iconSegment(elm: HTMLElement | null, name: IconName, cls?: string): (text: string) => void {
  if (!elm) return () => undefined;
  if (cls) elm.classList.add(cls);
  elm.prepend(icon(name));
  const label = document.createElement("span");
  elm.appendChild(label);
  return (text) => {
    if (label.textContent !== text) label.textContent = text;
    if (elm.hidden !== (text === "")) elm.hidden = text === "";
  };
}

export interface WorkspaceStatusOptions {
  /** 패널 수·포커스를 읽는다. 계측 모드에는 없다. */
  manager: PanelManager | null;
  /** 앱이 잡은 작업 폴더 (`app_info.paths.workspace_root`). §"작업 경로" 참조. */
  workspaceRoot: string;
  /** 기동 시 확인된 셸 이름 (`app_info.shell`). */
  shell: string;
}

export interface WorkspaceStatus {
  /** 즉시 한 번 갱신 — 레이아웃이 바뀐 직후처럼 주기를 기다릴 이유가 없을 때. */
  refresh(): void;
  dispose(): void;
}

/**
 * 상태바·컨텍스트 바를 건다. **계측 모드(`--latency-probe` 등)에서는 부르지 않는다** —
 * A-3를 재는 조건에 표시 코드를 얹으면 재는 대상이 달라진다.
 */
export function installWorkspaceStatus(opts: WorkspaceStatusOptions): WorkspaceStatus {
  const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

  const cwdEl = q("#wsCwd");
  const outEl = q("#wsOutput");
  const ctxFontEl = q("#ctxFont");
  const ctxShellEl = q("#ctxShell");

  // 디자인 `n3r5tO`·`iWCIx`의 [아이콘 + 라벨] 조각. PTY는 green(radio), 배치는 blue(layout-grid).
  const setPanes = iconSegment(q("#wsPanes"), "radio", "pty");
  const setLayout = iconSegment(q("#wsLayout"), "layout-grid", "layout");
  const setCtxLayout = iconSegment(q("#ctxLayout"), "layout-grid", "chip");

  const meter = installOutputMeter();
  let lastBytes = -1;

  const refresh = (): void => {
    const m = opts.manager;

    // 살아 있는 PTY 수 — `ptyReport()`(세아 · §요청 1 ✅)에서 센다. 디자인의 `PTY 8 ONLINE`
    // 그대로다. 탭 때문에 셸 수 ≠ 패널 수라 **셸끼리** 비교한다: 죽은 셸이 있으면
    // `PTY 7/8 ONLINE`으로 보인다 — 안 보이면 죽은 셸이 숨는다.
    if (m) {
      const rep = m.ptyReport();
      const online = rep.filter((p) => p.alive).length;
      setPanes(online === rep.length ? `PTY ${online} ONLINE` : `PTY ${online}/${rep.length} ONLINE`);
    } else {
      setPanes("");
    }

    // 배치 라벨 (`S2-11` 세아). 프리셋이 안 걸렸으면(직접 분할·드래그) null이고, 그때는 비운다 —
    // "배치 없음"을 지어내지 않는다. 하단은 규칙까지, 상단은 짧은 이름만 (design.pen 그대로).
    const preset = m?.currentPreset() ?? null;
    setLayout(preset ? `${preset.short} · ${preset.rule}` : "");
    setCtxLayout(preset ? preset.short : "");

    const bytes = meter.bytes();
    if (bytes !== lastBytes) {
      lastBytes = bytes;
      if (outEl) setText(outEl, `출력 ${humanBytes(bytes)}`);
    }

    // 폰트 크기 — 포커스 패널의 터미널이 실제로 쓰는 값을 읽는다.
    // 설정값이 아니라 실물을 읽는 건 A-2에서 배운 방식이다(무엇을 그렸는지까지 본다).
    const size = m?.focused()?.handle?.term.options.fontSize;
    if (ctxFontEl) setText(ctxFontEl, typeof size === "number" ? `FONT ${size}` : "");

    // 셸 — 포커스 패널의 실제 셸이 있으면 그걸, 없으면 기동 시 확인된 값을.
    // 표시는 파일 이름만 — 전체 경로는 상단 바를 통째로 밀어낸다(실측). 경로는 툴팁에 둔다.
    const shell = m?.focused()?.link?.shell ?? opts.shell;
    if (ctxShellEl) {
      setText(ctxShellEl, shell ? baseName(shell) : "");
      if (ctxShellEl.title !== (shell ?? "")) ctxShellEl.title = shell ?? "";
    }
  };

  if (cwdEl) {
    // ⚠️ 이건 **앱이 잡은 작업 폴더**지 패널별 셸의 현재 위치가 아니다.
    // 전작(AgentCommender)도 세션 생성 시점 cwd를 고정 표시했고 셸이 `cd`해도 안 바뀌었다
    // (FEATURE-DIFF C2 — `pty-manager.ts:88,103`). 그 한계를 **적지 않은 것**이 대조표에서
    // 잡힌 항목이다. 후속작이 같은 한계를 또 안 적으면 대조표를 만든 의미가 없다.
    setText(cwdEl, tailPath(opts.workspaceRoot));
    cwdEl.title =
      `${opts.workspaceRoot}\n\n` +
      "앱이 잡은 작업 폴더입니다. 패널별 셸의 현재 위치가 아닙니다 —\n" +
      "셸이 cd로 이동해도 이 값은 바뀌지 않습니다 (FEATURE-DIFF C2).\n" +
      "실시간 추적은 셸 통합(OSC 7)이 필요한 별개 기능입니다.";
  }

  refresh();
  const timer = window.setInterval(refresh, REFRESH_MS);

  // 레이아웃이 바뀌면 주기를 기다리지 않는다 — 분할 직후 패널 수가 한 박자 늦게
  // 바뀌는 건 눈에 띈다. 구독 해제 함수를 받아 dispose에서 푼다.
  const offLayout = opts.manager?.onLayoutChanged(refresh) ?? null;

  return {
    refresh,
    dispose: () => {
      window.clearInterval(timer);
      offLayout?.();
      meter.dispose();
    },
  };
}

// ── 세아에게 요청한 것 (`#18` 규칙 3 — 경계를 고치지 않고 멈춰서 요청한다) ────────────
//
//   1. ~~살아 있는 PTY 목록 — `ptyReport()`~~ ✅ **들어왔다** — `PTY N ONLINE`을 실측으로 걸었다.
//      셸이 죽으면 `PTY 7/8 ONLINE`으로 갈라 보인다. 패널별 cwd(OSC 7)는 여전히 §2와 같은 한계다.
//   2. 출력 누적 바이트를 `pty.rs`에서 세어 주기적으로 올려 주기
//      · 프런트에서 다시 세는 건 이미 디코드된 문자열을 되감는 낭비다.
//        위 `installOutputMeter`는 그때까지의 임시 구현이다.
//   3. ~~(`S2-11`) `currentPreset()`~~ ✅ **들어왔다** — 배치 라벨 연결 완료 (short · rule)
