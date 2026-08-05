//! EQMUX 백엔드 진입점.
//!
//! # 구조
//!
//! ```text
//! lib.rs        빌더 구성 · 창 생성        (여기)
//! config.rs     경로 해석 · 격리 스위치
//! error.rs      공통 에러 타입
//! commands/     Tauri 명령 (도메인별)
//! ```
//!
//! `pty.rs`가 ConPTY를 잡고(S1-2), 그 스트림을 프런트로 잇는다(S1-4).

mod appdata;
mod commands;
mod config;
mod error;
mod layout;
mod memlevel;
mod presets;
mod probe;
mod pty;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use appdata::AppDataWatch;
use config::Paths;
use probe::{
    FontProbeConfig, PanesConfig, PresetProbeConfig, ProbeConfig, PtyProbeConfig, TabProbeConfig,
    PRESET_PROBE_PANES,
};
use pty::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::system::app_info,
            commands::system::app_data_report,
            commands::system::echo,
            commands::system::memlevel_touch,
            commands::system::report_renderer,
            commands::system::log_front,
            commands::probe::probe_append,
            commands::probe::probe_finish,
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::pty::pty_list,
            commands::pty::pty_probe_finish,
            commands::probe::font_probe_finish,
            commands::probe::panes_probe_finish,
            commands::probe::preset_probe_finish,
            commands::probe::tab_probe_finish,
            commands::layout::layout_get,
            commands::layout::layout_apply_preset,
            commands::layout::layout_presets,
            commands::layout::layout_split,
            commands::layout::layout_close,
            commands::layout::layout_set_weights,
            commands::layout::layout_focus,
            commands::layout::layout_attach_pty,
            commands::layout::layout_tab_new,
            commands::layout::layout_tab_select,
            commands::layout::layout_tab_close,
            commands::layout::layout_save,
        ])
        .setup(|app| {
            // 경로를 먼저 확정한다. 창보다 앞이어야 WebView2 데이터 폴더를 갈아끼울 수 있다.
            let paths = Paths::resolve(app.handle())?;
            paths.ensure_dirs()?;

            // `--appdata-report` — 창을 안 열고 크기만 재고 끝낸다 (`docs/issue.md` #7 ②).
            // 해원의 3회 측정이 우리와 **같은 규칙**으로 나와야 한다. 창을 띄우면 그 측정 자체가
            // 캐시를 키운다 — 그래서 웹뷰를 만들기 전에 여기서 끊는다.
            let report_run = appdata::ReportRun::from_args();
            if report_run.enabled {
                let report = appdata::scan(&paths);
                appdata::log_report(&report, "무인");
                if let Some(out) = &report_run.out_path {
                    appdata::write_json(&report, out)?;
                    eprintln!("[eqmux][appdata] out = {}", out.display());
                }
                // setup 안이라 이벤트 루프가 아직 없다 — `app.exit()`은 여기서 안 먹는다.
                std::process::exit(0);
            }

            // `--layout-probe` — 저장 → 복원 → 같은 트리인가. 창을 안 연다 (`S2-1`).
            // **실제 상태 경로로** 돌기 때문에 격리 스위치를 존중하는지까지 같이 증명된다.
            let layout_probe = layout::LayoutProbe::from_args();
            if layout_probe.enabled {
                if paths.isolated {
                    eprintln!("[eqmux] 격리 인스턴스로 왕복 검증한다");
                } else {
                    // 라이브 상태 파일을 덮어쓰게 된다. 조용히 지나가면 안 되는 자리다.
                    eprintln!(
                        "[eqmux] ⚠️ 라이브 상태 파일로 왕복 검증한다 — EQMUX_STATE_PATH로 격리하는 편이 낫다"
                    );
                }
                let code = layout::run_probe(&paths.state_file, layout_probe.out_path.as_deref());
                // setup 안이라 이벤트 루프가 아직 없다 — `app.exit()`은 여기서 안 먹는다.
                std::process::exit(code);
            }

            let probe_cfg = ProbeConfig::from_args(&paths);
            if probe_cfg.enabled {
                eprintln!("[eqmux] 계측 모드 — out = {}", probe_cfg.out_path.display());
                if let Some(n) = probe_cfg.auto_samples {
                    eprintln!("[eqmux]   자동 입력 {n}회 후 종료한다");
                }
                // 자가 검증 조건은 반드시 stderr에 남긴다.
                // 어떤 조건으로 잰 값인지 모르는 숫자는 나중에 못 쓴다.
                eprintln!(
                    "[eqmux]   inject={}ms · frame_hold={} · gap={}ms",
                    probe_cfg.inject_ms, probe_cfg.frame_hold, probe_cfg.gap_ms
                );
            }

            let pty_probe_cfg = PtyProbeConfig::from_args(&paths);
            if pty_probe_cfg.enabled {
                eprintln!(
                    "[eqmux] PTY 무인 검증 — cmd={:?} wait={}ms out={}",
                    pty_probe_cfg.command,
                    pty_probe_cfg.wait_ms,
                    pty_probe_cfg.out_path.display()
                );
            }

            let font_cfg = FontProbeConfig::from_args(&paths);
            if font_cfg.enabled {
                eprintln!(
                    "[eqmux] A-2 폭 계측 — out = {}",
                    font_cfg.out_path.display()
                );
            }
            // 스택 강제는 계측과 무관하게도 먹는다. 먹었으면 반드시 보이게 남긴다 —
            // "강제했다고 믿는 것"과 실제로 그 스택이 뜬 것은 다른 이야기다.
            if let Some(s) = &font_cfg.stack {
                eprintln!("[eqmux] 폰트 스택 강제 — {s}");
            }

            // `S2-2` — 기동 분할과 패널 무인 검증. 설정만 읽는다 — 나누는 것은 프런트다.
            let mut panes_cfg = PanesConfig::from_args(&paths);

            // `S2-11` — 배치 프리셋 무인 확인. 개수를 안 받았으면 8이다(디자인 정원 · 브리프 §3).
            // 두 설정이 다 만들어진 뒤에 여기서 맞춘다 — `PanesConfig`가 프리셋을 알 이유는 없다.
            let preset_probe_cfg = PresetProbeConfig::from_args(&paths);
            if preset_probe_cfg.enabled {
                if panes_cfg.count <= 1 {
                    panes_cfg.count = PRESET_PROBE_PANES;
                }
                eprintln!(
                    "[eqmux] 배치 프리셋 무인 확인 — 대상 {} · 세션 {}개 · out = {}",
                    preset_probe_cfg.target,
                    panes_cfg.count,
                    preset_probe_cfg.out_path.display()
                );
            }

            // `S2-5` — 탭 무인 확인. 일반 화면 위에서 돈다. 패널은 하나면 충분하다 —
            // 탭은 패널 **안**의 일이라 여러 칸이 있어도 증명되는 것이 늘지 않는다.
            let tab_probe_cfg = TabProbeConfig::from_args(&paths);
            if tab_probe_cfg.enabled {
                eprintln!(
                    "[eqmux] 탭 무인 확인 — 탭 {}개 · out = {}",
                    tab_probe_cfg.tabs,
                    tab_probe_cfg.out_path.display()
                );
            }

            if panes_cfg.probe {
                eprintln!(
                    "[eqmux] 패널 무인 검증 — 목표 {}개 · out = {}",
                    panes_cfg.count,
                    panes_cfg.out_path.display()
                );
            } else if panes_cfg.count > 1 {
                eprintln!("[eqmux] 기동 분할 — 패널 {}개", panes_cfg.count);
            } else if panes_cfg.count == 0 {
                eprintln!("[eqmux] 빈 화면(진단 · SPIKE-A4) — 터미널·PTY·WebGL 없음");
            }

            // 계측 모드는 로컬 에코로 렌더러만 재므로 PTY를 붙이지 않는다.
            // 두 경로가 같이 돌면 셸 에코와 로컬 에코가 겹쳐 숫자가 오염된다.
            if probe_cfg.enabled && pty_probe_cfg.enabled {
                eprintln!("[eqmux] ⚠️ --latency-probe와 --pty-probe는 같이 못 쓴다 — PTY 검증만 돈다");
            }
            // 프런트 분기 순서(폭 > 지연 > 패널 > PTY)와 같은 말이어야 한다 — 다르면 경고가 거짓말이 된다.
            if panes_cfg.probe && font_cfg.enabled {
                eprintln!("[eqmux] ⚠️ --font-probe와 --panes-probe는 같이 못 쓴다 — 폭 계측만 돈다");
            }
            if panes_cfg.probe && probe_cfg.enabled {
                eprintln!("[eqmux] ⚠️ --latency-probe와 --panes-probe는 같이 못 쓴다 — 지연 계측만 돈다");
            }
            if panes_cfg.probe && pty_probe_cfg.enabled {
                eprintln!("[eqmux] ⚠️ --pty-probe와 --panes-probe는 같이 못 쓴다 — 패널 검증만 돈다");
            }
            // 폭 계측은 재고 바로 끝난다. 지연 계측과 겹치면 둘 다 못 쓴다.
            if font_cfg.enabled && probe_cfg.enabled {
                eprintln!("[eqmux] ⚠️ --font-probe와 --latency-probe는 같이 못 쓴다 — 폭 계측만 돈다");
            }
            // 프리셋 확인은 일반 화면 위에서 돌므로 앞의 검증들에 전부 진다 (프런트 분기 순서와 같은 말).
            if preset_probe_cfg.enabled {
                if font_cfg.enabled {
                    eprintln!("[eqmux] ⚠️ --font-probe와 --preset-probe는 같이 못 쓴다 — 폭 계측만 돈다");
                }
                if probe_cfg.enabled {
                    eprintln!("[eqmux] ⚠️ --latency-probe와 --preset-probe는 같이 못 쓴다 — 지연 계측만 돈다");
                }
                if panes_cfg.probe {
                    eprintln!("[eqmux] ⚠️ --panes-probe와 --preset-probe는 같이 못 쓴다 — 패널 검증만 돈다");
                }
                if pty_probe_cfg.enabled {
                    eprintln!("[eqmux] ⚠️ --pty-probe와 --preset-probe는 같이 못 쓴다 — 프리셋 확인만 돈다");
                }
            }
            // 탭 확인은 프리셋 확인 바로 뒤다 — 프런트 분기 순서와 같은 말이어야 한다.
            if tab_probe_cfg.enabled {
                for (flag, on) in [
                    ("--font-probe", font_cfg.enabled),
                    ("--latency-probe", probe_cfg.enabled),
                    ("--panes-probe", panes_cfg.probe),
                    ("--preset-probe", preset_probe_cfg.enabled),
                    ("--pty-probe", pty_probe_cfg.enabled),
                ] {
                    if on {
                        eprintln!("[eqmux] ⚠️ {flag}와 --tab-probe는 같이 못 쓴다 — {flag} 쪽만 돈다");
                    }
                }
            }

            if paths.isolated {
                // 격리 인스턴스라는 사실은 반드시 보이게 남긴다.
                // 라이브인 줄 모르고 잰 값은 측정이 아니라 오염이다.
                eprintln!("[eqmux] 격리 인스턴스로 기동한다");
                eprintln!("[eqmux]   state     = {}", paths.state_file.display());
                eprintln!("[eqmux]   workspace = {}", paths.workspace_root.display());
                if let Some(d) = &paths.webview_data_dir {
                    eprintln!("[eqmux]   webview   = {}", d.display());
                }
            }

            let mut win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("EQMUX")
                .inner_size(1100.0, 720.0)
                .min_inner_size(640.0, 400.0);

            // Electron의 --user-data-dir 대응. 이게 갈려야 캐시·로컬스토리지가 섞이지 않는다.
            if let Some(dir) = paths.webview_data_dir.clone() {
                win = win.data_directory(dir);
            }

            let window = win.build()?;

            // `S2-10` — 유휴 연동 메모리 정책. 정적 레버(--memory-target=low · SPIKE-A4)가
            // 있으면 정책은 스스로 꺼지고(정적이 이긴다) 여기서 한 번만 Low를 적용한다.
            let mem_policy = memlevel::MemoryPolicy::from_args();
            let static_low = std::env::args().any(|a| a == "--memory-target=low");
            app.manage(mem_policy);
            if static_low {
                eprintln!("[eqmux] 정적 메모리 레버 — MemoryUsageTargetLevel(Low) 상시");
                memlevel::apply(app.handle(), memlevel::Level::Low);
            } else {
                let policy = app.state::<memlevel::MemoryPolicy>();
                policy.spawn_worker(app.handle().clone());
                // 기동 자체가 활동이다 — 첫 유휴 카운트는 여기서 시작한다.
                policy.touch();
            }

            // 포커스 "획득"은 활동이다. 지속 포커스는 아니다 — 근거는 memlevel.rs 머리말.
            window.on_window_event({
                let handle = app.handle().clone();
                move |ev| {
                    if matches!(ev, tauri::WindowEvent::Focused(true)) {
                        handle.state::<memlevel::MemoryPolicy>().touch();
                    }
                }
            });

            let font_probe_running = font_cfg.enabled;

            // 기동 시점 크기를 stderr에 남긴다 (`S2-1b`).
            //
            // 별도 스레드인 이유: 디스크를 도는 동안 창이 안 뜨면 콜드 스타트(KR3)가 그만큼 늘어난다.
            // 계측 모드에서는 아예 돌리지 않는다 — 500표본을 재는 4초 동안 옆에서 디스크를 긁으면
            // 그 잡음이 A-3 숫자에 얹힌다. 용량을 보려다 지연을 오염시키면 둘 다 잃는다.
            // 폭 계측도 마찬가지다 — 재고 바로 종료하는 실행에 디스크 훑기를 얹을 이유가 없다.
            if !probe_cfg.enabled && !font_probe_running {
                let snapshot = paths.clone();
                std::thread::spawn(move || {
                    appdata::log_report(&appdata::scan(&snapshot), "기동");
                });
            }

            // 레이아웃을 창보다 먼저 읽어 둔다 (`S2-1`).
            // 프런트가 `layout_get`을 부르는 시점에는 이미 확정돼 있어야 한다 —
            // 없으면 "빈 화면을 먼저 그리고 나중에 재배치"가 되고, 그 깜빡임은 못 지운다.
            let loaded = layout::load(&paths.state_file);
            layout::log_load(&loaded, &paths.state_file);
            let layout_store = layout::LayoutStore::new(paths.state_file.clone(), loaded.state);

            // 명령에서 State<_>로 꺼내 쓴다.
            app.manage(layout_store);
            app.manage(paths);
            app.manage(AppDataWatch::default());
            app.manage(probe_cfg);
            app.manage(pty_probe_cfg);
            app.manage(font_cfg);
            app.manage(panes_cfg);
            app.manage(preset_probe_cfg);
            app.manage(tab_probe_cfg);
            app.manage(PtyManager::default());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("EQMUX 기동 실패");
}
