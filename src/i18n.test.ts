import { describe, expect, test } from "vitest";
import { dict as common } from "./i18n/common";
import { dict as settingsDict } from "./i18n/settings";
import { dict as control } from "./i18n/control";
import { dict as git } from "./i18n/git";
import { dict as roles } from "./i18n/roles";
import { dict as missions } from "./i18n/missions";
import { dict as session } from "./i18n/session";
import { dict as shell } from "./i18n/shell";
import { dict as panels } from "./i18n/panels";

// 사전은 Object.assign으로 합쳐서 같은 키는 뒤 사전이 말없이 이긴다 (B80) — 세션 상세의 '실행' 묶음
// 제목이 사이드 패널의 'Run'으로 나왔다. 같은 원문을 두 사전에 두려면 번역도 같아야 한다
describe("i18n 사전", () => {
  test("같은 원문 키는 사전이 달라도 번역이 같다", () => {
    const dicts = { common, settingsDict, control, git, roles, missions, session, shell, panels };
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
