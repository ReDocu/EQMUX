// 앱 셸 상태 — 내비게이션은 result_prd.md §2 순서도의 계약을 따른다:
// 상태를 바꾸는 것은 언제나 사용자 버튼이며, 자동 실행 경로는 없다.
import { createSignal } from "solid-js";
import { backend } from "./backend/mock";

export type View =
  | { kind: "control" } // 관제 고정 탭 (FR-G-01·02) — 다중 워크스페이스 대시보드
  | { kind: "workspace"; id: string } // 워크스페이스 탭 = 컨트롤 센터 (bi8Au)
  | { kind: "connect" } // 레인 01 — 워크스페이스 연결
  | { kind: "casting"; wsId: string } // 레인 01 — 팀 캐스팅
  | { kind: "composition"; wsId: string } // 레인 01 — 팀 편성
  | { kind: "roles" } // 역할 라이브러리 (화면 #7)
  | { kind: "missions"; wsId: string } // 임무 배정 (화면 #8)
  | { kind: "settings" };

export type PanelTab = "conversation" | "git" | "files" | "ports" | "missions";

export const [view, setView] = createSignal<View>({ kind: "control" });
export const [selectedSession, setSelectedSession] = createSignal<string | undefined>(undefined);
export const [exitOpen, setExitOpen] = createSignal(false);

/** 사이드 패널 (M1 — 대화는 패널 탭이며 메인 화면이 아니다) */
export const [panelOpen, setPanelOpen] = createSignal(false);
export const [panelTab, setPanelTab] = createSignal<PanelTab>("conversation");

/** 백엔드 방송(FR-C-43) 수신 틱 — 화면은 tick()을 구독해 다시 그린다 */
export const [tick, setTick] = createSignal(0);
backend.subscribe(() => setTick((t) => t + 1));

/** 대시보드 셀 클릭 = 1클릭 점프 (FR-G-50) */
export function jumpToSession(workspaceId: string, sessionId: string) {
  setSelectedSession(sessionId);
  setView({ kind: "workspace", id: workspaceId });
}
