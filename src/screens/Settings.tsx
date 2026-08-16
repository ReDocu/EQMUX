// 설정 (o2bCs2) — 표시된 기본값이 곧 정책 선언이다 (result_prd §3.15).
// 동작에 연결된 항목(시작 화면·알림 라우팅·사운드·재생 줄 수)은 settings.json에 즉시 저장되고,
// 고정 정책 항목은 클릭해도 바뀌지 않는 선언으로 남는다. Tauri 밖에서는 저장 없이 순환만 한다.
import { For, Show } from "solid-js";
import { DEFAULT_SETTINGS, settings, SLOT_OPTIONS, updateSettings } from "../backend/settings";
import type { AppSettings } from "../backend/settings";
import { isTauri, openExternal } from "../backend/pty";
import { t } from "../i18n";
import { Eyebrow } from "../components/ui";

type Wired = {
  k: string;
  labels: string[];
  current: () => number;
  apply: (idx: number) => void;
};
type Fixed = { k: string; label: string };
type Link = { k: string; label: string; url: () => string };
type Section = { title: string; desc: string; wired?: Wired[]; fixed?: Fixed[]; links?: Link[] };

function pick<T>(options: T[], value: T): number {
  const i = options.indexOf(value);
  return i < 0 ? 0 : i;
}

const START_VIEWS: AppSettings["startView"][] = ["control", "last"];
const NOTI: AppSettings["notifications"][] = ["waiting-dead", "waiting", "off"];
const REPLAY = [500, 1000, 2000];
const SLOTS = [...SLOT_OPTIONS]; // 4 · 6 · 8
const THEMES: AppSettings["theme"][] = ["dark", "light", "system"];
const MEM_BANNER = [0, 2048, 4096, 8192]; // FR-G-67 — 0 = 꺼짐 (기본)
const LANGS: AppSettings["language"][] = ["ko", "en"];

// 문의 폼 (README·릴리스 노트와 같은 주소) — UI 언어에 맞는 쪽을 연다
const FEEDBACK_FORM: Record<AppSettings["language"], string> = {
  ko: "https://docs.google.com/forms/d/e/1FAIpQLScn7JEfOpWv1W7FPJwDIFluvRkK_y6_dpOPCe6E-opf-YHHKw/viewform",
  en: "https://docs.google.com/forms/d/e/1FAIpQLSdGjEUhbjNoMhi3BiYAeTRnTOPoxqKNKsN4_m0_6Ta_6KcMNw/viewform",
};

