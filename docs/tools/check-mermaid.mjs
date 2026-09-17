// 사용: 저장소 루트에서  npm i --no-save mermaid jsdom && node docs/tools/check-mermaid.mjs
// technical-guide.md 안의 모든 ```mermaid 블록을 실제 mermaid 파서로 검증한다.
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try { Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true }); } catch {}
globalThis.DOMPurify = undefined;
globalThis.SVGElement = dom.window.SVGElement;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;

const mermaid = (await import("mermaid")).default;
mermaid.initialize({ startOnLoad: false });

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const md = readFileSync(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "technical-guide.md"), "utf8");
const re = /```mermaid\n([\s\S]*?)```/g;
let m, i = 0, bad = 0;
while ((m = re.exec(md))) {
  i++;
  const src = m[1];
  const line = md.slice(0, m.index).split("\n").length;
  try {
    const r = await mermaid.parse(src);
    console.log(`#${i} line ${line} OK (${r?.diagramType ?? "?"})`);
  } catch (e) {
    bad++;
    console.log(`#${i} line ${line} FAIL: ${String(e.message ?? e).split("\n").slice(0, 4).join(" | ")}`);
  }
}
console.log(`${i} diagrams, ${bad} failed`);
process.exit(bad ? 1 : 0);
