// 주입 본문 단위 테스트 — 전달 경로(PTY·인박스)는 통합의 몫이고, 여기서는 "여러 건을 어떻게
// 한 줄로 접는가"만 본다: 단건/묶음 접두 · 개행 평탄화 · 상한에서 덩어리 갈리기.
import { describe, expect, test } from "vitest";
import { batches, cancelBrief, crossCopy, titlePrefix, consumeTaken, droppedIds, noteTaken, capQueue, deliveredIds, flushInboxOnState, fmt, fmtNotice, goneName, injectedMsgIds, sentState, touchesMission, orphanedInbox, pendingBrief, queueBrief, pendingReason, prependOlder, splitPending, unmanagedAgent } from "./conversation";
import { typedText } from "./pty";
import type { ConversationMessage } from "../types";

const msg = (from: string, body: string, type: ConversationMessage["type"] = "ask"): ConversationMessage => ({
  id: `${from}:${body.length}`,
  time: "12:00",
  from,
  type,
  to: "@all",
  body,
  unread: true,
});

describe("fmt", () => {
  test("원장 id와 회신 대상을 머리에 싣는다 — eqmux send --re <id> (W3 §4)", () => {
    expect(fmt([{ ...msg("린", "봐줘"), rowId: 42 }])).toBe("[EQ·ask #42] 린: 봐줘");
    expect(fmt([{ ...msg("린", "끝"), rowId: 43, re: 41 }])).toBe("[EQ·ask #43 (#41에 회신)] 린: 끝");
    expect(fmt([{ ...msg("린", "a"), rowId: 1 }, msg("카이", "b")])).toBe("[EQ 2건] 1) 린·ask #1: a 2) 카이·ask: b");
  });
  test("단건은 짧은 접두 하나", () => {
    expect(fmt([msg("나", "빌드 봐줘")])).toBe("[EQ·ask] 나: 빌드 봐줘");
  });

  test("줄바꿈은 공백으로 눌린다 — TUI에서 개행은 곧 제출이라", () => {
    expect(fmt([msg("나", "첫 줄\n  둘째 줄")])).toBe("[EQ·ask] 나: 첫 줄 둘째 줄");
  });

  test("여러 건은 한 줄 — 래퍼도 턴도 하나", () => {
    const line = fmt([msg("나", "a"), msg("코더", "b", "report")]);
    expect(line).toBe("[EQ 2건] 1) 나·ask: a 2) 코더·report: b");
  });

  test("꼬리는 맨 끝에 한 번만", () => {
    const line = fmt([msg("나", "a"), msg("나", "b")], " (답신은 코더의 말투로)");
    expect(line.match(/답신은/g)).toHaveLength(1);
    expect(line.endsWith(" (답신은 코더의 말투로)")).toBe(true);
  });
});

// 발신자 표기 (BR-14) — 원장의 세션 id가 아니라 받은 그대로 `--to @이름`으로 답할 수 있는 이름
describe("fmt 발신자 이름", () => {
  test("label이 세션 id를 이름으로 푼다", () => {
    const m = msg("kai@eqmux-1e3b93", "로그인 API 봐줘");
    expect(fmt([m], "", () => "카이")).toBe("[EQ·ask] 카이: 로그인 API 봐줘");
  });

  test("묶음에서도 건마다 이름", () => {
    const line = fmt([msg("kai@ws", "a"), msg("noel@ws", "b")], "", (m) => (m.from === "kai@ws" ? "카이" : "노엘@app-b"));
    expect(line).toBe("[EQ 2건] 1) 카이·ask: a 2) 노엘@app-b·ask: b");
  });

  test("--file 첨부는 경로가 따라간다", () => {
    const m = { ...msg("나", "요약"), file: { path: ".eqmux/notes/a.md", size: 10 } };
    expect(fmt([m])).toBe("[EQ·ask] 나: 요약 (파일: .eqmux/notes/a.md)");
  });

  test("맨 셸 알림도 같은 머리 · 한 줄 — 내부 id가 나오지 않는다 (B157)", () => {
    expect(fmtNotice(msg("kai@eqmux-1e3b93", "hi\n  there"), "카이")).toBe("[EQ·ask] 카이: hi there");
    expect(fmtNotice(msg("카이", "x".repeat(300)))).toHaveLength(160);
  });
});

