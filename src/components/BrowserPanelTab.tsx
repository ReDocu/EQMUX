// 브라우저 패널 (PRD H · M17 확장) — 세션 포트 미리보기 + 실브라우저.
// Tauri에서는 패널 자리 위에 네이티브 자식 웹뷰(browser.rs)를 얹는다 — iframe과 달리
// X-Frame-Options·frame-ancestors에 안 막혀 임의 http·https 페이지가 열린다.
// 자식 웹뷰는 항상 메인 웹뷰 위에 그려지므로 탭 이탈·다이얼로그(.overlay)·전체 화면
// 팝업(.explorer-fullscreen) 동안은 숨긴다. 비Tauri(목)는 기존 localhost iframe 폴백.
// 포트 칩은 공용 감시기(backend/ports, M31)의 실측을 포트 패널과 그대로 나눠 쓴다 —
// 여기서 따로 netstat를 돌리지 않으므로 두 패널의 목록이 어긋날 일이 없다.
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  browserBounds,
  browserClose,
  browserNav,
  browserOpen,
  browserVisible,
  onBrowserNav,
  rectBounds,
} from "../backend/browser";
import { holdFastPoll, portUrl, sessionPorts } from "../backend/ports";
import { isTauri } from "../backend/pty";
import { browserRequest, panelSide, setBrowserRequest } from "../state";
import { t } from "../i18n";

const LOCAL_RE = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i;

// 웹뷰는 컴포넌트보다 오래 산다 — 다른 탭에 다녀와도 페이지·주소가 유지되게 모듈 스코프
const [addr, setAddr] = createSignal("");
const [active, setActive] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);
// 전체 화면 전환은 패널 인스턴스 교대(언마운트+재마운트) — 최종 0일 때만 웹뷰를 숨긴다
let mountCount = 0;

