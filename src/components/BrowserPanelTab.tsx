// 브라우저 패널 (PRD H) — 세션이 띄운 로컬 서버의 미리보기. 관측 지향이라 대상은
// localhost로 제한한다 (임의 웹 브라우징 용도가 아니다 — 그것은 사용자의 브라우저 몫).
// 렌더는 iframe — CSP가 없고 로컬 dev 서버는 프레임 차단 헤더가 없어 그대로 붙는다.
// 포트 칩은 포트 패널과 같은 실측(netstat + Job Object 귀속)을 5초 주기로 공유한다.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { portsSnapshot } from "../backend/panels";
import type { PortRow } from "../backend/panels";
import { isTauri } from "../backend/pty";
import { t } from "../i18n";

const LOCAL_RE = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i;

export function BrowserPanelTab() {
  const [ports, setPorts] = createSignal<PortRow[]>([]);
  const [addr, setAddr] = createSignal("");
  const [url, setUrl] = createSignal<string | null>(null);
  const [nonce, setNonce] = createSignal(0); // 새로고침 = iframe 강제 재생성
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    if (!isTauri()) return;
    const load = () =>
      void portsSnapshot().then((rows) => {
        if (rows) setPorts(rows.filter((r) => r.session));
      });
    load();
    const timer = setInterval(load, 5000);
    onCleanup(() => clearInterval(timer));
  });

  const open = (target: string) => {
    const raw = target.trim();
    const full = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    if (!LOCAL_RE.test(full)) {
      setError(t("localhost · 127.0.0.1 대상만 미리봅니다 — 외부 웹은 사용자의 브라우저에서"));
      return;
    }
    setError(null);
    setAddr(full);
    setUrl(full);
    setNonce((n) => n + 1);
  };

  return (
    <div class="browserp">
      <div class="panel-head-row">
        <span class="panel-title">{t("브라우저")}</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {t("세션 포트 미리보기")}
        </span>
        <Show when={url()}>
          <button
            class="btn ghost"
            style={{ "margin-left": "auto", padding: "2px 7px" }}
            title={t("새로고침")}
            onClick={() => setNonce((n) => n + 1)}
          >
            ⟳
          </button>
        </Show>
      </div>

      <Show when={ports().length > 0}>
        <div style={{ display: "flex", gap: "4px", "flex-wrap": "wrap" }}>
          <For each={ports()}>
            {(p) => (
              <button
                class="badge blue"
                style={{ cursor: "pointer" }}
                title={`${p.process} · ${p.session}`}
                onClick={() => open(`http://127.0.0.1:${p.port}`)}
              >
                :{p.port} {p.session?.split("@")[0]}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="card inset browserp-url mono" style={{ display: "flex", gap: "6px" }}>
        <input
          style={{ flex: 1, "min-width": 0, background: "transparent", border: "none", color: "inherit" }}
          placeholder={t("127.0.0.1:5173 — Enter로 열기")}
          value={addr()}
          onInput={(e) => setAddr(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && open(addr())}
        />
      </div>
      <Show when={error()}>
        <div style={{ color: "var(--eq-red, #ef6b73)", "font-size": "11px" }}>{error()}</div>
      </Show>

      <Show
        when={url()}
        fallback={
          <div class="card inset browserp-view">
            <div class="muted" style={{ "text-align": "center" }}>
              <div style={{ "font-size": "22px", "margin-bottom": "8px" }}>◱</div>
              {t("세션 포트 미리보기")}
              <div class="mono" style={{ "font-size": "10px", "margin-top": "6px" }}>
                {t(
                  isTauri()
                    ? ports().length > 0
                      ? "위 포트 칩을 누르거나 주소를 입력하세요"
                      : "세션이 LISTENING 포트를 열면 칩이 나타납니다"
                    : "Tauri에서 실행하면 실측 포트가 연결됩니다",
                )}
              </div>
            </div>
          </div>
        }
      >
        {/* keyed Show — url·nonce가 바뀔 때 iframe을 재생성한다 (새로고침) */}
        <Show when={`${url()}#${nonce()}`} keyed>
          <iframe src={url()!} class="card inset browserp-frame" title={t("세션 포트 미리보기")} />
        </Show>
      </Show>
    </div>
  );
}
