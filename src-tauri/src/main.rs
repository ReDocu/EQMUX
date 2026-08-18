// EQMUX — Tauri 엔트리. SessionService(PRD C)는 이 프로세스의 Rust 백엔드가 소유한다 (C1).
// 같은 바이너리가 CLI(PRD I)도 겸한다 — `eqmux send|report|_hook|_statusline|ping ...`은
// GUI를 띄우지 않고 파이프로 실행 중인 앱에 전달한다. 에이전트 PTY의 PATH에 앱 폴더가
// 앞서 있어 `eqmux`가 바로 잡힌다. 서브커맨드 목록은 cli.rs가 소유한다.
//
// 게이트 방향 (P-10) — "아는 커맨드만 CLI"가 아니라 "인자가 있으면 절대 GUI가 아니다".
// 반대로 두면 에이전트의 `eqmux --help`·오타·`send` 누락이 전부 새 앱 창으로 흘러,
// 대화를 시킬 때마다 창이 늘어난다. 모르는 인자는 사용법만 내고 끝낸다.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some(first) if eqmux_lib::is_cli_command(first) => std::process::exit(eqmux_lib::cli_main()),
        // 모르는 토큰 — CLI 오타든 미지의 서브커맨드든 GUI는 뜨지 않는다
        Some(_) => std::process::exit(eqmux_lib::cli_usage()),
        // 인자 없는 맨 `eqmux`. 세션 안(EQMUX_SESSION)에서 온 것이면 에이전트의 탐색 호출이므로
        // 역시 사용법이다 — 앱을 띄우는 건 사람이 아이콘으로 여는 경우뿐이다.
        None if std::env::var_os("EQMUX_SESSION").is_some() => {
            std::process::exit(eqmux_lib::cli_usage())
        }
        None => eqmux_lib::run(),
    }
}
