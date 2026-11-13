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

test("명령 문자열 — 빈칸 · 따옴표가 든 인자만 감싼다 (Rust command_line과 같다)", async () => {
  const { commandLine } = await import("./git");
  expect(commandLine(["pull", "--ff-only"])).toBe("git pull --ff-only");
  expect(commandLine(["commit", "-m", '고침 "a"'])).toBe('git commit -m "고침 \\"a\\""');
});

test("HEAD 표시 — 같은 브랜치라도 해시가 바뀌면 다른 값이다 (B175)", async () => {
  const { headMark } = await import("./git");
  const refs = (head: string, branch?: string) => ({
    local: branch ? [{ name: branch, hash: head, upstream: "", ahead: 0, behind: 0, gone: false, head: true }] : [],
    remote: [],
    tags: [],
    stashes: [],
    head,
  });
  expect(headMark(refs("1111111111", "main"))).toBe("main 11111111");
  expect(headMark(refs("2222222222", "main"))).not.toBe(headMark(refs("1111111111", "main")));
  expect(headMark(refs("3333333333"))).toBe("33333333"); // 분리 HEAD
  expect(headMark(refs(""))).toBe(""); // 빈 저장소
  expect(headMark(undefined)).toBe("");
});

test("실패 알림 — 진행 머리말이 아니라 원인 줄, 흔한 경우는 할 일을 앞에 (B177)", async () => {
  const { failText } = await import("./git");
  const push = "To C:/r/remote.git\n ! [rejected]        master -> master (fetch first)\nerror: failed to push some refs";
  expect(failText(push)).toContain("Pull 하세요");
  expect(failText(push)).toContain("! [rejected]");
  const pull = "From C:/r/remote\n   0865c8c..53438f3  master -> origin/master\nhint: Diverging branches\nfatal: Not possible to fast-forward, aborting.";
  expect(failText(pull)).toContain("fatal: Not possible to fast-forward");
  expect(failText(pull)).toContain("merge 또는 rebase");
  expect(failText("On branch master\nThe previous cherry-pick is now empty")).toContain("[건너뛰기]");
  expect(failText("Auto-merging a.txt\nCONFLICT (content): Merge conflict in a.txt")).toContain("CONFLICT (content)");
  expect(failText("그냥 한 줄")).toBe("그냥 한 줄");
});

test("사이드 패널의 실패 안내는 git 화면을 가리킨다 — 패널에는 Pull ▾ · 배너가 없다 (U190)", async () => {
  const { failText } = await import("./git");
  const pull = "fatal: Not possible to fast-forward, aborting.";
  expect(failText(pull)).toContain("Pull ▾");
  expect(failText(pull, true)).toContain("git 화면에서 merge 또는 rebase");
  expect(failText(pull, true)).not.toContain("Pull ▾");
  expect(failText("CONFLICT (content): Merge conflict in a.txt", true)).toContain("git 화면 배너");
  expect(failText("The previous cherry-pick is now empty", true)).toContain("git 화면 배너");
});
