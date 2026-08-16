// Git Diff (AXXhV) — 변경 파일 트리 사이드바 + 나란히 비교. 두 모드가 있다 (UI 리파인 §git):
// · 워크트리 모드(기본) — HEAD ↔ 워크트리
// · 커밋 모드(props.commit) — 부모 커밋 ↔ 이 커밋 (git 패널의 커밋 행 클릭이 연다)
// 양측 행은 1:1 정렬돼 있고(B8 — pad 필러) 세로·가로 스크롤이 동기화된다.
// 변경 내비게이션(U10): n/p 점프 · 스크롤바 마커 · ±3줄 문맥 접기 · ↑↓ 파일 이동.
// Tauri에서는 실측 (PRD H) · 읽기 전용이다 — 스테이지·커밋·편집은 터미널에서 사람이 한다
// (다른 패널과 같은 원칙). 브라우저 dev에서는 기존 목 데이터를 보여준다.
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import { commitChangedFiles, commitFileDiff, diffChangedFiles, diffFile, gitOverview } from "../backend/git";
import type { ChangedFile, DiffLine, FileDiff } from "../backend/git";
import { backend, DIFF_BRANCH, DIFF_CONTENT, DIFF_FILES, GIT_STATE } from "../backend/mock";
import { isTauri } from "../backend/pty";
import { t, tf } from "../i18n";
import { openPanel, scopeWorkspace, setView, tick, view } from "../state";

const FOLD_CONTEXT = 3; // 변경 주변에 남기는 문맥 줄 수 (U10)

type DispRow = { type: "line"; i: number } | { type: "fold"; start: number; end: number };

