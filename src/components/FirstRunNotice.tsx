// 첫 실행 고지 (0.6 §10 · §9-2 · §14) — 앱이 쓰는 곳 · 쓰지 않는 곳과 다른 도구 전역 지시 점검 결과.
// 고치는 것이 없으므로 [되돌리기]는 없다. 같은 내용을 설정 › 정보에서 다시 본다(WhereCard).
// 진단 정보 복사(§9-3)도 여기 둔다 — 설정 › 정보 카드와 README가 같은 자리를 가리킨다.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { notifyLocal } from "../backend/attention";
import { diagBundle, foreignSummary, foreignTools } from "../backend/diag";
import type { ForeignFinding } from "../backend/diag";
import { openLink } from "../backend/browser";
import { clipWriteText, revealPath } from "../backend/pty";
import { settings, updateSettings } from "../backend/settings";
import { t, tf } from "../i18n";
import { revealLabel } from "../labels";
import { IS_MAC } from "../platform";
import { pushLayer, setOverlay, setSettingsCat } from "../state";
import { notify } from "./ui";

// 절 앵커까지 (0.6 QA P81) — 1,250줄 문서의 맨 위로 열렸다. 영어 화면은 README.en.md의 같은 절로 보낸다
// (앵커는 각 문서의 '## 다른 도구와 같이 쓰기' · '## Using alongside other tools' 제목에서 나온다)
const howtoUrl = () =>
  settings().language === "en"
    ? "https://github.com/ReDocu/EQMUX/blob/main/README.en.md#using-alongside-other-tools"
    : "https://github.com/ReDocu/EQMUX/blob/main/docs/site/docs.md#다른-도구와-같이-쓰기";
const APP_DATA = IS_MAC ? "~/Library/Application Support/com.eqment.eqmux" : "%APPDATA%\\com.eqment.eqmux";

/** 점검 결과 — 앱 수명 동안 한 번 잰다(기동 때). 설정 › 정보의 [다시 점검]이 다시 잰다 */
const [findings, setFindings] = createSignal<ForeignFinding[] | undefined>(undefined);

async function check(): Promise<ForeignFinding[]> {
  const list = await foreignTools();
  setFindings(list);
  return list;
}

/** 기동 점검 (§14) — 찾으면 알림 센터에 한 건. 파일을 고치지 않는다. App이 1회 부른다 */
export function startForeignCheck(): void {
  void check().then((list) => {
    for (const g of foreignSummary(list))
      notifyLocal({
        session: `app:foreign:${g.tool}`,
        workspace: "",
        kind: "app",
        title: g.directive
          ? tf("{tool}의 전역 지시가 EQMUX 세션에도 실립니다", { tool: g.tool })
          : tf("{tool}의 훅 {n}개가 EQMUX 세션의 도구 호출마다 실행됩니다", { tool: g.tool, n: g.hooks }),
        // 구역과 훅이 함께 있으면 막을 수 없는 훅도 말한다 (B261) — '덮어 두었다'만 보면 다 막은 줄 안다
        body: !g.directive
          ? t("EQMUX가 막을 수 없습니다 · 누르면 끄는 방법")
          : g.hooks > 0
            ? tf("세션 안내문으로 덮어 두었습니다 · 훅 {n}개는 막을 수 없습니다 · 누르면 자세히", { n: g.hooks })
            : t("세션 안내문으로 덮어 두었습니다 · 누르면 자세히"),
        open: openWhere,
      });
  });
}

/** 설정 › 정보로 데려간다 — 알림 센터 항목이 누르면 오는 곳 */
function openWhere(): void {
  setSettingsCat("about");
  setOverlay("settings");
}

const kindText = (k: ForeignFinding["kind"], n: number) =>
  k === "block" ? t("자동 관리 구역") : k === "hook" ? tf("도구를 쓸 때마다 도는 훅 {n}개", { n }) : t("\"You are running inside …\" 문장");

