// 포트 패널 (rBkF0) — 세션 포트 + 시스템 포트 요약. 5초 폴링은 목이며 정적 데이터를 보여준다.
import { createMemo, createSignal, For, Show } from "solid-js";
import { PORT_SUMMARY, SESSION_PORTS } from "../backend/mock";
import type { SessionPort } from "../backend/mock";

const SYSTEM_PORTS = [
  { port: 135, proc: "svchost" },
  { port: 445, proc: "System" },
  { port: 5432, proc: "postgres" },
];

export function PortsPanelTab() {
  const [query, setQuery] = createSignal("");
  const [killed, setKilled] = createSignal<number[]>([]);
  const [sysOpen, setSysOpen] = createSignal(false);

  const ports = createMemo(() =>
    SESSION_PORTS.filter((p) => {
      if (killed().includes(p.port)) return false;
      const q = query().trim();
      return !q || `${p.port} ${p.proc} ${p.session}`.includes(q);
    }),
  );

  const copyAddr = (p: SessionPort) => {
    void navigator.clipboard?.writeText(`${p.host}:${p.port}`).catch(() => {});
  };

  return (
    <div class="portsp">
      <div class="panel-head-row">
        <span class="panel-title">포트</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {PORT_SUMMARY.session + PORT_SUMMARY.system} OPEN
        </span>
      </div>

      <input
        class="panel-search mono"
        placeholder="포트 · 프로세스 · 세션 검색"
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />

      <div class="portsp-section-head">
        <span class="eyebrow">SESSION PORTS</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {ports().length} OPEN · 5s POLL
        </span>
      </div>
      <For each={ports()}>
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
              <button class="portsp-act" title="주소 복사" onClick={() => copyAddr(p)}>
                ⧉
              </button>
              <button class="portsp-act" title="브라우저에서 열기">
                ↗
              </button>
              <button class="portsp-act" title="프로세스 종료 (목)" onClick={() => setKilled([...killed(), p.port])}>
                ✕
              </button>
            </div>
          </div>
        )}
      </For>

      <button class="portsp-section-head sys" onClick={() => setSysOpen(!sysOpen())}>
        <span class="eyebrow">
          <span class="mono">{sysOpen() ? "▾" : "›"}</span> SYSTEM PORTS
        </span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {PORT_SUMMARY.system} LISTENING
        </span>
      </button>
      <Show when={sysOpen()}>
        <div class="card inset" style={{ padding: "4px 10px" }}>
          <For each={SYSTEM_PORTS}>
            {(p) => (
              <div class="kv">
                <span class="k mono">:{p.port}</span>
                <span class="v muted">{p.proc}</span>
              </div>
            )}
          </For>
          <div class="mono muted" style={{ "font-size": "10px", padding: "4px 0" }}>
            + {PORT_SUMMARY.system - SYSTEM_PORTS.length}개 더 (목)
          </div>
        </div>
      </Show>

      <div class="portsp-summary card inset">
        <div class="eyebrow" style={{ "margin-bottom": "6px" }}>
          포트 사용 요약
        </div>
        <div class="portsp-summary-grid">
          <For
            each={[
              { v: PORT_SUMMARY.session, k: "세션 포트" },
              { v: PORT_SUMMARY.system, k: "시스템 포트" },
              { v: PORT_SUMMARY.conflicts, k: "충돌" },
              { v: PORT_SUMMARY.exposed, k: "외부 노출" },
            ]}
          >
            {(m) => (
              <div class="portsp-summary-cell">
                <div class="mono" style={{ "font-size": "16px", "font-weight": 700 }}>
                  {m.v}
                </div>
                <div class="muted" style={{ "font-size": "10px" }}>
                  {m.k}
                </div>
              </div>
            )}
          </For>
        </div>
        <div class="portsp-notice">
          <span class="st-green">✓</span> 모든 개발 포트가 localhost에만 바인딩되어 있습니다.
        </div>
      </div>
    </div>
  );
}
