// 페르소나 아바타 (0.6 §15-4) — personas/<id>.png가 있으면 초상, 없으면 이니셜. 역할 라이브러리 · 팀 캐스팅이 쓴다.
// 레일 · 페인 머리 · 대화 탭 · 알림(W7 화면)도 이 부품을 쓰면 같은 초상이 나온다.
import { createResource, Show } from "solid-js";
import { portraitUrl } from "../backend/library";
import type { Persona } from "../types";

/** 아바타 글자 — `[강사]실버울프`처럼 기호로 시작하는 이름은 첫 글자·숫자를 쓴다 */
export const initial = (name: string) => name.match(/[\p{L}\p{N}]/u)?.[0] ?? name.slice(0, 1);

export function PersonaAvatar(props: { persona?: Pick<Persona, "id" | "name" | "color" | "portraitMtimeMs">; class?: string }) {
  const [src] = createResource(
    () => props.persona,
    (p) => portraitUrl(p),
  );
  return (
    <span class={`cast-avatar ${props.class ?? ""} ${props.persona?.color ?? ""}`}>
      <Show when={src()} fallback={initial(props.persona?.name ?? "")}>
        <img class="eq-portrait" src={src()} alt="" />
      </Show>
    </span>
  );
}
