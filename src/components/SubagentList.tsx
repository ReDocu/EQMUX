// 서브에이전트 목록 (0.6 §4 · W3) — 세션 상세에 읽기 전용으로 붙는다. 트랜스크립트의 Agent/Task 도구 호출을 모은다.
// 읽어 온 창(transcript_read limit) 안의 호출만 보인다. 없으면 아무것도 그리지 않는다.
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { subagentCalls } from "../backend/history";
import { isTauri } from "../backend/pty";
import { readTranscript } from "../backend/transcript";
import type { TranscriptTurnReal } from "../backend/transcript";
import { t } from "../i18n";
import type { Session } from "../types";
import { Eyebrow } from "./ui";

export function SubagentList(props: { session: Session }) {
  const [calls, setCalls] = createSignal<TranscriptTurnReal[]>([]);
  createEffect(
    on(
      () => props.session.id,
      () => {
        setCalls([]);
        if (isTauri()) void readTranscript(props.session).then((d) => setCalls(subagentCalls(d?.turns ?? [])));
      },
    ),
  );
  return (
    <Show when={calls().length > 0}>
      <div style={{ "margin-top": "8px" }}>
        <Eyebrow>
          {t("서브에이전트")} · {calls().length}
        </Eyebrow>
        <div class="card inset" style={{ padding: "6px 10px" }}>
          <For each={calls()}>
            {(c) => (
              <div class="mono muted" style={{ "font-size": "11px", "line-height": 1.7 }} title={c.summary ?? undefined}>
                {c.time} {c.summary ?? t("설명 없음")}
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
