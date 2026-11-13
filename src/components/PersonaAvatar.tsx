// 페르소나 아바타 (0.6 §15-4) — personas/<id>.png가 있으면 초상, 없으면 이니셜. 역할 라이브러리 · 팀 캐스팅이 쓴다.
// 레일 · 페인 머리 · 대화 탭 · 알림(W7 화면)도 이 부품을 쓰면 같은 초상이 나온다.
import { createResource, createSignal, Show } from "solid-js";
import { portraitUrl } from "../backend/library";
import { backend } from "../backend/mock";
import { tick } from "../state";
import type { Persona } from "../types";

/** 아바타 글자 — `[강사]실버울프`처럼 기호로 시작하는 이름은 첫 글자·숫자를 쓴다 */
export const initial = (name: string) => name.match(/[\p{L}\p{N}]/u)?.[0] ?? name.slice(0, 1);

export function PersonaAvatar(props: { persona?: Pick<Persona, "id" | "name" | "color" | "portraitMtimeMs">; class?: string }) {
  const [src] = createResource(
    () => props.persona,
    (p) => portraitUrl(p),
  );
  const [bad, setBad] = createSignal<string>(); // 깨진 png — 브라우저가 못 그린 URL
  return (
    <span class={`cast-avatar ${props.class ?? ""} ${props.persona?.color ?? ""}`}>
      <Show when={src() && src() !== bad()} fallback={initial(props.persona?.name ?? "")}>
        <img class="eq-portrait" src={src()} alt="" onError={() => setBad(src())} />
      </Show>
    </span>
  );
}

/** 세션의 초상만 (§15-4) — png가 있을 때만 작은 원을 그리고, 없으면 아무것도 그리지 않는다.
 *  레일 · 페인 머리 · 대화 탭 · 알림은 이니셜 칸이 없으므로 초상이 없는 사람에게 레이아웃이 그대로다 */
export function SessionPortrait(props: { sessionId?: string; class?: string }) {
  const persona = () => {
    tick();
    const s = backend.listSessions().find((x) => x.id === props.sessionId);
    return s?.personaId ? backend.listPersonas().find((p) => p.id === s.personaId) : undefined;
  };
  const [src] = createResource(
    () => (persona()?.portraitMtimeMs ? persona() : undefined),
    (p) => portraitUrl(p),
  );
  const [bad, setBad] = createSignal<string>();
  return (
    <Show when={persona()?.portraitMtimeMs && src() && src() !== bad()}>
      <img class={`eq-portrait-sm ${props.class ?? ""}`} src={src()} alt="" onError={() => setBad(src())} />
    </Show>
  );
}
