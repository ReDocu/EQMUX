// 사람이 셸 페인에서 친 `eqmux …`의 콘솔 대리인 (B248). 배포할 때 `eqmux.com`으로 이름을 바꿔 eqmux.exe 옆에 둔다.
// 릴리스 eqmux.exe는 GUI 서브시스템이라, pwsh·cmd가 기다리지 않고 출력·종료 코드도 사라진다.
// PATHEXT는 .COM이 .EXE보다 앞이라 같은 폴더의 `eqmux`는 이 콘솔 exe로 잡힌다. 이 exe는 옆의
// eqmux.exe를 파이프로 띄워 출력을 옮기고 종료 코드를 그대로 돌려준다. 파이프로 부르면 원래 정상이다.
// Git Bash(에이전트)는 .com을 찾지 않으므로 지금처럼 eqmux.exe를 직접 부른다.
// ponytail: Ctrl+C는 이 대리인만 끝낸다 — `send --wait` 중이면 eqmux.exe가 시간 초과까지 남는다

#[cfg(windows)]
fn main() {
    use std::io::copy;
    use std::process::{Command, Stdio};

    let exe = std::env::current_exe().map(|p| p.with_file_name("eqmux.exe")).unwrap_or_else(|_| "eqmux.exe".into());
    let mut child = match Command::new(&exe)
        .args(std::env::args_os().skip(1))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("eqmux: {} — {e}", exe.display());
            std::process::exit(1);
        }
    };
    let mut err = child.stderr.take().unwrap();
    let t = std::thread::spawn(move || copy(&mut err, &mut std::io::stderr()));
    let _ = copy(child.stdout.as_mut().unwrap(), &mut std::io::stdout());
    let _ = t.join();
    std::process::exit(child.wait().ok().and_then(|s| s.code()).unwrap_or(1));
}

#[cfg(not(windows))]
fn main() {}
