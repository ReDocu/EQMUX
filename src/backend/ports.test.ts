// 포트 감시 단위 테스트 (M31) — 순수 부분만 겨눈다.
// netstat 실행과 Job 귀속은 Rust 몫이고(ports.rs 테스트), 여기서는 "그 결과를 화면이 쓰는
// 모양으로 어떻게 접는가"를 본다: 중복 접기 · 대표 호스트 · 기준선 · NEW 창 · 확인 표시.
import { describe, expect, test } from "vitest";
import {
  foldPortRows,
  isExposed,
  isNewPort,
  portAddress,
  portUrl,
  reconcileAcked,
} from "./ports";
import type { PortRow } from "./panels";

const row = (port: number, host: string, pid: number, session: string | null = null, process = "node"): PortRow => ({
  port,
  host,
  pid,
  process,
  session,
});

const NO_PREV = new Map<string, number>();

describe("foldPortRows — 중복 접기", () => {
  test("같은 프로세스가 IPv4·IPv6에 동시에 붙어도 항목은 하나다", () => {
    // Arrange — vite 기본 동작: 127.0.0.1과 [::1]에 같이 리슨한다
    const rows = [row(5173, "127.0.0.1", 4321, "s1"), row(5173, "[::1]", 4321, "s1")];

    // Act
    const out = foldPortRows(rows, NO_PREV, 1_000, true);

    // Assert — 칩이 두 개 뜨면 사용자는 포트가 두 개인 줄 안다
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("4321:5173");
    expect(out[0].hosts).toEqual(["127.0.0.1", "[::1]"]);
  });

  test("같은 포트라도 pid가 다르면 따로 센다 — 충돌은 접으면 안 된다", () => {
    const rows = [row(5173, "127.0.0.1", 1), row(5173, "127.0.0.1", 2)];

    const out = foldPortRows(rows, NO_PREV, 1_000, true);

    expect(out).toHaveLength(2);
  });

  test("대표 호스트는 열기 좋은 쪽 — 순서가 뒤집혀 들어와도 루프백 IPv4가 이긴다", () => {
    const rows = [row(3000, "[::]", 7, "s1"), row(3000, "0.0.0.0", 7, "s1"), row(3000, "127.0.0.1", 7, "s1")];

    const out = foldPortRows(rows, NO_PREV, 1_000, true);

    expect(out[0].host).toBe("127.0.0.1");
    expect(out[0].hosts).toHaveLength(3); // 노출 판정은 접기 전 바인딩 전부를 봐야 한다
  });

  test("귀속은 한 줄에만 실려 와도 살린다", () => {
    const rows = [row(8787, "[::1]", 99, null), row(8787, "127.0.0.1", 99, "s2")];

    const out = foldPortRows(rows, NO_PREV, 1_000, true);

    expect(out[0].session).toBe("s2");
  });
});

describe("foldPortRows — 기준선과 NEW", () => {
  test("첫 스냅숏은 기준선이다 — 앱 켤 때 이미 열려 있던 포트를 NEW로 알리지 않는다", () => {
    const rows = [row(5173, "127.0.0.1", 4321, "s1")];

    const out = foldPortRows(rows, NO_PREV, 1_000, /* baselined */ false);

    expect(out[0].firstSeen).toBe(0);
    expect(isNewPort(out[0])).toBe(false);
  });

  test("기준선 이후 처음 보인 포트는 그 시각을 갖는다", () => {
    const out = foldPortRows([row(5173, "127.0.0.1", 4321, "s1")], NO_PREV, 50_000, true);

    expect(out[0].firstSeen).toBe(50_000);
  });

  test("이미 아는 포트는 최초 관측 시각을 유지한다 — 폴 때마다 새것이 되면 안 된다", () => {
    const prev = new Map([["4321:5173", 10_000]]);

    const out = foldPortRows([row(5173, "127.0.0.1", 4321, "s1")], prev, 90_000, true);

    expect(out[0].firstSeen).toBe(10_000);
  });

  test("새 포트가 목록 맨 위로 온다", () => {
    const prev = new Map([["1:3000", 10_000]]);
    const rows = [row(3000, "127.0.0.1", 1, "s1"), row(5173, "127.0.0.1", 2, "s1")];

    const out = foldPortRows(rows, prev, 90_000, true);

    expect(out.map((e) => e.port)).toEqual([5173, 3000]);
  });

  test("기준선 포트끼리는 포트 번호 오름차순", () => {
    const rows = [row(5173, "127.0.0.1", 2), row(3000, "127.0.0.1", 1)];

    const out = foldPortRows(rows, NO_PREV, 1_000, false);

    expect(out.map((e) => e.port)).toEqual([3000, 5173]);
  });
});

