// 설정 (o2bCs2) — 표시된 기본값이 곧 정책 선언이다 (result_prd §3.15).
// 동작에 연결된 항목(시작 화면·알림 라우팅·사운드·재생 줄 수)은 settings.json에 즉시 저장되고,
// 고정 정책 항목은 클릭해도 바뀌지 않는 선언으로 남는다. Tauri 밖에서는 저장 없이 화면만 바뀐다.
// 0.5 — 클릭마다 다음 값으로 넘어가던 버튼을 없앴다: 선택지 3개 이하는 세그먼트, 4개 이상은 드롭다운.
// 0.5 시안(mT3kL·fvlW8) — 카테고리 탭 줄 + 카드. 행은 "이름·설명 | 컨트롤" 한 줄이다.
import { createSignal, For, Show } from "solid-js";
import {
  BUDGET_OPTIONS,
  DEFAULT_SETTINGS,
  PALETTES,
  settings,
  settingsSaveError,
  SLOT_OPTIONS,
  STATUSLINE_MODES,
  updateSettings,
} from "../backend/settings";
import type { AppSettings } from "../backend/settings";
import { agentClis, agentClisReady, refreshAgentClis } from "../backend/agentprobe";
import { isTauri } from "../backend/pty";
import { openLink } from "../backend/browser";
import { defaultShell, setDefaultShell, setSettingsCat, settingsCat, SHELLS } from "../state";
import { t, tf } from "../i18n";
import { ConfirmDialog, Segmented } from "../components/ui";
import { Icon } from "../components/icons";
import { WhereCard } from "../components/FirstRunNotice";
import { IS_MAC } from "../platform";

type Wired = {
  k: string;
  d?: string; // 행 설명 (시안의 둘째 줄)
  labels: string[];
  /** s를 주면 그 설정에서 고를 칸 — [기본값 복원] 확인창이 '지금 → 기본값'을 셈한다 (B203) */
  current: (s?: AppSettings) => number;
  apply: (idx: number) => void;
};
/** 고정 정책·사실 — 바뀌지 않는 값을 칩으로 보인다. tone은 시안의 칩 색 (green = 안전한 쪽으로 고정) */
type Fixed = { k: string; d?: string; label: string; tone?: "green" | "blue" };
type Link = { k: string; label: string; url: () => string };
type Cat = "general" | "runtime" | "notify" | "storage" | "security" | "keys" | "about";
type Section = {
  cat: Cat;
  title: string;
  sub?: string; // 카드 제목 아래 한 줄 (단축키·정보처럼 행 설명이 없는 카드)
  wired?: Wired[];
  fixed?: Fixed[];
  info?: Fixed[];
  links?: Link[];
  keys?: boolean; // 단축키 표 — 키캡 | 설명
};

// 카테고리 탭 (시안 mT3kL·fvlW8) — 카드를 한 화면에 다 펼치지 않고 묶음 하나씩 보인다
const CATS: { key: Cat; label: string }[] = [
  { key: "general", label: "일반" },
  { key: "runtime", label: "에이전트 런타임" },
  { key: "notify", label: "알림" },
  { key: "storage", label: "저장소" },
  { key: "security", label: "보안" },
  { key: "keys", label: "단축키" },
  { key: "about", label: "정보" },
];

function pick<T>(options: T[], value: T): number {
  const i = options.indexOf(value);
  return i < 0 ? 0 : i;
}

const START_VIEWS: AppSettings["startView"][] = ["control", "last"];
const NOTI: AppSettings["notifications"][] = ["waiting-dead", "waiting", "off"];
const DONE_NOTI: AppSettings["doneNotifications"][] = ["report", "all", "off"];
const MANUAL_DELIVERY: AppSettings["manualDelivery"][] = ["park", "auto"];
const WEB_OPEN: AppSettings["webOpen"][] = ["eqmux", "chrome"];
const CLOSE_ACTIONS: AppSettings["closeAction"][] = ["tray", "quit"];
const BUDGETS = [...BUDGET_OPTIONS]; // 0(끔) · 5 · 10 · 20 · 50
const REPLAY = [250, 500, 1000]; // 저장 상한(세션당 1,000줄)까지만 — 넘는 선택지는 1,000과 같았다 (B78)
const SLOTS = [...SLOT_OPTIONS]; // 4 · 6 · 8
const THEMES: AppSettings["theme"][] = ["dark", "light", "system"];
const PALS = [...PALETTES]; // 부드러움 · 고대비 · 중성 · 따뜻함
const RENDERERS: AppSettings["termRenderer"][] = ["webgl", "dom"];
const MEM_BANNER = [0, 2048, 4096, 8192]; // FR-G-67 — 0 = 꺼짐 (기본)
const LANGS: AppSettings["language"][] = ["ko", "en"];
const STATUSLINES = [...STATUSLINE_MODES]; // 모델·비용 · 모델만 · 숨김

