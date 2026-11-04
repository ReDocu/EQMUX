import { expect, test, vi } from "vitest";

// missions · team → ui.tsx가 window를 찾는다 — 여기서 보는 것은 순수 변환뿐이다
vi.mock("../components/ui", () => ({ notify: () => {} }));
import { cloneProgressText, cloneStopText, toWorkspace, wsNameAfter } from "./workspaces";

test("이름 바꾸기 — 앞뒤 공백을 떼고, 비우면 폴더 이름으로 돌아간다 (S23)", () => {
  expect(wsNameAfter("  웹 앱 ", "D:\\work\\app")).toBe("웹 앱");
  expect(wsNameAfter(" ", "D:\\work\\app\\")).toBe("app");
  expect(wsNameAfter("", "/Users/me/repo")).toBe("repo");
});

const entry = { id: "w", name: "W", path: "D:/w", remote: null, branch: null, last_used: 0 };

test("폴더는 있고 .git만 없으면 notRepo — 폴더가 없는 것과 가른다 (0.6 QA P80)", () => {
  expect(toWorkspace({ entry, exists: true, is_repo: false })).toMatchObject({ pathMissing: true, notRepo: true });
  expect(toWorkspace({ entry, exists: false, is_repo: false })).toMatchObject({ pathMissing: true, notRepo: false });
  expect(toWorkspace({ entry, exists: true, is_repo: true })).toMatchObject({ pathMissing: false, notRepo: false });
});

test("clone 진행 줄 → 단계 문구 · 퍼센트, 모르는 줄은 원문 (0.6 QA P72)", () => {
  expect(cloneProgressText("Receiving objects:  42% (42/100), 1.2 MiB | 3 MiB/s")).toBe("객체 받는 중 42%");
  expect(cloneProgressText("remote: Compressing objects:  7% (1/14)")).toBe("원격 압축 중 7%");
  expect(cloneProgressText("Cloning into 'repo'...")).toBe("Cloning into 'repo'...");
  expect(cloneProgressText("Weird stage:  5% (1/20)")).toBe("Weird stage:  5% (1/20)");
});

test("취소 · 상한 오류 → 폴더를 지웠는지 말한다, 다른 실패는 undefined (0.6 QA P72)", () => {
  expect(cloneStopText("CLONE_CANCELLED|")).toEqual({ text: "clone을 취소했습니다 — 받다 만 폴더를 지웠습니다", clean: true });
  expect(cloneStopText("CLONE_TIMEOUT|D:/x/repo")).toEqual({
    text: "clone이 60분 안에 끝나지 않아 멈췄습니다 — 받다 만 폴더가 남았습니다 — D:/x/repo",
    clean: false,
  });
  expect(cloneStopText("fatal: repository not found")).toBeUndefined();
});
