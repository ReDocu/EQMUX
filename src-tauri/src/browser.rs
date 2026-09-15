// 브라우저 패널 (M17 확장) — 사이드 패널 자리에 실제 WebView2 자식 웹뷰를 얹는다.
// iframe 미리보기는 X-Frame-Options·frame-ancestors에 막혀 외부 웹을 못 그린다 —
// 자식 웹뷰는 최상위 프레임이라 그 제약이 없고, 세션 dev 서버(localhost)도 같은 경로로 본다.
// 좌표는 CSS(논리) 픽셀 — 프런트가 패널 영역의 getBoundingClientRect를 그대로 보낸다.
// 원격 페이지에는 Tauri IPC가 열리지 않는다 (capabilities에 이 라벨이 없다) — 관측 전용 표면.
use serde::Serialize;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

/// 자식 웹뷰 라벨 — 창에 하나만 둔다. 탭 전환·다이얼로그는 파괴가 아니라 숨김/표시로 다룬다
const LABEL: &str = "panel-browser";

#[derive(Serialize, Clone)]
struct NavPayload {
    url: String,
}

/// http·https만 — file:// 등 로컬 자원이 브라우저 패널로 열리는 것을 막는다
fn parse_http(url: &str) -> Result<Url, String> {
    let u: Url = url.parse().map_err(|_| format!("잘못된 주소: {url}"))?;
    match u.scheme() {
        "http" | "https" => Ok(u),
        s => Err(format!("{s}:// 주소는 열 수 없습니다 — http·https만")),
    }
}

/// 열기 — 웹뷰가 없으면 만들고, 있으면 이동·재배치 후 보여준다
#[tauri::command]
pub fn browser_open(app: AppHandle, url: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let target = parse_http(&url)?;
    if let Some(wv) = app.get_webview(LABEL) {
        wv.navigate(target).map_err(|e| e.to_string())?;
        wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        wv.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
        return wv.show().map_err(|e| e.to_string());
    }
    let win = app.get_window("main").ok_or("메인 창을 찾지 못했습니다")?;
    let emitter = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(target))
        // 주소 바 동기화 — 웹뷰 안에서 링크를 따라가도 패널 입력칸이 따라온다.
        // 스킴 제한도 여기서 계속 지킨다 (페이지 안 링크가 http·https 밖으로 못 나가게)
        .on_navigation(move |u| {
            let allowed = matches!(u.scheme(), "http" | "https");
            if allowed {
                let _ = emitter.emit_to("main", "browser-nav", NavPayload { url: u.to_string() });
            }
            allowed
        });
    win.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| format!("웹뷰 생성 실패: {e}"))?;
    Ok(())
}

/// 재배치 — 패널 크기·위치가 바뀔 때 (ResizeObserver · 창 리사이즈 · 패널 좌우 전환)
#[tauri::command]
pub fn browser_bounds(app: AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let Some(wv) = app.get_webview(LABEL) else { return Ok(()) };
    wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())
}

/// 표시/숨김 — 자식 웹뷰는 항상 메인 웹뷰 위에 그려지므로, 다른 탭·다이얼로그·전체 화면
/// 팝업이 뜨는 동안은 숨겨야 한다. 페이지 상태(스크롤·폼)는 유지된다
#[tauri::command]
pub fn browser_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let Some(wv) = app.get_webview(LABEL) else { return Ok(()) };
    if visible { wv.show() } else { wv.hide() }.map_err(|e| e.to_string())
}

/// 탐색 — back·forward는 웹뷰 안 history로, reload는 네이티브 리로드로
#[tauri::command]
pub fn browser_nav(app: AppHandle, action: String) -> Result<(), String> {
    let Some(wv) = app.get_webview(LABEL) else { return Ok(()) };
    match action.as_str() {
        "back" => wv.eval("history.back()").map_err(|e| e.to_string()),
        "forward" => wv.eval("history.forward()").map_err(|e| e.to_string()),
        "reload" => wv.reload().map_err(|e| e.to_string()),
        other => Err(format!("모르는 탐색 동작: {other}")),
    }
}

/// 닫기 — 웹뷰를 파괴한다 (✕ 버튼). 다음 열기는 새로 만든다
#[tauri::command]
pub fn browser_close(app: AppHandle) -> Result<(), String> {
    let Some(wv) = app.get_webview(LABEL) else { return Ok(()) };
    wv.close().map_err(|e| e.to_string())
}