describe("batches", () => {
  test("상한 아래면 한 덩어리", () => {
    expect(batches([msg("나", "a"), msg("나", "b")])).toHaveLength(1);
  });

  test("상한을 넘으면 갈린다", () => {
    const big = () => msg("나", "x".repeat(1500));
    expect(batches([big(), big(), big(), big()]).map((b) => b.length)).toEqual([2, 2]);
  });

  test("혼자서 상한을 넘는 한 건도 버려지지 않는다", () => {
    const huge = msg("나", "x".repeat(9000));
    expect(batches([huge, msg("나", "a")])).toEqual([[huge], [msg("나", "a")]]);
  });

  test("빈 입력은 빈 결과", () => {
    expect(batches([])).toEqual([]);
  });
});

// 에코냐 주입이냐를 가르는 한 줄 — 여기가 틀리면 손으로 띄운 TUI 화면에 우리가 줄을 끼워 넣어
// 이후 재그리기가 전부 어긋난다(잔상·엉뚱한 커서), 또는 관리 세션의 유휴 판정을 건너뛴다.
describe("unmanagedAgent", () => {
  test("shell인데 프로세스 트리에 에이전트가 보이면 손으로 띄운 것", () => {
    expect(unmanagedAgent({ status: "shell", agent: "Codex" })).toBe(true);
  });

  test("맨 셸은 아니다 — 에코가 맞는 자리", () => {
    expect(unmanagedAgent({ status: "shell" })).toBe(false);
  });

  test("관리 세션은 아니다 — 돌고 있는 동안 status가 shell일 수 없다", () => {
    for (const status of ["starting", "busy", "waiting", "idle", "dead"]) {
      expect(unmanagedAgent({ status, agent: "Claude", personaId: "kai" })).toBe(false);
    }
  });

  test("기본 터미널의 에이전트는 레지스트리가 채택해 idle·busy여도 손으로 띄운 것", () => {
    for (const status of ["idle", "busy", "waiting"]) {
      expect(unmanagedAgent({ status, agent: "Claude", personaId: "" })).toBe(true);
    }
  });
});

// 사라진 세션의 이름 — 원장에 남은 보낸 때 이름 → id 앞부분 페르소나 → id 그대로
describe("goneName", () => {
  const personas = [{ id: "kai", name: "카이" }];
  test("원장 이름이 먼저다", () => {
    const ledger = new Map([["shell1@ws-1", "EQMUX01"]]);
    expect(goneName("shell1@ws-1", ledger, personas)).toBe("EQMUX01");
  });
  test("원장 이름이 없으면 id 앞부분의 페르소나 이름", () => {
    expect(goneName("kai@ws-1", new Map(), personas)).toBe("카이");
  });
  test("둘 다 없으면 id 그대로 — 나·@all도 원문으로 남는다", () => {
    expect(goneName("shell2@ws-1", new Map(), personas)).toBe("shell2@ws-1");
    expect(goneName("나", new Map(), personas)).toBe("나");
  });
});

// 사람이 친 글자 판정 (실기 QA) — 터미널이 스스로 내는 응답을 입력으로 치면 주입이 60초씩 막히고
// 유휴 세션의 메시지가 대기에 남는다
describe("typedText", () => {
  test("포커스 보고·커서 위치 응답·방향키는 글자가 아니다", () => {
    for (const d of ["\x1b[I", "\x1b[O", "\x1b[12;3R", "\x1b[?62;c", "\x1b[A"]) expect(typedText(d)).toBe(false);
  });

  test("글자와 괄호 붙여넣기는 사람이 친 것", () => {
    expect(typedText("a")).toBe(true);
    expect(typedText("안녕")).toBe(true);
    expect(typedText("\x1b[200~붙여넣은 글\x1b[201~")).toBe(true);
  });
});

