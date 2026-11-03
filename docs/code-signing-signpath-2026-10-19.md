# 코드 서명 — SignPath Foundation 신청 방법 (2026-10-19)

EQMUX 0.5.1은 서명하지 않은 `eqmux.exe`를 포터블 zip으로 배포한다. 그래서 처음 실행하면 SmartScreen이 "알 수 없는 게시자" 경고를 띄운다. 이 문서는 무료 오픈소스 코드 서명인 [SignPath Foundation](https://signpath.org)을 신청하는 절차와, 신청 전에 EQMUX에서 채워야 할 빈칸을 정리한다. `implementation-status.md`의 K4(코드 서명) 항목에 해당한다.

조건은 2026-10-19에 [signpath.org/terms](https://signpath.org/terms)와 [GitHub 연동 문서](https://docs.signpath.io/trusted-build-systems/github)에서 확인했다. terms 페이지에는 **draft** 표시가 있어서 조건이 바뀔 수 있다. 신청 직전에 한 번 더 확인한다.

## 요약

- **무료다. 대신 게시자 이름이 "SignPath Foundation"으로 찍힌다.** 본인 이름이나 EQMUX로 찍히지 않는다. 본인 이름이 필요하면 유료 OV 인증서(Certum Open Source, SSL.com 등)로 가야 한다.
- **가장 큰 빈칸은 CI다.** SignPath는 "소스에서 검증 가능한 방식으로 자동 빌드된" 바이너리만 서명한다. 오픈소스 플랜에서는 서명 요청까지 이어지는 모든 job이 **GitHub 호스팅 러너**에서 돌았는지 검사한다. 지금 EQMUX는 CI가 없고 손으로 빌드한다(`명령어 정리.md` §4). 로컬에서 빌드한 exe는 서명받을 수 없다.
- **나머지 조건은 대부분 이미 맞다.** MIT 라이선스, 공개 저장소, 릴리스 이력(v0.4.0~v0.5.1), 의존성이 전부 오픈소스라는 점이 그렇다. 추가로 할 일은 웹 쪽 문서 두 개(코드 서명 정책·개인정보 문구)와 MFA다.
- **순서:** ① CI 만들기 → ② 정책 문서 넣기 → ③ 신청 → ④ 승인되면 서명 단계를 CI에 붙이기.

## 1. 자격 조건과 EQMUX 현황

| 조건 (signpath.org/terms) | EQMUX 현황 | 할 일 |
|---|---|---|
| 모든 구성요소가 OSI 승인 라이선스이고, 상업용 이중 라이선스가 없을 것 | MIT. 의존성(Tauri, xterm.js, CodeMirror, Solid, portable-pty, rusqlite 등)도 전부 오픈소스다 | 없음 |
| 독점(비오픈소스) 구성요소가 없을 것. 시스템 라이브러리는 허용 | WebView2는 시스템 런타임이라 번들하지 않는다 | 없음. 나중에 K7(WebView2 오프라인 번들)을 하면 다시 확인한다 |
| 활발히 유지보수 중이고, 서명받을 형태로 이미 릴리스했을 것 | GitHub Releases에 v0.4.0~v0.5.1 포터블 zip이 있다 | 없음 |
| 다운로드 페이지에 기능 설명이 있을 것 | 저장소 홈페이지가 Releases다. README에 설명이 있다 | 릴리스 본문에 README 링크나 한 줄 설명을 넣는다 |
| 바이너리를 소스에서 검증 가능한 방식으로 자동 빌드할 것 | **CI가 없다.** 손으로 `npm run tauri build -- --no-bundle` | **§2-1 CI 만들기** |
| 모든 릴리스는 서명 전에 사람이 수동 승인할 것 | — | SignPath 쪽에서 Approver가 승인한다(§3) |
| 팀원 전원이 SignPath와 GitHub에 MFA를 쓸 것 | 확인 필요 | GitHub 2FA를 켜고, SignPath 계정에도 MFA를 켠다 |
| 제품명은 프로젝트 이름, 제품 버전은 빌드끼리 일관될 것 | exe 메타데이터의 ProductName이 `EQMUX`, 버전은 `tauri.conf.json`을 따른다 | 서명 설정(artifact configuration)에서 이 둘을 강제한다(§3) |
| 홈페이지와 다운로드 페이지에 "Code signing policy" 페이지가 있을 것 | 없다 | **§2-2** |
| 개인정보 처리방침, 또는 "사용자가 요청하지 않으면 다른 네트워크 시스템으로 정보를 보내지 않는다"는 문구 | 없다. 코드상 앱이 스스로 보내는 통신은 없다. 브라우저 패널과 링크 열기는 사용자가 연다 | **§2-2** |
| 금지: 악성코드·PUP, 해킹 도구, 알리지 않은 데이터 전송, 경고 없는 시스템 설정 변경, 설치형인데 제거 수단이 없는 것 | 포터블이라 설치 과정이 없다. 해당 없음 | 아래 주의 참고 |

**주의 — 경고 없는 시스템 변경.** ~~EQMUX는 에이전트 훅과 상태 줄을 위해 `~/.claude` 아래 설정을 고친다~~ (정정 2026-11-02: 코드로 확인해 보니 고치지 않는다. 훅(`eqmux _hook`)과 상태 줄(`_statusline`)은 앱 데이터 폴더의 `hook-settings.json`에 만들고, 세션을 띄울 때 `--settings`로만 싣는다(`lib.rs:1142`). Codex는 `-c` 인라인 인자로 싣는다.) 이 조건에는 걸리지 않는다. 그래도 정책 문서와 README에 "무엇을 어디에 쓰고, 어디는 건드리지 않는지"를 적어 두면 심사에 유리하다(0.6 §9-2).

## 2. 신청 전에 할 일

### 2-1. GitHub Actions 릴리스 빌드

SignPath에 보낼 exe는 GitHub 호스팅 러너가 빌드해야 한다. 지금의 손 순서(`명령어 정리.md` §4-2)를 그대로 옮기면 된다. 초안은 아래와 같다. 신청할 때 "CI로 빌드하고 있다"는 것을 보여 주려면 서명 단계 없이 이 부분만 먼저 넣어 둔다.

```yaml
# .github/workflows/release.yml (초안)
name: release
on:
  push:
    tags: ['v*']
permissions:
  contents: read
  actions: read
jobs:
  build:
    runs-on: windows-latest          # 호스팅 러너여야 한다 — self-hosted면 서명이 거부된다
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - uses: dtolnay/rust-toolchain@stable
      - run: npm ci
      - run: npm test
      - run: npm run tauri build -- --no-bundle
      - id: upload
        uses: actions/upload-artifact@v4
        with:
          name: eqmux-unsigned
          path: src-tauri/target/release/eqmux.exe
      # 승인 뒤 §4의 서명 단계를 여기에 붙인다
```

- 포터블 zip의 `README.txt`는 저장소에 없고 직전 릴리스 자산에서 이어 쓴다(`명령어 정리.md` §4-3). 서명 대상은 `eqmux.exe` 하나면 충분하다. zip 포장은 서명된 exe를 받은 뒤에 지금처럼 손으로 해도 된다.
- 빌드 스크립트와 CI 설정도 서명 근거에 들어간다. 그래서 `.github/workflows`를 고치는 변경도 코드처럼 리뷰 대상이다.

### 2-2. 코드 서명 정책·개인정보 문구

terms가 요구하는 페이지다. 저장소에 `CODE_SIGNING_POLICY.md`를 두고 README와 릴리스 본문에서 링크하면 된다. "홈페이지"와 "다운로드 페이지"가 각각 저장소 README와 Releases다. 내용은 아래 네 가지다.

```markdown
# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io),
certificate by [SignPath Foundation](https://signpath.org).

## Team roles
- Committers and reviewers: [ReDocu](https://github.com/ReDocu)
- Approvers: [ReDocu](https://github.com/ReDocu)

## Privacy policy
This program will not transfer any information to other networked systems
unless specifically requested by the user or the person installing or operating it.
```

- 1인 프로젝트라 Author, Reviewer, Approver를 모두 한 사람이 맡는다. 외부 PR을 받으면 Reviewer가 리뷰한 뒤에만 병합한다.
- 개인정보 문구는 SignPath가 제시한 표준 문장을 그대로 쓴다. EQMUX가 띄우는 에이전트 CLI(Claude Code 등)의 통신은 사용자가 실행한 것이다. 그래도 한 줄 덧붙여 두면 오해가 없다.
- §1의 "앱이 쓰는 곳 · 쓰지 않는 곳"을 README의 "알아 둘 점"에 적는다(`~/.claude`는 고치지 않는다).

### 2-3. MFA

- GitHub 계정의 2FA를 켠다(Settings → Password and authentication).
- 신청 뒤 만드는 SignPath 계정에도 MFA를 켠다.

## 3. 신청

1. [signpath.org/apply](https://signpath.org/apply)에서 신청 양식을 낸다. 프로젝트 이름, 저장소 URL, 라이선스, 다운로드 페이지, 담당자 연락처를 적는다. 양식 항목은 페이지가 스크립트로 그려서 미리 확인하지 못했다. 신청할 때 화면을 보고 채운다.
2. 심사는 재량이다. terms에도 "수락 의무가 없고, 독립적인 이의 절차도 없다"고 적혀 있다. 거절되면 유료 OV 인증서로 간다.
3. 승인되면 SignPath.io 조직(Open Source 플랜)이 열린다. 거기서 아래를 설정한다.
   - **Trusted build system:** 미리 정의된 `GitHub.com`을 추가하고 EQMUX 프로젝트에 연결한다. 감사 로그 평가를 쓰려면 **SignPath GitHub App**을 저장소에 설치한다.
   - **Project:** slug 예시 `eqmux`.
   - **Artifact configuration:** 업로드는 기본 zip이라 루트가 `zip-file`이고, 그 안의 `eqmux.exe`를 `pe-file`로 서명한다. ProductName `EQMUX`와 버전 일관성 제약도 여기서 건다.
   - **Signing policy:** `release-signing`. 수동 승인(Approver)이 켜져 있어야 한다.
   - **API token:** Submitter 권한이 있는 토큰을 만들어 GitHub 저장소 시크릿 `SIGNPATH_API_TOKEN`에 넣는다.

## 4. 승인 뒤 — CI에 서명 단계 붙이기

§2-1 워크플로의 업로드 단계 뒤에 아래를 붙인다.

```yaml
      - uses: signpath/github-action-submit-signing-request@v3
        with:
          api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
          organization-id: '<SignPath 조직 ID>'
          project-slug: 'eqmux'
          signing-policy-slug: 'release-signing'
          github-artifact-id: ${{ steps.upload.outputs.artifact-id }}
          wait-for-completion: true
          output-artifact-directory: 'signed'
      - uses: actions/upload-artifact@v4
        with:
          name: eqmux-signed
          path: signed/eqmux.exe
```

- `wait-for-completion: true`면 Approver가 SignPath 웹에서 승인할 때까지 job이 기다린다. 타임아웃 입력이 따로 있다.
- 같은 파일 이름을 다시 업로드하면 실패하는 `upload-artifact` 버그가 알려져 있다(actions/upload-artifact #769, #785). 아티팩트 이름을 버전마다 다르게 하면 피할 수 있다.
- 서명된 exe를 받으면 `명령어 정리.md` §4-3처럼 zip으로 묶어 릴리스에 올린다. 그 문서의 "4-2 빌드"는 "CI 아티팩트 받기"로 바꾼다.
- 서명한 뒤에도 SmartScreen 평판이 쌓이기 전까지는 경고가 남을 수 있다. 다만 SignPath Foundation 인증서는 여러 프로젝트가 함께 쓰는 인증서라 평판이 이미 쌓여 있다. 그래서 새 개인 인증서보다는 빨리 풀릴 것으로 본다(실측은 아직 없다).

## 5. 남은 결정

- 게시자가 "SignPath Foundation"으로 찍혀도 괜찮은지. 괜찮지 않으면 이 문서 대신 OV 인증서로 간다.
- CI를 도입하면 릴리스 순서가 "손 빌드"에서 "태그 push → CI 빌드 → SignPath 승인 → zip"으로 바뀐다. `명령어 정리.md` §4도 같이 고쳐야 한다.
- 자동 업데이트(K3)를 함께 할지. Tauri updater 서명(`tauri signer generate`)은 SignPath와 별개이고 무료라서, 같은 워크플로에 얹을 수 있다.
