// 설정 (o2bCs2) — 표시된 기본값이 곧 정책 선언이다 (result_prd §3.15).
import { For } from "solid-js";
import { Eyebrow, KV } from "../components/ui";

const SECTIONS: { title: string; desc: string; items: [string, string][] }[] = [
  {
    title: "시작과 복원",
    desc: "자동 실행 없이 화면 상태만 복원합니다.",
    items: [
      ["시작 화면", "관제 대시보드"],
      ["마지막 탭 복원", "꺼짐"],
      ["스크롤백 재생", "500 lines"],
    ],
  },
  {
    title: "알림",
    desc: "사람의 행동이 필요한 상태만 알립니다.",
    items: [
      ["OS 알림", "waiting · dead"],
      ["창 포커스 시", "억제"],
      ["waiting 사운드", "꺼짐"],
    ],
  },
  {
    title: "저장소와 보존",
    desc: "워크스페이스별 SQLite WAL.",
    items: [
      ["세션당 상한", "100,000 lines"],
      ["워크스페이스", "500 MB"],
      ["전역 / 기간", "2 GB · 30 days"],
    ],
  },
  {
    title: "Claude Code 런타임",
    desc: "검증된 CLI와 관측 어댑터 설정.",
    items: [
      ["CLI 버전", "2.1.226 verified"],
      ["상태 소스", "registry + hook"],
      ["watch 폴백", "2s polling"],
    ],
  },
  {
    title: "권한 정책",
    desc: "bypassPermissions는 앱에서 제공하지 않습니다.",
    items: [
      ["기본 구현", "acceptEdits"],
      ["리뷰·검증", "manual"],
      ["권한 변경", "재개 기반 재시작"],
    ],
  },
  {
    title: "사용자 파일 불가침",
    desc: "개인 Claude 설정은 수정하거나 읽지 않습니다.",
    items: [
      ["~/.claude/settings", "수정 안 함"],
      ["repo .claude", "수정 안 함"],
      ["Hook settings", "세션별 추가"],
    ],
  },
];

export function Settings() {
  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>설정</h1>
          <div class="sub">시작 · 알림 · 런타임 · 저장소 · 보안</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button class="btn">기본값 복원</button>
          <button class="btn primary">설정 저장</button>
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
              <For each={sec.items}>{([k, v]) => <KV k={k} v={v} />}</For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