// 문자열은 한국어 원문 그대로 둔다 — 렌더 지점의 t()가 언어를 푼다 (i18n.ts 규칙)
const SECTIONS: Section[] = [
  {
    title: "언어",
    desc: "UI 언어 — 한국어(기본)·영어. 코드·데이터의 한국어 원문은 그대로 두고 화면 표시만 바꿉니다.",
    wired: [
      {
        k: "표시 언어",
        labels: ["한국어 (기본)", "English"],
        current: () => pick(LANGS, settings().language),
        apply: (i) => updateSettings({ language: LANGS[i] }),
      },
    ],
    fixed: [{ k: "이벤트 로그·생성 파일", label: "원문 유지 (데이터 불변)" }],
  },
  {
    title: "화면",
    desc: "테마는 디자인 토큰만 바꿉니다 (M29). 터미널 페인은 TUI·ANSI 가독성을 위해 항상 다크입니다.",
    wired: [
      {
        k: "테마",
        labels: ["다크 (기본)", "라이트", "시스템 따름"],
        current: () => pick(THEMES, settings().theme),
        apply: (i) => updateSettings({ theme: THEMES[i] }),
      },
    ],
    fixed: [{ k: "터미널 페인", label: "항상 다크 (ANSI 팔레트 전제)" }],
  },
  {
    title: "세션 슬롯",
    desc: "워크스페이스당 세션(터미널 페인) 수의 상한입니다. 줄여도 이미 열린 세션은 닫지 않습니다.",
    wired: [
      {
        k: "슬롯 수",
        labels: ["4개 (기본)", "6개", "8개"],
        current: () => pick(SLOTS, settings().maxSlots),
        apply: (i) => updateSettings({ maxSlots: SLOTS[i] }),
      },
    ],
    fixed: [{ k: "복원 허용", label: "team.json 최대 8슬롯 — 설정과 무관" }],
  },
  {
    title: "시작과 복원",
    desc: "자동 실행 없이 화면 상태만 복원합니다 (FR-G-02 · FR-C-30).",
    wired: [
      {
        k: "시작 화면",
        labels: ["관제 대시보드", "마지막 워크스페이스"],
        current: () => pick(START_VIEWS, settings().startView),
        apply: (i) => updateSettings({ startView: START_VIEWS[i] }),
      },
      {
        k: "스크롤백 재생",
        labels: ["500 lines", "1,000 lines", "2,000 lines"],
        current: () => pick(REPLAY, settings().scrollbackReplay),
        apply: (i) => updateSettings({ scrollbackReplay: REPLAY[i] }),
      },
    ],
    fixed: [{ k: "열린 탭·배치 복원", label: "항상 (layout.json)" }],
  },
  {
    title: "알림",
    desc: "사람의 행동이 필요한 상태만 알립니다 (G3). 꺼도 인앱 미확인은 유지됩니다 (FR-G-37).",
    wired: [
      {
        k: "OS 알림",
        labels: ["waiting · dead", "waiting만", "꺼짐"],
        current: () => pick(NOTI, settings().notifications),
        apply: (i) => updateSettings({ notifications: NOTI[i] }),
      },
      {
        k: "waiting 사운드",
        labels: ["꺼짐", "켜짐 (예약 — OS 알림 기본음)"],
        current: () => (settings().waitingSound ? 1 : 0),
        apply: (i) => updateSettings({ waitingSound: i === 1 }),
      },
      {
        k: "메모리 배너",
        labels: ["꺼짐 (기본)", "세션 2 GB↑", "세션 4 GB↑", "세션 8 GB↑"],
        current: () => pick(MEM_BANNER, settings().memBannerMb),
        apply: (i) => updateSettings({ memBannerMb: MEM_BANNER[i] }),
      },
    ],
    fixed: [{ k: "창 포커스 시", label: "억제 (FR-G-31)" }],
  },
  {
    title: "저장소와 보존",
    desc: "워크스페이스별 SQLite WAL — 보존 상한은 고정 정책 (C4). SGR 저장은 끌 수 있습니다 (FR-C-15).",
    wired: [
      {
        k: "SGR 색 저장",
        labels: ["켜짐 (기본)", "꺼짐 — 용량 절감"],
        current: () => (settings().sgrStore ? 0 : 1),
        apply: (i) => updateSettings({ sgrStore: i === 0 }),
      },
    ],
    fixed: [
      { k: "세션당 상한", label: "100,000 lines" },
      { k: "보존 기간", label: "30 days" },
      { k: "배치 커밋", label: "100ms / 200행" },
    ],
  },
  {
    title: "Claude Code 런타임",
    desc: "검증된 CLI와 관측 어댑터 — 고정 정책 (D2).",
    fixed: [
      { k: "상태 소스", label: "세션 레지스트리 watch + 2s 재스캔" },
      { k: "재개", label: "--resume · 같은 UUID · 같은 cwd" },
      { k: "훅", label: "2차 소스 (PRD I 대기)" },
    ],
  },
  {
    title: "권한 정책",
    desc: "bypassPermissions는 앱에서 제공하지 않습니다.",
    fixed: [
      { k: "권한 원천", label: "역할 파일 frontmatter (D5)" },
      { k: "권한 변경", label: "재개 기반 재시작 (E11′)" },
    ],
  },
  {
    title: "사용자 파일 불가침",
    desc: "개인 Claude 설정은 수정하지 않습니다 (D3 · FR-E-70).",
    fixed: [
      { k: "~/.claude/settings", label: "수정 안 함" },
      { k: "repo .claude / CLAUDE.md", label: "수정 안 함 (읽기만)" },
    ],
  },
  {
    title: "문의 · 피드백",
    desc: "버그와 개선 제안을 받고 있습니다. 아직 1.0 이전이라 어떤 이야기든 도움이 됩니다.",
    links: [
      {
        k: "문의 폼",
        label: "브라우저에서 열기",
        url: () => FEEDBACK_FORM[settings().language],
      },
    ],
  },
];

export function Settings() {
  const isDefault = () => JSON.stringify(settings()) === JSON.stringify(DEFAULT_SETTINGS);

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>{t("설정")}</h1>
          <div class="sub">
            {t(isTauri() ? "settings.json 즉시 저장" : "브라우저 dev — 저장 없음")} · {t("값을 클릭하면 다음 옵션으로")}
          </div>
        </div>
        <button class="btn" disabled={isDefault()} onClick={() => updateSettings(DEFAULT_SETTINGS)}>
          {t("기본값 복원")}
        </button>
      </div>
      <div class="screen-body settings-grid">
        <For each={SECTIONS}>
          {(sec) => (
            <div class="card" style={{ padding: "12px 14px" }}>
              <Eyebrow>{t(sec.title)}</Eyebrow>
              <div class="muted" style={{ "font-size": "11px", margin: "4px 0 8px" }}>
                {t(sec.desc)}
              </div>
              <Show when={sec.wired}>
                <For each={sec.wired}>
                  {(it) => (
                    <div class="kv">
                      <span class="k">{t(it.k)}</span>
                      <button
                        class="v mono setting-v"
                        classList={{ changed: it.current() !== 0 }}
                        onClick={() => it.apply((it.current() + 1) % it.labels.length)}
                        title={t("클릭하면 다음 옵션 — 즉시 저장")}
                      >
                        {t(it.labels[it.current()])}
                      </button>
                    </div>
                  )}
                </For>
              </Show>
              <Show when={sec.fixed}>
                <For each={sec.fixed}>
                  {(it) => (
                    <div class="kv">
                      <span class="k">{t(it.k)}</span>
                      <span class="v mono setting-v fixed" title={t("고정 정책 — 설정으로 바꾸지 않습니다")}>
                        {t(it.label)}
                      </span>
                    </div>
                  )}
                </For>
              </Show>
              <Show when={sec.links}>
                <For each={sec.links}>
                  {(it) => (
                    <div class="kv">
                      <span class="k">{t(it.k)}</span>
                      <button
                        class="v mono setting-v"
                        onClick={() => openExternal(it.url())}
                        title={t("기본 브라우저로 엽니다")}
                      >
                        {t(it.label)} ↗
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
