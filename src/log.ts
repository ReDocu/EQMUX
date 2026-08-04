// 프런트 로그를 프로세스 stderr로 보낸다.
//
// 웹뷰 콘솔은 창을 열고 F12를 눌러야 보인다.
// 무인 실행(--latency-probe-run, CI)에서 프런트가 죽으면 아무 흔적도 남지 않는다.
// 여기서 실제로 한 번 눈이 멀어 원인을 못 찾았다 — 그래서 이 파일이 있다.

import { invoke } from "@tauri-apps/api/core";

type Level = "info" | "warn" | "error";

function send(level: Level, msg: string): void {
  // 로그가 실패해도 앱을 죽이지 않는다.
  void invoke("log_front", { level, msg }).catch(() => undefined);
}

export function logInfo(msg: string): void {
  console.log(msg);
  send("info", msg);
}

export function logWarn(msg: string): void {
  console.warn(msg);
  send("warn", msg);
}

export function logError(msg: string, e?: unknown): void {
  const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : e !== undefined ? String(e) : "";
  console.error(msg, e);
  send("error", detail ? `${msg} :: ${detail}` : msg);
}

/** 잡히지 않은 예외·거부를 전부 stderr로 끌어낸다. 최대한 이른 시점에 부른다. */
export function installGlobalHandlers(): void {
  window.addEventListener("error", (ev) => {
    logError("uncaught", ev.error ?? ev.message);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    logError("unhandledrejection", ev.reason);
  });
}
