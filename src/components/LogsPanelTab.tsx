// 서버 로그 패널 (KcL3j) — 레벨 필터 + 검색. Tauri에선 event 테이블 실스트림 (FR-G-40),
// 브라우저에선 목 로그. 저장: 표시 중인 로그를 파일로 내보내고, 세션 로그 폴더를 연다.
// Enter = 디스크 전문 검색 (FR-C-16 FTS) — 전체 스크롤백을 뒤지고, 히트 클릭 = 그 지점의
// 앞뒤 기록을 디스크에서 조각 로드해 보여준다 (FR-C-13·14).
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { queryGlobalEvents } from "../backend/events";
import type { FeedEvent } from "../backend/events";
import { backend, LOG_METRICS, SERVER_LOGS } from "../backend/mock";
import type { ServerLog } from "../backend/mock";
import { pageScrollback, searchScrollback } from "../backend/panels";
import type { ScrollbackHit } from "../backend/panels";
import { isTauri, openLogDir } from "../backend/pty";
import { t, tf } from "../i18n";

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

type DiskHit = ScrollbackHit & { wsId: string };

const hhmmss = (ts: number) => {
  const t = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
};

export function LogsPanelTab() {
  const [level, setLevel] = createSignal<(typeof LEVELS)[number]>("전체");
  const [query, setQuery] = createSignal("");

  // ── 디스크 전문 검색 (FR-C-16) — Enter로 실행, 결과가 있으면 라이브 목록을 대신한다 ──
  const [hits, setHits] = createSignal<DiskHit[] | null>(null);
  const [searching, setSearching] = createSignal(false);
  const [ctx, setCtx] = createSignal<{ wsId: string; session: string; hitSeq: number; lines: ScrollbackHit[] } | null>(null);

  const runDiskSearch = async () => {
    const q = query().trim();
    if (!q || !isTauri()) return;
    setSearching(true);
    setCtx(null);
    const wss = backend.listWorkspaces();
    const all = await Promise.all(
      wss.map(async (w) => (await searchScrollback(w.id, q)).map((h) => ({ ...h, wsId: w.id }))),
    );
    setHits(all.flat().sort((a, b) => b.ts - a.ts).slice(0, 100));
    setSearching(false);
  };

  // 히트 문맥 열람 (FR-C-13·14) — 그 지점 앞뒤 ~60줄을 디스크에서 조각 로드
  const openContext = async (h: DiskHit) => {
    const lines = await pageScrollback(h.wsId, h.sessionId, h.seq + 31, 60);
    setCtx({ wsId: h.wsId, session: h.sessionId, hitSeq: h.seq, lines });
  };

  const loadOlder = async () => {
    const c = ctx();
    if (!c) return;
    const first = c.lines[0]?.seq ?? null;
    const older = await pageScrollback(c.wsId, c.session, first, 60);
    if (older.length > 0) setCtx({ ...c, lines: [...older, ...c.lines] });
  };

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
        <span class="panel-title">{t("서버 로그")}</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {metrics().total} LINES
        </span>
        <select
          class="logsp-level mono"
          value={level()}
          onChange={(e) => setLevel(e.currentTarget.value as (typeof LEVELS)[number])}
        >
          <For each={LEVELS}>{(l) => <option value={l}>{t(l)}</option>}</For>
        </select>
        <button class="btn ghost" style={{ padding: "2px 7px" }} title={t("표시 중인 로그를 파일로 저장")} onClick={exportLogs}>
          ⤓ {t("저장")}
        </button>
      </div>

      <input
        class="panel-search mono"
        placeholder={t(isTauri() ? "필터 입력 · Enter = 디스크 전문 검색(FTS)" : "분류 · 세션 · 내용 검색")}
        value={query()}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          if (!e.currentTarget.value.trim()) {
            setHits(null);
            setCtx(null);
          }
        }}
        onKeyDown={(e) => e.key === "Enter" && void runDiskSearch()}
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

      <Show
        when={hits() === null}
        fallback={
          <div class="logsp-list">
            <div class="panel-head-row" style={{ padding: "4px 0" }}>
              <span class="eyebrow">{tf("디스크 검색 · {n}건 (전체 스크롤백 FTS)", { n: hits()!.length })}</span>
              <button class="btn ghost" style={{ "margin-left": "auto", padding: "2px 7px" }} onClick={() => { setHits(null); setCtx(null); }}>
                ✕ {t("결과 닫기")}
              </button>
            </div>
            <Show when={!searching()} fallback={<div class="muted" style={{ padding: "8px" }}>{t("검색 중…")}</div>}>
              <For each={hits()!}>
                {(h) => (
                  <div class="logsp-row" style={{ cursor: "pointer" }} onClick={() => void openContext(h)}>
                    <span class="mono muted logsp-time">{hhmmss(h.ts)}</span>
                    <span class="badge logsp-type">{h.sessionId.split("@")[0]}</span>
                    <span class="logsp-msg mono" style={{ "font-size": "10.5px" }}>{h.text}</span>
                  </div>
                )}
              </For>
              <Show when={hits()!.length === 0}>
                <div class="muted" style={{ padding: "12px", "font-size": "11px" }}>
                  {t("디스크 스크롤백에서 찾지 못했습니다")}
                </div>
              </Show>
            </Show>
            <Show when={ctx()}>
              {(c) => (
                <div class="card inset" style={{ "margin-top": "6px", padding: "6px 8px" }}>
                  <div class="panel-head-row" style={{ padding: "0 0 4px" }}>
                    <span class="eyebrow">
                      {c().session} · {tf("문맥 {n}줄 (디스크 페이징)", { n: c().lines.length })}
                    </span>
                    <button class="btn ghost" style={{ "margin-left": "auto", padding: "1px 6px" }} onClick={() => setCtx(null)}>
                      ✕
                    </button>
                  </div>
                  <button class="btn ghost" style={{ width: "100%", padding: "2px" }} onClick={() => void loadOlder()}>
                    ▲ {t("더 이전 60줄")}
                  </button>
                  <div class="mono" style={{ "max-height": "180px", overflow: "auto", "font-size": "10.5px", "line-height": "1.5" }}>
                    <For each={c().lines}>
                      {(l) => (
                        <div style={l.seq === c().hitSeq ? { background: "rgba(110,158,255,.18)" } : undefined}>
                          {l.text}
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </Show>
          </div>
        }
      >
        <div class="logsp-list">
          <For each={logs()}>
            {(l) => (
              <div class="logsp-row" classList={{ error: l.level === "error", warn: l.level === "warn" }}>
                <span class="mono muted logsp-time">{l.time}</span>
                <span class="badge logsp-type">{t(l.type)}</span>
                <span class="logsp-msg">{l.message}</span>
                <Show when={l.expandable}>
                  <span class="mono muted">›</span>
                </Show>
              </div>
            )}
          </For>
          <Show when={logs().length === 0}>
            <div class="muted" style={{ padding: "12px", "font-size": "11px" }}>
              {t("조건에 맞는 로그가 없습니다")}
            </div>
          </Show>
        </div>
      </Show>

      <div class="card inset logsp-footer">
        <span class="logsp-live">
          <span class="logsp-live-dot" />
          {t(isTauri() ? "event 테이블 스트림 연결됨" : "실시간 스트림 (목)")}
        </span>
        <span class="mono muted">{t(metrics().rate)}</span>
      </div>

      <Show when={isTauri()}>
        <div class="card inset logsp-session-logs">
          <div>
            <div style={{ "font-weight": 700, "font-size": "11px" }}>{t("세션 로그 (PTY 원문)")}</div>
            <div class="mono muted" style={{ "font-size": "10px" }}>
              {t("~/.eqmux/logs/<세션>.log · 실시간 append")}
            </div>
          </div>
          <button class="btn" onClick={openLogDir}>
            {t("폴더 열기")}
          </button>
        </div>
      </Show>
    </div>
  );
}