// 0.5.x QA eqmux-66
describe("deliveredIds (B89)", () => {
  test("@all이 한 수신자에게만 흘렀으면 다른 인박스에 남은 동안 전달됨이 아니다", () => {
    const m = { ...msg("나", "모두 확인"), id: "m1" };
    const other = { ...msg("코더", "x"), id: "m2" };
    expect(deliveredIds([m, other], new Map([["b@w", [m]]]))).toEqual([]);
    expect(deliveredIds([m, other], new Map())).toEqual(["m1"]); // 내 메시지만, 다 빠졌을 때
  });
});

describe("orphanedInbox (B90)", () => {
  test("에이전트가 내려간 기본 터미널만 고아 — 역할 세션·dead는 기다린다", () => {
    expect(orphanedInbox({ status: "shell" })).toBe(true);
    expect(orphanedInbox({ status: "shell", agent: "claude" })).toBe(false);
    expect(orphanedInbox({ status: "shell", personaId: "kai" })).toBe(false);
    expect(orphanedInbox({ status: "dead" })).toBe(false);
  });
});

describe("prependOlder (B99)", () => {
  test("옛 페이지는 응답 뒤 스트림 앞에 붙고 겹치는 id는 한 번만", () => {
    const a = { ...msg("나", "a"), id: "1" };
    const b = { ...msg("나", "b"), id: "2" };
    const c = { ...msg("나", "c"), id: "3" }; // 기다리는 사이 도착
    expect(prependOlder([a, b], [b, c]).map((m) => m.id)).toEqual(["1", "2", "3"]);
  });
});

describe("pendingReason (U50)", () => {
  test("사유별로 갈린다", () => {
    expect(pendingReason({ status: "dead", personaId: "kai" })).toBe("종료됨 · 재개해야 전달");
    expect(pendingReason({ status: "shell", agent: "claude" })).toBe("손으로 띄운 에이전트 · 넣기 필요");
    expect(pendingReason({ status: "shell", personaId: "kai" })).toBe("에이전트 미기동 · 띄우면 전달");
    expect(pendingReason({ status: "waiting", personaId: "kai" })).toBe("응답 대기 · 답한 뒤 전달");
    expect(pendingReason({ status: "busy", personaId: "kai" })).toBe("작업 중 · 턴 끝나면 전달");
  });
});

describe("splitPending (U51)", () => {
  test("체크한 것만 넣고/버리고 나머지는 남긴다 — 없으면 전부", () => {
    const a = { ...msg("나", "a"), id: "a" };
    const b = { ...msg("나", "b"), id: "b" };
    expect(splitPending([a, b], new Set(["b"]))).toEqual([[b], [a]]);
    expect(splitPending([a, b])).toEqual([[a, b], []]);
  });
});

describe("queueBrief (B93)", () => {
  test("작업 중이면 턴 끝(idle 전이)에 넣는다 — 그 전에는 남고, 다시 배정하면 덮고, 해제하면 버린다", () => {
    queueBrief("x@w", "[EQ] 임무 배정: A");
    queueBrief("x@w", "[EQ] 임무 배정: B");
    flushInboxOnState("x@w", "busy");
    expect(pendingBrief("x@w")).toBe("[EQ] 임무 배정: B");
    flushInboxOnState("x@w", "idle");
    expect(pendingBrief("x@w")).toBeUndefined();
    queueBrief("y@w", "[EQ] 임무 배정: C");
    cancelBrief("y@w");
    expect(pendingBrief("y@w")).toBeUndefined();
  });
});

