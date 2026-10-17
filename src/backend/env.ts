// 환경변수 보기 (실행 › 환경변수) — 워크스페이스 루트의 .env 계열 파일을 읽어 KEY=VALUE로 보인다.
// 읽기 전용이다. 값은 비밀이 많아 화면이 기본으로 가린다 (EnvPanelTab).
import { fsRead } from "./panels";

/** 살펴보는 파일 — 흔한 dotenv 이름들. ponytail: 고정 목록, 다른 이름이 필요하면 여기에 더한다 */
export const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.test",
];

export interface EnvVar {
  key: string;
  value: string;
}

export interface EnvFile {
  file: string;
  vars: EnvVar[];
}

/** dotenv 한 파일 → 변수 목록. 주석·빈 줄·`export ` 머리를 걸러내고, 따옴표 값은 벗긴다.
 *  ponytail: 여러 줄 값(따옴표 안 줄바꿈)은 첫 줄만 — 필요해지면 그때 */
export function parseDotenv(text: string): EnvVar[] {
  const out: EnvVar[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'" || q === "`") && value.length > 1 && value.endsWith(q)) {
      value = value.slice(1, -1);
      if (q === '"') value = value.replace(/\\n/g, "\n");
    } else {
      value = value.replace(/\s+#.*$/, ""); // 따옴표 없는 값의 줄 끝 주석
    }
    out.push({ key, value });
  }
  return out;
}

/** 워크스페이스 루트의 .env 계열 중 있는 것만 — 없거나 못 읽는 파일은 조용히 건너뛴다 */
export async function loadEnvFiles(wsPath: string): Promise<EnvFile[]> {
  const read = await Promise.all(
    ENV_FILES.map((file) =>
      fsRead(wsPath, file).then(
        (c) => ({ file, vars: parseDotenv(c.text) }),
        () => undefined,
      ),
    ),
  );
  return read.filter((f): f is EnvFile => !!f);
}
