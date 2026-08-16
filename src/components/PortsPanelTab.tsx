// 포트 패널 (rBkF0) — 세션 포트 + 시스템 포트. Tauri에서는 netstat 실측을 5초 폴링한다 (PRD H).
// 세션 귀속은 Job Object pid 대조 — 관측 전용이며 프로세스 종료는 제공하지 않는다 (git 패널과 같은 원칙).
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { backend, PORT_SUMMARY, SESSION_PORTS } from "../backend/mock";
import { portsSnapshot } from "../backend/panels";
import type { PortRow } from "../backend/panels";
import { clipWriteText, isTauri } from "../backend/pty";
import { t } from "../i18n";

interface Row {
  port: number;
  host: string;
  proc: string;
  session?: string; // 세션 이름 (귀속 시)
  badge: "LISTENING" | "DEBUG";
}

const MOCK_SYSTEM: Row[] = [
  { port: 135, host: "0.0.0.0", proc: "svchost", badge: "LISTENING" },
  { port: 445, host: "0.0.0.0", proc: "System", badge: "LISTENING" },
  { port: 5432, host: "127.0.0.1", proc: "postgres", badge: "LISTENING" },
];

export function PortsPanelTab() {
  const [query, setQuery] = createSignal("");
  const [sysOpen, setSysOpen] = createSignal(false);
  const [real, setReal] = createSignal<PortRow[] | undefined>(undefined);

  onMount(() => {
    if (!isTauri()) return;
    const load = () => void portsSnapshot().then(setReal);
    load();
    const t = setInterval(load, 5_000);
    onCleanup(() => clearInterval(t));
  });

  const personaName = (sessionId: string) => {
    const s = backend.listSessions().find((x) => x.id === sessionId);
    const p = s && backend.listPersonas().find((x) => x.id === s.personaId);
    return p?.name ?? sessionId.split("@")[0];
  };

  const rows = createMemo<{ session: Row[]; system: Row[] }>(() => {
    const r = real();
    if (isTauri() && r) {
      const toRow = (p: PortRow): Row => ({
        port: p.port,
        host: p.host,
        proc: p.process,
        session: p.session ? personaName(p.session) : undefined,
        badge: p.port === 9229 ? "DEBUG" : "LISTENING",
      });
      const all = r.map(toRow);
      return { session: all.filter((x) => x.session), system: all.filter((x) => !x.session) };
    }
    return {
      session: SESSION_PORTS.map((p) => ({ port: p.port, host: p.host, proc: p.proc, session: p.session, badge: p.badge })),
      system: MOCK_SYSTEM,
    };
  });

  const filtered = createMemo(() =>
    rows().session.filter((p) => {
      const q = query().trim();
      return !q || `${p.port} ${p.proc} ${p.session ?? ""}`.includes(q);
    }),
  );

  // 요약 — 충돌 = 같은 포트를 여러 pid가 리슨, 외부 노출 = 루프백이 아닌 바인딩
  const summary = createMemo(() => {
    const all = [...rows().session, ...rows().system];
    if (!isTauri() || !real()) return PORT_SUMMARY;
    const counts = new Map<number, number>();
    for (const p of all) counts.set(p.port, (counts.get(p.port) ?? 0) + 1);
    const conflicts = [...counts.values()].filter((n) => n > 1).length;
    const loopback = (h: string) => h.startsWith("127.") || h === "[::1]" || h === "localhost";
    const exposed = all.filter((p) => !loopback(p.host) && p.host !== "0.0.0.0" && p.host !== "[::]").length
      + all.filter((p) => (p.host === "0.0.0.0" || p.host === "[::]") && rows().session.includes(p)).length;
    return { session: rows().session.length, system: rows().system.length, conflicts, exposed };
  });

  const copyAddr = (p: Row) => {
    const host = p.host === "0.0.0.0" || p.host === "[::]" ? "127.0.0.1" : p.host;
    void clipWriteText(`${host}:${p.port}`);
  };

  return (
    <div class="portsp">
      <div class="panel-head-row">
        <span class="panel-title">{t("포트")}</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {summary().session + summary().system} OPEN {t(isTauri() && real() ? "· 실측" : "· 목")}
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
          <div class="card inset portsp-row">
            <span class="portsp-dot" classList={{ debug: p.badge === "DEBUG" }} />
            <div class="portsp-copy">
              <div class="portsp-top">
                <span class="mono" style={{ "font-weight": 700 }}>
                  :{p.port}
                </span>
                <span class="badge" classList={{ green: p.badge === "LISTENING", amber: p.badge === "DEBUG" }}>
                  {p.badge}
                </span>
              </div>
              <div class="mono muted" style={{ "font-size": "10px" }}>
                {p.proc} · {p.session} · {p.host}
              </div>
            </div>
            <div class="portsp-actions">
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
              { v: summary().exposed, k: "외부 노출" },
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
            fallback={<><span class="st-waiting">⚠</span> {t("루프백 밖으로 바인딩된 포트가 있습니다.")}</>}
          >
            <span class="st-green">✓</span> {t("세션 포트가 루프백에만 바인딩되어 있습니다.")}
          </Show>
        </div>
      </div>
    </div>
  );
}
