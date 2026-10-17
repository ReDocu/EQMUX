// 포트 패널 (rBkF0) — 세션 포트 + 시스템 포트. 실측은 공용 감시기(backend/ports)가 들고 있다 (M31).
// 패널이 직접 폴링하지 않는 이유: 패널을 닫아 둔 동안 열린 포트를 놓치기 때문이다. 여기서는
// 결과를 그리기만 한다. 갱신은 [다시 실측]으로만 한다 (주기 폴링 없음).
// 세션 귀속은 Job Object pid 대조 — 관측 전용이며 프로세스 종료는 제공하지 않는다 (git 패널과 같은 원칙).
// "열기"는 자동이 아니다 — 새 포트는 NEW 칩과 탭 뱃지로 알리고, 여는 것은 언제나 이 클릭이다.
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { backend, PORT_SUMMARY, SESSION_PORTS } from "../backend/mock";
import {
  isExposed,
  isNewPort,
  isServerTermId,
  markPortsSeen,
  portAddress,
  portsLive,
  portUrl,
  refreshPorts,
  sessionPorts,
  systemPorts,
} from "../backend/ports";
import type { PortEntry } from "../backend/ports";
import { clipWriteText, isTauri } from "../backend/pty";
import { openLink } from "../backend/browser";
import { openInBrowserPanel, setPanelNote } from "../state";
import { Icon } from "./icons";
import { ContextMenu } from "./ui";
import { t, tf } from "../i18n";
import { nameBesideNo, paneNo, sessionName } from "../types";

interface Row {
  key: string;
  port: number;
  host: string; // 대표 바인딩 — 열기·복사에 쓰는 쪽
  proc: string;
  pid?: number;
  session?: string; // 세션 이름 (귀속 시)
  badge: "LISTENING" | "DEBUG";
  isNew: boolean;
  exposed: boolean;
  url: string;
}

const mockRow = (port: number, host: string, proc: string, session?: string): Row => ({
  key: `mock${port}`,
  port,
  host,
  proc,
  session,
  badge: port === 9229 ? "DEBUG" : "LISTENING",
  isNew: false,
  exposed: false,
  url: `http://${host}:${port}`,
});

const MOCK_SYSTEM: Row[] = [
  mockRow(135, "0.0.0.0", "svchost"),
  mockRow(445, "0.0.0.0", "System"),
  mockRow(5432, "127.0.0.1", "postgres"),
];