// 문의 폼 (README·릴리스 노트와 같은 주소) — UI 언어에 맞는 쪽을 연다
const FEEDBACK_FORM: Record<AppSettings["language"], string> = {
  ko: "https://docs.google.com/forms/d/e/1FAIpQLScn7JEfOpWv1W7FPJwDIFluvRkK_y6_dpOPCe6E-opf-YHHKw/viewform",
  en: "https://docs.google.com/forms/d/e/1FAIpQLSdGjEUhbjNoMhi3BiYAeTRnTOPoxqKNKsN4_m0_6Ta_6KcMNw/viewform",
};

// 문자열은 한국어 원문 그대로 둔다 — 렌더 지점의 t()가 언어를 푼다 (i18n.ts 규칙)
const SECTIONS: Section[] = [
  {
    cat: "general",
    title: "일반",
    wired: [
      {
        // 기본 셸은 settings.json이 아니라 layout.json에 남는 값이다 (관제 화면 셸 선택과 같은 신호)
        k: "기본 셸",
        d: "새로 여는 터미널이 쓰는 셸 · 이미 열린 터미널은 그대로",
        // 첫 셸이 플랫폼 기본이다 — 다른 줄처럼 '(기본)'을 붙인다 (0.6 QA U149). getter라 렌더 때 번역된다
        get labels() {
          return SHELLS.map((s, i) => (i === 0 ? tf("{name} (기본)", { name: t(s.name) }) : t(s.name)));
        },
        current: () => pick(SHELLS, defaultShell()),
        apply: (i) => setDefaultShell(SHELLS[i]),
      },
      {
        k: "언어",
        d: "화면 표시만 바뀝니다 — 코드·데이터의 한국어 원문과 직함 값은 그대로",
        labels: ["한국어 (기본)", "English"],
        current: (s = settings()) => pick(LANGS, s.language),
        apply: (i) => updateSettings({ language: LANGS[i] }),
      },
      {
        k: "테마",
        d: "디자인 토큰만 바꿉니다 — 터미널 페인은 항상 다크",
        labels: ["다크 (기본)", "라이트", "시스템 따름"],
        current: (s = settings()) => pick(THEMES, s.theme),
        apply: (i) => updateSettings({ theme: THEMES[i] }),
      },
      {
        k: "색 팔레트",
        d: "배경 명도·색온도만 바뀝니다 — 강조색은 팔레트 공통",
        labels: ["부드러움 (기본)", "고대비", "중성", "따뜻함"],
        current: (s = settings()) => pick(PALS, s.palette),
        apply: (i) => updateSettings({ palette: PALS[i] }),
      },
      {
        k: "터미널 렌더러",
        d: "WebGL이 빠릅니다 · 잔상이 보일 때만 DOM으로 바꿉니다",
        labels: ["WebGL (기본)", "DOM"],
        current: (s = settings()) => pick(RENDERERS, s.termRenderer),
        apply: (i) => updateSettings({ termRenderer: RENDERERS[i] }),
      },
      {
        k: "시작 화면",
        d: "자동 실행 없이 화면 상태만 복원합니다",
        labels: ["관제 대시보드 (기본)", "마지막 워크스페이스"], // 줄마다 기본값 표시 (0.6 QA U149)
        current: (s = settings()) => pick(START_VIEWS, s.startView),
        apply: (i) => updateSettings({ startView: START_VIEWS[i] }),
      },
      {
        k: "웹 페이지 열기",
        d: "누른 링크와 에이전트의 eqmux browser open이 열리는 곳 · Chrome이면 에이전트가 페이지를 조작하지 못합니다",
        labels: ["EQMUX 브라우저 (기본)", "Chrome"],
        current: (s = settings()) => pick(WEB_OPEN, s.webOpen),
        apply: (i) => updateSettings({ webOpen: WEB_OPEN[i] }),
      },
      {
        // W1 트레이 (§1-1 · §10) — Rust window_close_to_tray가 읽는다. 돌고 있는 세션이 없으면 어느 쪽이든 종료한다
        k: "창을 닫으면",
        d: IS_MAC
          ? "Dock에 남겨도 세션이 계속 돕니다 · 끝내려면 ⌘Q 또는 메뉴 막대 아이콘의 [전부 종료]를 누릅니다"
          : "트레이로 숨기면 세션이 계속 돕니다 · 끝내려면 트레이 메뉴의 [전부 종료]를 누릅니다",
        labels: [IS_MAC ? "Dock에 남기기 (기본)" : "트레이로 숨기기 (기본)", "앱 종료"],
        current: (s = settings()) => pick(CLOSE_ACTIONS, s.closeAction),
        apply: (i) => updateSettings({ closeAction: CLOSE_ACTIONS[i] }),
      },
      {
        // 숨김 확인창의 [다시 묻지 않기]를 되돌리는 자리 (U180). 행이 있어야 [기본값 복원]이 이 값을
        // 화면의 값으로 세어 확인창에 보인다 — 행 없이 비교만 하면 '0개 값이 바뀝니다'였다 (B286)
        k: "숨기기 전에 묻기",
        d: "세션이 도는 채로 창을 닫으면 숨기기 전에 묻습니다 · 확인창에서 [다시 묻지 않기]를 고르면 꺼집니다",
        labels: ["묻기 (기본)", "묻지 않기"],
        current: (s = settings()) => (s.trayAskOff ? 1 : 0),
        apply: (i) => updateSettings({ trayAskOff: i === 1 }),
      },
      {
        k: "스크롤백 재생",
        d: "앱을 다시 켰을 때 페인에 다시 그리는 줄 수",
        labels: ["250줄", "500줄 (기본)", "1,000줄"],
        current: (s = settings()) => pick(REPLAY, s.scrollbackReplay),
        apply: (i) => updateSettings({ scrollbackReplay: REPLAY[i] }),
      },
      {
        k: "슬롯 수",
        d: "워크스페이스당 세션 수의 상한 · 줄여도 이미 열린 세션은 닫지 않습니다",
        labels: ["4개 (기본)", "6개", "8개"],
        current: (s = settings()) => pick(SLOTS, s.maxSlots),
        apply: (i) => updateSettings({ maxSlots: SLOTS[i] }),
      },
    ],
    fixed: [
      {
        k: "열린 탭·배치 복원",
        d: "workspaces.json · layout.json은 버전 업에도 남습니다",
        label: "항상 (layout.json)",
      },
      { k: "복원 허용", label: "team.json 최대 8슬롯 — 설정과 무관" },
      { k: "이벤트 로그·생성 파일", label: "원문 유지 (데이터 불변)" },
    ],
  },
  {
    cat: "runtime",
    title: "에이전트 런타임",
    wired: [
      {
        k: "세션 상태 줄",
        d: "검증된 CLI와 관측 방식은 고정입니다 · 상태 줄 표시만 고릅니다",
        labels: ["모델 · 비용 (기본)", "모델만 — 비용 숨김", "숨김"],
        current: (s = settings()) => pick(STATUSLINES, s.statusLine),
        apply: (i) => updateSettings({ statusLine: STATUSLINES[i] }),
      },
    ],
    fixed: [
      { k: "상태 소스", label: "세션 레지스트리 watch + 2s 재스캔" },
      { k: "재개", label: "--resume · 같은 UUID · 같은 cwd" },
      { k: "Codex", label: "훅 인라인 주입 · resume <id> · 샌드박스 = 권한" },
    ],
  },
  {
    cat: "notify",
    title: "알림",
    wired: [
      {
        // 0.6 §13-6 — 넘으면 알림 센터 + OS 알림 한 번. 세션은 멈추지 않는다
        k: "하루 비용 예산",
        d: "모든 세션의 비용 합계 · 넘으면 하루에 한 번 알립니다 · 세션은 멈추지 않습니다",
        labels: ["끔 (기본)", "$5", "$10", "$20", "$50"],
        current: (s = settings()) => pick(BUDGETS, s.dailyBudgetUsd),
        apply: (i) => updateSettings({ dailyBudgetUsd: BUDGETS[i] }),
      },
      {
        k: "OS 알림",
        d: "사람의 행동이 필요한 상태만 알립니다 · 꺼도 인앱 미확인은 유지됩니다",
        labels: ["응답 대기 · 종료", "응답 대기만", "꺼짐"],
        current: (s = settings()) => pick(NOTI, s.notifications),
        apply: (i) => updateSettings({ notifications: NOTI[i] }),
      },
      {
        k: "완료 OS 알림",
        d: "완료 보고는 에이전트가 끝났다고 밝힌 것입니다 · 턴 완료는 하루 수십 번이라 기본으로 끕니다 · 앱 안의 칩은 설정과 관계없이 뜹니다",
        labels: ["완료 보고만 (기본)", "턴 끝날 때마다", "끔"],
        current: (s = settings()) => pick(DONE_NOTI, s.doneNotifications),
        apply: (i) => updateSettings({ doneNotifications: DONE_NOTI[i] }),
      },
      {
        // 손으로 띄운 claude·codex — 앱이 띄우지 않아 승인 창을 직접 모른다. 자동이어도 idle일 때만 넣는다
        k: "손으로 띄운 에이전트 메시지",
        d: "기본 터미널에서 직접 실행한 claude·codex에 온 메시지 · 자동이어도 쉬는 중일 때만 넣고, 승인 대기·상태 모름이면 쌓아 벨에 남깁니다",
        labels: ["쌓아 두기 (기본)", "쉬면 자동으로 넣기"],
        current: (s = settings()) => pick(MANUAL_DELIVERY, s.manualDelivery),
        apply: (i) => updateSettings({ manualDelivery: MANUAL_DELIVERY[i] }),
      },
      {
        // 실제 동작 — waiting 진입 때 앱이 직접 소리를 낸다(창이 포커스면 내지 않는다). "예약"이 아니다
        k: "응답 대기 알림 소리",
        d: "승인·입력 대기가 되면 소리를 냅니다 · 창을 보고 있으면 내지 않습니다",
        labels: ["꺼짐 (기본)", "켜짐"],
        current: (s = settings()) => (s.waitingSound ? 1 : 0),
        apply: (i) => updateSettings({ waitingSound: i === 1 }),
      },
      {
        k: "메모리 배너",
        d: "세션 메모리가 넘으면 배너로 알립니다 — 소프트 경고만 냅니다",
        labels: ["꺼짐 (기본)", "세션 2 GB↑", "세션 4 GB↑", "세션 8 GB↑"],
        current: (s = settings()) => pick(MEM_BANNER, s.memBannerMb),
        apply: (i) => updateSettings({ memBannerMb: MEM_BANNER[i] }),
      },
    ],
    fixed: [
      { k: "같은 세션 반복 합치기", d: "60초 안의 반복을 합칩니다 · 완료 알림은 따로 셉니다", label: "60초" },
      { k: "훅 기반 상태 감지", d: "Stop · Notification 훅으로 쉬는 중 · 승인 대기를 판정합니다", label: "항상 켬" },
      { k: "창 포커스 시", d: "창을 보고 있으면 OS 알림을 내지 않습니다", label: "억제" },
    ],
  },
  {
    cat: "storage",
    title: "저장소",
    wired: [
      {
        k: "SGR 색 저장",
        d: "스크롤백에 색 시퀀스를 남깁니다 · 끄면 용량을 아낍니다",
        labels: ["켜짐 (기본)", "꺼짐"],
        current: (s = settings()) => (s.sgrStore ? 0 : 1),
        apply: (i) => updateSettings({ sgrStore: i === 0 }),
      },
      {
        // 0.6 E4 (W6) — 끄는 동작은 Rust(W1)가 이 키를 읽는다
        k: "스크롤백 · 세션 로그 저장",
        d: "스크롤백과 세션 로그 파일에는 토큰·비밀번호가 평문으로 남을 수 있습니다. 끄면 디스크에 쓰지 않습니다 — 꺼 둔 동안은 eqmux read · 로그 검색 · 과거 세션 검색에 새 출력이 남지 않고, 재시작 뒤 이전 출력도 다시 볼 수 없습니다.",
        labels: ["켜짐 (기본)", "꺼짐"],
        current: (s = settings()) => (s.scrollbackPersist ? 0 : 1),
        apply: (i) => updateSettings({ scrollbackPersist: i === 0 }),
      },
    ],
    fixed: [
      { k: "메시지 · 스크롤백 보존", label: "30일" },
      {
        // 0.6 W1 §1-2 — .bak으로 넘기던 것을 스키마 이전으로 바꿨다
        k: "버전 업 때 session.db",
        d: "기록을 새 버전 형식으로 옮겨 이어 씁니다 · 손상되면 옆으로 옮기고 새로 만듭니다",
        label: "이전",
        tone: "blue",
      },
      {
        k: "전체 보존 상한",
        d: "모든 워크스페이스 합계 · 넘으면 오래된 스크롤백부터 지웁니다 (메시지는 남습니다)",
        label: "2GB",
      },
      { k: "세션당 상한", label: "1,000줄" },
      { k: "배치 커밋", label: "100ms / 200행" },
      { k: "캐릭터 시트 상한", d: "SessionStart 훅이 싣는 시트 본문", label: "4,000자" },
      { k: "브라우저 결과 상한", d: "snapshot · get-text 한 번", label: "10,000자" },
    ],
  },
  {
    cat: "security",
    title: "보안",
    fixed: [
      { k: "권한 우회", d: "bypass를 쓰지 않습니다 — 승인은 사람이 합니다(터미널 페인 또는 관제 승인함)", label: "항상 끔" },
      {
        k: "외부 열기",
        d: "http/https만 엽니다 · 원격 주소의 토큰은 화면·툴팁·링크 어디에도 나오지 않습니다",
        label: "http · https",
        tone: "green",
      },
      {
        k: "메시지 경계 문장",
        d: "팀원·다른 워크스페이스의 메시지는 요청일 뿐입니다 — 승인·허가로 쓰지 않습니다",
        label: "역할 파일에 포함",
      },
      { k: "이벤트 방송 범위", d: "PTY 출력·메시지·상태 이벤트는 main 창에만", label: "main", tone: "green" },
      { k: "권한 원천", label: "역할 파일 frontmatter" },
      { k: "권한 변경", label: "재개 기반 재시작" },
      // 확장 탭은 사람이 누르면 쓴다 (0.6 QA U116 · 결정 X1) — 첫 실행 고지와 같은 말
      { k: "~/.claude/settings", d: "확장 탭에서 사람이 누른 플러그인 · 스킬 변경만 씁니다", label: "스스로 고치지 않음" },
      { k: "repo .claude / CLAUDE.md", d: "확장 탭에서 사람이 누른 스킬 · settings.local.json 변경만 씁니다", label: "스스로 고치지 않음" },
    ],
  },
  {
    cat: "keys",
    title: "단축키 (읽기 전용)",
    sub: "읽기 전용입니다. xterm은 Ctrl+Shift+글자를 터미널로 보내지 않아 셸 단축키와 겹치지 않습니다.",
    keys: true,
    // macOS는 ⌘가 앱 키, Ctrl은 셸 제어키다 — 표가 실제 바인딩과 같아야 한다 (U67·B126)
    fixed: IS_MAC
      ? [
          { k: "⌘⇧U", label: "다음 미확인으로 (= ⛶ 응답 대기 칩)" },
          { k: "⌘1~8", label: "N번 슬롯 페인에 키보드 포커스" },
          { k: "⌘⇧L", label: "페인 배치" },
          { k: "⌘⇧D", label: "관제 토글" },
          { k: "⌘⇧B", label: "사이드 패널 토글 (마지막 탭)" },
          { k: "⌘⇧K", label: "건너뛰기 팔레트 — 세션 · 워크스페이스 · 임무 · 화면 · 패널" },
          { k: "⌘F", label: "터미널 검색" },
          { k: "⌘F · ⌘S · Tab", label: "파일 편집기 안 — 찾기 · 저장 · 들여쓰기 (Esc 다음 Tab은 포커스 이동)" },
          { k: "⌘C / ⌘V", label: "복사 · 붙여넣기 (이미지는 파일 경로로)" },
          { k: "⌘K", label: "터미널 화면 · 스크롤백 비우기" },
          { k: "Ctrl+C · F · V", label: "셸로 그대로 — 인터럽트 · 커서 이동 · 글자 그대로 넣기" },
          { k: "Option", label: "Meta 키 — Option+B/F 단어 이동 · Option+Enter 줄바꿈" },
          { k: "Esc", label: "맨 위 창·팝업·메뉴 하나만 닫기 · 입력칸에서는 칸 빠져나오기" },
          { k: "Enter", label: "확인창에서 취소 (위험 버튼은 Tab으로 옮겨 Enter)" },
          { k: "n / p", label: "diff 화면 — 다음 · 이전 변경" },
          { k: "] / [ · ⌥↑↓", label: "diff 화면 — 다음 · 이전 파일" },
          { k: "Esc", label: "git · diff · 기록 화면 닫기 (돌아가기)" },
          { k: "⌃⌥D", label: "화면이 깨졌을 때 진단 기록에 표시" },
        ]
      : [
          { k: "Ctrl+Shift+U", label: "다음 미확인으로 (= ⛶ 응답 대기 칩)" },
          { k: "Ctrl+Alt+1~8", label: "N번 슬롯 페인에 키보드 포커스" },
          { k: "Ctrl+Shift+L", label: "페인 배치" },
          { k: "Ctrl+Shift+D", label: "관제 토글" },
          { k: "Ctrl+Shift+B", label: "사이드 패널 토글 (마지막 탭)" },
          { k: "Ctrl+Shift+K", label: "건너뛰기 팔레트 — 세션 · 워크스페이스 · 임무 · 화면 · 패널" },
          { k: "Ctrl+F", label: "터미널 검색" },
          { k: "Ctrl+F · Ctrl+S · Tab", label: "파일 편집기 안 — 찾기 · 저장 · 들여쓰기 (Esc 다음 Tab은 포커스 이동)" },
          { k: "Ctrl+Shift+C / V", label: "복사 · 붙여넣기" },
          { k: "Ctrl+C · Ctrl+V", label: "선택이 있으면 복사 · 붙여넣기 (앱)" },
          { k: "Esc", label: "맨 위 창·팝업·메뉴 하나만 닫기 · 입력칸에서는 칸 빠져나오기" },
          { k: "Enter", label: "확인창에서 취소 (위험 버튼은 Tab으로 옮겨 Enter)" },
          { k: "n / p", label: "diff 화면 — 다음 · 이전 변경" },
          { k: "] / [ · Alt+↑↓", label: "diff 화면 — 다음 · 이전 파일" },
          { k: "Esc", label: "git · diff · 기록 화면 닫기 (돌아가기)" },
          { k: "Ctrl+Alt+D", label: "화면이 깨졌을 때 진단 기록에 표시" },
        ],
  },
  {
    cat: "about",
    title: "문의 · 피드백",
    sub: "버그와 개선 제안을 받고 있습니다. 아직 1.0 이전이라 어떤 이야기든 도움이 됩니다.",
    links: [
      {
        k: "문의 폼",
        label: "브라우저에서 열기",
        url: () => FEEDBACK_FORM[settings().language],
      },
    ],
  },
  {
    cat: "about",
    title: "정보",
    sub: "여러 AI 에이전트가 팀으로 하나의 git 저장소를 함께 작업하고, 사람이 그것을 관제하는 데스크톱 앱입니다.",
    info: [
      { k: "제품", label: "EQMUX — 멀티 에이전트 관제 MUX" },
      { k: "버전", label: `v${__APP_VERSION__}` },
      { k: "라이선스", label: "MIT" },
    ],
  },
];