describe("isNewPort — 표시 창", () => {
  const entry = (firstSeen: number) => foldPortRows([row(1, "127.0.0.1", 1)], new Map([["1:1", firstSeen]]), 0, true)[0];

  test("갓 열린 포트는 NEW", () => {
    expect(isNewPort(entry(Date.now()))).toBe(true);
  });

  test("60초가 지나면 스스로 꺼진다 — 되돌리는 코드가 따로 없다", () => {
    expect(isNewPort(entry(Date.now() - 61_000))).toBe(false);
  });

  test("기준선(0)은 절대 NEW가 아니다", () => {
    expect(isNewPort(entry(0))).toBe(false);
  });
});

describe("portAddress · portUrl — 실제로 접속 가능한 주소로 바꾼다", () => {
  test("와일드카드 바인딩은 루프백으로 접는다", () => {
    expect(portAddress({ host: "0.0.0.0", port: 5173 })).toBe("127.0.0.1:5173");
    expect(portAddress({ host: "[::]", port: 5173 })).toBe("[::1]:5173");
  });

  test("IPv6는 대괄호를 지킨다 — URL 문법이 깨지면 웹뷰가 못 연다", () => {
    expect(portUrl({ host: "[::1]", port: 8787 })).toBe("http://[::1]:8787");
  });

  test("구체적인 주소는 그대로 둔다", () => {
    expect(portUrl({ host: "127.0.0.1", port: 3000 })).toBe("http://127.0.0.1:3000");
    expect(portAddress({ host: "192.168.0.10", port: 3000 })).toBe("192.168.0.10:3000");
  });
});

describe("isExposed — 루프백 밖 바인딩", () => {
  test("LAN 주소로 붙은 포트는 노출이다", () => {
    const out = foldPortRows([row(3000, "192.168.0.10", 5, "s1")], NO_PREV, 0, true);
    expect(isExposed(out[0])).toBe(true);
  });

  test("루프백·와일드카드만이면 노출이 아니다", () => {
    const out = foldPortRows([row(3000, "0.0.0.0", 5, "s1"), row(3000, "[::]", 5, "s1")], NO_PREV, 0, true);
    expect(isExposed(out[0])).toBe(false);
  });

  test("접기 전 바인딩 하나라도 루프백 밖이면 노출이다 — 대표 호스트만 보면 놓친다", () => {
    const out = foldPortRows([row(3000, "127.0.0.1", 5, "s1"), row(3000, "10.0.0.5", 5, "s1")], NO_PREV, 0, true);
    expect(out[0].host).toBe("127.0.0.1"); // 대표는 루프백인데
    expect(isExposed(out[0])).toBe(true); // 노출은 잡힌다
  });
});

describe("reconcileAcked — 확인 표시", () => {
  test("기준선 스냅숏은 통째로 확인 처리 — 앱 시작 시 뱃지가 켜지지 않는다", () => {
    const out = reconcileAcked(new Set(), new Set(["a", "b"]), false);
    expect([...out].sort()).toEqual(["a", "b"]);
  });

  test("닫힌 포트의 확인 표시는 버린다 — pid 재사용 시 새 포트가 확인된 것으로 둔갑한다", () => {
    const out = reconcileAcked(new Set(["dead", "alive"]), new Set(["alive"]), true);
    expect([...out]).toEqual(["alive"]);
  });

  test("기준선 이후 새로 나타난 키는 확인되지 않은 채로 남는다 — 이게 뱃지다", () => {
    const out = reconcileAcked(new Set(["old"]), new Set(["old", "fresh"]), true);
    expect(out.has("old")).toBe(true);
    expect(out.has("fresh")).toBe(false);
  });
});