export function PortsPanelTab() {
  const [query, setQuery] = createSignal("");
  const [sysOpen, setSysOpen] = createSignal(false);

  const personaName = (sessionId: string) => {
    if (isServerTermId(sessionId)) return t("서버");
    const s = backend.listSessions().find((x) => x.id === sessionId);
    if (!s) return sessionId.split("@")[0];
    // 시안 qFwsr — `01 EQMUX01`처럼 번호와 세션 이름
    return `${paneNo(s)} ${nameBesideNo(paneNo(s), sessionName(s, backend.listPersonas().find((x) => x.id === s.personaId)))}`;
  };

  const toRow = (e: PortEntry): Row => ({
    key: e.key,
    port: e.port,
    host: e.host,
    proc: e.process,
    pid: e.pid,
    session: e.session ? personaName(e.session) : undefined,
    badge: e.port === 9229 ? "DEBUG" : "LISTENING",
    isNew: isNewPort(e),
    exposed: isExposed(e),
    url: portUrl(e),
  });

  const rows = createMemo<{ session: Row[]; system: Row[] }>(() => {
    if (isTauri()) {
      // 첫 실측 전에는 빈 상태다 — 목 행을 보이면 실제 앱에 가짜 포트가 뜬다 (BR-13)
      if (!portsLive()) return { session: [], system: [] };
      return { session: sessionPorts().map(toRow), system: systemPorts().map(toRow) };
    }
    return {
      session: SESSION_PORTS.map((p) => mockRow(p.port, p.host, p.proc, p.session)),
      system: MOCK_SYSTEM,
    };
  });

  // 패널을 보고 있다 = 확인했다 — 목록이 바뀔 때마다 탭 뱃지를 끈다.
  // untrack — markPortsSeen이 읽는 확인 표시까지 의존성에 걸면 자기 쓰기로 한 번 더 돈다
  createEffect(() => {
    rows().session;
    untrack(markPortsSeen);
  });

  const filtered = createMemo(() =>
    rows().session.filter((p) => {
      const q = query().trim();
      return !q || `${p.port} ${p.proc} ${p.session ?? ""}`.includes(q);
    }),
  );

  // 요약 — 충돌 = 같은 포트 번호를 여러 프로세스가 리슨(시스템 포트 포함),
  // 외부 노출 = 루프백 밖에 바인딩된 '세션' 포트. 시스템 포트를 함께 세면 Windows 파일공유
  // (NetBIOS 139 등)만으로도 항상 ⚠가 켜져, 보안 성격의 경고가 상시 오탐이 된다 (B61)
  const summary = createMemo(() => {
    if (!isTauri()) return PORT_SUMMARY;
    const all = [...rows().session, ...rows().system];
    const counts = new Map<number, number>();
    for (const p of all) counts.set(p.port, (counts.get(p.port) ?? 0) + 1);
    return {
      session: rows().session.length,
      system: rows().system.length,
      conflicts: [...counts.values()].filter((n) => n > 1).length,
      exposed: rows().session.filter((p) => p.exposed).length,
    };
  });

  const copyAddr = (p: Row) => void clipWriteText(portAddress(p));

  // 세그먼트 줄 오른쪽 요약 (0.5 시안 qFwsr) — `실측 3 · 새 1`
  createEffect(() => {
    const live = isTauri() && portsLive();
    setPanelNote(
      tf(live ? "실측 {n} · 새 {m}" : "목 {n} · 새 {m}", {
        n: rows().session.length,
        m: rows().session.filter((p) => p.isNew).length,
      }),
    );
  });
  onCleanup(() => setPanelNote(""));

  // 행 우클릭 메뉴 — 시안 kM4KC. 프로세스 종료는 두지 않는다(관측 전용)
  const [rowMenu, setRowMenu] = createSignal<{ x: number; y: number; p: Row } | undefined>(undefined);

  return (
    <div class="portsp">
      <div class="portsp-head">
        <span class="portsp-title">{t("열린 포트 · 이 워크스페이스의 프로세스")}</span>
        <button class="btn" disabled={!isTauri()} onClick={refreshPorts}>
          <Icon name="refresh-cw" size={12} />
          {t("다시 실측")}
        </button>
      </div>

      <input
        class="panel-search mono"
        placeholder={t("포트 · 프로세스 · 세션 검색")}
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />

      <Show
        when={filtered().length > 0}
        fallback={
          <div class="portsp-empty">
            <div class="portsp-empty-title">
              {t(isTauri() && !portsLive() ? "포트를 처음 읽는 중…" : "세션이 연 LISTENING 포트가 없습니다")}
            </div>
          </div>
        }
      >
        <div class="portsp-list">
          <For each={filtered()}>
            {(p) => (
              <div
                class="portsp-row"
                classList={{ fresh: p.isNew }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setRowMenu({ x: e.clientX, y: e.clientY, p });
                }}
              >
                <span class="portsp-port mono">{p.port}</span>
                <div class="portsp-copy">
                  <div class="portsp-who">
                    {p.session ? `${p.session} · ${p.proc}` : p.proc}
                  </div>
                  <div class="portsp-pid mono">
                    {p.pid !== undefined ? `PID ${p.pid} · ${p.host}` : p.host}
                  </div>
                </div>
                <div class="portsp-actions">
                  <Show when={p.isNew}>
                    <span class="badge blue mono">NEW</span>
                  </Show>
                  <Show when={p.badge === "DEBUG"}>
                    <span class="badge amber mono">DEBUG</span>
                  </Show>
                  <button
                    class="portsp-act"
                    title={t("브라우저로 열기")}
                    aria-label={t("브라우저로 열기")}
                    onClick={() => openLink(p.url)}
                  >
                    <Icon name="external-link" size={13} />
                  </button>
                  <button
                    class="portsp-act"
                    title={t("브라우저 패널에서 열기")}
                    aria-label={t("브라우저 패널에서 열기")}
                    onClick={() => openInBrowserPanel(p.url)}
                  >
                    <Icon name="globe" size={13} />
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={rowMenu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            header={`:${m().p.port}`}
            onClose={() => setRowMenu(undefined)}
            groups={[
              [
                { label: t("브라우저로 열기"), action: () => openLink(m().p.url) },
                { label: t("브라우저 패널에서 열기"), action: () => openInBrowserPanel(m().p.url) },
                { label: t("주소 복사"), action: () => copyAddr(m().p) },
              ],
            ]}
          />
        )}
      </Show>

      <button class="portsp-section-head sys" onClick={() => setSysOpen(!sysOpen())}>
        <span class="eyebrow">
          <span class="mono">{sysOpen() ? "▾" : "›"}</span> SYSTEM PORTS
        </span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {rows().system.length} LISTENING
        </span>
      </button>
      <Show when={sysOpen()}>
        <div class="card inset" style={{ padding: "4px 10px", "max-height": "180px", "overflow-y": "auto" }}>
          <For each={rows().system}>
            {(p) => (
              <div class="kv">
                <span class="k mono">:{p.port}</span>
                <span class="v muted">
                  {p.proc} · {p.host}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="portsp-summary card inset">
        <div class="eyebrow" style={{ "margin-bottom": "6px" }}>
          {t("포트 사용 요약")}
        </div>
        <div class="portsp-summary-grid">
          <For
            each={[
              { v: summary().session, k: "세션 포트" },
              { v: summary().system, k: "시스템 포트" },
              { v: summary().conflicts, k: "충돌" },
              { v: summary().exposed, k: "세션 외부 노출" },
            ]}
          >
            {(m) => (
              <div class="portsp-summary-cell">
                <div class="mono" style={{ "font-size": "16px", "font-weight": 700 }}>
                  {m.v}
                </div>
                <div class="muted" style={{ "font-size": "10px" }}>
                  {t(m.k)}
                </div>
              </div>
            )}
          </For>
        </div>
        <div class="portsp-notice">
          <Show
            when={summary().exposed === 0}
            fallback={
              <>
                <span class="st-waiting">⚠</span>{" "}
                {tf("세션 포트 {n}개가 루프백 밖에 바인딩되어 있습니다.", { n: String(summary().exposed) })}
              </>
            }
          >
            <span class="st-green">✓</span> {t("세션 포트가 루프백에만 바인딩되어 있습니다.")}
          </Show>
        </div>
      </div>
    </div>
  );
}
