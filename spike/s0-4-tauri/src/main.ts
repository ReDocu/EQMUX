// S0-4 스파이크 — WebView2 환경 프로브
//
// 확인 대상
//  1. WebView2가 실제로 렌더하는가 (이 페이지가 보이면 통과)
//  2. WebGL1 / WebGL2가 잡히는가 — xterm.js WebGL 애드온의 전제 (S1-3 / R1)
//  3. 렌더러가 실제 GPU인가 SwiftShader(소프트웨어)인가 — 여기가 진짜 관건
//  4. 프런트 → Rust IPC 왕복

import { invoke } from "@tauri-apps/api/core";

type Probe = Record<string, string | number | boolean | null>;

function glInfo(
  prefix: string,
  ctx: WebGLRenderingContext | WebGL2RenderingContext | null,
): Probe {
  if (!ctx) return { [prefix]: false };

  // WEBGL_debug_renderer_info가 막혀 있으면 마스킹된 값이라도 남긴다.
  const dbg = ctx.getExtension("WEBGL_debug_renderer_info");
  const unmaskedRenderer = dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
  const unmaskedVendor = dbg ? ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null;

  return {
    [prefix]: true,
    [`${prefix}.vendor`]: ctx.getParameter(ctx.VENDOR),
    [`${prefix}.renderer`]: ctx.getParameter(ctx.RENDERER),
    [`${prefix}.unmaskedVendor`]: unmaskedVendor,
    [`${prefix}.unmaskedRenderer`]: unmaskedRenderer,
    [`${prefix}.version`]: ctx.getParameter(ctx.VERSION),
    // xterm.js WebGL 애드온은 글리프 아틀라스를 텍스처로 올린다 — 상한이 작으면 문제가 된다.
    [`${prefix}.maxTextureSize`]: ctx.getParameter(ctx.MAX_TEXTURE_SIZE),
  };
}

function collect(): Probe {
  const gl1 = (document.createElement("canvas").getContext("webgl") ??
    document.createElement("canvas").getContext(
      "experimental-webgl",
    )) as WebGLRenderingContext | null;

  // WebGL2는 같은 캔버스에서 다시 못 딴다 — 새 캔버스로 만든다.
  const gl2 = document.createElement("canvas").getContext("webgl2");

  const probe: Probe = {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    screen: `${window.screen.width}x${window.screen.height}`,
    ...glInfo("webgl1", gl1),
    ...glInfo("webgl2", gl2),
  };

  // 소프트웨어 래스터라이저면 WebGL이 "되긴 해도" 성능 목표(p99 16ms)를 못 맞춘다.
  const r = String(probe["webgl2.unmaskedRenderer"] ?? probe["webgl1.unmaskedRenderer"] ?? "");
  probe.softwareRasterizer = /swiftshader|software|llvmpipe|basic render/i.test(r);

  return probe;
}

function render(probe: Probe) {
  const table = document.querySelector<HTMLTableElement>("#probe")!;
  table.innerHTML = Object.entries(probe)
    .map(([k, v]) => {
      const missingGl = (k === "webgl1" || k === "webgl2") && v === false;
      const soft = k === "softwareRasterizer" && v === true;
      const cls = missingGl || soft ? ' class="bad"' : "";
      return `<tr${cls}><th>${k}</th><td>${v === null ? "—" : String(v)}</td></tr>`;
    })
    .join("");
}

window.addEventListener("DOMContentLoaded", async () => {
  const probe = collect();
  render(probe);
  console.log("[spike] probe", probe);

  const el = document.querySelector<HTMLElement>("#saved")!;
  try {
    const path = await invoke<string>("save_probe", {
      json: JSON.stringify(probe, null, 2),
    });
    el.textContent = `IPC 왕복 OK — ${path}`;
  } catch (e) {
    el.textContent = `IPC 실패: ${e}`;
    el.classList.add("bad");
  }
});