/** 행 왼쪽 — 이름과 (있으면) 설명 한 줄 */
function RowCopy(props: { k: string; d?: string }) {
  return (
    <div class="set-copy">
      <div class="set-label">{t(props.k)}</div>
      <Show when={props.d}>
        <div class="set-desc">{t(props.d!)}</div>
      </Show>
    </div>
  );
}

export function Settings() {
  // 음소거(FR-G-35)는 이 화면에 행이 없다 — 세션 상세에서만 켜고 끈다. 비교와 복원 양쪽에서
  // 빼야 '보이는 값이 전부 기본값이면 버튼이 꺼진다'가 성립하고, 복원이 보이지 않는 목록을
  // 조용히 지우지 않는다 (B53). 첫 실행 고지를 봤다는 표시도 같다 — 복원이 고지를 다시 띄우지 않게
  const visible = (x: AppSettings) => JSON.stringify({ ...x, muted: [], firstRunSeen: false });
  const isDefault = () => visible(settings()) === visible(DEFAULT_SETTINGS);
  const resetTo = (): AppSettings => ({ ...DEFAULT_SETTINGS, muted: settings().muted, firstRunSeen: settings().firstRunSeen });
  // 복원은 확인을 거친다 (B203) — 언어·슬롯 수·예산·창 닫기까지 한 번에 바뀌었다. 바뀌는 행만 '지금 → 기본값'으로 보인다
  const [askReset, setAskReset] = createSignal(false);
  const resetLines = () => {
    const next = resetTo();
    return SECTIONS.flatMap((sec) => sec.wired ?? [])
      .filter((it) => it.current() !== it.current(next))
      .map((it) => `${t(it.k)}: ${t(it.labels[it.current()])} → ${t(it.labels[it.current(next)])}`);
  };
  // 카테고리는 앱 셸 상태다 — 벨의 [알림 설정]이 알림 탭을 지정해 연다 (U34)
  const cat = () => settingsCat() as Cat;
  const setCat = (c: Cat) => setSettingsCat(c);

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>{t("설정")}</h1>
          <div class="sub mono">{t(isTauri() ? "settings.json 즉시 저장" : "브라우저 dev — 저장 없음")}</div>
        </div>
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <span class="set-chip">{t("바뀔 때마다 저장")}</span>
          <button class="btn" disabled={isDefault()} onClick={() => setAskReset(true)}>
            {t("기본값 복원")}
          </button>
        </div>
      </div>
      <Show when={askReset()}>
        <ConfirmDialog
          danger
          title={t("설정을 기본값으로 되돌릴까요?")}
          body={tf("아래 {n}개 값이 기본값으로 바뀝니다. 앱 안에서는 되돌릴 수 없습니다.", { n: resetLines().length })}
          info={resetLines()}
          confirmLabel={t("기본값 복원")}
          onConfirm={() => {
            setAskReset(false);
            updateSettings(resetTo());
          }}
          onCancel={() => setAskReset(false)}
        />
      </Show>
      {/* 저장 실패 (B54) — 화면 값과 파일이 갈라진 상태를 숨기지 않는다 */}
      <Show when={settingsSaveError()}>
        <div class="card inset" style={{ margin: "0 0 8px", padding: "8px 10px", "font-size": "11px" }}>
          <span class="st-dead">{t("저장 실패 — 다음 실행에 반영되지 않습니다")}</span>
          <div class="mono muted" style={{ "margin-top": "4px" }}>{settingsSaveError()}</div>
        </div>
      </Show>
      <div class="screen-body settings-layout">
        <nav class="settings-tabs" aria-label={t("설정")}>
          <For each={CATS}>
            {(c) => (
              <button classList={{ on: cat() === c.key }} aria-current={cat() === c.key} onClick={() => setCat(c.key)}>
                {t(c.label)}
              </button>
            )}
          </For>
        </nav>
        <div class="settings-grid">
          <For each={SECTIONS.filter((x) => x.cat === cat())}>
            {(sec) => (
              <div class="card set-card">
                <div class="set-card-title">{t(sec.title)}</div>
                <Show when={sec.sub}>
                  <div class="set-card-sub mono">{t(sec.sub!)}</div>
                </Show>
                <For each={sec.wired ?? []}>
                  {(it) => (
                    <div class="set-row">
                      <RowCopy k={it.k} d={it.d} />
                      <Show
                        when={it.labels.length <= 3}
                        fallback={
                          <select
                            class="setting-select"
                            aria-label={t(it.k)}
                            value={String(it.current())}
                            onChange={(e) => it.apply(Number(e.currentTarget.value))}
                          >
                            <For each={it.labels}>{(l, i) => <option value={String(i())}>{t(l)}</option>}</For>
                          </select>
                        }
                      >
                        <Segmented
                          label={t(it.k)}
                          items={it.labels.map((l, i) => ({
                            value: String(i),
                            label: t(l),
                          }))}
                          value={String(it.current())}
                          onChange={(v) => it.apply(Number(v))}
                        />
                      </Show>
                    </div>
                  )}
                </For>
                <For each={sec.fixed ?? []}>
                  {(it) =>
                    sec.keys ? (
                      <div class="set-row">
                        <span class="set-key">{it.k}</span>
                        <span class="set-key-desc">{t(it.label)}</span>
                      </div>
                    ) : (
                      <div class="set-row">
                        <RowCopy k={it.k} d={it.d} />
                        <span
                          class="set-chip"
                          classList={{ green: it.tone === "green", blue: it.tone === "blue" }}
                          title={t("고정 정책 — 설정으로 바꾸지 않습니다")}
                        >
                          {t(it.label)}
                        </span>
                      </div>
                    )
                  }
                </For>
                <For each={sec.info ?? []}>
                  {(it) => (
                    <div class="set-row">
                      <RowCopy k={it.k} />
                      <span class="set-chip">{t(it.label)}</span>
                    </div>
                  )}
                </For>
                <For each={sec.links ?? []}>
                  {(it) => (
                    <div class="set-row">
                      <RowCopy k={it.k} />
                      <button class="btn" onClick={() => openLink(it.url(), true)} title={t("앱 밖 브라우저로 엽니다")}>
                        <Icon name="external-link" size={12} />
                        {t(it.label)}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
          <Show when={cat() === "runtime"}>
            <CliAgentsCard />
          </Show>
          {/* 첫 실행 고지 다시 보기 · 다른 도구 전역 지시 점검 · 진단 정보 복사 (0.6 §10 · §14 · §9-3) */}
          <Show when={cat() === "about"}>
            <div class="card set-card">
              <div class="set-card-title">{t("앱이 쓰는 곳 · 진단")}</div>
              <WhereCard />
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

/** CLI 에이전트 명부 (설치 실측) — 설정값이 아니라 환경 사실이라 SECTIONS의 틀 밖에 둔다.
 *  세션 추가 진입점이 보는 것과 같은 목록이다: 여기서 "설치됨"인 것만 거기 카드로 나온다.
 *  그래서 세 갈래로 나눈다 — 무엇을 열 수 있고, 열면 무엇이 붙는지가 갈리는 지점이 거기다.
 *
 *  claude·codex가 관리 실행이다 (M37): 역할 주입·권한 플래그·훅·재개가 붙는다 (agent.rs의 두 어댑터).
 *  나머지는 셸에 명령을 치는 것과 같아서 관제에는 "실행 중"으로만 잡힌다 — 그 차이를 감추면
 *  "왜 이 에이전트는 대화가 안 오지"가 된다. */
function CliAgentsCard() {
  const managed = () => agentClis().filter((a) => a.managed && a.installed);
  const shellRun = () => agentClis().filter((a) => !a.managed && a.installed);
  const missing = () => agentClis().filter((a) => !a.installed);

  const group = (title: string, desc: string, list: () => { cmd: string; name: string }[], note: string, ok: boolean) => (
    <Show when={list().length > 0}>
      <div class="set-group-head">
        <div class="set-label">{t(title)}</div>
        <div class="set-desc">{t(desc)}</div>
      </div>
      <For each={list()}>
        {(a) => (
          <div class="set-row">
            <div class="set-copy">
              <div class="set-label">
                {a.name} <span class="mono muted">{a.cmd}</span>
              </div>
            </div>
            <span class="set-chip" classList={{ green: ok }}>
              {t(note)}
            </span>
          </div>
        )}
      </For>
    </Show>
  );

  return (
    <div class="card set-card">
      <div class="set-card-title">{t("CLI 에이전트")}</div>
      <div class="set-card-sub mono">
        {t("PATH 실측 — 설치된 것만 세션 추가에서 열 수 있습니다. 감지 목록과 같은 명부라, 열 수 있는 것은 관제에도 잡힙니다.")}
      </div>

      {/* 실측 전에는 아무것도 단정하지 않는다 — 빈 목록을 "전부 미설치"로 그리면 거짓말이 된다 */}
      <Show when={agentClisReady()} fallback={<div class="muted mono" style={{ "font-size": "11px" }}>{t("확인 중…")}</div>}>
        {group(
          "관리 실행",
          "역할·권한 플래그·훅·재개가 붙습니다. 세션 추가의 [에이전트 열기]가 이 경로입니다.",
          managed,
          "설치됨",
          true,
        )}
        {group(
          "셸 실행",
          "셸에 명령을 치는 것과 같습니다 — 역할·훅·재개는 붙지 않고 관제에는 실행 중으로만 보입니다.",
          shellRun,
          "설치됨",
          true,
        )}
        {group(
          "미설치",
          "PATH에 없습니다 — 세션 추가에 나오지 않습니다. 설치한 뒤 다시 확인하세요.",
          missing,
          "없음",
          false,
        )}
      </Show>

      <div style={{ display: "flex", "justify-content": "flex-end", "margin-top": "10px" }}>
        <button class="btn" disabled={!isTauri()} onClick={() => void refreshAgentClis()} title={t("PATH를 다시 훑습니다")}>
          <Icon name="refresh-cw" size={12} />
          {t("다시 확인")}
        </button>
      </div>
    </div>
  );
}
