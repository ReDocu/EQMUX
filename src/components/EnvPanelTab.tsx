// 실행 › 환경변수 — 워크스페이스 루트의 .env 계열을 보이고, 만들고, 고치고, 지운다 (§16, backend/env.ts).
// 값은 비밀(API 키·토큰)이 많아 기본으로 가린다 — 화면 공유·녹화 중에 그대로 새지 않게. 편집 칸도 같다.
// 알림·오류에는 키만 쓰고 값은 쓰지 않는다. 변수 하나를 고치면 그 한 줄만 바뀐다(원문 보존).
// 파일 목록은 SidePanel이 읽는다. 여기는 그리기와 편집 — 저장 뒤에는 onReload로 다시 읽힌다.
import { createEffect, createMemo, createResource, createSignal, For, lazy, on, onMount, Show } from "solid-js";
import {
  addToGitignore,
  appendLine,
  createEnvFile,
  deleteEnvFile,
  duplicateKeys,
  editEnvFile,
  ENV_FILES,
  fromExample,
  gitPathStatus,
  keyError,
  readEnvText,
  removeLine,
  serializeValue,
  setLine,
  STALE,
  writeEnvText,
} from "../backend/env";
import type { EnvFile, EnvVar } from "../backend/env";
import { clipWriteText } from "../backend/pty";
import { t, tErr, tf } from "../i18n";
import { Icon } from "./icons";
import { Chip, ConfirmDialog, notify } from "./ui";

const CodeEditor = lazy(() => import("./CodeEditor").then((m) => ({ default: m.CodeEditor })));

/** 편집 중인 줄 — line이 없으면 새 변수 */
type Edit = { file: string; line?: number; key: string; value: string; quote?: string; self?: string };
type Confirm = { file: string; v?: EnvVar };