// ── CLI 조종 (PRD I · `eqmux browser`) ─────────────────────────────────────
// 에이전트가 사람이 보고 있는 그 패널을 직접 몬다. 보이지 않는 창을 따로 띄우는 브라우저
// 자동화(Playwright 류)와 반대 방향이다 — 관제가 핵심이라는 원칙 그대로, 에이전트가 무엇을
// 여는지 사람이 실시간으로 본다.
//
// 보안 경계는 그대로다: 방향은 앱 → 페이지 한쪽뿐이다. 패널 웹뷰는 여전히 capabilities에
// 없어 원격 페이지가 Tauri 커맨드를 부를 길이 없다. 대신 돌아오는 문자열은 페이지가 만든
// 것이므로 에이전트에게는 신뢰할 수 없는 입력이다(프롬프트 주입면) — CLI 응답에 그대로 싣되
// 앱 상태를 바꾸는 데는 쓰지 않는다.

const NO_PANEL: &str = "브라우저 패널이 열려 있지 않습니다 — 먼저 `eqmux browser open <주소>`";
/// 페이지 응답 대기 — 스크립트 한 번의 상한. UI 스레드가 막혀 있으면 여기서 끊는다
const EVAL_SECS: u64 = 10;
/// 로딩 안정화 대기 상한 — 넘으면 오류가 아니라 "현재 상태"를 낸다
const SETTLE_SECS: u64 = 20;
/// 응답 상한 — 에이전트 컨텍스트를 한 번에 태우지 않게 자른다
const MAX_RESULT: usize = 30_000;

/// 결과를 문자열로 뽑는 공통 도우미(`__s`)를 얹은 IIFE 래퍼.
/// 페이지 CSP와 무관하게 돌도록 eval·new Function을 쓰지 않고 본문을 그대로 심는다.
fn wrap(body: &str) -> String {
    format!(
        "(function(){{const __s=v=>typeof v==='string'?v:(JSON.stringify(v)??String(v));\
         try{{{body}}}catch(e){{return 'ERR '+e}}}})()"
    )
}

/// JS 본문을 패널 페이지에서 돌리고 문자열 결과를 받는다 — CLI 조종의 유일한 원시 연산.
/// 나머지 동작(snapshot·click·type…)은 전부 이 위에 얹은 JS 문자열이다.
/// WebView2 ExecuteScript 콜백은 UI 스레드에서 오고 호출자는 파이프 워커 스레드라 채널로 받는다.
#[cfg(windows)]
pub fn eval_text(app: &AppHandle, body: &str) -> Result<String, String> {
    let wv = app.get_webview(LABEL).ok_or(NO_PANEL)?;
    let js = wrap(body);
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    wv.with_webview(move |pw| unsafe {
        let core = match pw.controller().CoreWebView2() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(Err(format!("웹뷰를 얻지 못했습니다: {e}")));
                return;
            }
        };
        let htx = tx.clone();
        let handler = webview2_com::ExecuteScriptCompletedHandler::create(Box::new(move |hr, res| {
            // 매크로가 PCWSTR을 이미 String으로 바꿔 넘겨준다 (webview2-com callback)
            let _ = htx.send(if hr.is_ok() {
                Ok(res)
            } else {
                Err(format!("스크립트 실행 실패: {hr:?}"))
            });
            Ok(())
        }));
        let s = webview2_com::CoTaskMemPWSTR::from(js.as_str());
        let r = s.as_ref();
        if let Err(e) = core.ExecuteScript(*r.as_pcwstr(), &handler) {
            let _ = tx.send(Err(format!("스크립트를 보내지 못했습니다: {e}")));
        }
    })
    .map_err(|e| format!("웹뷰에 접근하지 못했습니다: {e}"))?;
    let raw = rx
        .recv_timeout(std::time::Duration::from_secs(EVAL_SECS))
        .map_err(|_| format!("브라우저가 {EVAL_SECS}초 안에 응답하지 않았습니다"))??;
    // ExecuteScript는 결과를 JSON으로 준다 — 문자열이면 따옴표를 벗기고, undefined는 빈 줄
    Ok(match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(serde_json::Value::String(s)) => s,
        Ok(serde_json::Value::Null) => String::new(),
        _ => raw,
    })
}

#[cfg(not(windows))]
pub fn eval_text(_app: &AppHandle, _body: &str) -> Result<String, String> {
    Err("브라우저 조종은 WebView2(Windows) 전용입니다".into())
}

/// 지금 페이지의 신원 — 모든 탐색 동작이 끝나고 돌려주는 두 줄
const DESCRIBE: &str = "return document.title+'\\n'+location.href";

/// 문서 교체 표식 — 지금 문서에 심어 두면 새 문서에서는 사라진다.
/// readyState만 보면 '아직 떠나지 않은 옛 페이지'가 complete라서 곧바로 통과해 버린다.
const MARK: &str = "window.__eqnav=1;return 'ok'";

