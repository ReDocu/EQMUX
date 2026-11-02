import { expect, test, vi } from "vitest";

// missions · team → ui.tsx가 window를 찾는다 — 여기서 보는 것은 순수 변환뿐이다
vi.mock("../components/ui", () => ({ notify: () => {} }));
import { toWorkspace } from "./workspaces";

const entry = { id: "w", name: "W", path: "D:/w", remote: null, branch: null, last_used: 0 };

test("폴더는 있고 .git만 없으면 notRepo — 폴더가 없는 것과 가른다 (0.6 QA P80)", () => {
  expect(toWorkspace({ entry, exists: true, is_repo: false })).toMatchObject({ pathMissing: true, notRepo: true });
  expect(toWorkspace({ entry, exists: false, is_repo: false })).toMatchObject({ pathMissing: true, notRepo: false });
  expect(toWorkspace({ entry, exists: true, is_repo: true })).toMatchObject({ pathMissing: false, notRepo: false });
});