describe("capQueue (CPU·RAM M6)", () => {
  test("상한 안이면 그대로, 넘치면 최근 것만 남긴다", () => {
    const q = [1, 2, 3];
    expect(capQueue(q, 5)).toBe(q);
    expect(capQueue([1, 2, 3, 4, 5, 6], 4)).toEqual([3, 4, 5, 6]);
  });
});

describe("--wait로 받아 간 회신 (W3 §4)", () => {
  test("message-new보다 먼저 온 표시는 그 세션에 한 번만 쓰이고, 10초가 지나면 걷힌다", () => {
    noteTaken("kai@ws", 7, 1000);
    expect(consumeTaken("rin@ws", 7, 1001)).toBe(false);
    expect(consumeTaken("kai@ws", 7, 1002)).toBe(true);
    expect(consumeTaken("kai@ws", 7, 1003)).toBe(false);
    noteTaken("kai@ws", 8, 1000);
    expect(consumeTaken("kai@ws", 8, 20_000)).toBe(false);
  });
});

describe("상한으로 밀려난 메시지 (§2 M3)", () => {
  test("사람이 보낸 것만 버려짐이 된다", () => {
    const mine = { ...msg("나", "a"), id: "m1" };
    expect(droppedIds([mine, msg("카이", "b")])).toEqual(["m1"]);
  });
});

describe("전달됨 시점 (B168)", () => {
  test("rowId가 있으면 보내는 중 — 도착 이벤트와 짝지을 수 없으면 바로 전달됨", () => {
    expect(sentState({ rowId: 7 })).toBe("sending");
    expect(sentState({})).toBe("delivered");
  });
  test("message-injected의 rowId → 그 워크스페이스 메시지 id", () => {
    const a = { ...msg("나", "a"), id: "a", rowId: 7, workspaceId: "w1" };
    const b = { ...msg("나", "b"), id: "b", rowId: 7, workspaceId: "w2" };
    const c = { ...msg("나", "c"), id: "c" };
    expect(injectedMsgIds([a, b, c], "w1", [7, 8])).toEqual(["a"]);
  });
  test("임무 필터 — 담당 세션이 보냈거나 받은 것 (§4)", () => {
    expect(touchesMission({ from: "kai", to: "@all" }, ["kai"])).toBe(true);
    expect(touchesMission({ from: "나", to: "kai" }, ["kai"])).toBe(true);
    expect(touchesMission({ from: "나", to: "rin" }, ["kai"])).toBe(false);
  });
});

describe("받는 사람 · 사본 (U121 · B210)", () => {
  test("직함 접두 — 띄어쓰기를 빼고 비교, 뒤는 공백이나 끝", () => {
    expect(titlePrefix("클라이언트 개발자 확인 부탁", "클라이언트 개발자")).toBe(9);
    expect(titlePrefix("클라이언트개발자 확인", "클라이언트 개발자")).toBe(8);
    expect(titlePrefix("클라이언트 개발자", "클라이언트개발자")).toBe(9);
    expect(titlePrefix("클라이언트 개발자들 확인", "클라이언트 개발자")).toBe(0);
    expect(titlePrefix("서버 개발자 확인", "클라이언트 개발자")).toBe(0);
    expect(titlePrefix("아무거나", undefined)).toBe(0);
  });
  test("보낸 쪽 사본은 다른 워크스페이스로 보낼 때만", () => {
    expect(crossCopy("B", "lin@B", "A")).toBe("lin@B");
    expect(crossCopy("A", "kai@A", "A")).toBeUndefined();
    expect(crossCopy("B", "lin@B")).toBeUndefined();
    // @all 전달도 사본을 남긴다 (B266) — 그대로 @all이면 보낸 쪽 팀 전체에게 가므로 받는 프로젝트를 붙인다
    expect(crossCopy("B", "@all", "A", "app-b")).toBe("@all@app-b");
    expect(crossCopy("B", "@all", "A")).toBe("@all@B");
  });
});
