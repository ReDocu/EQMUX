// 서브에이전트 목록 (0.6 §4 · W3) — 세션 상세에 읽기 전용으로 붙는다. 트랜스크립트의 Agent/Task 도구 호출을 모은다.
// 읽어 온 창(transcript_read limit) 안의 호출만 보인다. 없으면 아무것도 그리지 않는다.
// 개요의 '지금 도는 서브에이전트'(동시 수)와 다른 숫자라 '최근 호출 (기록)'으로 부른다 (U159)
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import type { AgentStateEvt } from "../backend/agent";
import { subagentCalls, subagentDone } from "../backend/history";
import { isTauri } from "../backend/pty";
import { readTranscript } from "../backend/transcript";
import type { TranscriptTurnReal } from "../backend/transcript";
import { t } from "../i18n";
import type { Session } from "../types";
import { Eyebrow } from "./ui";

export function SubagentList(props: { session: Session }) {
  const [calls, setCalls] = createSignal<TranscriptTurnReal[]>([]);
  // 늦게 끝난 이전 세션 읽기는 버린다 — 패널은 세션이 바뀌어도 다시 만들어지지 않는다
  const load = () => {
    const sid = props.session.id;
    void readTranscript(props.session).then((d) => {
      if (sid === props.session.id) setCalls(d?.guessed ? [] : subagentCalls(d?.turns ?? [])); // 추정 로그는 동료 것일 수 있다 (B209)
    });
  };
  createEffect(
    on(
      () => props.session.id,
      () => {
        setCalls([]);
        if (isTauri()) load();
      },
    ),
  );
  // 패널을 연 채 새 Task를 불러도 늘어나게 — TranscriptPane처럼 이 세션의 agent-state에 다시 읽는다 (U159)
  if (isTauri()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unlisten = listen<AgentStateEvt>("agent-state", (e) => {
      if (e.payload.session !== props.session.id) return;
      clearTimeout(timer);
      timer = setTimeout(load, 1000);
    });
    onCleanup(() => {
      clearTimeout(timer);
      void unlisten.then((f) => f());
    });
  }
  return (
    <Show when={calls().length > 0}>
      <div style={{ "margin-top": "8px" }}>
        <Eyebrow>
          {t("최근 서브에이전트 호출 (기록)")} · {calls().length}
        </Eyebrow>
        <div class="card inset" style={{ padding: "6px 10px" }}>
          <For each={calls()}>
            {(c) => (
              <div class="mono muted" style={{ "font-size": "11px", "line-height": 1.7 }} title={c.summary ?? undefined}>
                {c.time}{" "}
                {/* 결과가 기록에 있으면 끝남, 없으면 진행 중 (U159) — 세션을 끊었으면 중단된 것일 수 있다 */}
                <span
                  classList={{ "st-waiting": !subagentDone(c) }}
                  title={subagentDone(c) ? undefined : t("결과가 아직 기록되지 않았습니다 — 진행 중이거나 중단됐습니다")}
                >
                  {t(subagentDone(c) ? "끝남" : "진행 중")}
                </span>{" "}
                · {c.summary ?? t("설명 없음")}
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
