# 변경 기록

이 프로젝트의 눈에 띄는 변경을 적습니다. 0.5.x 이전 기록은 [GitHub Releases](https://github.com/ReDocu/EQMUX/releases)를 보세요.

## [0.6.0] — 미출시 (작업 중)

### 새 기능

- **git 화면**: 브랜치 그래프 · 커밋 상세 · 파일 히스토리 · blame, 파일 · 덩어리 단위 스테이징, 커밋 · amend, 브랜치 · 태그, fetch · pull(`--ff-only`) · push, merge · rebase · cherry-pick · revert · stash · reset, 충돌 덩어리 고르기, 커밋마다 고친 세션 배지. git 쓰기는 사람이 버튼을 눌러야 실행됩니다. 에이전트가 작업 중이면 pull · 브랜치 전환 전에 경고합니다. `clean` · `--force` · `--no-verify` · 대화형 rebase는 막혀 있고, `reset --hard`는 두 번 묻습니다. diff의 `.env` 값은 가려집니다.
- **승인함**: 대시보드에서 Claude Code의 도구 승인 요청에 [허용] · [거부]로 답합니다. 답은 Claude Code 권한 훅으로 전합니다.
- **동시 편집 경고**: 두 세션이 같은 파일을 고치면 페인 머리 · 대시보드 · 알림 센터에 알립니다.
- **관제**: 멈춘 세션 배지, 자리 비운 사이 요약, 하루 비용 예산 알림(기본 꺼짐).
- **빠른 시작**: 폴더만 고르면 리드 + 개발 두 세션으로 시작합니다. 마법사 단계 표시와 [뒤로]. 첫 실행 고지(앱이 쓰는 곳 · 쓰지 않는 곳), 다른 도구 흔적 점검, [진단 정보 복사].
- **트레이**: 창을 닫으면 트레이로 내려가고 세션은 계속 돕니다. 설정에서 '종료'로 바꿀 수 있습니다.
- **메시지 버스**: 직함으로 보내기, `--re` 회신, `send --wait`, `eqmux read` · `eqmux list`, 선행 임무가 끝나면 후행 임무 담당에게 알림.
- **임무**: 시작점(`base_commit`)과 그 뒤 커밋 수, 선행 임무(`depends_on`).
- **역할 · 캐릭터**: 직무별 모델(`model:`), 매 턴 상기(`remind:`), 캐릭터 기억(`memory:`), 초상 이미지, 실행 방식 화면의 '이 팀으로 시작'.
- **패널**: 환경변수 추가 · 고치기 · 지우기, 저장 명령(`.eqmux/commands.json`), 세션별 포트 범위(`EQMUX_PORT_BASE` · `EQMUX_PORT_END`).
- **브라우저 패널**: `eqmux browser console` · `network`, 에이전트 동작 중 대화상자 처리(`click --accept`), 낡은 `@eN` 참조 거부.

### 바뀐 점

- 비밀값 가리기: 로그 패널, `eqmux read` 출력. 비밀값 복사는 클립보드 기록 · 클라우드 동기화에서 뺍니다.
- 스크롤백 · 세션 로그 디스크 저장을 끌 수 있습니다.
- 저장소 손상 복구와 2GB 상한.
- 메시지가 실제로 에이전트 턴에 들어간 시점을 진단 로그에 남깁니다.

### 고친 것

- 한국어 Windows PowerShell 파이프에서 `eqmux` 출력이 깨지던 문제.
- 버스가 바쁠 때 · 잘못된 줄을 받았을 때의 응답(B124 · B125).
- 패널이 닫혀 있을 때 `eqmux browser open`이 `about:blank`를 돌려주던 문제(B156).
- 맨 셸 칸에 온 메시지가 터미널 본문에 섞이던 문제(B157).
- macOS 단일 인스턴스 · 소켓 정리(B116), 세션 종료 유예(B122).

### 배포

- GitHub Actions 빌드: Windows 포터블 zip · NSIS 설치 파일, macOS universal dmg, `SHA256SUMS`.
- `CODE_SIGNING_POLICY.md` · `SECURITY.md` · `CONTRIBUTING.md` · 이슈 템플릿.