/** loading — 이 워크스페이스 목록을 아직 못 읽었다. '파일 없음'과 가른다 (B239) */
export function EnvPanelTab(props: { files: EnvFile[]; loading?: boolean; wsPath?: string; onReload: () => void }) {
  // 탭에 들어올 때마다 다시 읽는다 (P67) — 감시가 없어, 패널을 연 채 밖에서 만든 .env가 '없음'으로 남았다
  onMount(props.onReload);
  const [reveal, setReveal] = createSignal(false);
  const [q, setQ] = createSignal("");
  const [edit, setEdit] = createSignal<Edit>();
  const [err, setErr] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  const [confirm, setConfirm] = createSignal<Confirm>();
  const [raw, setRaw] = createSignal<{ file: string; text: string; mtimeMs: number; base: string }>();
  // [원문 편집] [취소]도 고친 내용이 있으면 묻는다 (P77)
  const [askDropRaw, setAskDropRaw] = createSignal(false);
  const cancelRaw = () => (raw() && raw()!.text !== raw()!.base ? setAskDropRaw(true) : setRaw(undefined));
  const [savedNote, setSavedNote] = createSignal(false);
  // [값 보기]가 꺼진 채 [원문 편집]을 누르면 먼저 묻는다 (U115) — 원문은 모든 값을 평문으로 펼친다
  const [askRaw, setAskRaw] = createSignal<string>();

  // 워크스페이스를 옮기면 [값 보기]와 편집 상태를 끈다 — 다른 저장소의 키가 확인 없이 펼쳐지지 않게 (B147).
  // createMemo로 값이 실제로 바뀔 때만 돈다 — on()은 같은 값에도 돌아, 방송(tick)마다 편집이 닫혔다 (B249)
  createEffect(
    on(
      createMemo(() => props.wsPath),
      () => {
        setReveal(false);
        setEdit(undefined);
        setRaw(undefined);
        setErr(undefined);
        setSavedNote(false);
      },
      { defer: true },
    ),
  );

  const envs = () => props.files.filter((f) => !f.example);
  const example = () => props.files.find((f) => f.example && !f.error);
  const missing = () => ENV_FILES.filter((n) => !props.files.some((f) => f.file === n));
  const [git, { refetch: refetchGit }] = createResource(
    () => props.wsPath && envs().map((f) => f.file).join("\n"),
    (list) => gitPathStatus(props.wsPath!, list.split("\n")),
  );
  const gitOf = (file: string) => git()?.find((g) => g.path === file);

  const hit = (k: string) => k.toLowerCase().includes(q().trim().toLowerCase());
  const copy = async (k: string, v: string) => {
    // 클립보드 기록·클라우드 동기화에서 뺀다 (B148). 실패하면 성공 토스트를 띄우지 않는다 (B262)
    if (await clipWriteText(v, true)) notify(tf("{k} 값을 복사했습니다", { k }), "ok");
    else notify(t("복사하지 못했습니다"));
  };

  /** 쓰기 하나 — 실패 사유를 보이고, 외부 변경이면 다시 읽는다. 성공하면 다시 읽고 "재시작 필요" 한 줄 */
  const run = async (job: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setErr(undefined);
    try {
      await job();
      if (ok) notify(ok, "ok");
      props.onReload();
      return true;
    } catch (e) {
      const stale = String(e).includes(STALE);
      setErr(stale ? t("파일이 밖에서 바뀌어 다시 읽었습니다 — 확인하고 다시 고치세요") : String(e));
      props.onReload(); // 이유와 상관없이 — '이미 있습니다'도 목록이 낡았다는 뜻이다 (P67)
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveVar = async () => {
    const e = edit();
    const f = props.files.find((x) => x.file === e?.file);
    if (!e || !f || !props.wsPath) return;
    const why = keyError(e.key, f.vars.map((v) => v.key), e.self);
    if (why) return setErr(t(why));
    const rendered = serializeValue(e.value, e.quote);
    if (rendered === undefined) return setErr(t("이 값은 한 줄로 쓸 수 없습니다 — [원문 편집]에서 고치세요"));
    const ws = props.wsPath;
    const done = await run(
      () =>
        editEnvFile(ws, f, (text) =>
          e.line === undefined ? appendLine(text, e.key, rendered) : setLine(text, e.line, e.key, rendered),
        ),
      tf("{k}을(를) 저장했습니다", { k: e.key }),
    );
    if (done) {
      setEdit(undefined);
      setSavedNote(true);
    }
  };

  const doDelete = async () => {
    const c = confirm();
    const f = props.files.find((x) => x.file === c?.file);
    if (!c || !f || !props.wsPath) return;
    const ws = props.wsPath;
    const line = c.v?.line;
    const ok =
      line === undefined
        ? await run(() => deleteEnvFile(ws, f.file), tf("{f}을(를) 휴지통으로 옮겼습니다", { f: f.file }))
        : await run(() => editEnvFile(ws, f, (text) => removeLine(text, line)), tf("{k}을(를) 지웠습니다", { k: c.v!.key }));
    setConfirm(undefined);
    if (ok && line !== undefined) setSavedNote(true);
  };

  const create = async (file: string, fromEx: boolean) => {
    const ws = props.wsPath;
    const ex = example();
    if (!ws || !file) return;
    await run(async () => {
      const text = fromEx && ex ? fromExample((await readEnvText(ws, ex.file)).text) : "";
      await createEnvFile(ws, file, text);
    }, tf("{f}을(를) 만들었습니다", { f: file }));
  };

  const openRaw = async (file: string) => {
    if (!props.wsPath) return;
    if (!reveal()) return setAskRaw(file);
    setErr(undefined);
    const c = await readEnvText(props.wsPath, file).catch((e) => void setErr(String(e)));
    if (c) setRaw({ file, ...c, base: c.text });
  };
  const saveRaw = async () => {
    const r = raw();
    const ws = props.wsPath;
    if (!r || !ws) return;
    if (await run(() => writeEnvText(ws, r.file, r.text, r.mtimeMs), tf("{f}을(를) 저장했습니다", { f: r.file }))) {
      setRaw(undefined);
      setSavedNote(true);
    }
  };

  const ignore = (file: string) =>
    props.wsPath &&
    void run(() => addToGitignore(props.wsPath!, file), tf(".gitignore에 {f}을(를) 더했습니다", { f: file })).then(
      () => refetchGit(),
    );

  const startEdit = (f: EnvFile, v?: EnvVar) => {
    setErr(undefined);
    setEdit(
      v
        ? { file: f.file, line: v.line, key: v.key, value: v.value, quote: v.quote, self: v.key }
        : { file: f.file, key: "", value: "" },
    );
  };

  const editRow = () => (
    <div
      class="env-edit"
      onKeyDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) return; // 버튼 위 Enter는 click이 맡는다
        if (e.key === "Enter") void saveVar();
        else if (e.key === "Escape") setEdit(undefined);
      }}
    >
      <input
        class="mono"
        placeholder={t("KEY")}
        value={edit()!.key}
        ref={(el) => queueMicrotask(() => el.focus())}
        onInput={(e) => setEdit({ ...edit()!, key: e.currentTarget.value.trim() })}
      />
      <input
        class="mono"
        type={reveal() ? "text" : "password"}
        placeholder={t("값")}
        value={edit()!.value}
        autocomplete="off"
        onInput={(e) => setEdit({ ...edit()!, value: e.currentTarget.value })}
      />
      <button class="btn primary" disabled={busy()} onClick={() => void saveVar()}>
        {t("저장")}
      </button>
      <button class="btn ghost" onClick={() => setEdit(undefined)}>
        {t("취소")}
      </button>
    </div>
  );

  return (
    <div class="portsp">
      <div class="portsp-head">
        <span class="portsp-title">{t("환경변수 · .env 파일")}</span>
        <button class="btn" onClick={() => setReveal(!reveal())} aria-pressed={reveal()}>
          <Icon name={reveal() ? "eye-off" : "eye"} size={12} />
          {t(reveal() ? "값 가리기" : "값 보기")}
        </button>
        <Show when={missing().length > 0 && props.wsPath}>
          <select
            class="btn"
            aria-label={t("새 파일")}
            value=""
            disabled={busy() || props.loading}
            onChange={(e) => {
              const v = e.currentTarget.value;
              e.currentTarget.value = "";
              void create(v, false);
            }}
          >
            <option value="">{t("새 파일 ▾")}</option>
            <For each={missing()}>{(n) => <option value={n}>{n}</option>}</For>
          </select>
        </Show>
        <button class="btn" onClick={props.onReload} title={t("다시 읽기")} aria-label={t("다시 읽기")}>
          <Icon name="refresh-cw" size={12} />
        </button>
      </div>
      {/* 앱이 주입하는 값이 아니다 (B149) — 서버 탭 옆이라 서버 셸이 받는다고 오해하기 쉽다 */}
      <div class="muted env-note">{t("페인·서버 셸 환경에 넣지 않습니다 — 서버가 dotenv로 직접 읽는 값입니다")}</div>
      <input
        class="panel-search mono"
        placeholder={t("변수 이름 검색")}
        value={q()}
        onInput={(e) => setQ(e.currentTarget.value)}
      />
      <Show when={err()}>
        <div class="env-err" role="alert">
          {err()}
        </div>
      </Show>
      <Show when={savedNote()}>
        <div class="muted env-note">{t("이미 실행 중인 서버와 세션은 다시 시작해야 새 값을 읽습니다")}</div>
      </Show>

      {/* 빈 상태 (V2) — 탭은 늘 보이고, 만들기의 입구가 여기다 */}
      <Show when={props.loading}>
        <div class="muted">{t("읽는 중…")}</div>
      </Show>
      <Show when={!props.loading && envs().length === 0}>
        <div class="card inset env-file env-empty">
          <div class="muted">{t("워크스페이스 루트에 .env 파일이 없습니다")}</div>
          <div class="env-empty-actions">
            <button class="btn" disabled={!props.wsPath || busy()} onClick={() => void create(".env", false)}>
              {t(".env 만들기")}
            </button>
            <Show when={example()}>
              <button class="btn" disabled={!props.wsPath || busy()} onClick={() => void create(".env", true)}>
                {tf("{f}에서 만들기", { f: example()!.file })}
              </button>
            </Show>
          </div>
        </div>
      </Show>

      <For each={props.files}>
        {(f) => {
          const dups = () => duplicateKeys(f.vars);
          const g = () => (f.example ? undefined : gitOf(f.file));
          return (
            <div class="card inset env-file">
              <div class="eyebrow mono env-file-head">
                <span>
                  {f.file} · {tf("변수 {n}개", { n: f.vars.length })}
                  {f.example || f.error ? ` · ${t("읽기 전용")}` : ""}
                </span>
                <Show when={g()?.tracked}>
                  <Chip tone="red" text={t("git에 추적됨")} title={t("이 파일은 커밋되어 있습니다 — 값이 저장소에 남습니다")} />
                </Show>
                <Show when={g() && !g()!.tracked && !g()!.ignored}>
                  <Chip
                    tone="amber"
                    text={t("git 무시 안 됨")}
                    action={{ label: t(".gitignore에 추가"), onClick: () => ignore(f.file), disabled: busy() }}
                  />
                </Show>
                <span class="env-file-actions">
                  <Show when={!f.error}>
                    <button class="btn ghost" onClick={() => void openRaw(f.file)}>
                      {t("원문 편집")}
                    </button>
                  </Show>
                  <Show when={!f.example}>
                    <button class="btn ghost" onClick={() => setConfirm({ file: f.file })}>
                      {t("파일 삭제")}
                    </button>
                  </Show>
                </span>
              </div>

              <Show when={raw()?.file === f.file}>
                <div class="env-raw">
                  <CodeEditor
                    value={raw()!.text}
                    fileName={f.file}
                    onChange={(text) => setRaw({ ...raw()!, text })}
                    onSave={() => void saveRaw()}
                  />
                  <div class="env-raw-actions">
                    <button class="btn primary" disabled={busy()} onClick={() => void saveRaw()}>
                      {t("저장")}
                    </button>
                    <button class="btn ghost" onClick={cancelRaw}>
                      {t("취소")}
                    </button>
                  </div>
                </div>
              </Show>

              <Show when={f.vars.length > 0 || f.example} fallback={<div class="muted">{f.error ? tErr(f.error) : t("이 파일에 변수가 없습니다")}</div>}>
                <For each={f.vars.filter((v) => hit(v.key))}>
                  {(v) => (
                    <Show
                      when={edit()?.file === f.file && edit()?.line === v.line && edit()?.line !== undefined}
                      fallback={
                        <div class="kv env-row">
                          <span class="k mono" title={t("클릭하면 값을 복사합니다")} onClick={() => copy(v.key, v.value)}>
                            {v.key}
                            <Show when={dups().has(v.key)}>
                              <Chip tone="amber" text={t("중복")} title={t("같은 키가 이 파일에 두 번 이상 있습니다")} />
                            </Show>
                          </span>
                          <span
                            class="v mono"
                            role="button"
                            tabIndex={0}
                            title={t("클릭하면 값을 복사합니다")}
                            onClick={() => copy(v.key, v.value)}
                            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), copy(v.key, v.value))}
                          >
                            {v.value === "" ? t("(빈 값)") : reveal() ? v.value : "••••••••"}
                          </span>
                          <Show when={!f.example}>
                            <span
                              class="env-row-actions"
                              title={v.multiline ? t("여러 줄 값입니다 — [원문 편집]에서 고치세요") : undefined}
                            >
                              <button class="btn ghost" disabled={v.multiline || busy()} onClick={() => startEdit(f, v)}>
                                {t("편집")}
                              </button>
                              <button class="btn ghost" disabled={v.multiline || busy()} onClick={() => setConfirm({ file: f.file, v })}>
                                {t("삭제")}
                              </button>
                            </span>
                          </Show>
                        </div>
                      }
                    >
                      {editRow()}
                    </Show>
                  )}
                </For>
              </Show>
              <Show when={!f.example && !f.error}>
                <Show
                  when={edit()?.file === f.file && edit()?.line === undefined}
                  fallback={
                    <button class="btn ghost env-add" disabled={busy()} onClick={() => startEdit(f)}>
                      {t("+ 변수")}
                    </button>
                  }
                >
                  {editRow()}
                </Show>
              </Show>
            </div>
          );
        }}
      </For>

      <Show when={confirm()}>
        {(c) => (
          <ConfirmDialog
            danger
            busy={busy()}
            title={c().v ? t("변수 삭제") : t("파일 삭제")}
            body={
              <span>
                {c().v
                  ? tf("{f}에서 {k} 줄을 지웁니다. 되돌리기는 없습니다.", { f: c().file, k: c().v!.key })
                  : tf("{f}을(를) 휴지통으로 옮깁니다.", { f: c().file })}
              </span>
            }
            confirmLabel={t("삭제")}
            onConfirm={() => void doDelete()}
            onCancel={() => setConfirm(undefined)}
          />
        )}
      </Show>
      <Show when={askRaw()}>
        {(file) => (
          <ConfirmDialog
            title={t("원문 편집")}
            body={t("원문에는 이 파일의 모든 값이 평문으로 보입니다. 화면을 공유 중이면 멈추고 여세요. 열면 [값 보기]도 켜집니다.")}
            info={[file()]}
            confirmLabel={t("값을 보이고 열기")}
            onConfirm={() => {
              const f = file();
              setAskRaw(undefined);
              setReveal(true); // 상태 표시와 실제가 어긋나지 않게 — 원문이 열려 있는 동안 [값 보기]는 켜져 있다
              void openRaw(f);
            }}
            onCancel={() => setAskRaw(undefined)}
          />
        )}
      </Show>
      <Show when={askDropRaw()}>
        <ConfirmDialog
          danger
          title={t("저장하지 않은 편집이 있습니다")}
          body={t("버리면 고친 내용이 사라집니다. 남기려면 [계속 편집]을 누르고 [저장]하세요.")}
          info={[raw()?.file ?? ""]}
          confirmLabel={t("변경 버리기")}
          cancelLabel={t("계속 편집")}
          onConfirm={() => {
            setAskDropRaw(false);
            setRaw(undefined);
          }}
          onCancel={() => setAskDropRaw(false)}
        />
      </Show>
    </div>
  );
}
