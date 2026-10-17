import { expect, test } from "vitest";
import { commitWebUrl, remoteWebUrl } from "./git";

test("원격 주소 → 웹 주소 (토큰·포트·.git 제거, 로컬은 없음)", () => {
  const cases: [string | undefined, string | undefined][] = [
    ["git@github.com:acme/eqmux.git", "https://github.com/acme/eqmux"],
    ["git@github.com:acme/eqmux", "https://github.com/acme/eqmux"],
    ["ssh://git@gitlab.example.com:2222/team/app.git", "https://gitlab.example.com/team/app"],
    ["https://user:token@github.com/acme/eqmux.git", "https://github.com/acme/eqmux"],
    ["https://ghp_abc@github.com/acme/eqmux/", "https://github.com/acme/eqmux"],
    ["http://git.local:8080/a/b.git", "https://git.local/a/b"],
    ["git@ssh.dev.azure.com:v3/org/proj/repo", "https://dev.azure.com/org/proj/_git/repo"],
    ["https://org@dev.azure.com/org/proj/_git/repo", "https://dev.azure.com/org/proj/_git/repo"],
    ["D:\repos\shared.git", undefined],
    ["D:/repos/shared.git", undefined],
    ["/srv/git/shared.git", undefined],
    ["file:///srv/git/shared.git", undefined],
    ["", undefined],
    [undefined, undefined],
  ];
  for (const [remote, want] of cases) expect(remoteWebUrl(remote), String(remote)).toBe(want);
});

test("커밋 주소 — GitHub·GitLab·Bitbucket만", () => {
  expect(commitWebUrl("git@github.com:a/b.git", "a1b2c3d")).toBe("https://github.com/a/b/commit/a1b2c3d");
  expect(commitWebUrl("ssh://git@gitlab.example.com:2222/t/app.git", "a1b2c3d")).toBe(
    "https://gitlab.example.com/t/app/commit/a1b2c3d",
  );
  expect(commitWebUrl("git@bitbucket.org:a/b.git", "a1b2c3d")).toBe("https://bitbucket.org/a/b/commits/a1b2c3d");
  expect(commitWebUrl("git@ssh.dev.azure.com:v3/o/p/r", "a1b2c3d")).toBeUndefined();
  expect(commitWebUrl("git@github.com:a/b.git", "not-a-hash")).toBeUndefined();
  expect(commitWebUrl(undefined, "a1b2c3d")).toBeUndefined();
});
