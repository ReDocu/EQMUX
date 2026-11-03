import { describe, expect, test } from "vitest";
import { josa, tErr, tf } from "./i18n";
import { dict as common } from "./i18n/common";
import { dict as settingsDict } from "./i18n/settings";
import { dict as control } from "./i18n/control";
import { dict as git } from "./i18n/git";
import { dict as roles } from "./i18n/roles";
import { dict as missions } from "./i18n/missions";
import { dict as session } from "./i18n/session";
import { dict as shell } from "./i18n/shell";
import { dict as panels } from "./i18n/panels";
import { dict as extensions } from "./i18n/extensions";

// 사전은 Object.assign으로 합쳐서 같은 키는 뒤 사전이 말없이 이긴다 (B80) — 세션 상세의 '실행' 묶음
// 제목이 사이드 패널의 'Run'으로 나왔다. 같은 원문을 두 사전에 두려면 번역도 같아야 한다
describe("i18n 사전", () => {
  test("같은 원문 키는 사전이 달라도 번역이 같다", () => {
    const dicts = { common, settingsDict, control, git, roles, missions, session, shell, panels, extensions };
    const seen = new Map<string, { from: string; en: string }>();
    const clashes: string[] = [];
    for (const [name, d] of Object.entries(dicts)) {
      for (const [ko, en] of Object.entries(d)) {
        const prev = seen.get(ko);
        if (prev && prev.en !== en) clashes.push(`${ko}: ${prev.from}="${prev.en}" vs ${name}="${en}"`);
        else seen.set(ko, { from: name, en });
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe("josa (U176)", () => {
  test("받침으로 을/를 · 이/가를 고른다", () => {
    expect(josa("기능", "을(를)")).toBe("을");
    expect(josa("기록", "이(가)")).toBe("이");
    expect(josa("파이프", "을(를)")).toBe("를");
    expect(josa("A", "을(를)")).toBe("를");
    expect(josa("feature", "을(를)")).toBe("를");
    expect(josa("main", "을(를)")).toBe("을");
    expect(josa("R", "이(가)")).toBe("이");
    expect(josa("commands.json", "을(를)")).toBe("을");
    expect(josa("stash@{0}", "이(가)")).toBe("이");
    expect(josa("v2", "을(를)")).toBe("를");
    expect(josa("日本", "을(를)")).toBe("을(를)");
    expect(josa("", "은(는)")).toBe("은(는)");
    expect(josa("책", "와(과)")).toBe("과"); // 와(과)는 받침 쪽이 뒤
    expect(josa("나무", "와(과)")).toBe("와");
  });

  test("tf가 자리표시자 뒤 조사를 고른다", () => {
    expect(tf("{k}을(를) 저장했습니다", { k: "A" })).toBe("A를 저장했습니다");
    expect(tf("{b}을(를) 현재 브랜치로 merge", { b: "main" })).toBe("main을 현재 브랜치로 merge");
    expect(tf("{names}이(가) {path}을(를) 동시에 편집 중", { names: "셸1 · 셸2", path: "a.ts" })).toBe("셸1 · 셸2가 a.ts를 동시에 편집 중");
    // 조사를 박아 두던 문장들 (U176 남은 것)
    expect(tf("에이전트 없음 — PATH에 {cmd}이(가) 없어 기동할 수 없습니다", { cmd: "codex" })).toBe("에이전트 없음 — PATH에 codex가 없어 기동할 수 없습니다");
    expect(tf("{u}와(과) 갈라짐", { u: "origin/main" })).toBe("origin/main과 갈라짐");
    expect(tf("오늘 비용이 예산 ${budget}을(를) 넘었습니다", { budget: 10 })).toBe("오늘 비용이 예산 $10을 넘었습니다");
  });
});

// format!으로 만든 Rust 오류도 사전의 {자리표시} 틀로 번역한다 (U125)
describe("tErr (U125)", () => {
  const d = {
    "에이전트를 띄우지 못했습니다 — {err}": "Couldn't start the agent — {err}",
    "작업 폴더가 없습니다: {cwd} — 폴더를 되돌리거나 세션을 다시 만드세요": "Working folder not found: {cwd} — restore it or recreate the session",
    "git 저장소가 아닙니다": "Not a git repository",
    "{name} · {n}": "{name} · {n}", // 한글 낱말이 없는 틀은 쓰지 않는다
  };
  test("통째 키 · 틀 · 끼인 값까지 푼다", () => {
    expect(tErr("git 저장소가 아닙니다", d)).toBe("Not a git repository");
    expect(tErr("에이전트를 띄우지 못했습니다 — 작업 폴더가 없습니다: D:\w (x) — 폴더를 되돌리거나 세션을 다시 만드세요", d)).toBe(
      "Couldn't start the agent — Working folder not found: D:\w (x) — restore it or recreate the session",
    );
  });
  test("못 맞추면 원문 · 한국어 모드면 그대로", () => {
    expect(tErr("모르는 오류 · 3", d)).toBe("모르는 오류 · 3");
    expect(tErr(new Error("boom"), d)).toBe("Error: boom");
    expect(tErr("git 저장소가 아닙니다", undefined)).toBe("git 저장소가 아닙니다");
  });
  test("실제 사전의 Rust 오류 틀이 맞는다", () => {
    expect(tErr("허용하지 않는 git 명령: rm", { ...git })).toBe("git command not allowed: rm");
    expect(tErr("실행 실패 — \"claude\": not found", { ...control })).toBe('Failed to start — "claude": not found');
  });
});