export function BrowserPanelTab() {
  // 포트 칩 — 포트 패널과 같은 실측을 공용 감시기(M31)에서 읽는다. 예전처럼 여기서 또
  // netstat를 돌리면 같은 스냅숏을 두 번 뜨는 셈이고, 두 패널의 값이 어긋나 보인다
  const ports = sessionPorts;
  // 목 폴백 (비Tauri) — localhost iframe. nonce 증가 = iframe 강제 재생성(새로고침)
  const [mockUrl, setMockUrl] = createSignal<string | null>(null);
  const [nonce, setNonce] = createSignal(0);
  let viewEl: HTMLDivElement | undefined;

  onMount(() => onCleanup(holdFastPoll()));

  const syncBounds = () => {
    if (viewEl && active()) void browserBounds(rectBounds(viewEl));
  };
  // 레이아웃 확정 뒤에 좌표를 읽는다 — 마운트·패널 이동 직후의 rect는 아직 옛값이다.
  // 핸들을 들고 있다가 언마운트 때 취소한다 — 떨어진 노드의 rect(0×0)가 웹뷰로 가면 깜빡인다
  let boundsRaf = 0;
  const syncSoon = () => {
    cancelAnimationFrame(boundsRaf);
    boundsRaf = requestAnimationFrame(() => {
      boundsRaf = 0;
      syncBounds();
    });
  };

  const open = (target: string) => {
    const raw = target.trim();
    if (!raw) return;
    const full = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    setError(null);
    if (!isTauri()) {
      if (!LOCAL_RE.test(full)) {
        setError(t("목 모드는 localhost 미리보기만 됩니다 — 앱에서 실행하세요"));
        return;
      }
      setAddr(full);
      setMockUrl(full);
      setNonce((n) => n + 1);
      return;
    }
    if (!viewEl) return;
    browserOpen(full, rectBounds(viewEl))
      .then(() => {
        setAddr(full);
        setActive(true);
      })
      .catch((e) => setError(String(e)));
  };

  const close = () => {
    setMockUrl(null);
    setError(null);
    if (isTauri()) {
      void browserClose();
      setActive(false);
    }
  };

  const reload = () => (isTauri() ? void browserNav("reload") : setNonce((n) => n + 1));
  const showing = () => (isTauri() ? active() : mockUrl() !== null);

  // 마운트 수명 — 재마운트(탭 복귀·전체 화면 전환) 시 웹뷰를 다시 보이고 재배치한다
  onMount(() => {
    mountCount += 1;
    // 증감 짝은 isTauri 가드 앞에서 맺는다 — 목 모드에서도 카운터가 새지 않게
    onCleanup(() => {
      mountCount -= 1;
    });
    if (!isTauri()) return;
    if (active()) {
      void browserVisible(true);
      syncSoon();
    }
    const unNav = onBrowserNav(setAddr);
    const ro = new ResizeObserver(() => syncBounds());
    if (viewEl) ro.observe(viewEl);
    const onResize = () => syncSoon();
    window.addEventListener("resize", onResize);
    onCleanup(() => {
      unNav();
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(boundsRaf);
      // 교대 마운트가 끝난 다음 틱에 판정 — 정말 패널을 떠났을 때만 숨긴다
      setTimeout(() => {
        if (mountCount === 0) void browserVisible(false);
      }, 0);
    });
  });

  // 패널 좌/우 전환 — 크기가 같아 ResizeObserver가 안 울린다. 위치를 다시 보낸다
  createEffect(() => {
    panelSide();
    syncSoon();
  });

  // 포트 패널의 "열기" 요청 (M31) — 그 클릭이 이 패널을 방금 마운트시켰을 수 있어서,
  // 레이아웃이 확정된 다음 프레임에 연다 (마운트 직후 rect는 0×0이고 웹뷰가 그 크기로 뜬다).
  // 요청은 읽는 즉시 비운다 — 남겨 두면 다음 마운트 때 옛 주소가 한 번 더 열린다.
  // 대기 프레임은 언마운트 때 취소한다 — 떨어진 노드의 rect로 웹뷰를 띄우지 않기 위해서다
  let openRaf = 0;
  onCleanup(() => cancelAnimationFrame(openRaf));
  createEffect(() => {
    const req = browserRequest();
    if (!req) return;
    setBrowserRequest(undefined);
    cancelAnimationFrame(openRaf);
    openRaf = requestAnimationFrame(() => {
      openRaf = 0;
      open(req.url);
    });
  });

  // 다이얼로그·전체 화면 팝업 감시 — 자식 웹뷰가 이들을 가리므로 떠 있는 동안 숨긴다.
  // 터미널 출력 등 DOM 변경 폭주는 rAF 한 번으로 묶어 흡수한다
  onMount(() => {
    if (!isTauri()) return;
    let covered = false;
    let raf = 0;
    const check = () => {
      raf = 0;
      const now = document.querySelector(".overlay, .explorer-fullscreen") !== null;
      if (now === covered) return;
      covered = now;
      if (!active()) return;
      void browserVisible(!now);
      if (!now) syncSoon();
    };
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(check);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    check();
    onCleanup(() => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    });
  });

  return (
    <div class="browserp">
      <div class="panel-head-row">
        <span class="panel-title">{t("브라우저")}</span>
        <span class="mono muted" style={{ "font-size": "10px" }}>
          {t("세션 포트 · 웹 미리보기")}
        </span>
      </div>

      <Show when={ports().length > 0}>
        <div style={{ display: "flex", gap: "4px", "flex-wrap": "wrap" }}>
          <For each={ports()}>
            {(p) => (
              <button
                class="badge blue"
                style={{ cursor: "pointer" }}
                title={`${p.process} · ${p.session} · ${p.host}`}
                onClick={() => open(portUrl(p))}
              >
                :{p.port} {p.session?.split("@")[0]}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="card inset browserp-url mono">
        <Show when={showing()}>
          <Show when={isTauri()}>
            <button class="browserp-navbtn" title={t("뒤로")} onClick={() => void browserNav("back")}>
              ‹
            </button>
            <button class="browserp-navbtn" title={t("앞으로")} onClick={() => void browserNav("forward")}>
              ›
            </button>
          </Show>
          <button class="browserp-navbtn" title={t("새로고침")} onClick={reload}>
            ⟳
          </button>
        </Show>
        <input
          style={{ flex: 1, "min-width": 0, background: "transparent", border: "none", color: "inherit" }}
          placeholder={t("주소 입력 — Enter로 열기 (127.0.0.1:5173 · https://…)")}
          value={addr()}
          onInput={(e) => setAddr(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && open(addr())}
        />
        <Show when={showing()}>
          <button class="browserp-navbtn" title={t("브라우저 닫기")} onClick={close}>
            ✕
          </button>
        </Show>
      </div>
      <Show when={error()}>
        <div style={{ color: "var(--eq-red, #ef6b73)", "font-size": "11px" }}>{error()}</div>
      </Show>

      <div class="card inset browserp-view" ref={viewEl}>
        <Show
          when={showing()}
          fallback={
            <div class="muted" style={{ "text-align": "center" }}>
              <div style={{ "font-size": "22px", "margin-bottom": "8px" }}>◱</div>
              {t("세션 포트 · 웹 미리보기")}
              <div class="mono" style={{ "font-size": "10px", "margin-top": "6px" }}>
                {t(
                  ports().length > 0
                    ? "위 포트 칩을 누르거나 주소를 입력하세요"
                    : isTauri()
                      ? "세션이 LISTENING 포트를 열면 칩이 나타납니다"
                      : "Tauri에서 실행하면 실측 포트가 연결됩니다",
                )}
              </div>
            </div>
          }
        >
          <Show when={!isTauri() && mockUrl()}>
            {/* keyed — url·nonce가 바뀔 때 iframe을 재생성한다 (새로고침) */}
            <Show when={`${mockUrl()}#${nonce()}`} keyed>
              <iframe src={mockUrl()!} class="browserp-frame" title={t("세션 포트 · 웹 미리보기")} />
            </Show>
          </Show>
          <Show when={isTauri()}>
            {/* 이 자리는 네이티브 웹뷰가 덮는다 — 다이얼로그로 잠시 숨은 동안 주소만 남긴다 */}
            <span class="mono muted" style={{ "font-size": "10px" }}>
              {addr()}
            </span>
          </Show>
        </Show>
      </div>
    </div>
  );
}