/// 탐색이 가라앉을 때까지 기다린다 — 에이전트가 바로 snapshot을 찍어도 옛 문서를 보지 않게.
/// 상한을 넘으면 오류가 아니라 현재 상태를 낸다 (느린 페이지도 조종은 계속돼야 한다).
fn settle(app: &AppHandle) -> Result<String, String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(SETTLE_SECS);
    loop {
        std::thread::sleep(std::time::Duration::from_millis(150));
        // 웹뷰가 아직 없으면(패널이 지금 뜨는 중) 오류가 온다 — 그대로 다시 돈다
        if let Ok(s) = eval_text(app, "return window.__eqnav?'nav':document.readyState") {
            if s == "complete" {
                return eval_text(app, DESCRIBE);
            }
        }
        if std::time::Instant::now() >= deadline {
            // ponytail: 해시 이동처럼 문서가 안 바뀌는 탐색은 표식이 남아 여기로 온다.
            // 상태 자체는 정확하므로 안내만 붙인다 — 필요해지면 hashchange 감지를 더한다
            return eval_text(app, DESCRIBE)
                .map(|d| format!("{d}\n({SETTLE_SECS}초 안에 로딩이 끝나지 않았습니다 — 현재 상태)"));
        }
    }
}

/// `@e3` · `e3` · `3` 모두 받는다 — PowerShell이 따옴표 없는 `@e3`를 스플래팅으로 삼켜서
/// 에이전트에게는 `e3`만 남는 일이 흔하다 (`--to @이름`이 사라지던 것과 같은 원인).
fn ref_index(arg: Option<&String>) -> Result<usize, String> {
    let raw = arg.map(String::as_str).unwrap_or("").trim();
    let n = raw.trim_start_matches('@').trim_start_matches('e');
    n.parse::<usize>()
        .map_err(|_| format!("참조가 필요합니다 — snapshot이 매긴 @e3 형태 (받은 값: \"{raw}\")"))
}

/// 주소 정규화 — 스킴이 없으면 http, http·https 밖은 거부 (패널 열기와 같은 규칙)
fn normalize_url(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("주소가 필요합니다 — `eqmux browser open 127.0.0.1:5173`".into());
    }
    let full = if raw.contains("://") { raw.to_string() } else { format!("http://{raw}") };
    parse_http(&full)?;
    Ok(full)
}

/// 조작 가능한 요소에 @eN을 매겨 페이지를 한 덩어리로 요약한다. 참조는 window에 얹으므로
/// 문서가 바뀌면 같이 사라진다 — 탐색 뒤에는 다시 찍어야 한다(그게 맞는 동작이다).
/// ponytail: 문서 순서로 엮지 않고 제목·조작요소·본문 세 묶음으로 낸다 — 접근성 트리가
/// 아니라 DOM 훑기라 순서 정보가 정확하지 않다. 필요해지면 그때 문서 순서로.
const SNAPSHOT: &str = r#"
const R=[];window.__eq=R;const L=[];
const vis=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0};
const txt=s=>(s||'').trim().replace(/\s+/g,' ');
const name=el=>txt(el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('title')||el.getAttribute('alt')||(el.tagName==='INPUT'&&el.type!=='password'?el.value:'')||el.innerText).slice(0,80);
const role=el=>{const t=el.tagName.toLowerCase();
 if(t==='input')return ({checkbox:'checkbox',radio:'radio',submit:'button',button:'button',file:'file'})[el.type]||'textbox';
 if(t==='a')return 'link';if(t==='textarea')return 'textbox';
 return ({button:'button',select:'select',summary:'summary'})[t]||el.getAttribute('role')||t};
const HIT='a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[contenteditable=""],[contenteditable=true],[onclick]';
for(const el of document.querySelectorAll(HIT)){
 if(!vis(el)||L.length>=200)continue;
 R.push(el);L.push('- '+role(el)+' "'+name(el)+'" @e'+(R.length-1)+(el.disabled?' (disabled)':''))}
const H=[...document.querySelectorAll('h1,h2,h3')].filter(vis).slice(0,20).map(e=>'# '+txt(e.innerText).slice(0,100));
const body=(document.body&&document.body.innerText||'').replace(/\n{3,}/g,'\n\n').trim().slice(0,4000);
return [location.href,document.title,'',...H,'','조작 가능:',...(L.length?L:['(없음)']),'','본문:',body].join('\n')
"#;

