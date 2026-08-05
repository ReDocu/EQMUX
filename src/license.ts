// 배포물에 OFL 1.1 전문이 **실제로 실려 있는가**를 앱이 스스로 답한다.
//
// 왜 코드로 박는가:
//   1. `dist/`에 파일이 있는 것과 실행 파일이 그것을 꺼내 주는 것은 다른 사건이다.
//      프런트 번들은 컴파일 시점에 exe 안으로 들어가므로, 빌드가 성공해도
//      옛 자산이 박힌 바이너리가 조용히 남을 수 있다(docs/HANDOVER-DEV-2026-08-05.md §6-1).
//   2. OFL 1.1 조건 2는 저장소가 아니라 **사용자가 받는 사본마다** 라이선스가 붙기를 요구한다.
//      저장소에서 파일이 사라지거나 `public/`에서 빠지면 그건 법적 회귀다 — 조용히 지나가면 안 된다.
//
// 판정은 해시로 한다. 이 파일은 2007년에 고정된 법적 문서라 **바뀌면 그게 사건**이다.
// 고지 첫 줄(폰트 저작권)이 바뀌어도 해시가 깨진다 — 폰트를 갈았다는 뜻이므로 그것도 사건이다.

import { logError, logInfo } from "./log";

/** `public/licenses/`에 두면 Vite가 `dist/`로 복사하고, 그 `dist/`가 exe에 박힌다. */
const LICENSE_PATH = "/licenses/LICENSE-OFL-1.1.txt";

/**
 * SIL 정본(https://openfontlicense.org/documents/OFL.txt)에서 받은 뒤
 * 빈칸(`<Copyright Holder>` 등) 5줄만 폰트 name 테이블 ID 0 값으로 채운 파일이다.
 * 본문은 정본과 diff 0바이트 — 근거와 재확인 명령은 `src/assets/fonts/NOTICE-D2Coding.md`.
 */
const EXPECT_SHA256 = "719f4b9237d61d376ee3ef033523c639978cd99e5dab9f2d8961bcc9bc565c98";
const EXPECT_BYTES = 4395;

export interface LicenseCheck {
  ok: boolean;
  bytes: number;
  sha256: string;
  reason?: string;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 배포물 안의 OFL 전문을 꺼내 해시로 대조한다. 실패해도 앱을 죽이지 않는다 —
 * 라이선스 누락은 배포를 막을 사유이지 사용자의 터미널을 막을 사유가 아니다.
 * 대신 **stderr에 한 줄로 남긴다.** 무인 실행에서도 보이는 유일한 경로다.
 */
export async function verifyBundledLicense(): Promise<LicenseCheck> {
  try {
    const res = await fetch(LICENSE_PATH);
    if (!res.ok) {
      const fail: LicenseCheck = { ok: false, bytes: 0, sha256: "", reason: `HTTP ${res.status}` };
      logError(`[license] OFL-1.1 미탑재 — ${LICENSE_PATH} ${fail.reason}`);
      return fail;
    }

    const buf = await res.arrayBuffer();
    const sha256 = await sha256Hex(buf);
    const bytes = buf.byteLength;

    if (sha256 !== EXPECT_SHA256) {
      // 크기까지 같은데 해시가 다르면 줄바꿈 변환(LF→CRLF)이 가장 흔한 원인이다.
      // `.gitattributes`의 `-text` 규칙이 빠졌는지 먼저 본다.
      const reason =
        bytes === EXPECT_BYTES ? "내용이 다르다" : `크기가 다르다(기대 ${EXPECT_BYTES} B)`;
      const fail: LicenseCheck = { ok: false, bytes, sha256, reason };
      logError(`[license] OFL-1.1 대조 실패 — ${reason} · sha256 ${sha256.slice(0, 12)}…`);
      return fail;
    }

    logInfo(`[license] OFL-1.1 탑재 확인 — ${bytes} B · sha256 ${sha256.slice(0, 12)}…`);
    return { ok: true, bytes, sha256 };
  } catch (e) {
    logError("[license] OFL-1.1 확인 중 예외", e);
    return { ok: false, bytes: 0, sha256: "", reason: "예외" };
  }
}