/** 앱이 쓰는 곳 · 쓰지 않는 곳 (§9-2와 같은 문구) */
function WhereList() {
  return (
    <div class="frn-where">
      <div class="frn-h">{t("쓰는 곳")}</div>
      <div class="frn-row">
        <span class="mono">{APP_DATA}</span>
        <span class="muted">{t("설정 · 워크스페이스 목록 · 세션 기록 · 훅과 상태 줄 합성 설정(hook-settings.json)")}</span>
      </div>
      {/* 세션 터미널 출력 원문도 여기 쌓인다 (U127) — 비밀값이 평문으로 남을 수 있는 가장 큰 파일이다 */}
      <div class="frn-row">
        <span class="mono">~/.eqmux/logs</span>
        <span class="muted">{t("세션 터미널 출력 로그 · 진단 로그 — 토큰이 평문으로 남을 수 있습니다(설정 › 저장소에서 끔)")}</span>
      </div>
      <div class="frn-row">
        <span class="mono">{t("<저장소>/.eqmux/")}</span>
        <span class="muted">{t("팀 편성 · 역할 파일 · 임무 — 커밋하면 동료가 같은 팀으로 시작합니다. 개인용이면 .gitignore에 .eqmux/를 넣습니다(팀 공유가 꺼집니다)")}</span>
      </div>
      {/* 확장 탭의 쓰기 (U116 · 결정 X1) — 사람이 그 화면에서 누를 때만 */}
      <div class="frn-row">
        <span class="mono">~/.claude/skills · settings.json, {t("<저장소>/.claude/skills · settings.local.json")}</span>
        <span class="muted">{t("확장 탭에서 사람이 누를 때만 씁니다 — 플러그인 켜기 · 끄기, 스킬 만들기 · 고치기 · 지우기 · 복사")}</span>
      </div>
      <div class="frn-h">{t("쓰지 않는 곳")}</div>
      <div class="frn-row">
        <span class="mono">~/.claude · ~/.codex</span>
        <span class="muted">
          {t("엔진 설정은 스스로 고치지 않습니다(확장 탭에서 사람이 누른 변경만 위 목록대로 씁니다). 훅은 세션을 띄울 때 인자로만 싣습니다")}{" "}
          (<code class="mono" style={{ "white-space": "nowrap" }}>--settings</code>, Codex{" "}
          <code class="mono" style={{ "white-space": "nowrap" }}>-c</code>)
        </span>
      </div>
      <div class="frn-row">
        <span class="mono">{t("저장소의 .claude/ · .codex/ · CLAUDE.md")}</span>
        <span class="muted">{t("읽기만 합니다 — 확장 탭에서 사람이 누른 스킬 · 플러그인 변경은 예외입니다")}</span>
      </div>
      <div class="muted frn-net">{t("요청하지 않으면 다른 시스템으로 아무것도 보내지 않습니다. 진단 정보도 사람이 복사해 붙일 때만 나갑니다.")}</div>
    </div>
  );
}

