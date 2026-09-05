// 포트 패널 (rBkF0) — 세션 포트 + 시스템 포트. 실측은 공용 감시기(backend/ports)가 들고 있다 (M31).
// 패널이 직접 폴링하지 않는 이유: 패널을 닫아 둔 동안 열린 포트를 놓치기 때문이다. 여기서는
// 마운트 동안 주기만 빠르게 올리고(holdFastPoll) 결과를 그린다.
// 세션 귀속은 Job Object pid 대조 — 관측 전용이며 프로세스 종료는 제공하지 않는다 (git 패널과 같은 원칙).
// "열기"는 자동이 아니다 — 새 포트는 NEW 칩과 탭 뱃지로 알리고, 여는 것은 언제나 이 클릭이다.
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js";
import { backend, PORT_SUMMARY, SESSION_PORTS } from "../backend/mock";
import {
  holdFastPoll,
  isExposed,
  isNewPort,
  markPortsSeen,
  portAddress,
  portsLive,
  portUrl,
  sessionPorts,
  systemPorts,
} from "../backend/ports";
import type { PortEntry } from "../backend/ports";
import { clipWriteText, isTauri } from "../backend/pty";
import { openInBrowserPanel } from "../state";
import { t, tf } from "../i18n";

interface Row {
  key: string;
  port: number;
  host: string; // 대표 바인딩 — 열기·복사에 쓰는 쪽
  proc: string;
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

  // 패널을 보고 있는 동안만 빠른 주기 — 닫으면 감시기가 알아서 느려진다
  onMount(() => onCleanup(holdFastPoll()));

  const personaName = (sessionId: string) => {
    const s = backend.listSessions().find((x) => x.id === sessionId);
    const p = s && backend.listPersonas().find((x) => x.id === s.personaId);
    return p?.name ?? sessionId.split("@")[0];
  };

  const toRow = (e: PortEntry): Row => ({
    key: e.key,
    port: e.port,
    host: e.host,
    proc: e.process,
    session: e.session ? personaName(e.session) : undefined,
    badge: e.port === 9229 ? "DEBUG" : "LISTENING",
    isNew: isNewPort(e),
    exposed: isExposed(e),
    url: portUrl(e),
  });

  const rows = createMemo<{ session: Row[]; system: Row[] }>(() => {
    if (isTauri() && portsLive()) {
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
    if (!isTauri() || !portsLive()) return PORT_SUMMARY;
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

  return (
    <div class="portsp">
      <div class="panel-head-row">
        <span class="panel-title">{t("포트")}</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {summary().session + summary().system} OPEN {t(isTauri() && portsLive() ? "· 실측" : "· 목")}
        </span>
      </div>

      <input
        class="panel-search mono"
        placeholder={t("포트 · 프로세스 · 세션 검색")}
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />

      <div class="portsp-section-head">
        <span class="eyebrow">SESSION PORTS</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {filtered().length} OPEN · 5s POLL
        </span>
      </div>
      <For each={filtered()}>
        {(p) => (
          <div class="card inset portsp-row" classList={{ fresh: p.isNew }}>
            <span class="portsp-dot" classList={{ debug: p.badge === "DEBUG" }} />
            <div class="portsp-copy">
              <div class="portsp-top">
                <span class="mono" style={{ "font-weight": 700 }}>
                  :{p.port}
                </span>
                <Show when={p.isNew}>
                  <span class="badge blue">NEW</span>
                </Show>
                <span class="badge" classList={{ green: p.badge === "LISTENING", amber: p.badge === "DEBUG" }}>
                  {p.badge}
                </span>
              </div>
              <div class="mono muted" style={{ "font-size": "10px" }}>
                {p.proc} · {p.session} · {p.host}
              </div>
            </div>
            <div class="portsp-actions">
              <button class="portsp-act" title={t("브라우저 패널에서 열기")} onClick={() => openInBrowserPanel(p.url)}>
                ↗
              </button>
              <button class="portsp-act" title={t("주소 복사")} onClick={() => copyAddr(p)}>
                ⧉
              </button>
            </div>
          </div>
        )}
      </For>
      <Show when={filtered().length === 0}>
        <div class="muted" style={{ padding: "8px", "font-size": "11px" }}>
          {t("세션이 연 LISTENING 포트가 없습니다")}
        </div>
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
