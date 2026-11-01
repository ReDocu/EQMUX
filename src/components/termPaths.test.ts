import { describe, expect, test } from "vitest";
import { findPathLinks, pathChunkAt } from "./termPaths";

describe("경로 링크 (M30·B129)", () => {
  test("Windows 드라이브 문자·UNC·따옴표 경로는 그대로 잡는다", () => {
    expect(findPathLinks(String.raw`saved C:\Users\me\a.png ok`)).toEqual([{ text: String.raw`C:\Users\me\a.png`, begin: 6 }]);
    expect(findPathLinks(String.raw`"C:\Program Files\x.txt"`)).toEqual([{ text: String.raw`C:\Program Files\x.txt`, begin: 1 }]);
    expect(findPathLinks(String.raw`\\srv\share\f`)[0].text).toBe(String.raw`\\srv\share\f`);
  });
  test("macOS 절대 경로·홈 경로·붙여넣은 이미지 경로도 링크다", () => {
    expect(findPathLinks("open /Users/me/repo/package.json now")).toEqual([{ text: "/Users/me/repo/package.json", begin: 5 }]);
    expect(findPathLinks("~/.eqmux/logs/a.log")).toEqual([{ text: "~/.eqmux/logs/a.log", begin: 0 }]);
    expect(findPathLinks('"/var/folders/x/T/eqmux-pastes/paste-1.png" ')).toEqual([
      { text: "/var/folders/x/T/eqmux-pastes/paste-1.png", begin: 1 },
    ]);
    expect(findPathLinks('"/Users/me/My Folder/a.txt"')[0].text).toBe("/Users/me/My Folder/a.txt");
    expect(findPathLinks("(see /tmp/x.log)")[0]).toEqual({ text: "/tmp/x.log)", begin: 5 });
    // GR 실기 14번 — 프롬프트·작은따옴표·`키:값` 뒤의 홈 경로도 링크다
    expect(findPathLinks("me@mac ~/Desktop/repo % ls")[0]).toEqual({ text: "~/Desktop/repo", begin: 7 });
    expect(findPathLinks("cat '~/a/b.txt'")[0]).toEqual({ text: "~/a/b.txt", begin: 5 });
    expect(findPathLinks("log:~/.eqmux/logs/x.log")[0]).toEqual({ text: "~/.eqmux/logs/x.log", begin: 4 });
  });
  test("URL·분수·낱말 속 슬래시·// 주석은 경로로 잡지 않는다", () => {
    expect(findPathLinks("https://example.com/a/b")).toEqual([]);
    expect(findPathLinks("1/2 and/or a/b")).toEqual([]);
    expect(findPathLinks("  // comment here")).toEqual([]);
  });
});

describe("더블클릭 경로 덩어리 (M30·B129)", () => {
  test("공백 있는 POSIX 절대 경로는 / 부터 통째로 잡는다", () => {
    const line = "ls /Users/me/My Folder/a.txt";
    expect(pathChunkAt(line, line.indexOf("Folder"))).toBe("/Users/me/My Folder/a.txt");
  });
  test("드라이브 문자 경로는 지금처럼 잡는다", () => {
    const line = String.raw`C:\Program Files\Git\bin`;
    expect(pathChunkAt(line, line.indexOf("Git"))).toBe(line);
  });
  test("상대 경로는 공백으로 끊은 낱말 하나다", () => {
    const line = "edit src/app.ts please";
    expect(pathChunkAt(line, line.indexOf("app"))).toBe("src/app.ts");
  });
});
