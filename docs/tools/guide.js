(function () {
  // 목차 현재 위치 강조
  var links = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
  var heads = Array.prototype.slice.call(document.querySelectorAll(".doc h2[id], .doc h3[id]"));
  var current = null;
  function setActive(id) {
    if (current === id) return;
    if (current && byId[current]) byId[current].classList.remove("active");
    current = id;
    var a = byId[id];
    if (a) {
      a.classList.add("active");
      var box = a.closest(".toc");
      if (box) {
        var r = a.getBoundingClientRect(), b = box.getBoundingClientRect();
        if (r.top < b.top + 40 || r.bottom > b.bottom - 40) a.scrollIntoView({ block: "center" });
      }
    }
  }
  function update() {
    var top = 52 + 24, pick = heads[0];
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top - top <= 0) pick = heads[i]; else break;
    }
    if (pick) setActive(pick.id);
  }
  var raf = 0;
  window.addEventListener("scroll", function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; update(); }); }, { passive: true });
  update();
})();

function initMermaid() {
  if (!window.mermaid) return;
  var root = document.documentElement;
  var dark = root.getAttribute("data-theme") === "dark" ||
    (root.getAttribute("data-theme") !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  window.mermaid.initialize({
    startOnLoad: false,
    theme: dark ? "dark" : "neutral",
    themeVariables: { fontFamily: '"IBM Plex Sans KR", "Malgun Gothic", sans-serif', fontSize: "13px" },
    flowchart: { htmlLabels: true, curve: "basis" },
    sequence: { useMaxWidth: false },
  });
  window.mermaid.run({ querySelector: "pre.mermaid" });
}
