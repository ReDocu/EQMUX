// 코드 편집기 — CodeMirror 6 래퍼. 임무 탐색기의 편집 모드가 쓴다 (textarea의 후신).
// 계약: 저장 배관(1MB 상한 · mtime 충돌 · .git 불가침)은 호출부(fsx)가 소유하고,
// 여기는 텍스트 표면만 맡는다 — 구문 강조·줄 번호·검색·되돌리기.
// 테마는 전부 CSS 토큰(var(--eq-*))으로 그려 라이트/다크 전환(M29)을 그대로 따라간다.
import { createEffect, on, onCleanup, onMount } from "solid-js";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { settings } from "../backend/settings";

/** 산문 파일만 줄바꿈한다 (P86) — 코드는 긴 줄이 접히면 줄 번호와 실제 줄이 어긋나 보인다 */
const isProse = (name: string) => /\.(md|markdown|mdx|txt)$/i.test(name);

/** 검색 패널(Ctrl+F) 한국어 문구 (U164) — CodeMirror 기본은 영어다. 영어 화면은 기본 문구를 그대로 쓴다 */
const PHRASES_KO: Record<string, string> = {
  Find: "찾기",
  Replace: "바꾸기",
  next: "다음",
  previous: "이전",
  all: "모두",
  "match case": "대소문자 구분",
  regexp: "정규식",
  "by word": "단어 단위",
  replace: "바꾸기",
  "replace all": "모두 바꾸기",
  close: "닫기",
  "Go to line": "줄로 이동",
  go: "이동",
  "current match": "현재 일치",
  "on line": "줄",
  "replaced match on line $": "$번 줄의 일치를 바꿨습니다",
  "replaced $ matches": "일치 $개를 바꿨습니다",
};

/** 확장자 → 언어. 임무·역할·팀 파일(md/json/yaml)은 정적 번들 — 편집기와 함께 즉시 뜬다.
 *  그 외 확장자는 language-data 목록에서 찾아 지연 로드한다 (아래 loadExtraLang) */
function langOf(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".json")) return [json()];
  if (n.endsWith(".yml") || n.endsWith(".yaml")) return [yaml()];
  if (n.endsWith(".md") || n.endsWith(".markdown") || n.endsWith(".mdx")) return [markdown()];
  return [];
}

// 앱 토큰만 쓴다 — 고정 hex를 넣으면 라이트 테마에서 어긋난다
const eqTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "11px",
    backgroundColor: "var(--eq-surface)",
    color: "var(--eq-text)",
  },
  ".cm-scroller": {
    fontFamily: "var(--eq-mono)",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--eq-text)", padding: "8px 0" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": {
    backgroundColor: "var(--eq-gutter)",
    color: "var(--eq-dim)",
    border: "none",
    fontSize: "10px",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--eq-blue) 7%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--eq-muted)" },
  ".cm-cursor": { borderLeftColor: "var(--eq-text)" },
  "&.cm-focused > .cm-scroller .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--eq-blue) 28%, transparent)",
  },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--eq-cyan) 18%, transparent)" },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--eq-amber) 25%, transparent)",
    outline: "1px solid var(--eq-amber)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--eq-amber) 45%, transparent)",
  },
  // 검색 패널 (Ctrl+F) — 앱의 카드·버튼 문법에 맞춘다
  ".cm-panels": {
    backgroundColor: "var(--eq-surface-2)",
    color: "var(--eq-text)",
    borderTop: "1px solid var(--eq-line)",
    fontFamily: "var(--eq-mono)",
    fontSize: "11px",
  },
  ".cm-panels .cm-textfield": {
    backgroundColor: "var(--eq-surface)",
    border: "1px solid var(--eq-line)",
    color: "var(--eq-text)",
  },
  ".cm-panels .cm-button": {
    backgroundColor: "var(--eq-surface)",
    border: "1px solid var(--eq-line)",
    color: "var(--eq-text)",
    backgroundImage: "none",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--eq-surface-2)",
    border: "1px solid var(--eq-line)",
    color: "var(--eq-text)",
  },
});

