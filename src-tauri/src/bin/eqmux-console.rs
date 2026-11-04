// 사람이 셸 페인에서 친 `eqmux …`의 콘솔 대리인 (B248). 배포할 때 `eqmux.com`으로 이름을 바꿔 eqmux.exe 옆에 둔다.
// 릴리스 eqmux.exe는 GUI 서브시스템이라, pwsh·cmd가 기다리지 않고 출력·종료 코드도 사라진다.
// PATHEXT는 .COM이 .EXE보다 앞이라 같은 폴더의 `eqmux`는 이 콘솔 exe로 잡힌다. 이 exe는 옆의
// eqmux.exe를 띄워 출력을 옮기고 종료 코드를 그대로 돌려준다. 파이프로 부르면 원래 정상이다.
// Git Bash(에이전트)는 .com을 찾지 않으므로 지금처럼 eqmux.exe를 직접 부른다.
// ponytail: Ctrl+C는 이 대리인만 끝낸다 — `send --wait` 중이면 eqmux.exe가 시간 초과까지 남는다
//
// 콘솔로 가는 출력만 파이프로 받아 옮긴다. 이미 파이프 · 파일로 가는 출력은 그 핸들을 그대로 물려준다 (B285) —
// 그래야 eqmux.exe가 '읽는 쪽이 PowerShell인가'를 자기 stdout으로 판정해 한글을 콘솔 코드 페이지로 바꿔 쓴다.
// 콘솔이 없는 eqmux.exe는 코드 페이지를 모르므로 대리인의 것을 EQMUX_CONSOLE_CP로 넘긴다 (cli.rs say)

#[cfg(windows)]
fn main() {
    use std::io::{copy, IsTerminal};
    use std::process::{Command, Stdio};

    let exe = std::env::current_exe().map(|p| p.with_file_name("eqmux.exe")).unwrap_or_else(|_| "eqmux.exe".into());
    let out_console = std::io::stdout().is_terminal();
    let err_console = std::io::stderr().is_terminal();
    let pipe_if = |console: bool| if console { Stdio::piped() } else { Stdio::inherit() };
    let mut cmd = Command::new(&exe);
    cmd.args(std::env::args_os().skip(1)).stdout(pipe_if(out_console)).stderr(pipe_if(err_console));
    // 인자가 있을 때만 — 맨 `eqmux`는 GUI로 가고, 그 PTY 세션들에 이 값이 새지 않게 한다
    if std::env::args_os().nth(1).is_some() {
        let cp = unsafe { windows_sys::Win32::System::Console::GetConsoleOutputCP() };
        cmd.env("EQMUX_CONSOLE_CP", cp.to_string());
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("eqmux: {} — {e}", exe.display());
            std::process::exit(1);
        }
    };
    let t = child.stderr.take().map(|mut err| std::thread::spawn(move || copy(&mut err, &mut std::io::stderr())));
    if let Some(out) = child.stdout.as_mut() {
        let _ = copy(out, &mut std::io::stdout());
    }
    if let Some(t) = t {
        let _ = t.join();
    }
    std::process::exit(child.wait().ok().and_then(|s| s.code()).unwrap_or(1));
}

#[cfg(not(windows))]
fn main() {}