/** 다른 도구 전역 지시 점검 결과 (§14) — 없으면 한 줄, 있으면 도구별로 파일과 종류 */
function ForeignList() {
  const reveal = async (file: string) => {
    if (!(await revealPath(file))) notify(t("파일을 열 수 없습니다"));
  };
  return (
    <div class="frn-foreign">
      <div class="frn-h">{t("다른 도구의 전역 지시")}</div>
      <Show when={findings()} fallback={<div class="muted">{t("점검 중…")}</div>}>
        {(list) => (
          <Show when={list().length > 0} fallback={<div class="muted">{t("찾지 못했습니다 — EQMUX 세션에 다른 도구의 지시가 실리지 않습니다")}</div>}>
            <For each={foreignSummary(list())}>
              {(g) => (
                <div class="frn-tool">
                  <div class="frn-tool-t">
                    {/* 덮을 수 있는 것은 구역 · 문장뿐이다 — 훅은 막을 수 없다고 말한다 (U128 · §14-2).
                        둘 다 있으면 두 문장을 다 보인다 (B261) */}
                    <Show when={g.directive}>
                      <div>{tf("{tool}의 전역 지시가 EQMUX 세션에도 실립니다 — 세션 안내문으로 덮어 두었습니다", { tool: g.tool })}</div>
                    </Show>
                    <Show when={g.hooks > 0}>
                      <div>{tf("{tool}의 훅 {n}개가 EQMUX 세션의 도구 호출마다 실행됩니다 — EQMUX가 막을 수 없습니다", { tool: g.tool, n: g.hooks })}</div>
                    </Show>
                  </div>
                  <For each={list().filter((f) => f.tool === g.tool)}>
                    {(f) => (
                      <div class="frn-row">
                        <button class="wizard-link mono" title={revealLabel()} onClick={() => void reveal(f.file)}>
                          {f.file}
                        </button>
                        <span class="muted">{kindText(f.kind, f.count)}</span>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
            <div class="muted frn-note">
              {t("EQMUX는 이 파일을 고치지 않습니다. 그 도구가 다시 써 넣기 때문입니다.")}{" "}
              <button class="wizard-link" onClick={() => openLink(howtoUrl(), true)}>
                {t("끄는 방법 →")}
              </button>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}

/** [진단 정보 복사] (§9-3) — 앱 버전 · OS · 엔진 CLI 버전 · 로그 꼬리. 가린 뒤의 글만 클립보드로 */
export function DiagCopyButton() {
  const [busy, setBusy] = createSignal(false);
  const copy = async () => {
    setBusy(true);
    try {
      // 클립보드 쓰기가 실패하면 성공 토스트를 띄우지 않는다 (B197)
      if (await clipWriteText(await diagBundle())) notify(t("진단 정보를 복사했습니다 — GitHub 이슈에 붙여 주세요"), "ok");
      else notify(t("진단 정보를 클립보드에 넣지 못했습니다 — 다시 눌러 주세요"));
    } catch (e) {
      notify(tf("진단 정보를 만들지 못했습니다 · {err}", { err: String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button class="btn" disabled={busy()} onClick={() => void copy()}>
      {t(busy() ? "모으는 중…" : "진단 정보 복사")}
    </button>
  );
}

/** 설정 › 정보 카드 본문 — 고지와 같은 내용 + [다시 점검] · [진단 정보 복사] */
export function WhereCard() {
  onMount(() => findings() === undefined && void check());
  return (
    <div class="frn-card">
      <WhereList />
      <ForeignList />
      <div class="frn-actions">
        <button class="btn" onClick={() => (setFindings(undefined), void check())}>
          {t("다시 점검")}
        </button>
        <DiagCopyButton />
      </div>
      <div class="muted frn-note">{t("진단 정보에서 경로의 사용자 이름과 토큰은 가립니다. 앱이 보내지 않습니다 — 복사해서 직접 붙입니다.")}</div>
    </div>
  );
}

/** 첫 실행 고지 — settings.firstRunSeen이 거짓일 때 한 번. [확인]이 저장한다 */
export function FirstRunNotice() {
  let box: HTMLDivElement | undefined;
  let ok: HTMLButtonElement | undefined;
  const close = () => updateSettings({ firstRunSeen: true });
  onMount(() => {
    onCleanup(pushLayer(close, () => box));
    ok?.focus();
  });
  return (
    <div class="overlay">
      <div ref={box} class="dialog frn" role="dialog" aria-modal="true" aria-label={t("EQMUX가 쓰는 곳 · 쓰지 않는 곳")}>
        <div class="eq-confirm-t">{t("EQMUX가 쓰는 곳 · 쓰지 않는 곳")}</div>
        <div class="muted frn-sub">{t("처음 한 번만 보입니다. 설정 › 정보에서 다시 볼 수 있습니다.")}</div>
        <WhereList />
        <ForeignList />
        <div class="eq-confirm-f">
          {/* 알림만 하는 창의 닫기 — 'Confirm'은 정책 동의로 읽혔다 (0.6 QA U147) */}
          <button ref={ok} class="btn primary" onClick={close}>
            {t("알겠습니다")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 지금 고지를 띄울까 — 설정 로드 뒤에만 의미가 있다(로드 전 기본값은 거짓) */
export const firstRunPending = (): boolean => !settings().firstRunSeen;
