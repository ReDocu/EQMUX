// 서버 로그 패널 (KcL3j) — 레벨 필터 + 검색 + 실시간 스트림 목.
import { createMemo, createSignal, For, Show } from "solid-js";
import { LOG_METRICS, SERVER_LOGS } from "../backend/mock";

const LEVELS = ["전체", "INFO", "WARN", "ERROR"] as const;

export function LogsPanelTab() {
  const [level, setLevel] = createSignal<(typeof LEVELS)[number]>("전체");
  const [query, setQuery] = createSignal("");

  const logs = createMemo(() =>
    SERVER_LOGS.filter((l) => {
      if (level() !== "전체" && l.level !== level().toLowerCase()) return false;
      const q = query().trim();
      if (q && !`${l.type} ${l.message}`.includes(q)) return false;
      return true;
    }),
  );

  return (
    <div class="logsp">
      <div class="panel-head-row">
        <span class="panel-title">서버 로그</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {LOG_METRICS.total} LINES
        </span>
        <select
          class="logsp-level mono"
          value={level()}
          onChange={(e) => setLevel(e.currentTarget.value as (typeof LEVELS)[number])}
        >
          <For each={LEVELS}>{(l) => <option value={l}>{l}</option>}</For>
        </select>
      </div>

      <input
        class="panel-search mono"
        placeholder="분류 · 세션 · 내용 검색"
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />

      <div class="logsp-metrics">
        <div class="card inset logsp-metric">
          <div class="logsp-metric-v mono">{LOG_METRICS.info}</div>
          <div class="eyebrow">INFO</div>
        </div>
        <div class="card inset logsp-metric warn">
          <div class="logsp-metric-v mono">{LOG_METRICS.warn}</div>
          <div class="eyebrow">WARN</div>
        </div>
        <div class="card inset logsp-metric error">
          <div class="logsp-metric-v mono">{LOG_METRICS.error}</div>
          <div class="eyebrow">ERROR</div>
        </div>
      </div>

      <div class="logsp-list">
        <For each={logs()}>
          {(l) => (
            <div class="logsp-row" classList={{ error: l.level === "error", warn: l.level === "warn" }}>
              <span class="mono muted logsp-time">{l.time}</span>
              <span class="badge logsp-type">{l.type}</span>
              <span class="logsp-msg">{l.message}</span>
              <Show when={l.expandable}>
                <span class="mono muted">›</span>
              </Show>
            </div>
          )}
        </For>
        <Show when={logs().length === 0}>
          <div class="muted" style={{ padding: "12px", "font-size": "11px" }}>
            조건에 맞는 로그가 없습니다
          </div>
        </Show>
      </div>

      <div class="card inset logsp-footer">
        <span class="logsp-live">
          <span class="logsp-live-dot" />
          실시간 스트림 연결됨
        </span>
        <span class="mono muted">{LOG_METRICS.rate}</span>
      </div>
    </div>
  );
}
