// S1-1 — 프런트↔Rust 왕복 확인.
//
// 이 화면의 목적은 하나다: IPC 경로가 살아 있다는 것을 눈으로 확인한다.
// 터미널 UI는 S1-3(렌더러) 이후에 이 자리를 대체한다.

import { invoke } from "@tauri-apps/api/core";

interface Paths {
  state_file: string;
  workspace_root: string;
  webview_data_dir: string | null;
  isolated: boolean;
}

interface AppInfo {
  name: string;
  version: string;
  paths: Paths;
}

function row(k: string, v: string): string {
  return `<tr><th>${k}</th><td>${v}</td></tr>`;
}

async function main(): Promise<void> {
  const infoEl = document.querySelector<HTMLTableElement>("#info")!;
  const rtEl = document.querySelector<HTMLElement>("#roundtrip")!;
  const verEl = document.querySelector<HTMLElement>("#ver")!;
  const modeEl = document.querySelector<HTMLElement>("#mode")!;

  try {
    const info = await invoke<AppInfo>("app_info");

    verEl.textContent = `v${info.version}`;
    modeEl.textContent = info.paths.isolated ? "격리 인스턴스" : "일반 인스턴스";
    modeEl.classList.add(info.paths.isolated ? "isolated" : "normal");

    infoEl.innerHTML = [
      row("state_file", info.paths.state_file),
      row("workspace_root", info.paths.workspace_root),
      row("webview_data_dir", info.paths.webview_data_dir ?? "(Tauri 기본값)"),
    ].join("");

    // 왕복 지연을 눈으로 본다. 정밀 계측은 S1-3의 --latency-probe가 맡는다.
    const t0 = performance.now();
    const sent = "왕복 확인";
    const got = await invoke<string>("echo", { value: sent });
    const ms = performance.now() - t0;

    if (got === sent) {
      rtEl.textContent = `왕복 OK — app_info + echo, ${ms.toFixed(2)} ms`;
      rtEl.classList.add("ok");
    } else {
      rtEl.textContent = `왕복 값 불일치: 보냄 "${sent}" / 받음 "${got}"`;
      rtEl.classList.add("bad");
    }
  } catch (e) {
    rtEl.textContent = `왕복 실패: ${e}`;
    rtEl.classList.add("bad");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  void main();
});
