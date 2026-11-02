// 비밀값 가리기 (§2 로그 마스킹 · B150) — `eqmux read`처럼 스크롤백 원문을 밖으로 내보내기 전에 쓴다.
// 패턴은 src/backend/secretPatterns.json 하나를 프런트(backend/secrets.ts)와 같이 읽는다.
// 정규식 없이 같은 바이트 훑기를 양쪽에 두고, 같은 cases를 양쪽 테스트가 돌린다.
// 구간은 ASCII 위치에서만 시작·끝나므로 UTF-8 경계를 자르지 않는다.
// ponytail: PEM 본문 줄(base64)과 머리 없는 임의 문자열은 못 잡는다 — 모양으로 알 수 없는 값이다

use std::sync::OnceLock;

#[derive(serde::Deserialize)]
struct Patterns {
    mask: String,
    prefixes: Vec<(String, usize)>,
    keywords: Vec<String>,
    #[serde(rename = "minValue")]
    min_value: usize,
    #[cfg_attr(not(test), allow(dead_code))]
    cases: Vec<(String, String)>,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/backend/secretPatterns.json"))
            .expect("secretPatterns.json — 빌드에 묶인 파일이라 깨지면 테스트가 먼저 잡는다")
    })
}

fn is_tok(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}
fn is_key(b: u8) -> bool {
    is_tok(b) || b == b'.'
}
fn is_space(b: u8) -> bool {
    b == b' ' || b == b'\t'
}
fn is_ws(b: u8) -> bool {
    is_space(b) || b == b'\n' || b == b'\r'
}
fn is_quote(b: u8) -> bool {
    b == b'"' || b == b'\'' || b == b'`'
}
fn ends_value(b: u8) -> bool {
    is_ws(b) || is_quote(b) || b == b',' || b == b';' || b == b'&'
}

fn run(b: &[u8], from: usize, ok: impl Fn(u8) -> bool) -> usize {
    let mut k = from;
    while k < b.len() && ok(b[k]) {
        k += 1;
    }
    k
}

fn spans(s: &str) -> Vec<(usize, usize)> {
    let p = patterns();
    let b = s.as_bytes();
    let n = b.len();
    let mut out = Vec::new();

    // 1) 알려진 토큰 머리 — 머리는 남기고 뒤를 가린다
    for (prefix, min) in &p.prefixes {
        for (i, _) in s.match_indices(prefix.as_str()) {
            if i > 0 && is_tok(b[i - 1]) {
                continue;
            }
            let j = i + prefix.len();
            let k = run(b, j, is_tok);
            if k - j >= *min {
                out.push((j, k));
            }
        }
    }

    // 2) 이름에 키워드가 든 KEY=값 · KEY: 값 · "key": "값"
    let mut i = 0;
    while i < n {
        if !is_key(b[i]) || (i > 0 && is_key(b[i - 1])) {
            i += 1;
            continue;
        }
        let k = run(b, i, is_key);
        let word = s[i..k].to_ascii_uppercase();
        i = k;
        if !p.keywords.iter().any(|w| word.contains(w.as_str())) {
            continue;
        }
        let mut q = k;
        if q < n && is_quote(b[q]) {
            q += 1;
        }
        q = run(b, q, is_space);
        if q >= n || (b[q] != b'=' && b[q] != b':') {
            continue;
        }
        q = run(b, q + 1, is_space);
        if q < n && is_quote(b[q]) {
            q += 1;
        }
        let e = run(b, q, |c| !ends_value(c));
        if e - q >= p.min_value {
            out.push((q, e));
        }
    }

    // 3) URL 안의 비밀번호 — scheme://user:pass@
    for (i, _) in s.match_indices("://") {
        let u = run(b, i + 3, |c| c != b':' && c != b'/' && c != b'@' && !is_ws(c));
        if u == i + 3 || u >= n || b[u] != b':' {
            continue;
        }
        let q = run(b, u + 1, |c| c != b'@' && c != b'/' && !is_ws(c));
        if q < n && b[q] == b'@' && q > u + 1 {
            out.push((u + 1, q));
        }
    }

    // 4) Bearer 토큰 (JWT의 . 와 base64의 / + = 포함)
    let lower = s.to_ascii_lowercase();
    for (i, _) in lower.match_indices("bearer ") {
        if i > 0 && is_tok(b[i - 1]) {
            continue;
        }
        let j = run(b, i + 7, is_space);
        let k = run(b, j, |c| is_tok(c) || c == b'.' || c == b'/' || c == b'+' || c == b'=');
        if k - j >= 8 {
            out.push((j, k));
        }
    }

    out.sort();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (a, z) in out {
        match merged.last_mut() {
            Some(last) if a <= last.1 => last.1 = last.1.max(z),
            _ => merged.push((a, z)),
        }
    }
    merged
}

/// 비밀값 모양을 가린 문자열 — 없으면 원문 그대로. 여러 줄 텍스트도 그대로 받는다
pub fn mask_secrets(s: &str) -> String {
    let sp = spans(s);
    if sp.is_empty() {
        return s.to_string();
    }
    let mask = &patterns().mask;
    let mut out = String::with_capacity(s.len());
    let mut last = 0;
    for (a, z) in sp {
        out.push_str(&s[last..a]);
        out.push_str(mask);
        last = z;
    }
    out.push_str(&s[last..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 프런트 secrets.test.ts와 같은 cases — 두 구현이 같은 결과를 낸다
    #[test]
    fn masks_shared_cases() {
        for (input, want) in &patterns().cases {
            assert_eq!(&mask_secrets(input), want, "입력: {input}");
        }
    }

    #[test]
    fn masks_across_lines() {
        let s = "a\nAPI_KEY=abcdefgh\nb";
        assert_eq!(mask_secrets(s), "a\nAPI_KEY=••••••••\nb");
    }
}
