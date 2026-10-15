# bbarit-agent-oss 기능 정리

> 출처: https://github.com/bbarit/bbarit-agent-oss (README 기준, 2026-08-02 조사)
>
> 이 저장소는 **에이전트 CLI 단독 오픈소스**로, 별도 제품인 BBARIT Terminal(멀티플렉서)의
> 기능은 포함하지 않는다(README에 "BBARIT Terminal과 상태를 공유하지 않는다"고 명시).
> 아래 "터미널" 항목은 이 에이전트가 가진 **터미널 UI(TUI)** 기능이다.

---

## 🖥️ 터미널 (TUI / 입출력)

- **풀스크린 인터랙티브 TUI** — 기본 실행 모드, 현재 디렉터리에서 구동
- **트랜스크립트 렌더링** — 워드랩 + 코드 구문 강조, 툴 호출 상세 표시
- **라이브 토큰 스트리밍** — 스트리밍 중 실시간 토큰 카운트 표시
- **피커 UI** — 모델/로그인/페르소나 선택 피커(페르소나는 id·이름·설명 퍼지 검색)
- **테마 지원** (`/themes`)
- **셸 스타일 히스토리** — 위/아래 화살표로 입력 이력 탐색
- **키 조작** — Tab으로 메뉴 열기, Esc로 에이전트 실행 중단
- **타이틀바 페르소나 배지** — 현재 활성 페르소나 표시
- **슬래시 커맨드 체계** — `/login` `/model` `/session` `/memory` `/wiki` `/help` 등
  전 기능을 커맨드로 조작
- **HTML 내보내기/가져오기/공유** — `/export` `/import` `/share`
  (세션을 자체 완결 HTML로 저장)

## 🤖 에이전트

### 코어 루프

- 자율 툴-유즈 루프 (assistant → tool call → result 반복, 작업 완료까지)
- 자동 컨텍스트 컴팩션 (세션이 길어지면 자동 압축)
- 병렬 서브에이전트 오케스트레이션 (`--orchestrate "task1" "task2"` —
  독립 프로세스로 병렬 실행 후 결과 집계)
- 백그라운드 코드 인덱싱 — 내장 `semble` 엔진(BM25 + 시맨틱 하이브리드 검색)

### 모델/프로바이더

- 15+ 프로바이더, 1,000+ 모델 (Anthropic, OpenAI/Codex, Gemini/Vertex, OpenRouter,
  Groq, Mistral, Together, Fireworks, DeepSeek, Cerebras, Bedrock, GitHub Copilot)
- Ollama 로컬 모델 지원 (오프라인 가능, `OLLAMA_HOST` 자동 탐색)
- 세션 중 모델 전환 (`/model`), 추론 강도 조절 (`--thinking low|medium|high`)

### 툴셋

- 파일: `read` `write` `edit`(해시 검증 수정) / 셸: `bash`
- 탐색: `grep` `find` `ls` `tree` (gitignore 인식), `code_search`
- 웹: `web_search`, `web_fetch`
- 데스크톱 제어: `computer` 툴 (스크린샷 + 마우스/키보드, `/computer on|off`)
- 툴 제한: `--tools` 허용목록, `--exclude-tools`, `--no-tools`
- LSP(언어 서버) 연동 진단

### 페르소나

- 30개 도메인, **295개 내장 페르소나**
  (엔지니어링·디자인·보안·마케팅·법률·게임개발 등)
- `/persona`, `--persona`, `BBARIT_PERSONA`로 적용, `defaultPersona` 설정
- 읽기전용 페르소나(`%%mode=readonly`) — 감사자/리뷰어 역할은 파일 변경 거부
- 전문성·작업 스타일·우선순위·금기 사항을 담은 "성격 브리프" 제공

### 크로스 세션 메모리

- 턴 시작 시 키워드 매칭 회상(LLM 지연 없음) + 턴 종료 시 백그라운드
  서브에이전트로 추출
- 메모리 타입: `user` / `feedback` / `project` / `reference`
- 마크다운 파일 + `MEMORY.md` 인덱스, `/memory show|forget|reset` 관리,
  `BBARIT_AUTO_MEMORY=0`으로 끄기
- 세션별 커서로 중복 추출 방지, 서브에이전트에서는 추출 안 함(재귀 방지)

### 프로젝트 위키

- 프로젝트별 격리된 마크다운 노트 (다른 프로젝트에 지식 유출 없음)
- 위키링크·태그 지원, `/wiki` 검색·조회·삭제
- 변경은 파일 편집처럼 게이트 처리 (플랜 모드·읽기전용 페르소나에서 차단)

### 세션 관리

- JSONL 트리 세션, 최근 30개 자동 정리
- 브랜치/포크/클론/이름변경/재개 (`/fork` `/clone` `/resume` `/new`)

### 확장성

- MCP 서버 등록 (`/mcp add`, 프로젝트별 `.mcp.json`)
- 스킬 시스템 (`SKILL.md` 드롭인, `/skill new`로 스캐폴딩)
- **Claude Code / Codex 상호운용** — `~/.claude.json`, `~/.codex/config.toml`을
  읽기 전용으로 그대로 사용 (`/interop on|off`, `BBARIT_INTEROP=1`)
- 로컬 JS/TS 확장 — 커맨드·툴·훅·단축키·커스텀 프로바이더 추가

### 실행 모드

- 인터랙티브 TUI (기본)
- 원샷 `--print` 모드 (stdout=답변만, stderr=진행 로그 — 스크립트/파이프용)
- `--mode json` — NDJSON 이벤트 스트림
  (`session`, `agent_start`, `message_update`, `turn_end`, `agent_end`)
- `--approve` — 프로젝트 신뢰 기반 변경 게이트

## 📦 기타 (설정 · 배포 · 라이선스)

### 설정/저장소

- 모든 설정이 `~/.bbarit-oss/agent/` 아래 자체 격리
  (자격증명·세션·메모리·위키·.env), 구 `~/.pi/agent` 1회 마이그레이션
- API 키 해석 우선순위: `--api-key` → `/login` 저장 자격증명 → 프로바이더 설정 →
  환경변수 (바이너리에 하드코딩 없음)
- 인증 방식 — 프로바이더별 OAuth/디바이스 로그인/API 키, 첫 실행 시 자동 로그인 피커
- 환경변수 스위치 — `BBARIT_AGENT_MODE`, `BBARIT_AUTO_CONTEXT`, `BBARIT_INTEROP`,
  `BBARIT_SUBAGENT`, `BBARIT_AUTO_UPGRADE`, `BBARIT_NO_UPDATE_CHECK`,
  `BBARIT_UPDATE_BASE`, `BBARIT_INSTALL_DIR` 등

### 설치/업데이트

- macOS/Linux curl 원라이너, Windows PowerShell 원라이너, 소스 빌드(cargo)
- 지원 플랫폼: macOS arm64/x64, Linux x64/arm64, Windows x64
- 자체 업데이트 — `--upgrade`/`/update` 원자적 바이너리 교체, 다운그레이드 거부,
  시작 시 비차단 업데이트 확인

### 아키텍처/라이선스

- Rust 단일 정적 바이너리(런타임 의존성 없음), 멀티프로세스 오케스트레이터
- "작고 읽기 쉬운 에이전트 루프" 설계 철학 (Pi 계승)
- MIT 라이선스. Pi(Mario Zechner) 기반, 페르소나는 AgentLand에서 각색,
  semble 번들, PROVENANCE.md/NOTICE에 출처 명시
