// 설정 (o2bCs2) — 표시된 기본값이 곧 정책 선언이다 (result_prd §3.15).
// 값을 클릭하면 허용된 옵션 안에서 순환한다. 저장은 M0에서 목이다.
import { createSignal, For } from "solid-js";
import { Eyebrow } from "../components/ui";

type Item = { k: string; options: string[] };
type Section = { title: string; desc: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: "시작과 복원",
    desc: "자동 실행 없이 화면 상태만 복원합니다.",
    items: [
      { k: "시작 화면", options: ["관제 대시보드", "마지막 워크스페이스"] },
      { k: "마지막 탭 복원", options: ["꺼짐", "켜짐"] },
      { k: "스크롤백 재생", options: ["500 lines", "1,000 lines", "2,000 lines"] },
    ],
  },
  {
    title: "알림",
    desc: "사람의 행동이 필요한 상태만 알립니다.",
    items: [
      { k: "OS 알림", options: ["waiting · dead", "waiting만", "꺼짐"] },
      { k: "창 포커스 시", options: ["억제", "표시"] },
      { k: "waiting 사운드", options: ["꺼짐", "켜짐"] },
    ],
  },
  {
    title: "저장소와 보존",
    desc: "워크스페이스별 SQLite WAL.",
    items: [
      { k: "세션당 상한", options: ["100,000 lines", "50,000 lines", "200,000 lines"] },
      { k: "워크스페이스", options: ["500 MB", "1 GB"] },
      { k: "전역 / 기간", options: ["2 GB · 30 days", "4 GB · 60 days"] },
    ],
  },
  {
    title: "Claude Code 런타임",
    desc: "검증된 CLI와 관측 어댑터 설정.",
    items: [
      { k: "CLI 버전", options: ["2.1.226 verified"] },
      { k: "상태 소스", options: ["registry + hook", "hook only"] },
      { k: "watch 폴백", options: ["2s polling", "5s polling"] },
    ],
  },
  {
    title: "권한 정책",
    desc: "bypassPermissions는 앱에서 제공하지 않습니다.",
    items: [
      { k: "기본 구현", options: ["acceptEdits", "manual"] },
      { k: "리뷰·검증", options: ["manual"] },
      { k: "권한 변경", options: ["재개 기반 재시작"] },
    ],
  },
  {
    title: "사용자 파일 불가침",
    desc: "개인 Claude 설정은 수정하거나 읽지 않습니다.",
    items: [
      { k: "~/.claude/settings", options: ["수정 안 함"] },
      { k: "repo .claude", options: ["수정 안 함"] },
      { k: "Hook settings", options: ["세션별 추가"] },
    ],
  },
];

export function Settings() {
  const [values, setValues] = createSignal<Record<string, number>>({});
  const [saved, setSaved] = createSignal(false);
  const idx = (k: string) => values()[k] ?? 0;
  const cycle = (it: Item) => {
    if (it.options.length < 2) return;
    setValues({ ...values(), [it.k]: (idx(it.k) + 1) % it.options.length });
    setSaved(false);
  };

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>설정</h1>
          <div class="sub">시작 · 알림 · 런타임 · 저장소 · 보안 — 값을 클릭하면 변경됩니다</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            class="btn"
            onClick={() => {
              setValues({});
              setSaved(false);
            }}
          >
            기본값 복원
          </button>
          <button class="btn primary" onClick={() => setSaved(true)}>
            {saved() ? "저장됨 ✓" : "설정 저장"}
          </button>
        </div>
      </div>
      <div class="screen-body settings-grid">
        <For each={SECTIONS}>
          {(sec) => (
            <div class="card" style={{ padding: "12px 14px" }}>
              <Eyebrow>{sec.title}</Eyebrow>
              <div class="muted" style={{ "font-size": "11px", margin: "4px 0 8px" }}>
                {sec.desc}
              </div>
              <For each={sec.items}>
                {(it) => (
                  <div class="kv">
                    <span class="k">{it.k}</span>
                    <button
                      class="v mono setting-v"
                      classList={{ fixed: it.options.length < 2, changed: idx(it.k) !== 0 }}
                      onClick={() => cycle(it)}
                      title={it.options.length > 1 ? "클릭하면 다음 옵션" : "고정 정책"}
                    >
                      {it.options[idx(it.k)]}
                    </button>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
