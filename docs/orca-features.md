# Orca 기능 정리

> 출처: https://www.onorca.dev/docs (전체 문서 약 50페이지, 2026-08-02 조사)
>
> Orca는 "여러 AI 코딩 에이전트를 나란히 돌리는 데스크톱 IDE"다. 태스크마다
> 자체 git 워크트리·에이전트 터미널·브라우저 탭을 부여한다.
> 명시적 비목표: AI 모델이 아니고(사용자가 구독 중인 에이전트를 실행),
> git 대체제가 아니며(실제 git 워크트리 사용), 호스팅 VPS 상품도 아니다(기본 로컬 실행).

---

## 🖥️ 터미널

- **xterm.js 기반 터미널** (VS Code와 동일 엔진) + AI 에이전트 워크플로 확장
- **탭/스플릿** — 터미널 탭 분할(`Cmd-\` 우측, `Cmd-Shift-\` 하단), 새 탭 `Cmd-T`,
  새 에이전트 탭 `Cmd-Alt-T`, 탭 닫기 `Cmd-W`
- **에이전트 상태 표시 탭** — working / waiting for input / completed / 미확인 완료를 탭에 라이브 표시
- **스크롤백 검색** — `Cmd-F`, 하이라이트·대소문자·정규식 지원
- **Copy Context** — 우클릭으로 페인의 트랜스크립트를 범위 지정 복사(외부 도구 붙여넣기용)
- **TUI 클립보드 (OSC 52)** — Zellij/tmux/Neovim/fzf 등 TUI의 클립보드 쓰기 지원, SSH 원격 포함(기본 켜짐)
- **네이티브 키 바인딩** — kitty keyboard protocol 지원으로 `Shift+Enter`, `Ctrl+Enter` 등 실제 전달
- **테마** — 인기 테마 라이브러리, **Ghostty 설정 임포트**(테마·폰트·커서), **Warp 테마(YAML) 임포트**
- **Windows 셸 옵션** — PowerShell / CMD / WSL 기본 셸 선택, 탭바 **+** 드롭다운으로 일회성 선택,
  `\\wsl.localhost\...` 경로는 `wsl.exe -d <distro>`로 처리
- **JIS 키보드** — ¥ 키 → 백슬래시 매핑 옵션
- **플로팅 터미널** — 전역 셸 서피스 (`Cmd+Option+A` / `Ctrl+Alt+A`), 시작 디렉터리 설정 가능
- **Quick Commands** — 자주 쓰는 터미널 명령/에이전트 프롬프트 저장(전역·프로젝트 스코프),
  탭바 버튼으로 새 탭 실행 또는 현재 터미널에 삽입, 모바일과 양방향 동기화
- **터미널 스크롤백/세션 유지** — 백그라운드 데몬이 PTY를 소유해 앱을 닫아도 에이전트 CLI가 계속 실행,
  재실행 시 워프 재접속 + 앱이 닫혀 있던 동안의 출력까지 스크롤백 보존

## 🤖 에이전트

### 지원 에이전트

- **딥 통합**: Claude Code(사용량·핫스왑·훅), Claude Agent Teams(기본 꺼짐), Codex(사용량·핫스왑),
  Cursor CLI
- **자동 설정 지원**(30+): Grok, GitHub Copilot CLI, OpenCode, Pi, OMP, Gemini, Antigravity, Aider,
  Goose, Amp, Kilocode, Kiro, Charm Crush, Auggie, Cline, Codebuff, Continue, Devin, Droid(Factory),
  Kimi, Mistral Vibe, MiniMax, Qwen Code, Rovo Dev, Hermes, OpenClaw, Trae 등
- **GLM-5.2 연동** — Claude Code/OpenCode/Cline 등 기존 하네스를 통해 사용
  (Z.ai CodePlan 구독, `~/.claude/settings.json`에 모델 오버라이드 설정)
- **커스텀 CLI 에이전트 추가** — 이름·바이너리 경로·기본 인자·시작 훅(예: `source .envrc`) 등록,
  OSC 타이틀을 내보내면 상태 점 표시. 일반 bash/zsh도 콤보박스에서 실행 가능

### 실행/권한

- **자동 승인(Yolo) 기본 실행** — Claude `--dangerously-skip-permissions`,
  Codex `--dangerously-bypass-approvals-and-sandbox`, Gemini 등 `--yolo` 플래그를 기본 적용
  (워크트리를 "일회용 실험 환경"으로 취급하는 전제)
- **Yolo / Manual 모드 전환** — Settings → Agents → Agent Permissions
- **에이전트별 실행 인자·환경변수 오버라이드** + 기본값 리셋 버튼
- **Restart 칩** — 작업 디렉터리(Codex는 계정까지) 유지한 원클릭 재시작

### 세션/상태 관리

- **에이전트 세션 모델** — "워크트리 1개 × 터미널 1개 × CLI 에이전트 1개", 활성/유휴 추적
- **상태 인디케이터** — 스피너(작업중), 앰버 ?(입력 대기), 에메랄드 체크(완료), 빨강(차단/실패), 회색(유휴)
- **Agent Dashboard**(실험적) — 칸반 보드: "Needs You" / "Working" / "Done" / "Idle" 컬럼,
  인윈도우·팝아웃 모드, 워크트리/프로젝트/에이전트 검색, 프로젝트·상태·PR 필터
- **상태 감지** — OSC 타이틀 시퀀스 + 에이전트 훅 기반
- **서브에이전트 트리 표시** — Claude 백그라운드 서브에이전트·Codex Task 서브에이전트를
  부모 아래 확장 가능한 자식 행으로 표시
- **세션 이어가기** — "Continue in a new session": 이전 트랜스크립트 기반 핸드오프 프롬프트로 새 세션 시작

### 계정 관리

- **Codex 계정 핫스왑** — 재로그인·설정 편집 없이 즉시 계정 전환, 친화적 라벨("personal", "work"),
  시스템 기본 계정(`~/.codex`) + 격리 홈의 관리 계정, 실행 중 세션은 재시작 전까지 기존 계정 유지
- **Claude 다중 계정** — 동일 워크플로(`~/.claude`), 라이브 세션 중에도 전환 가능(인증 갱신 중복 가드)
- **Windows(WSL) Codex** — WSL 배포판 내 격리 홈, 호스트 경로 매핑

### 사용량/요금 추적

- **상태바 사용량 표시** — 활성 계정 플랜 대비 사용량, 5시간/일간/주간/Fable 주간 윈도 리셋 시각,
  80% 초과 시 경고 칩
- **로컬 상태 파일 기반** — `~/.claude`, `~/.codex` 등에서 읽음(API 호출·추가 인증 불필요)
- **사용량 팝오버** — 프로바이더별 플랜·리셋·윈도 바, 가장 빡빡한 한도 우선 정렬, 상세/컴팩트 모드
- **추정 비용(Stats)** — 로컬 가격표 기반 모델별 추정 비용

### 세션 히스토리

- **온디스크 트랜스크립트 자동 발견** — Claude/Codex/Cursor/Gemini 등 12개 CLI의 과거 세션을
  우측 패널에서 탐색
- 검색(제목·디렉터리·브랜치·모델·대화 미리보기), 스코프(Workspace/Project/All),
  정렬·그룹핑·빈 세션 숨김
- 액션: **Resume**(원래 디렉터리·세션 ID로 `--resume` 실행), 재개 명령 복사, 세션 ID/로그 경로 복사,
  로그 열기, cwd를 워크스페이스로 열기

### 에이전트 하이버네이션 (실험적)

- 완료 후 방치된 에이전트 터미널을 자동 정지, 워크트리를 다시 열면 동일 세션 자동 재개
- 조건: done 상태 + 비활성 워크트리 + 유휴 시간(기본 30분, 1분~24시간) + 재개 가능 에이전트
  (Claude, Codex, Gemini, OpenCode 등; Cursor CLI·Copilot 등은 불가)

### 훅 & 메모리

- **저장소별 훅** — 기존 `.claude/`·`.codex/` 설정을 그대로 읽어 워크트리 실행 시 적용
- **워크트리 셋업 훅** — 워크트리 생성 후 자동 명령(의존성 설치 등)
- **메모리 파일** — `CLAUDE.md`·`AGENTS.md`를 파일 탐색기에서 인라인 편집
- **훅 엔드포인트 영속화** — 앱 재시작 후에도 세션-서버 연결 유지

### Chat UI (네이티브 채팅, 실험적)

- 터미널 세션 위에 구조화된 트랜스크립트 + 컴포저를 얹은 채팅 인터페이스(터미널이 진실 원천)
- 파일/이미지 첨부, 슬래시 커맨드, 에이전트별 스킬 탐색, 사고 수준·모드 설정 필

### 멀티 에이전트 오케스트레이션 (`orca orchestration`)

- **모델**: Run(네임스페이스+인박스) → Task(pending/ready/dispatched/completed/failed/blocked) →
  Dispatch(터미널 단위 시도) → Message(status/dispatch/worker_done/escalation/question/heartbeat)
- **워커 운영** — `worker-start`(현재/자식/신규 워크트리, 원격 머신 지정 가능), `worker-read`,
  `worker-stop`, 재시도(`--retry-of`)
- **메시징** — `@all` `@idle` `@claude` `@codex` `@worktree:<id>` 등 그룹 주소로 브로드캐스트,
  `ask`로 코디네이터에 블로킹 질문
- **결정 게이트** — `gate-create`/`gate-resolve`로 사람 승인 전까지 태스크 차단
- **워커 계약** — `worker_done` 1회 송신(성공/실패 + 요약), 장기 작업 중 heartbeat

### 예약 자동화 (`orca automations`)

- 크론/RRULE 또는 프리셋(hourly/daily/weekdays/weekly) 트리거로 에이전트 작업 예약 실행
- 옵션: 프로바이더·저장소·워크스페이스·호스트 지정, `--precheck`(셸 검사 실패 시 스킵),
  `--reuse-session`, 누락 실행 유예 시간, 비활성 상태 생성
- 관리: list / show / edit / remove / 수동 run / 실행 이력(runs)

### 컴퓨터 사용 (`orca computer`)

- 접근성 트리 + 스크린샷 기반 로컬 데스크톱 앱 제어 (macOS는 Screen Recording 권한 추가 필요)
- 앱 열거·윈도우 목록·상태 읽기(`get-app-state`), click / set-value / type-text / press-key /
  hotkey / paste-text / scroll / drag / 좌표 클릭 폴백
- 민감 입력은 `--value-stdin` / `--text-stdin`으로 stdin 전달

### Agents 피드 (Activity)

- 전체 워크트리의 에이전트 이벤트(완료·블로킹 질문·워크트리 생성)를 스레드 피드로 표시
- 실행 중 에이전트 상단 고정, 최근 응답 미리보기, 클릭 시 해당 워크트리·페인으로 이동

## 📦 기타

### 워크트리 모델 (IDE 코어)

- **저장소 base ref + 워크트리별 start-from ref** — 브랜치·커밋·원격 브랜치 어디서든 분기
- **라이프사이클** — 생성(이슈 연결 포함) → 작업 → 리뷰(diff·주석·어트리뷰션) → 배포(커밋·푸시·PR) →
  아카이브/삭제(디렉터리+브랜치 원클릭 제거)
- **백그라운드 생성** — 다이얼로그 즉시 닫힘, `git fetch`/`git worktree add` 백그라운드 진행,
  사이드바 진행 표시, 실패 시 Retry
- **공유 디렉터리** — Worktree Shared Paths(APFS clone-copy/심링크),
  `orca.yaml`의 `worktree.sharedDirectories`(node_modules 등), `.worktreeinclude`(.env 등 복사)
- **이름 규칙** — 자동 해양생물 이름 또는 커스텀, 이모지 숏코드(`:rocket:` → 브랜치명 `rocket`),
  이슈 기반 브랜치명 자동 파생(Linear는 Linear 제안 브랜치명 사용)
- **사이드바** — 프로젝트별 그룹핑, 필터(잠자는/기본 브랜치/자동화 생성/CLI 생성/detached HEAD 숨김),
  핀 고정, 멀티 선택(Cmd/Shift+클릭), 드래그 정렬, 더블클릭 리네임, 미확인 굵게 표시
- **멀티 레포 프로젝트 그룹** — 폴더 워크스페이스로 상위 폴더 임포트, 그룹 단위 워크스페이스 생성
- **순수 git 호환** — 외부 생성 워크트리 감지 인박스, `git worktree remove` 시 자동 정리
- **탭·페인·스플릿** — 탭(터미널/에디터/브라우저/diff/PR)을 페인으로 그룹, 가장자리 드래그로 중첩 분할,
  경계 위치 워크트리별 저장, 워크트리 전환 시 페인 트리 전체 스왑
- **세션 복원** — 열린 워크트리·탭·페인 레이아웃·포커스가 재시작 후 복원
  ("새 세션으로 열기" 모드 없음 — 항상 이전 상태 복원)
- **Quick Open (`Cmd-P`)** — 워크트리 스코프 파일 검색, 최근성+매치 점수 랭킹, gitignored 파일 2차 포함
- **Jump Palette (`Cmd-J`)** — 워크트리·탭 통합 검색, PR/MR 번호(`#123`/`!123`) 매칭,
  `Shift-Enter`로 새 스플릿에 열기, 미매칭 시 "Create worktree" 옵션 생성

### 코드 리뷰 & 배포

- **Diff 뷰어** — staged/unstaged/untracked 통합 diff, 헝크/라인 단위 스테이징(비주얼 `git add -p`),
  이미지 diff(나란히/스와이프/어니언스킨), 3-way 머지 충돌 UI, 접이식 파일 트리, 워드랩,
  비교 기준 변경(임의 커밋·브랜치), 단축키 `j/k`(파일), `n/p`(헝크), `s`(스테이지), `c`(코멘트)
- **AI Diff 주석(Annotate AI Diff)** — diff 라인에 인라인 코멘트(마크다운), 수정 후에도 라인 추적,
  **Send to agent**로 전체 코멘트를 라인 앵커 포함 프롬프트로 컴파일해 에이전트에게 전달,
  Resolve로 스레드 접기, 미해결 코멘트 자동 재포함
- **어트리뷰션** — 에이전트가 만진 라인을 추적해 AI 작성/사람 작성 구분 거터 마커 표시,
  사람이 덮어쓰면 사람 작성으로 전환, 데이터는 로컬 전용(커밋 안 됨), diff 메타데이터 내보내기
- **커밋/푸시** — 커밋 메시지 **AI 생성**, pre-commit 훅 자동 실행 + 실패 시 **Fix with AI**,
  첫 푸시 시 업스트림 자동 설정, **force push with lease**, PR 생성(제목·본문 **AI 생성**, 드래프트),
  Amend(푸시된 커밋은 확인 요구), 머지/리베이스 충돌 시 **Resolve with AI**
- **Action Recipes** — AI 생성 프롬프트를 전역/저장소별 커스터마이즈
  (`{branch}` `{stagedPatch}` `{linkedIssue}` 등 템플릿 변수)
- **GitHub 통합** — 호스팅 리뷰 열기(GitHub/GitLab/Bitbucket/Azure DevOps/Gitea),
  PR 탭에서 체크·리뷰·코멘트 인라인 표시, 스레드 답글, **Fix broken checks**(실패 체크를 에이전트에 전달),
  자동 머지(Squash/Merge/Rebase, 머지 큐 지원), 이슈 브라우징·편집·워크트리 생성,
  Actions 실패 시 빨간 칩 + 로그 인라인, GitHub Projects 태스크 보드
- **Linear 연동** — 이슈 드로어(상태·담당자·우선순위·라벨·추정 편집), 이슈에서 워크트리 생성
  (Linear 제안 브랜치명), 이슈 내 이미지·미디어를 에이전트 컨텍스트에 포함, 상태 자동 "In Progress" 동기화(옵트인),
  `orca linear` CLI(조회·검색·생성·수정·관계·코멘트·첨부)
- **Jira 연동** — Cloud(API 토큰)·셀프호스티드(PAT/Basic), 통합 태스크 드로어, 인라인 편집·코멘트,
  이슈에서 워크트리 생성, URL 붙여넣기 인식, 멀티 사이트, OS 키체인 암호화 저장

### 편집기 & 뷰어

- **Monaco 에디터 + 자동 저장** — 블러/유휴 시 저장(dirty 표시 없음), 멀티 커서(`Cmd-D`),
  파일/워크트리 검색(`Cmd-F`/`Cmd-Shift-F`), 정의로 이동(`Cmd-Click`), 워드랩(`Alt+Z`),
  미니맵 옵션, 에디터 전용 폰트 설정
- **Changes 뷰 모드** — 커서 유지한 채 HEAD 대비 diff를 탭 안에서 토글, diff 뷰어와 동일 단축키
- **리치 마크다운 에디터** — `/` 슬래시 메뉴(헤딩·리스트·코드·콜아웃·이미지·Mermaid·토글 블록),
  `[[` 위키링크 자동완성, 렌더링 텍스트 검색, 리뷰 주석(Add Review Note), front matter 표시/숨김,
  표 키보드 내비게이션, 목차 패널, 리치↔Monaco 전환(`Cmd-Shift-M`)
- **뷰어** — Mermaid(.mmd 팬/줌), PDF(스크롤·줌·텍스트 선택), 이미지(png/jpg/svg/webp/gif + diff 모드),
  CSV/TSV 테이블 뷰어(정렬·검색·원문 편집 전환), Jupyter 노트북 베타(.ipynb 렌더+셀 편집)
- **파일 탐색기** — 실시간 동기화(에이전트 변경 포함), git 상태 색상, 우클릭(스테이지/discard/리네임/경로 복사),
  외부 드래그드롭(파일 복사, 마크다운에 이미지 삽입, 터미널에 경로 붙여넣기, SSH 원격 업로드),
  원격 파일/폴더 다운로드, Find in Folder

### 브라우저 & 디자인 모드

- **워크트리별 브라우저** — 워크트리 스코프 탭·스크롤 위치 복원, 주소창 퍼지 자동완성,
  find-in-page, 다운로드 셸프, 뷰포트 크기 에뮬레이션(CDP 기반), 링크 라우팅 설정(+수정자 키 반전)
- **Design Mode** — 렌더된 페이지의 UI 요소를 클릭하면 HTML·계산된 CSS·크롭 스크린샷·
  소스 파일/라인(소스맵)을 에이전트 채팅에 첨부 — "클릭 → 에이전트 수정 → 핫리로드 → 재클릭" 루프
- **브라우저 프로필** — 프로필별 쿠키/로컬스토리지/캐시 격리, 로그인 세션·user-agent·뷰포트 지정,
  에이전트 브라우저 명령이 활성 프로필 자동 상속
- **에이전트 브라우저 자동화** — `orca goto/snapshot/click/fill/screenshot/wait/console/network/pdf` 등

### 원격 & SSH

- **실행 방식 4종** — 로컬 데스크톱(기본) / SSH 타깃 / Remote Orca Server / Cloud VM(워크스페이스별 환경)
- **SSH 워크트리** — 원격에서 에이전트·git 실행, 에디터·diff·UI는 로컬,
  OpenSSH 설정 자동 임포트(Include 포함), 연결 재사용(멀티플렉싱), 프록시·점프 호스트, Kerberos/GSSAPI,
  연결 상태 칩(초록/노랑/빨강), 원격 PTY는 릴레이로 유지(앱 종료에도 생존), 포트 포워딩 탭(`Cmd+Shift+I`,
  리스닝 포트 자동 감지·원클릭 포워딩), VS Code Remote-SSH로 열기
- **Remote Orca Server** — 서버가 레포·워크트리·터미널·에이전트를 소유, 노트북·웹·모바일 멀티 클라이언트,
  Tailscale 페어링 링크 또는 헤드리스 `orca serve --pairing-address`, 클라이언트별 개별 취소 가능 토큰,
  노트북이 자도 에이전트 계속 실행
- **Cloud VM (실험적)** — 워크트리마다 `orca.yaml` 레시피로 온디맨드 환경 부팅
  (Vercel Sandbox, Fly, Modal, SSH 호스트, 로컬 Docker), 일시정지/재개/파기

### 모바일 컴패니언 (iOS / Android)

- 전체 워크트리·에이전트 상태 모니터링(모든 호스트 통합), 파일 트리 탐색
- 터미널/Chat UI 접근, Tab 등 특수키 액세서리 행, Live 모드 직접 스트리밍, 음성 딕테이션
- 짧은 응답 전송, 사진·파일 첨부, Quick Commands 실행(데스크톱과 동기화)
- 계정 전환·사용량 확인, Codex 리셋 크레딧 사용
- 모바일에서 워크스페이스 생성(Smart/GitHub/Linear/GitLab/브랜치), Source Control(스테이지·커밋·PR 연결)
- 브라우저 Web/Mobile 뷰포트 전환, 에이전트 완료 푸시 알림
- 페어링: 데스크톱 일회용 코드/딥링크, 디바이스 토큰 발급

### 알림 & 인박스

- 에이전트 완료 시 시스템 알림·사운드·워크트리 칩, 카테고리별 토글
- 헤더 벨(전체 워크트리 미확인 집계) + macOS Dock 배지, 클릭 시 해당 페인으로 점프
- 커스텀 알림음(MP3/WAV/OGG 등) + 볼륨 조절, 알림 "읽지 않음" 표시

### Orca CLI (`orca`)

- 실행 중인 Orca를 어떤 셸에서든 스크립팅 — 에이전트가 Orca 자체를 도구로 사용 가능
- 명령 그룹: `repo`(추가·base ref), `worktree`(생성·조회·코멘트·삭제, `--agent --prompt`로 에이전트 즉시 투입),
  `terminal`(읽기·입력 전송·유휴 대기·생성·분할), `file`(열기·diff), 브라우저(goto/snapshot/click/fill 등),
  `tab profile`, `emulator`(iOS 시뮬레이터·Android, 정규화 좌표 탭/제스처/회전),
  `linear`, `automations`, `orchestration`, `computer`, `skills`, `account`, `environment`, `agent hooks`
- 셀렉터 체계: `id:` `active` `path:` `branch:` `issue:` 등
- **워크트리 체크포인트** — `orca worktree set --comment` + `--workspace-status`(todo/in-progress/
  in-review/completed)로 에이전트가 진행 상황을 UI 카드에 직접 기록
- **스킬 레지스트리** — `npx skills add https://github.com/stablyai/orca --skill <name>`:
  orca-cli, orchestration, computer-use, orca-linear, orca-emulator(iOS), orca-emulator-android,
  orca-per-workspace-env
- **MCP** — Settings → Integrations → MCP로 외부 MCP 서버 등록

### 설치 · 설정 · 개인정보

- **설치** — macOS(Apple Silicon/Intel, 서명·공증, Homebrew cask), Windows 인스톨러,
  Linux(AppImage/.deb); 첫 실행 시 `~/.claude`·`~/.codex`·Ghostty 설정 임포트 제안
- **자동 업데이트** — stable 채널 기본, 수정자 클릭으로 RC/perf 프리릴리스 선택
- **설정 주요 항목** — UI 줌·테마·액센트·밀도·앱 아이콘·언어(한국어 포함 6종),
  상태바 리소스 매니저(CPU/메모리), 커밋 서명, GitHub API 쿼터 추적, 브랜치 자동 리네임,
  단축키 전체 리매핑(`~/.orca/keybindings.json`), 저장소별 아이콘·배지 색·훅·Shared Paths
- **음성 딕테이션** — 오프라인 모델(Parakeet/Zipformer/SenseVoice/Whisper Tiny, 한국어 지원 모델 포함)
  또는 클라우드(GPT-4o Transcribe), Toggle/Hold 모드
- **플러그인 시스템(실험적)** — git 마켓플레이스에서 탐색·설치·업데이트·롤백, 서드파티는 비신뢰 취급
- **텔레메트리** — 익명 사용 데이터(PostHog US), 설정 토글 / `DO_NOT_TRACK=1` /
  `ORCA_TELEMETRY_DISABLED=1`로 비활성화
