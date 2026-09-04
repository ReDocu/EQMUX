// 진단 드리프트 판정 테스트 — 이 계산이 틀리면 로그가 거짓말을 한다.
// 없는 어긋남을 신고하면 엉뚱한 원인을 쫓게 되고, 있는 어긋남을 놓치면 계측을 넣은 의미가 없다.
import { describe, expect, test } from "vitest";
import { computeDrift } from "./diag";
import type { DiagGeometry, DiagRect } from "./diag";

const geo = (over: Partial<DiagGeometry>): DiagGeometry => ({
  scaleFactor: 1,
  windowOuter: { x: 0, y: 0, w: 1600, h: 900 },
  windowInner: { x: 0, y: 0, w: 1600, h: 900 },
  monitorName: "\\\\.\\DISPLAY1",
  monitorScale: 1,
  monitor: { x: 0, y: 0, w: 1920, h: 1080 },
  browser: null,
  ...over,
});

/** 패널이 실제로 앉는 자리 — 오른쪽 사이드 패널 */
const PANEL: DiagRect = { x: 600, y: 100, w: 400, h: 600 };

describe("computeDrift — 정상", () => {
  test("자식 웹뷰 좌표가 창 상대이고 정확하면 어긋남이 없다", () => {
    const g = geo({ browser: { x: 600, y: 100, w: 400, h: 600 } });

    const d = computeDrift(PANEL, g)!;

    expect(d.rel).toBe(0);
    expect(d.off).toBe(0);
    expect(d.size).toBe(0);
  });

  test("좌표 기준이 화면 절대여도 어긋남으로 보지 않는다 — 기준을 모르는 채로도 옳아야 한다", () => {
    // 창이 화면 (200, 50)에 있고 웹뷰 좌표가 화면 절대라면 실제값은 그만큼 밀려 온다
    const g = geo({
      windowInner: { x: 200, y: 50, w: 1600, h: 900 },
      browser: { x: 800, y: 150, w: 400, h: 600 },
    });

    const d = computeDrift(PANEL, g)!;

    expect(d.rel).toBe(200); // 창 상대로 읽으면 어긋나 보이지만
    expect(d.abs).toBe(0); // 화면 절대로 읽으면 정확하다
    expect(d.off).toBe(0); // 가까운 쪽을 택하므로 오탐이 아니다
  });

  test("배율 1.5에서 논리→물리 변환이 맞으면 어긋남이 없다", () => {
    const g = geo({
      scaleFactor: 1.5,
      browser: { x: 900, y: 150, w: 600, h: 900 },
    });

    const d = computeDrift(PANEL, g)!;

    expect(d.off).toBe(0);
    expect(d.size).toBe(0);
  });
});

describe("computeDrift — 후보 1이 실제로 일어난 순간", () => {
  test("배율이 다른 모니터로 옮겨졌는데 좌표를 다시 안 보냈으면 크게 어긋난다", () => {
    // 배율 1.0일 때 놓은 물리 좌표(600,100)가 그대로 남아 있는데 배율만 1.5가 됐다.
    // ResizeObserver는 CSS 크기만 보므로 프런트는 이 순간을 모른다 — 그래서 계측이 필요하다
    const g = geo({
      scaleFactor: 1.5,
      browser: { x: 600, y: 100, w: 400, h: 600 },
    });

    const d = computeDrift(PANEL, g)!;

    expect(d.off).toBe(300); // 기대 물리 900 vs 실제 600
    expect(d.size).toBe(300); // 크기도 같이 어긋난다 — 덮는 넓이가 달라진다
  });

  test("좌표는 맞는데 크기만 낡았으면 그것도 잡는다", () => {
    // 패널이 좁아졌는데 웹뷰가 옛 너비를 들고 있으면 옆 UI를 덮는다
    const g = geo({ browser: { x: 600, y: 100, w: 700, h: 600 } });

    const d = computeDrift(PANEL, g)!;

    expect(d.off).toBe(0);
    expect(d.size).toBe(300);
  });

  test("창을 옮겼는데 웹뷰가 옛 화면 좌표에 남아 있으면 잡힌다", () => {
    const g = geo({
      windowInner: { x: 900, y: 300, w: 1600, h: 900 },
      browser: { x: 800, y: 150, w: 400, h: 600 }, // 옛 창 위치(200,50) 기준의 절대 좌표
    });

    const d = computeDrift(PANEL, g)!;

    expect(d.off).toBe(200); // 창 상대(200) vs 화면 절대(700) 중 가까운 쪽
  });
});

describe("computeDrift — 경계", () => {
  test("브라우저 패널을 안 열었으면 판정하지 않는다", () => {
    expect(computeDrift(PANEL, geo({ browser: null }))).toBeUndefined();
  });

  test("배율이 0으로 와도 1로 보고 계산한다 — 진단이 0으로 나누고 죽으면 안 된다", () => {
    const g = geo({ scaleFactor: 0, browser: { x: 600, y: 100, w: 400, h: 600 } });

    expect(computeDrift(PANEL, g)!.off).toBe(0);
  });

  test("반올림 오차 1px은 어긋남으로 치지 않을 만큼 작게 나온다", () => {
    const g = geo({ browser: { x: 601, y: 100, w: 400, h: 600 } });

    expect(computeDrift(PANEL, g)!.off).toBe(1); // 임계값 3px 아래
  });
});