export function GitDiffEditor(props: { wsId?: string; commit?: { hash: string; message: string } }) {
  // 커밋 모드 (UI 리파인 §git) — 있으면 부모 커밋 ↔ 이 커밋, 없으면 HEAD ↔ 워크트리
  const commit = () => props.commit;
  // wsId 지정(진입점이 안다)이 우선, 없으면 현재 워크스페이스 문맥 (단일 소스 — 임의 폴백 없음)
  const ws = () => {
    tick();
    const byProp = props.wsId ? backend.listWorkspaces().find((w) => w.id === props.wsId) : undefined;
    if (byProp) return byProp;
    const scoped = scopeWorkspace();
    return scoped && !scoped.pathMissing ? scoped : undefined;
  };

  const [files, setFiles] = createSignal<ChangedFile[]>(
    isTauri() ? [] : DIFF_FILES.map((f) => ({ status: f.status, path: f.path, stat: f.stat })),
  );
  const [selected, setSelected] = createSignal<string | undefined>(undefined);
  const [query, setQuery] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal<"A" | "M" | "D" | "R" | undefined>(undefined); // U12
  const [real, setReal] = createSignal<FileDiff | undefined>(undefined);
  const [diffErr, setDiffErr] = createSignal<string | undefined>(undefined);
  const [filesErr, setFilesErr] = createSignal(false); // 목록 읽기 실패 ≠ 깨끗한 워크트리 (B9)
  const [diffLoading, setDiffLoading] = createSignal(false); // 읽는 중 ≠ 내용 없음 (B10)
  const [branch, setBranch] = createSignal<string>(isTauri() ? "—" : DIFF_BRANCH.name);
  const [sync, setSync] = createSignal<{ ahead: number; behind: number }>(
    isTauri() ? { ahead: 0, behind: 0 } : { ahead: DIFF_BRANCH.ahead, behind: DIFF_BRANCH.behind },
  );
  const [blockIdx, setBlockIdx] = createSignal(-1); // 현재 변경 블록 (U10)
  const [foldCtx, setFoldCtx] = createSignal(true); // 기본은 ±3줄 문맥만 — 전체 문맥은 토글 (U10)
  const [expandedFolds, setExpandedFolds] = createSignal<number[]>([]);
  const [wrap, setWrap] = createSignal(false); // 줄바꿈 토글 (U13)

  /** 파일 선택 — 내비게이션·접기 상태는 파일별이므로 함께 초기화한다 */
  const selectFile = (path: string | undefined) => {
    setSelected(path);
    setBlockIdx(-1);
    setExpandedFolds([]);
  };

  let filesReq = 0; // 워크스페이스·커밋 전환 시 이전 대상의 늦은 응답이 새 목록·브랜치를 덮지 않게
  const loadFiles = async () => {
    const target = ws();
    if (!isTauri() || !target) return;
    const req = ++filesReq;
    const c = commit();
    const result = c ? await commitChangedFiles(target.path, c.hash) : await diffChangedFiles(target.path);
    if (req !== filesReq) return; // 그새 대상이 바뀌었다 — 이 응답은 버린다
    setFilesErr(result === undefined); // 실패(비 저장소·git 없음)를 빈 목록과 구분한다 (B9)
    const list = result ?? [];
    setFiles(list);
    // 파일이 바뀌지 않아 selectFile이 안 불려도 새 대상에선 diff를 다시 읽는다
    if (!selected() || !list.some((f) => f.path === selected())) {
      selectFile(list[0]?.path);
    } else {
      void loadDiff();
    }
    if (c) return; // 커밋 모드에는 브랜치·동기화 줄이 없다 — 커밋 자체가 문맥이다
    void gitOverview(target.path).then((o) => {
      if (req !== filesReq) return;
      if (o) {
        setBranch(o.branch);
        setSync({ ahead: o.ahead, behind: o.behind });
      }
    });
  };

  let diffReq = 0; // 빠른 파일 전환 시 뒤늦은 응답이 최신 선택을 덮지 않게 하는 토큰
  const loadDiff = async () => {
    const target = ws();
    const path = selected();
    setReal(undefined);
    setDiffErr(undefined);
    if (!isTauri() || !target || !path) return;
    const req = ++diffReq;
    setDiffLoading(true);
    const c = commit();
    const d = c ? await commitFileDiff(target.path, c.hash, path) : await diffFile(target.path, path);
    if (req !== diffReq) return;
    setDiffLoading(false);
    if (typeof d === "string") setDiffErr(d);
    else setReal(d);
  };

  onMount(() => {
    if (!isTauri()) {
      selectFile(DIFF_FILES[0]?.path);
      return;
    }
    // 커밋 전환도 재로드 대상이다 — 같은 화면에서 다른 커밋 diff로 옮겨갈 수 있다 (UI 리파인 §git)
    createEffect(on(() => [ws()?.id, commit()?.hash] as const, () => void loadFiles()));
    createEffect(on(selected, () => void loadDiff()));
  });

  // 새로 읽기 — 무반응을 두지 않는다 (B12): 목 모드는 사유를 말하고, 실모드는 진행을 보인다
  const [refreshing, setRefreshing] = createSignal(false);
  const [refreshNote, setRefreshNote] = createSignal<string | undefined>(undefined);
  const refresh = async () => {
    if (!isTauri()) {
      setRefreshNote(t("목 데이터 — 실측 없음"));
      setTimeout(() => setRefreshNote(undefined), 1800);
      return;
    }
    setRefreshing(true);
    await loadFiles();
    setRefreshing(false);
  };

  // 필터 — 대소문자 무시 + 상태(A/M/D) 칩 (U12). 경로 정렬 — 트리 표시·↑↓ 이동 순서가 일치한다
  const filtered = () => {
    const q = query().trim().toLowerCase();
    return files()
      .filter((f) => (!q || f.path.toLowerCase().includes(q)) && (!statusFilter() || f.status === statusFilter()))
      .sort((a, b) => a.path.localeCompare(b.path));
  };
  const stat = () => files().find((f) => f.path === selected())?.stat ?? "";

  // 디렉터리 트리 행 (UI 리파인 §git) — 정렬된 목록에서 직전 항목과의 공통 접두 이후만 디렉터리 행으로 낸다
  type TreeRow = { type: "dir"; name: string; depth: number } | { type: "file"; f: ChangedFile; name: string; depth: number };
  const treeRows = createMemo<TreeRow[]>(() => {
    const rows: TreeRow[] = [];
    let prev: string[] = [];
    for (const f of filtered()) {
      const parts = f.path.split("/");
      const dirs = parts.slice(0, -1);
      let i = 0;
      while (i < dirs.length && i < prev.length && dirs[i] === prev[i]) i++;
      for (; i < dirs.length; i++) rows.push({ type: "dir", name: `${dirs[i]}/`, depth: i });
      rows.push({ type: "file", f, name: parts[parts.length - 1], depth: dirs.length });
      prev = dirs;
    }
    return rows;
  });

  /** 파일 목록 ↑↓ 이동 (U10) — 필터된 목록 안에서 순환 */
  const moveFile = (dir: 1 | -1) => {
    const list = filtered();
    if (!list.length) return;
    const idx = list.findIndex((f) => f.path === selected());
    selectFile(list[(idx + dir + list.length) % list.length]?.path ?? list[0].path);
  };

  // 목 폴백 라인 (브라우저 dev) — 모든 변경 파일이 파일별 내용을 갖는다 (B5)
  const mockDiff = () => (selected() ? DIFF_CONTENT[selected()!] : undefined);
  const baseLines = (): DiffLine[] => (isTauri() ? (real()?.base ?? []) : (mockDiff()?.base ?? []));
  const curLines = (): DiffLine[] => (isTauri() ? (real()?.current ?? []) : (mockDiff()?.current ?? []));
  // BASE = HEAD 짧은 해시 — 목에서는 커밋 그래프 최상단에서 파생해 화면 간 해시가 일치한다 (B13)
  const baseLabel = () => (isTauri() ? (real()?.baseLabel ?? "HEAD") : GIT_STATE.commits[0].hash);

  const rowCount = () => Math.max(baseLines().length, curLines().length);
  const isChanged = (i: number) => !!(baseLines()[i]?.kind || curLines()[i]?.kind);

  /** 연속한 변경 행 묶음 — 점프·마커의 단위 (U10) */
  const changeBlocks = createMemo(() => {
    const blocks: { start: number; end: number }[] = [];
    let open = false;
    for (let i = 0; i < rowCount(); i++) {
      if (isChanged(i)) {
        if (open) blocks[blocks.length - 1].end = i;
        else blocks.push({ start: i, end: i });
        open = true;
      } else open = false;
    }
    return blocks;
  });

  /** 표시 행 — 접기 모드에서는 변경 ±3줄 밖의 ctx 런을 fold 행 하나로 접는다 (U10) */
  const display = createMemo<{ rows: DispRow[]; pos: Map<number, number> }>(() => {
    const n = rowCount();
    const rows: DispRow[] = [];
    const pos = new Map<number, number>();
    const push = (i: number) => {
      pos.set(i, rows.length);
      rows.push({ type: "line", i });
    };
    if (!foldCtx()) {
      for (let i = 0; i < n; i++) push(i);
      return { rows, pos };
    }
    const keep = new Array<boolean>(n).fill(false);
    for (const b of changeBlocks()) {
      for (let j = Math.max(0, b.start - FOLD_CONTEXT); j <= Math.min(n - 1, b.end + FOLD_CONTEXT); j++) keep[j] = true;
    }
    let i = 0;
    while (i < n) {
      if (keep[i]) {
        push(i);
        i++;
        continue;
      }
      let j = i;
      while (j < n && !keep[j]) j++;
      // 두 줄 미만 접기는 접는 값이 없다 — 그대로 보여준다
      if (expandedFolds().includes(i) || j - i < 2) {
        for (let k = i; k < j; k++) push(k);
      } else {
        rows.push({ type: "fold", start: i, end: j - 1 });
      }
      i = j;
    }
    return { rows, pos };
  });

  // 양 페인 스크롤 동기화 (B8·U13) — 행이 1:1 정렬돼 있으므로 세로·가로 모두 그대로 미러링한다
  let baseEl: HTMLDivElement | undefined;
  let curEl: HTMLDivElement | undefined;
  let syncing = false;
  const mirror = (from?: HTMLDivElement, to?: HTMLDivElement) => {
    if (!from || !to || syncing) return;
    syncing = true;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => (syncing = false));
  };

  /** idx번째 변경 블록으로 점프 (U10) — 순환하며, 화면 위 1/3 지점에 놓는다 */
  const jumpTo = (idx: number) => {
    const blocks = changeBlocks();
    if (!blocks.length) return;
    const i = ((idx % blocks.length) + blocks.length) % blocks.length;
    setBlockIdx(i);
    const host = curLines().length ? curEl : baseEl;
    const row = host?.querySelector<HTMLElement>(`.gde-line[data-row="${blocks[i].start}"]`);
    if (host && row) {
      host.scrollTop = Math.max(0, row.offsetTop - host.clientHeight / 3);
      mirror(host, host === curEl ? baseEl : curEl);
    }
  };

  /** 짝지어진 del↔add 행에서 공통 접두·접미를 제외한 실제 변경 구간을 강조한다 (U13) */
  const intraSpans = (text: string, other?: string): JSX.Element => {
    if (other === undefined) return text;
    const max = Math.min(text.length, other.length);
    let p = 0;
    while (p < max && text[p] === other[p]) p++;
    let s = 0;
    while (s < max - p && text[text.length - 1 - s] === other[other.length - 1 - s]) s++;
    const mid = text.slice(p, text.length - s);
    if (!mid || mid === text) return text;
    return (
      <>
        {text.slice(0, p)}
        <span class="gde-hl">{mid}</span>
        {text.slice(text.length - s)}
      </>
    );
  };

  /** 반대편에서 같은 행에 짝지어진 텍스트 — del↔add 쌍일 때만 */
  const pairText = (i: number, mine: "del" | "add") => {
    const other = (mine === "del" ? curLines() : baseLines())[i];
    return other && other.kind === (mine === "del" ? "add" : "del") ? other.text : undefined;
  };

  // 줄바꿈 모드 (U13) — 좌우 행 높이를 짝의 최대값으로 맞춰 정렬(B8)이 깨지지 않게 한다
  const equalize = () => {
    if (!baseEl || !curEl) return;
    const a = baseEl.querySelectorAll<HTMLElement>(".gde-line");
    const b = curEl.querySelectorAll<HTMLElement>(".gde-line");
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      a[i].style.minHeight = "";
      b[i].style.minHeight = "";
    }
    if (!wrap()) return;
    for (let i = 0; i < n; i++) {
      const h = Math.max(a[i].getBoundingClientRect().height, b[i].getBoundingClientRect().height);
      a[i].style.minHeight = `${h}px`;
      b[i].style.minHeight = `${h}px`;
    }
  };
  createEffect(on([wrap, () => display().rows.length, selected, real], () => requestAnimationFrame(equalize)));
  onMount(() => {
    const ro = new ResizeObserver(() => equalize());
    if (curEl) ro.observe(curEl);
    onCleanup(() => ro.disconnect());
  });

  /** 닫기 — 진입 시점 뷰로 복귀하고 git 패널 문맥도 되살린다 (U11) */
  const close = () => {
    const v = view();
    const back = v.kind === "gitdiff" ? v.back : undefined;
    setView(back ?? { kind: "control" });
    if (back) openPanel("git");
  };

  // 키보드 (U10·U11) — n/p 변경 점프 · ↑↓ 파일 이동 · Esc 닫기. 입력 필드에서는 양보한다
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Escape") close();
      else if (e.key === "n") jumpTo(blockIdx() + 1);
      else if (e.key === "p") jumpTo(blockIdx() - 1);
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        moveFile(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveFile(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  /** 한 페인의 표시 행 렌더 — fold 행은 양 페인에 같은 자리로 들어가 정렬이 유지된다 */
  const paneRows = (side: () => DiffLine[], mine: "del" | "add") => (
    <For each={display().rows}>
      {(r) =>
        r.type === "fold" ? (
          <button class="gde-fold mono" onClick={() => setExpandedFolds([...expandedFolds(), r.start])}>
            ⋯ {tf("{n}줄 접힘 — 펼치기", { n: r.end - r.start + 1 })}
          </button>
        ) : (
          <Show when={side()[r.i]} keyed>
            {(l) => (
              <div
                class="gde-line"
                data-row={r.i}
                classList={{
                  del: mine === "del" && l.kind === "del",
                  add: mine === "add" && l.kind === "add",
                  pad: l.kind === "pad",
                  cursor:
                    blockIdx() >= 0 &&
                    !!changeBlocks()[blockIdx()] &&
                    r.i >= changeBlocks()[blockIdx()].start &&
                    r.i <= changeBlocks()[blockIdx()].end,
                }}
              >
                <span class="gde-gutter">{l.no ?? ""}</span>
                <span class="gde-text">
                  {l.kind === mine ? intraSpans(l.text, pairText(r.i, mine)) : l.text}
                </span>
              </div>
            )}
          </Show>
        )
      }
    </For>
  );

  return (
    <div class="screen gde">
      <div class="gde-body">
        {/* 좌: 변경 파일 사이드바 */}
        <div class="gde-sidebar">
          <div class="gde-sidebar-head">
            <div style={{ display: "flex", "justify-content": "space-between", "align-items": "baseline" }}>
              <span style={{ "font-weight": 800 }}>{commit() ? <>diff — <span class="mono">{commit()!.hash}</span></> : t("변경 파일")}</span>
              <span class="mono muted" style={{ "font-size": "10px" }}>
                {files().length} CHANGES {t(isTauri() ? "· 실측" : "· 목")}
              </span>
            </div>
            <div class="mono muted gde-sidebar-sub" style={{ "font-size": "10px", "margin-top": "3px" }} title={commit()?.message}>
              {commit() ? commit()!.message : `${branch()} ↑${sync().ahead} ↓${sync().behind} · ${ws()?.name ?? "—"}`}
            </div>
          </div>
          <input
            class="panel-search mono"
            placeholder={t("파일 필터…")}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          {/* 상태 칩 (U12) — 다시 누르면 해제 */}
          <div class="gde-filter-chips">
            <For each={["A", "M", "D", "R"] as const}>
              {(st) => (
                <button
                  class="btn ghost mono"
                  classList={{ on: statusFilter() === st }}
                  title={t(st === "A" ? "새 파일만" : st === "M" ? "수정만" : st === "D" ? "삭제만" : "이름변경만")}
                  onClick={() => setStatusFilter(statusFilter() === st ? undefined : st)}
                >
                  {st}
                </button>
              )}
            </For>
          </div>
          <div class="gde-files">
            {/* 디렉터리 트리 (UI 리파인 §git) — 폴더 행 + 들여쓴 파일 행. 상태 문자는 색으로 구분 */}
            <For each={treeRows()}>
              {(r) =>
                r.type === "dir" ? (
                  <div class="gde-dir mono" style={{ "padding-left": `${8 + r.depth * 12}px` }}>
                    {r.name}
                  </div>
                ) : (
                  <button
                    class="gde-file"
                    classList={{ selected: selected() === r.f.path }}
                    style={{ "padding-left": `${8 + r.depth * 12}px` }}
                    title={`${r.f.renamedFrom ? `${r.f.renamedFrom} → ` : ""}${r.f.path}${r.f.stat ? ` · ${r.f.stat}` : ""}`}
                    onClick={() => selectFile(r.f.path)}
                  >
                    <span
                      class="gde-st mono"
                      classList={{ add: r.f.status === "A", del: r.f.status === "D", mod: r.f.status === "M" || r.f.status === "R" }}
                    >
                      {r.f.status}
                    </span>
                    <span class="mono gde-file-path">{r.name}</span>
                    <span class="mono muted gde-file-stat">{r.f.stat}</span>
                  </button>
                )
              }
            </For>
            <Show when={filesErr()}>
              {/* 실패는 깨끗한 워크트리가 아니다 (B9) — git 패널과 같은 오류 카드로 말한다 */}
              <div class="card conn-error mono" style={{ margin: "8px", "font-size": "11px" }}>
                <div>{t("변경 파일을 읽을 수 없습니다 — git 저장소가 아니거나 git CLI가 없습니다")}</div>
                <button class="btn" style={{ "margin-top": "6px", width: "100%" }} onClick={() => void loadFiles()}>
                  {t("다시 시도")}
                </button>
              </div>
            </Show>
            <Show when={!filesErr() && filtered().length === 0}>
              <div class="muted" style={{ padding: "10px", "font-size": "11px" }}>
                {isTauri() && !query().trim() && !statusFilter()
                  ? commit()
                    ? t("이 커밋에는 변경 파일이 없습니다")
                    : t("변경된 파일이 없습니다 — 워크트리가 깨끗합니다")
                  : t("검색 결과 없음")}
              </div>
            </Show>
          </div>
          <div class="gde-sidebar-actions">
            <button class="btn" style={{ flex: 1 }} disabled={refreshing()} onClick={() => void refresh()}>
              {refreshing() ? t("읽는 중…") : refreshNote() ?? t("⟳ 새로 읽기")}
            </button>
          </div>
        </div>

        {/* 우: 비교 뷰어 (읽기 전용) */}
        <div class="gde-main">
          <div class="gde-toolbar">
            <div>
              <div class="mono" style={{ "font-weight": 700, "font-size": "12px" }}>
                {selected()?.split("/").join(" / ") ?? t("파일을 선택하세요")}
              </div>
              <div class="mono muted" style={{ "font-size": "10px" }}>
                {commit()
                  ? tf("COMPARE · 부모 커밋 {base} ↔ {hash} · {stat} · 읽기 전용", { base: baseLabel(), hash: commit()!.hash, stat: stat() })
                  : tf("COMPARE · {base} ({branch}) ↔ WORKTREE · {stat} · 읽기 전용 — 커밋·편집은 터미널에서", { base: baseLabel(), branch: branch(), stat: stat() })}
              </div>
            </div>
            <div class="gde-toolbar-actions">
              {/* 변경 내비게이션 (U10) */}
              <span class="mono muted" style={{ "font-size": "10px", "align-self": "center" }}>
                {changeBlocks().length
                  ? tf("변경 {cur}/{total}", { cur: blockIdx() >= 0 ? Math.min(blockIdx() + 1, changeBlocks().length) : "–", total: changeBlocks().length })
                  : t("변경 없음")}
              </span>
              <button class="btn ghost" title={t("이전 변경 (p)")} onClick={() => jumpTo(blockIdx() - 1)}>
                ↑
              </button>
              <button class="btn ghost" title={t("다음 변경 (n)")} onClick={() => jumpTo(blockIdx() + 1)}>
                ↓
              </button>
              <button
                class="btn ghost"
                title={foldCtx() ? t("전체 문맥 보기") : tf("변경 ±{n}줄만 보기", { n: FOLD_CONTEXT })}
                onClick={() => {
                  setFoldCtx(!foldCtx());
                  setExpandedFolds([]);
                }}
              >
                {foldCtx() ? t("전체 문맥") : t("변경만")}
              </button>
              <button class="btn ghost" classList={{ on: wrap() }} title={t("줄바꿈 (U13)")} onClick={() => setWrap(!wrap())}>
                ↩ {t("줄바꿈")}
              </button>
              <button class="btn ghost" title={t("닫기 (Esc) — 진입한 화면으로 복귀")} onClick={close}>
                ✕
              </button>
            </div>
          </div>

          <Show when={diffErr()}>
            <div class="card conn-error mono" style={{ margin: "10px" }}>
              {diffErr()}
            </div>
          </Show>

          <div class="gde-compare">
            <div class="gde-pane">
              {/* 왼쪽 = 비교 대상(과거) — 붉은 계열 헤더로 방향을 못박는다 (UI 리파인 §git) */}
              <div class="gde-pane-head old">
                <div>
                  <div class="mono gde-pane-title" style={{ "font-weight": 700, "font-size": "11px" }}>
                    {commit() ? tf("비교 대상 — 부모 커밋 ({base})", { base: baseLabel() }) : tf("비교 대상 — BASE ({base})", { base: baseLabel() })}
                  </div>
                  <div class="muted" style={{ "font-size": "10px" }}>
                    {t(commit() ? "커밋 직전 내용" : "HEAD 커밋 시점 내용")}
                  </div>
                </div>
                <span class="badge">{t("🔒 읽기 전용")}</span>
              </div>
              <div class="gde-codewrap">
                <div
                  class="gde-code mono"
                  classList={{ wrap: wrap() }}
                  ref={baseEl}
                  onScroll={() => mirror(baseEl, curEl)}
                >
                  {paneRows(baseLines, "del")}
                  {/* 빈 상태를 침묵시키지 않는다 (B5) — 읽는 중(B10)·새 파일·내용 불가를 구분해 말한다 */}
                  <Show when={diffLoading()}>
                    <div class="muted" style={{ padding: "10px", "font-size": "11px" }}>{t("읽는 중…")}</div>
                  </Show>
                  <Show when={!diffLoading() && selected() && baseLines().length === 0}>
                    <div class="muted" style={{ padding: "10px", "font-size": "11px" }}>
                      {curLines().length > 0
                        ? commit()
                          ? t("(이 시점에는 파일이 없습니다 — 새 파일)")
                          : t("BASE 없음 — 새 파일입니다")
                        : t("이 파일의 내용을 표시할 수 없습니다")}
                    </div>
                  </Show>
                </div>
              </div>
            </div>

            <div class="gde-pane">
              {/* 오른쪽 = 현재(도착점) — 초록 계열 헤더 (UI 리파인 §git) */}
              <div class="gde-pane-head new">
                <div>
                  <div class="mono gde-pane-title" style={{ "font-weight": 700, "font-size": "11px" }}>
                    {commit() ? tf("현재 — 이 커밋 ({hash})", { hash: commit()!.hash }) : t("현재 — 워크트리")}
                  </div>
                  <div class="muted" style={{ "font-size": "10px" }}>
                    {t(commit() ? "커밋된 내용" : "현재 파일 내용")}
                  </div>
                </div>
                <span class="badge">{t("🔒 읽기 전용")}</span>
              </div>
              <div class="gde-codewrap">
                <div
                  class="gde-code mono"
                  classList={{ wrap: wrap() }}
                  ref={curEl}
                  onScroll={() => mirror(curEl, baseEl)}
                >
                  {paneRows(curLines, "add")}
                  <Show when={diffLoading()}>
                    <div class="muted" style={{ padding: "10px", "font-size": "11px" }}>{t("읽는 중…")}</div>
                  </Show>
                  <Show when={!diffLoading() && selected() && curLines().length === 0}>
                    <div class="muted" style={{ padding: "10px", "font-size": "11px" }}>
                      {baseLines().length > 0
                        ? commit()
                          ? t("(이 커밋에서 삭제된 파일입니다)")
                          : t("워크트리에 없음 — 삭제된 파일입니다")
                        : t("이 파일의 내용을 표시할 수 없습니다")}
                    </div>
                  </Show>
                </div>
                {/* 스크롤바 변경 위치 마커 (U10) — 클릭하면 그 변경으로 점프 */}
                <div class="gde-markers">
                  <For each={changeBlocks()}>
                    {(b, bi) => {
                      const d = () => display();
                      const total = () => Math.max(1, d().rows.length);
                      const top = () => ((d().pos.get(b.start) ?? 0) / total()) * 100;
                      const h = () =>
                        Math.max((((d().pos.get(b.end) ?? 0) - (d().pos.get(b.start) ?? 0) + 1) / total()) * 100, 1.5);
                      const hasAdd = () => curLines().slice(b.start, b.end + 1).some((l) => l?.kind === "add");
                      return (
                        <button
                          class="gde-marker"
                          classList={{ addm: hasAdd(), delm: !hasAdd(), active: bi() === blockIdx() }}
                          style={{ top: `${top()}%`, height: `${h()}%` }}
                          title={tf("변경 {n}로 이동", { n: bi() + 1 })}
                          onClick={() => jumpTo(bi())}
                        />
                      );
                    }}
                  </For>
                </div>
              </div>
            </div>
          </div>

          <div class="gde-statusbar mono">
            <div class="gde-status-left">
              <span class="muted">BASE {baseLabel()} · READ ONLY</span>
              {/* 숫자는 위치로 이어진다 (U10) — 클릭 시 첫 변경으로 점프 */}
              <button class="gde-stat-jump mono" title={t("첫 변경으로 이동")} onClick={() => jumpTo(0)}>
                {commit() ? commit()!.hash : "WORKTREE"} ·{" "}
                {tf("{a} 추가 · {d} 삭제", {
                  a: curLines().filter((l) => l.kind === "add").length,
                  d: baseLines().filter((l) => l.kind === "del").length,
                })}
                <Show when={real()?.truncated}> · {t("3,000줄에서 잘림")}</Show>
              </button>
            </div>
            <span class="muted">
              {isTauri()
                ? commit()
                  ? tf("git diff {a}^ {b} 실측", { a: commit()!.hash, b: commit()!.hash })
                  : t("git diff -U999999 실측")
                : t("목 데이터")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
