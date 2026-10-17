// 실행 › 환경변수 — 워크스페이스 루트의 .env 계열을 읽기 전용으로 보인다 (backend/env.ts).
// 값은 비밀(API 키·토큰)이 많아 기본으로 가린다 — 화면 공유·녹화 중에 그대로 새지 않게.
// 파일 목록은 SidePanel이 읽는다(탭을 보일지 정하는 것도 같은 결과라서). 여기는 그리기만.
import { createSignal, For, Show } from "solid-js";
import type { EnvFile } from "../backend/env";
import { clipWriteText } from "../backend/pty";
import { t, tf } from "../i18n";
import { Icon } from "./icons";
import { notify } from "./ui";

export function EnvPanelTab(props: { files: EnvFile[]; onReload: () => void }) {
  const [reveal, setReveal] = createSignal(false);
  const [q, setQ] = createSignal("");
  const hit = (k: string) => k.toLowerCase().includes(q().trim().toLowerCase());
  const copy = (k: string, v: string) => {
    clipWriteText(v);
    notify(tf("{k} 값을 복사했습니다", { k }));
  };
  return (
    <div class="portsp">
      <div class="portsp-head">
        <span class="portsp-title">{t("환경변수 · .env 파일 (읽기 전용)")}</span>
        <button class="btn" onClick={() => setReveal(!reveal())} aria-pressed={reveal()}>
          <Icon name={reveal() ? "eye-off" : "eye"} size={12} />
          {t(reveal() ? "값 가리기" : "값 보기")}
        </button>
        <button class="btn" onClick={props.onReload} title={t("다시 읽기")} aria-label={t("다시 읽기")}>
          <Icon name="refresh-cw" size={12} />
        </button>
      </div>
      <input
        class="panel-search mono"
        placeholder={t("변수 이름 검색")}
        value={q()}
        onInput={(e) => setQ(e.currentTarget.value)}
      />
      <For each={props.files}>
        {(f) => (
          <div class="card inset env-file">
            <div class="eyebrow mono">
              {f.file} · {tf("변수 {n}개", { n: f.vars.length })}
            </div>
            <Show when={f.vars.length > 0} fallback={<div class="muted">{t("이 파일에 변수가 없습니다")}</div>}>
              <For each={f.vars.filter((v) => hit(v.key))}>
                {(v) => (
                  <div class="kv" title={t("클릭하면 값을 복사합니다")} onClick={() => copy(v.key, v.value)}>
                    <span class="k mono">{v.key}</span>
                    <span class="v mono">
                      {v.value === "" ? t("(빈 값)") : reveal() ? v.value : "••••••••"}
                    </span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
