// 서버 로그 패널 (KcL3j) — 레벨 필터 + 검색. Tauri에선 event 테이블 실스트림 (FR-G-40),
// 브라우저에선 목 로그. 저장: 표시 중인 로그를 파일로 내보내고, 세션 로그 폴더를 연다.
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { queryGlobalEvents } from "../backend/events";
import type { FeedEvent } from "../backend/events";
import { backend, LOG_METRICS, SERVER_LOGS } from "../backend/mock";
import type { ServerLog } from "../backend/mock";
import { isTauri, openLogDir } from "../backend/pty";

const LEVELS = ["전체", "INFO", "WARN", "ERROR"] as const;

// 이벤트 → 로그 행 변환 — 레벨은 내용에서 추정한다 (waiting=warn · dead/비정상 종료=error)
function toLog(e: FeedEvent): ServerLog {
  const level: ServerLog["level"] =
    e.message.startsWith("dead") || /exit [1-9]/.test(e.message)
      ? "error"
      : e.message.startsWith("waiting")
        ? "warn"
        : "info";
  const type: ServerLog["type"] = e.kind === "state" ? "agent" : e.kind === "app" ? "세션" : "store";
  const who = e.sessionId ? `${e.sessionId.split("@")[0]} · ` : "";
  return { time: e.time, type, message: `${who}${e.message}`, level };
}

export function LogsPanelTab() {
  const [level, setLevel] = createSignal<(typeof LEVELS)[number]>("전체");
  const [query, setQuery] = createSignal("");

  // 실스트림 — 상태 방송에 붙어 디바운스 갱신 (폴링 없음)
  const [realLogs, setRealLogs] = createSignal<ServerLog[]>([]);
  onMount(() => {
    if (!isTauri()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => void queryGlobalEvents(200).then((es) => setRealLogs(es.map(toLog)));
    load();
    const unsub = backend.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 500);
    });
    onCleanup(() => {
      clearTimeout(timer);
      unsub();
    });
  });
  const source = () => (isTauri() ? realLogs() : SERVER_LOGS);
  const metrics = createMemo(() => {
    if (!isTauri()) return LOG_METRICS;
    const all = source();
    const info = all.filter((l) => l.level === "info").length;
    const warn = all.filter((l) => l.level === "warn").length;
    const error = all.filter((l) => l.level === "error").length;
    return { info, warn, error, total: all.length, rate: "event 테이블 실측" };
  });

  const logs = createMemo(() =>
    source().filter((l) => {
      if (level() !== "전체" && l.level !== level().toLowerCase()) return false;
      const q = query().trim();
      if (q && !`${l.type} ${l.message}`.includes(q)) return false;
      return true;
    }),
  );

  // 표시 중인 로그를 텍스트 파일로 내보내기 (필터 반영)
  const exportLogs = () => {
    const text = logs()
      .map((l) => `${l.time} [${l.level.toUpperCase()}] [${l.type}] ${l.message}`)
      .join("\n");
    const url = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "eqmux-server-logs.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div class="logsp">
      <div class="panel-head-row">
        <span class="panel-title">서버 로그</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {metrics().total} LINES
        </span>
        <select
          class="logsp-level mono"
          value={level()}
          onChange={(e) => setLevel(e.currentTarget.value as (typeof LEVELS)[number])}
        >
          <For each={LEVELS}>{(l) => <option value={l}>{l}</option>}</For>
        </select>
        <button class="btn ghost" style={{ padding: "2px 7px" }} title="표시 중인 로그를 파일로 저장" onClick={exportLogs}>
          ⤓ 저장
        </button>
      </div>

      <input
        class="panel-search mono"
        placeholder="분류 · 세션 · 내용 검색"
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />

      <div class="logsp-metrics">
        <div class="card inset logsp-metric">
          <div class="logsp-metric-v mono">{metrics().info}</div>
          <div class="eyebrow">INFO</div>
        </div>
        <div class="card inset logsp-metric warn">
          <div class="logsp-metric-v mono">{metrics().warn}</div>
          <div class="eyebrow">WARN</div>
        </div>
        <div class="card inset logsp-metric error">
          <div class="logsp-metric-v mono">{metrics().error}</div>
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
          {isTauri() ? "event 테이블 스트림 연결됨" : "실시간 스트림 (목)"}
        </span>
        <span class="mono muted">{metrics().rate}</span>
      </div>

      <Show when={isTauri()}>
        <div class="card inset logsp-session-logs">
          <div>
            <div style={{ "font-weight": 700, "font-size": "11px" }}>세션 로그 (PTY 원문)</div>
            <div class="mono muted" style={{ "font-size": "10px" }}>
              ~/.eqmux/logs/&lt;세션&gt;.log · 실시간 append
            </div>
          </div>
          <button class="btn" onClick={openLogDir}>
            폴더 열기
          </button>
        </div>
      </Show>
    </div>
  );
}