// 구문 색 — 앱 토큰만 쓴다 (고정 hex 금지, 라이트 테마 M29를 그대로 따라간다).
// 코드 팔레트: 키워드=purple · 함수=blue · 타입/클래스=cyan · 키/속성=blue · 문자열=green ·
// 숫자/상수=amber · 정규식/이스케이프=orange · 태그/self=pink · 연산자=slate · 주석=dim.
// t.name 기본 매핑은 basicSetup의 defaultHighlightStyle 폴백(라이트 전제 hex) 누출 방지다.
const eqHighlight = HighlightStyle.define([
  { tag: t.name, color: "var(--eq-text)" },
  { tag: [t.keyword, t.definitionKeyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], color: "var(--eq-purple)" },
  { tag: [t.function(t.variableName), t.macroName], color: "var(--eq-blue)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--eq-cyan)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--eq-blue)" },
  { tag: [t.string, t.special(t.string)], color: "var(--eq-green)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.constant(t.name), t.standard(t.name)], color: "var(--eq-amber)" },
  { tag: [t.regexp, t.escape], color: "var(--eq-orange)" },
  { tag: [t.tagName, t.self, t.special(t.variableName), t.labelName], color: "var(--eq-pink)" },
  { tag: [t.operator], color: "var(--eq-slate)" },
  { tag: [t.comment, t.meta, t.processingInstruction], color: "var(--eq-dim)", fontStyle: "italic" },
  { tag: [t.inserted], color: "var(--eq-green)" },
  { tag: [t.deleted], color: "var(--eq-red)" },
  { tag: [t.changed], color: "var(--eq-amber)" },
  { tag: [t.separator, t.contentSeparator], color: "var(--eq-dim)" },
  { tag: [t.invalid], color: "var(--eq-red)" },
  // 산문(마크다운) — 기존 관례 유지: 헤딩=blue, 링크=cyan
  { tag: [t.heading], color: "var(--eq-blue)", fontWeight: "700" },
  { tag: [t.link, t.url], color: "var(--eq-cyan)", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.monospace], color: "var(--eq-code)" },
]);

export function CodeEditor(props: {
  /** 초기 내용 — 마운트 시 1회만 읽는다. 이후의 원본은 편집기 문서다 (onChange로 흘러나간다) */
  value: string;
  /** 언어 판별용 파일명 */
  fileName: string;
  onChange: (text: string) => void;
  /** Ctrl+S — 저장은 호출부의 배관(mtime 충돌 감지)을 그대로 탄다 */
  onSave: () => void;
}) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  const langSlot = new Compartment(); // 지연 로드 언어를 나중에 끼워 넣는 자리
  const phraseSlot = new Compartment(); // 검색 패널 문구 — 설정 언어를 바꾸면 갈아 끼운다 (U164)
  const phrases = (lang: string) => (lang === "en" ? [] : EditorState.phrases.of(PHRASES_KO));

  onMount(() => {
    const staticLang = langOf(props.fileName);
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          // 커스텀 keymap을 basicSetup보다 앞에 — Ctrl+S가 브라우저 저장을 가로챈다
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                props.onSave();
                return true;
              },
            },
            // 앱 단축키(Mod-Shift-K·L·B·D·U, App.tsx)는 앱 것이다 (B222) — basicSetup의 줄 삭제·같은 단어 모두
            // 고르기가 같은 키에 함께 돌지 않게 여기서 삼킨다. stopPropagation은 달지 않아 window의 앱 단축키는 그대로 받는다
            ...["k", "l", "b", "d", "u"].map((k) => ({ key: `Mod-Shift-${k}`, run: () => true })),
            // Tab은 들여쓰기 (P86) — YAML에서 포커스가 밖으로 나갔다. Esc 다음 Tab은 CodeMirror 관례대로 포커스 이동
            indentWithTab,
          ]),
          basicSetup,
          langSlot.of(staticLang),
          eqTheme,
          syntaxHighlighting(eqHighlight),
          isProse(props.fileName) ? EditorView.lineWrapping : [], // 임무·역할 문서는 산문이다 — 가로 스크롤보다 줄바꿈
          phraseSlot.of(phrases(settings().language)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) props.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.focus();
    // 정적 3종 밖의 언어 — language-data 목록 자체도 이 분기에서만 지연 로드한다
    // (md/json/yaml 실사용이 170여 개 언어 기술자 구성 비용을 내지 않게).
    // 로드 전·미지원 확장자는 평문으로 열려 있고, 로드가 끝나면 색만 뒤늦게 입혀진다
    if (staticLang.length === 0) {
      void import("@codemirror/language-data")
        .then(({ languages }) => LanguageDescription.matchFilename(languages, props.fileName)?.load())
        .then((support) => {
          if (support) view?.dispatch({ effects: langSlot.reconfigure(support) });
        })
        .catch(() => undefined); // 파서 로드 실패 = 평문 유지 — 편집을 막을 이유가 없다
    }
  });
  // 편집기를 연 채 언어를 바꿔도 따라간다 (U164) — 이미 열려 있던 검색 패널은 닫았다 다시 열면 바뀐다
  createEffect(
    on(
      () => settings().language,
      (lang) => view?.dispatch({ effects: phraseSlot.reconfigure(phrases(lang)) }),
      { defer: true },
    ),
  );
  onCleanup(() => {
    view?.destroy();
    view = undefined; // 언어 로드 완료 콜백이 파괴된 뷰에 dispatch하지 않게
  });

  return <div class="cm-host" ref={host} />;
}