/// 파이프가 가져온 한 줄 → 동작. 결과는 문자열 한 덩어리(CLI가 그대로 stdout에 찍는다).
///
/// 패널 브라우저는 앱에 하나뿐이다 — 여러 에이전트가 동시에 몰면 서로의 페이지를 본다.
/// ponytail: 잠그지 않는다. 한 동작씩 직렬화해 봐야 snapshot→click 사이는 여전히 벌어지고,
/// 사람이 보고 있는 화면이라 충돌은 눈에 띈다. 필요해지면 세션 단위 점유를 더한다.
pub fn cli(app: &AppHandle, action: &str, args: &[String]) -> Result<String, String> {
    let out = match action {
        "open" => {
            let url = normalize_url(&args.join(" "))?;
            // 열기는 프런트를 거친다 — 웹뷰 바운드는 패널의 DOM 자리에서만 읽을 수 있고
            // (browser_open 주석), 패널이 닫혀 있으면 열어 주기까지 해야 사람이 본다.
            let _ = eval_text(app, MARK); // 패널이 없으면 실패가 정상 — 표식은 최선 노력
            app.emit("browser-request", serde_json::json!({ "url": url }))
                .map_err(|e| format!("패널에 요청하지 못했습니다: {e}"))?;
            settle(app)?
        }
        "back" | "forward" | "reload" => {
            eval_text(app, MARK)?; // 패널이 없으면 여기서 NO_PANEL로 끊긴다
            browser_nav(app.clone(), action.to_string())?;
            settle(app)?
        }
        "snapshot" => eval_text(app, SNAPSHOT)?,
        "get-text" => eval_text(
            app,
            "return __s((document.body&&document.body.innerText||'').replace(/\\n{3,}/g,'\\n\\n').trim().slice(0,20000))",
        )?,
        "click" => {
            let n = ref_index(args.first())?;
            eval_text(app, &format!(
                "const el=(window.__eq||[])[{n}];if(!el)return '@e{n} 참조가 없습니다 — snapshot을 다시 찍으세요';\
                 el.scrollIntoView({{block:'center'}});el.click();\
                 return 'clicked @e{n} '+(el.innerText||el.value||el.tagName).trim().slice(0,60)"
            ))?
        }
        "type" => {
            let n = ref_index(args.first())?;
            let text = serde_json::to_string(&args[1..].join(" ")).unwrap_or_else(|_| "\"\"".into());
            // 네이티브 setter로 넣어야 React·Solid 같은 제어 입력이 값을 따라온다
            eval_text(app, &format!(
                "const el=(window.__eq||[])[{n}];if(!el)return '@e{n} 참조가 없습니다 — snapshot을 다시 찍으세요';\
                 el.focus();const v={text};\
                 const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value');\
                 if(d&&d.set)d.set.call(el,v);else if(el.isContentEditable)el.textContent=v;else el.value=v;\
                 el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));\
                 return 'typed @e{n}'"
            ))?
        }
        "eval" => {
            let src = args.join(" ");
            if src.trim().is_empty() {
                return Err("실행할 JS가 필요합니다".into());
            }
            // return이 있으면 함수 본문으로, 없으면 식으로 본다. eval·new Function은 쓰지
            // 않는다 — 페이지 CSP가 unsafe-eval을 막으면 그쪽이 통째로 죽는다
            let body = if src.contains("return") { src } else { format!("return __s({src})") };
            eval_text(app, &body)?
        }
        other => {
            return Err(format!(
                "모르는 동작: {other} — open · snapshot · click · type · get-text · eval · back · forward · reload"
            ))
        }
    };
    Ok(match out.char_indices().nth(MAX_RESULT) {
        Some((i, _)) => format!("{}\n…({MAX_RESULT}자에서 잘랐습니다)", &out[..i]),
        None => out,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PowerShell이 따옴표 없는 `@e3`를 삼켜도 참조가 성립해야 한다 —
    /// 여기가 막히면 에이전트의 click·type이 전부 "참조가 필요합니다"로 떨어진다
    #[test]
    fn ref_index_accepts_every_spelling() {
        for s in ["@e3", "e3", "3", " @e3 "] {
            assert_eq!(ref_index(Some(&s.to_string())), Ok(3), "{s}");
        }
        assert!(ref_index(None).is_err());
        assert!(ref_index(Some(&"버튼".to_string())).is_err());
    }

    /// 스킴 규칙은 패널 열기와 같다 — 스킴 없으면 http, file://은 거부
    #[test]
    fn normalize_url_matches_panel_rules() {
        assert_eq!(normalize_url("127.0.0.1:5173").unwrap(), "http://127.0.0.1:5173");
        assert_eq!(normalize_url(" https://example.com/a ").unwrap(), "https://example.com/a");
        assert!(normalize_url("file:///C:/secret.txt").is_err());
        assert!(normalize_url("").is_err());
    }

    /// 래퍼는 본문을 그대로 심는다 (eval 없음) — CSP가 unsafe-eval을 막아도 돌아야 한다
    #[test]
    fn wrap_inlines_the_body_without_eval() {
        let js = wrap("return 1");
        assert!(js.contains("return 1") && !js.contains("eval("));
        assert!(js.starts_with("(function(){") && js.ends_with("})()"));
    }
}
