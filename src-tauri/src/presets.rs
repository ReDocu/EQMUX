//! S2-11 — 배치 프리셋 엔진 (프리셋 → 레이아웃 트리).
//!
//! # 이 파일이 정하는 것
//!
//! 프리셋 6종이 **지금 있는 세션 N개**를 어떤 모양으로 늘어놓을지다.
//! 트리 자료구조와 불변식은 `layout.rs`가 든다 — 여기는 **모양만** 만든다.
//!
//! # 🔴 재배열이지 재생성이 아니다
//!
//! 프리셋 적용은 트리 모양만 바꾼다. **잎(세션)은 그대로 옮겨 담는다.**
//! 새 잎을 만들고 옛 잎을 버리면 그 잎이 참조하던 PTY가 `layout_close` 경로로 통째로 죽는다
//! (`S2-2`에서 잡은 kill 누수의 반대 방향 사고다).
//!
//! 그래서 재배열은 `LayoutState::rearrange` 하나만 쓴다 — 잎 노드를 **꺼내서 그대로 다시 담는다.**
//! id·`pty_id`·`title`·`cwd`가 전부 따라간다. 이 성질은 테스트로 못 박혀 있다
//! (`프리셋_6종_전부_잎_신원을_보존한다`).
//!
//! # 열 우선(`grid-col`) — 전작 계승
//!
//! AgentCommender의 격자는 **세로로 채우고 새 열**이다(FEATURE-DIFF **H1** · `model.ts:167,223-232`).
//! wmux 문서가 "행 우선"이라 적은 것은 틀린 기술이다. 상태바 라벨 `2 × 4 · GRID-COL`이
//! 이 규칙을 화면에 드러낸다.
//!
//! 그래서 **잎은 트리 순서 그대로 첫 열을 위에서 아래로 채우고, 다 차면 다음 열로 넘어간다.**
//!
//! # N이 정원과 안 맞을 때 — **열 수를 지키고 행을 늘린다·줄인다**
//!
//! 디자인은 N=8을 상정한다("현재 팀의 세션 8개"). N이 3이거나 11일 때는 디자인에 없어서
//! 여기서 정한다. 셋 중 하나를 골라야 했다(브리프 §2).
//!
//! | 후보 | 왜 안 골랐나 |
//! |---|---|
//! | 빈 칸을 남긴다 | 트리에 "빈 칸"이 없다. 만들려면 잎을 새로 내야 하는데 그 잎은 곧 세션이다 — 안 부른 셸이 뜬다 |
//! | 남는 세션을 마지막 칸에 겹쳐 쌓는다 | 겹쳐 쌓기는 탭(`S2-5`)이다. 아직 없는 개념을 프리셋이 먼저 발명하면 S2-5가 그걸 물려받아야 한다 |
//! | **프리셋을 N에 맞춘다** ← 채택 | 사용자가 클릭한 것은 *"2열로 세로 배치"* 라는 **모양**이다. 그 모양을 지키면서 N을 담는다 |
//!
//! 채택안의 규칙은 한 줄이다. **열 수 C를 지키고, N을 열에 앞에서부터 고르게 나눈다.**
//! (`C_실제 = min(C, N)` · 앞쪽 열이 한 칸 더 갖는다)
//!
//! ```text
//! 2 × 4 · N=8  → [4, 4]      정원과 같다 — 디자인 그대로
//! 2 × 4 · N=5  → [3, 2]      열은 둘 그대로. 행이 줄었다
//! 2 × 4 · N=11 → [6, 5]      열은 둘 그대로. 행이 늘었다
//! 4 × 2 · N=5  → [2, 1, 1, 1]
//! 8 × 1 · N=3  → [1, 1, 1]   열이 셋으로 준다 (min(8,3))
//! ```
//!
//! **왜 "세로 4개 채우고 새 열"(엄격 계승)이 아닌가.** 그 규칙은 전작에서 *세션이 늘어날 때
//! 자동으로 배치되는* 격자의 규칙이었다. 여기서는 사용자가 `4 × 2`를 **직접 골랐다.**
//! 행을 2로 고정하면 N=5에서 열이 셋이 되어 화면이 `3 × 2`가 된다 — **고른 것과 다른 것이 나온다.**
//! 열 우선 규칙은 *채우는 순서*로 계승하고, *열 수*는 사용자가 고른 값을 지킨다.
//!
//! # 정원(`capacity`)은 상한이 아니다
//!
//! 디자인이 상정한 세션 수(8)일 뿐이다. N > 8이어도 거부하지 않는다 — 거부하면 사용자는
//! "왜 안 되는지" 모른 채 아무 일도 안 일어나는 화면을 본다. 상한은 패널 상한(`MAX_PANELS` 16)과
//! 노드 상한(`MAX_NODES`)이 이미 들고 있다.

use serde::Serialize;

use crate::error::{Error, Result};
use crate::layout::{Child, Direction, LayoutState, Node, MAX_NODES};

/// 메인 페인이 가져가는 비율 (`메인 + 우측 스택` · `메인 + 하단 나열`).
///
/// 디자인은 "큰 페인 1 + 스택"이라고만 하고 비율을 적지 않았다. 3:2로 둔다 —
/// 8개일 때 나머지 7개가 남은 40%를 나눠도 한 칸이 최소 폭(`MIN_PANEL_PX` 100)을 넘는다.
/// **적용 후 드래그로 조정할 수 있다**(디자인 푸터) — 그래서 여기 값은 출발점이지 결론이 아니다.
const MAIN_WEIGHT: f64 = 0.6;

/// 프리셋이 트리를 만드는 방식.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// 열 우선 격자. **열 수를 고정**하고 N을 열에 나눠 담는다(§N 불일치).
    Grid { columns: usize },
    /// 큰 페인 하나 + 나머지 전부를 한 줄로. `axis`는 뿌리 분할 방향이다 —
    /// `Row`면 나머지가 우측 세로 스택, `Column`이면 하단 가로 나열이 된다.
    Main { axis: Direction },
}

/// 프리셋 하나의 정의. **6종은 디자인 실물(`tveEh` / `M0FL0`)에서 왔다.**
#[derive(Debug, Clone, Copy)]
pub struct PresetDef {
    /// 안정 키. 상태 파일(`S3-4`)과 피커(`S2-12`)가 이 값으로 프리셋을 지목한다.
    pub id: &'static str,
    /// 피커 칸에 그려질 이름 — 디자인 문구 그대로.
    pub label: &'static str,
    /// 상태바·컨텍스트 바용 짧은 이름 (`S2-13` — `2 × 4 · GRID-COL`의 앞부분).
    pub short: &'static str,
    /// 배치 규칙 표기 (`S2-13` — 같은 라벨의 뒷부분).
    pub rule: &'static str,
    /// 디자인이 상정한 세션 수. **상한이 아니다**(§정원).
    pub capacity: usize,
    kind: Kind,
}

/// 프리셋 6종 — 디자인 `M0FL0` Equal Layout Preset Grid의 6칸 순서 그대로.
pub const PRESETS: &[PresetDef] = &[
    PresetDef {
        id: "grid-2x4",
        label: "2 × 4 그리드",
        short: "2 × 4",
        rule: "GRID-COL",
        capacity: 8,
        kind: Kind::Grid { columns: 2 },
    },
    PresetDef {
        id: "grid-4x2",
        label: "4 × 2 그리드",
        short: "4 × 2",
        rule: "GRID-COL",
        capacity: 8,
        kind: Kind::Grid { columns: 4 },
    },
    PresetDef {
        id: "grid-1x8",
        label: "1 × 8 세로",
        short: "1 × 8",
        rule: "GRID-COL",
        capacity: 8,
        kind: Kind::Grid { columns: 1 },
    },
    PresetDef {
        id: "grid-8x1",
        label: "8 × 1 가로",
        short: "8 × 1",
        rule: "GRID-COL",
        capacity: 8,
        kind: Kind::Grid { columns: 8 },
    },
    PresetDef {
        id: "main-right",
        label: "메인 + 우측 스택",
        short: "메인 + 우측",
        rule: "MAIN-RIGHT",
        capacity: 8,
        kind: Kind::Main {
            axis: Direction::Row,
        },
    },
    PresetDef {
        id: "main-bottom",
        label: "메인 + 하단 나열",
        short: "메인 + 하단",
        rule: "MAIN-BOTTOM",
        capacity: 8,
        kind: Kind::Main {
            axis: Direction::Column,
        },
    },
];

/// 프런트로 나가는 프리셋 메타 (`listPresets`).
///
/// `axis`·`groups`는 **지금 세션 수 N에 대한 실제 배치**다 — 피커(`S2-12`)가 이걸로
/// "고르면 이렇게 된다"를 그릴 수 있다. 정원(8) 기준 고정 그림이 아니다.
#[derive(Debug, Clone, Serialize)]
pub struct PresetInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub short: &'static str,
    pub rule: &'static str,
    pub capacity: usize,
    /// 뿌리 분할 방향. `row`면 `groups`가 **열**, `column`이면 **행**이다.
    pub axis: Direction,
    /// 각 칸에 들어갈 잎 수 — 앞에서부터 채운다(열 우선).
    pub groups: Vec<usize>,
    /// 지금 이 프리셋이 걸려 있는가 (`S2-12` — 현재 배치를 선택 상태로 표시).
    pub current: bool,
}

/// id로 정의를 찾는다.
pub fn find(id: &str) -> Option<&'static PresetDef> {
    PRESETS.iter().find(|p| p.id == id)
}

/// 지금 상태 기준 6종 메타. **하드코딩 금지**(`S2-12` 브리프 §2) — 피커가 이걸 받아 그린다.
pub fn list(state: &LayoutState) -> Vec<PresetInfo> {
    let n = state.root.leaf_ids().len();
    PRESETS.iter().map(|d| info(d, n, state)).collect()
}

// 지금 걸린 프리셋의 **라벨을 여기서 만들지 않는다.** 상태바(`S2-13`)가 쓰는 값은
// `layout_get`의 `preset`(id)과 `layout_presets`의 메타를 프런트에서 맞춘 것이다 —
// `panels.ts::currentPreset()`이 그 자리다. 라벨 조립을 양쪽에 두면 언젠가 갈린다.

fn info(d: &'static PresetDef, n: usize, state: &LayoutState) -> PresetInfo {
    let (axis, groups) = plan(d.kind, n);
    PresetInfo {
        id: d.id,
        label: d.label,
        short: d.short,
        rule: d.rule,
        capacity: d.capacity,
        axis,
        groups,
        current: state.preset.as_deref() == Some(d.id),
    }
}

/// 프리셋을 적용한다 — **트리 모양만 바꾸고 잎은 그대로 옮겨 담는다.**
pub fn apply(state: &mut LayoutState, id: &str) -> Result<()> {
    let def = find(id).ok_or_else(|| {
        Error::Path(format!(
            "모르는 프리셋이다: {id} (있는 것: {})",
            PRESETS
                .iter()
                .map(|p| p.id)
                .collect::<Vec<_>>()
                .join(", ")
        ))
    })?;

    let n = state.root.leaf_ids().len();
    let (axis, groups) = plan(def.kind, n);

    // 새 트리가 노드 상한을 넘을 수 있는가. 넘는 상태를 만들어 놓고 저장에서 거부당하면
    // 화면과 파일이 갈린다 — 만들기 전에 막는다.
    let nodes = node_count(&groups);
    if nodes > MAX_NODES {
        return Err(Error::Path(format!(
            "프리셋 적용이 노드 상한을 넘는다: {nodes} > {MAX_NODES}"
        )));
    }

    let weights = weights_for(def.kind, &groups);
    state.rearrange(|leaves| build(axis, &groups, &weights, leaves));
    state.preset = Some(def.id.to_string());
    Ok(())
}

/// 지금 트리가 그 프리셋의 **모양 그대로인가**(비율은 안 본다).
///
/// 불러온 상태 파일이 들고 온 프리셋 이름을 믿을지 판단하는 자리다(`layout::load`).
/// 손으로 고친 파일, 다른 버전이 쓴 파일이 이름만 남기고 모양이 다를 수 있다 —
/// **틀린 이름이 상태바에 뜨는 것이 이름이 없는 것보다 나쁘다.**
///
/// 비율을 안 보는 이유는 디자인이 정한다 — *"적용 후에도 분할선을 드래그해 비율을 조정할 수
/// 있습니다"*. **비율만 바뀐 것은 여전히 그 프리셋이다.**
pub fn still_matches(state: &LayoutState, id: &str) -> bool {
    let Some(def) = find(id) else {
        return false;
    };
    let n = state.root.leaf_ids().len();
    let (axis, groups) = plan(def.kind, n);
    shape_of(&state.root) == planned_shape(axis, &groups)
}

// ── 모양 만들기 ──────────────────────────────────────────────────────────────

/// N을 어떻게 나눌지. 돌려주는 것은 (뿌리 방향, 칸마다 들어갈 잎 수)다.
fn plan(kind: Kind, n: usize) -> (Direction, Vec<usize>) {
    let n = n.max(1);
    match kind {
        Kind::Grid { columns } => {
            // 열 수는 사용자가 고른 값을 지킨다. 다만 잎보다 많은 열은 만들 수 없다.
            let c = columns.clamp(1, n);
            let base = n / c;
            let rem = n % c;
            // 앞쪽 열이 한 칸 더 갖는다 — 열 우선(위에서 아래로 채우고 다음 열)의 자연스러운 결과다.
            let groups = (0..c).map(|i| base + usize::from(i < rem)).collect();
            (Direction::Row, groups)
        }
        Kind::Main { axis } => {
            if n <= 1 {
                (axis, vec![1])
            } else {
                (axis, vec![1, n - 1])
            }
        }
    }
}

/// 칸 비율. 격자는 등분, 메인 계열은 3:2다.
fn weights_for(kind: Kind, groups: &[usize]) -> Vec<f64> {
    match kind {
        Kind::Main { .. } if groups.len() == 2 => vec![MAIN_WEIGHT, 1.0 - MAIN_WEIGHT],
        _ => vec![1.0 / groups.len() as f64; groups.len()],
    }
}

/// 잎을 순서대로 칸에 담는다. **잎 노드는 만들지 않는다 — 받은 것을 그대로 옮긴다.**
fn build(axis: Direction, groups: &[usize], weights: &[f64], leaves: Vec<Node>) -> Node {
    debug_assert_eq!(groups.len(), weights.len());
    debug_assert!(groups.iter().all(|g| *g >= 1), "빈 칸은 만들지 않는다");

    let inner = opposite(axis);
    let mut rest = leaves.into_iter();
    let mut children: Vec<Child> = Vec::with_capacity(groups.len());

    for (g, w) in groups.iter().zip(weights) {
        let mut taken: Vec<Node> = rest.by_ref().take(*g).collect();
        if taken.is_empty() {
            continue;
        }
        let node = if taken.len() == 1 {
            // 칸이 하나면 잎을 그대로 둔다. 감싸면 `normalize`가 어차피 걷어낸다.
            taken.pop().expect("길이 1")
        } else {
            let each = 1.0 / taken.len() as f64;
            Node::split(
                inner,
                taken
                    .into_iter()
                    .map(|node| Child { weight: each, node })
                    .collect(),
            )
        };
        children.push(Child { weight: *w, node });
    }

    // 계산이 어긋나 남은 잎이 있으면 버리지 않고 마지막 칸 뒤에 붙인다.
    // **잎을 잃는 것은 세션을 잃는 것이다** — 모양이 틀리는 쪽이 낫다.
    for node in rest {
        children.push(Child { weight: 1.0, node });
    }

    if children.len() == 1 {
        return children.pop().expect("길이 1").node;
    }
    Node::split(axis, children)
}

fn opposite(d: Direction) -> Direction {
    match d {
        Direction::Row => Direction::Column,
        Direction::Column => Direction::Row,
    }
}

/// 새 트리가 몇 노드가 되는가 — 잎 + 칸 분할 + 뿌리.
fn node_count(groups: &[usize]) -> usize {
    let leaves: usize = groups.iter().sum();
    let inner = groups.iter().filter(|g| **g > 1).count();
    let root = usize::from(groups.len() > 1);
    leaves + inner + root
}

// ── 모양 비교 ────────────────────────────────────────────────────────────────

/// id·비율을 뺀 트리 모양. `still_matches`가 이것만 비교한다.
#[derive(Debug, PartialEq, Eq)]
enum Shape {
    Leaf,
    Split(Direction, Vec<Shape>),
}

fn shape_of(node: &Node) -> Shape {
    match node {
        Node::Leaf { .. } => Shape::Leaf,
        Node::Split {
            direction,
            children,
            ..
        } => Shape::Split(*direction, children.iter().map(|c| shape_of(&c.node)).collect()),
    }
}

/// `build` + `normalize`가 만들어 낼 모양. **외자식 분할이 걷힌 뒤**의 모양이어야 한다 —
/// 안 그러면 `1 × 8`처럼 칸이 하나뿐인 프리셋이 스스로와 안 맞는다고 나온다.
fn planned_shape(axis: Direction, groups: &[usize]) -> Shape {
    let inner = opposite(axis);
    let cell = |g: &usize| -> Shape {
        if *g == 1 {
            Shape::Leaf
        } else {
            Shape::Split(inner, (0..*g).map(|_| Shape::Leaf).collect())
        }
    };
    if groups.len() == 1 {
        return cell(&groups[0]);
    }
    Shape::Split(axis, groups.iter().map(cell).collect())
}

// ── 테스트 ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// 잎 N개짜리 트리. 잎마다 PTY를 붙여 둔다 — 재배열이 참조를 지키는지 봐야 한다.
    fn tree_with(n: usize) -> LayoutState {
        let mut st = LayoutState::single_terminal();
        let mut last = st.root.leaf_ids()[0].clone();
        for _ in 1..n {
            last = st.split(&last, Direction::Row).unwrap();
        }
        let ids = st.root.leaf_ids();
        for (i, id) in ids.iter().enumerate() {
            st.attach_pty(id, Some(format!("pty-{i}"))).unwrap();
        }
        // split이 preset을 지운다 — 프리셋 없는 상태에서 시작한다.
        assert_eq!(st.preset, None);
        st
    }

    /// 잎 id → pty_id 표. 신원 보존을 이걸로 대조한다.
    fn identities(st: &LayoutState) -> Vec<(String, Option<String>)> {
        let mut out = Vec::new();
        collect(&st.root, &mut out);
        fn collect(n: &Node, out: &mut Vec<(String, Option<String>)>) {
            match n {
                Node::Leaf { id, pty_id, .. } => out.push((id.clone(), pty_id.clone())),
                Node::Split { children, .. } => {
                    for c in children {
                        collect(&c.node, out);
                    }
                }
            }
        }
        out
    }

    #[test]
    fn 프리셋은_여섯_종이고_id가_겹치지_않는다() {
        assert_eq!(PRESETS.len(), 6);
        for (i, a) in PRESETS.iter().enumerate() {
            for b in &PRESETS[i + 1..] {
                assert_ne!(a.id, b.id, "id가 겹친다: {}", a.id);
            }
            assert!(!a.label.is_empty() && !a.short.is_empty() && !a.rule.is_empty());
        }
    }

    /// 🔴 브리프 §2 최상단 요구 — **잎 신원이 보존되는가.**
    #[test]
    fn 프리셋_6종_전부_잎_신원을_보존한다() {
        for d in PRESETS {
            for n in [1usize, 2, 3, 5, 8, 11] {
                let mut st = tree_with(n);
                let before = identities(&st);

                apply(&mut st, d.id).unwrap();
                let after = identities(&st);

                assert_eq!(
                    before, after,
                    "{} · N={n} — 잎 id·PTY 참조가 순서까지 그대로여야 한다",
                    d.id
                );
                assert_eq!(st.root.leaf_ids().len(), n, "{} · N={n} — 잎 수", d.id);
                st.validate().unwrap_or_else(|e| panic!("{} · N={n} — {e}", d.id));
            }
        }
    }

    #[test]
    fn 프리셋을_연달아_바꿔도_세션은_그대로다() {
        let mut st = tree_with(8);
        let before = identities(&st);
        for d in PRESETS.iter().chain(PRESETS.iter().rev()) {
            apply(&mut st, d.id).unwrap();
            assert_eq!(identities(&st), before, "{} 적용 후", d.id);
        }
    }

    #[test]
    fn 정원과_같은_세션수는_디자인_모양_그대로다() {
        let cases = [
            ("grid-2x4", Direction::Row, vec![4, 4]),
            ("grid-4x2", Direction::Row, vec![2, 2, 2, 2]),
            ("grid-1x8", Direction::Row, vec![8]),
            ("grid-8x1", Direction::Row, vec![1, 1, 1, 1, 1, 1, 1, 1]),
            ("main-right", Direction::Row, vec![1, 7]),
            ("main-bottom", Direction::Column, vec![1, 7]),
        ];
        for (id, axis, groups) in cases {
            let (a, g) = plan(find(id).unwrap().kind, 8);
            assert_eq!((a, &g), (axis, &groups), "{id}");

            let mut st = tree_with(8);
            apply(&mut st, id).unwrap();
            assert_eq!(shape_of(&st.root), planned_shape(axis, &groups), "{id} 트리 모양");
        }
    }

    #[test]
    fn n이_정원과_달라도_열_수를_지킨다() {
        // 열 수는 고른 값 그대로, 행만 늘고 준다 (§N 불일치).
        assert_eq!(plan(find("grid-2x4").unwrap().kind, 5).1, vec![3, 2]);
        assert_eq!(plan(find("grid-2x4").unwrap().kind, 11).1, vec![6, 5]);
        assert_eq!(plan(find("grid-4x2").unwrap().kind, 5).1, vec![2, 1, 1, 1]);
        // 잎보다 많은 열은 못 만든다.
        assert_eq!(plan(find("grid-8x1").unwrap().kind, 3).1, vec![1, 1, 1]);
        assert_eq!(plan(find("grid-4x2").unwrap().kind, 1).1, vec![1]);
        // 메인 계열은 언제나 "하나 + 나머지".
        assert_eq!(plan(find("main-right").unwrap().kind, 5).1, vec![1, 4]);
        assert_eq!(plan(find("main-right").unwrap().kind, 1).1, vec![1]);
    }

    #[test]
    fn 잎이_하나면_뿌리가_잎이다() {
        for d in PRESETS {
            let mut st = tree_with(1);
            apply(&mut st, d.id).unwrap();
            assert!(st.root.is_leaf(), "{}", d.id);
            st.validate().unwrap();
        }
    }

    #[test]
    fn 메인_계열은_큰_페인을_먼저_둔다() {
        let mut st = tree_with(4);
        let first = st.root.leaf_ids()[0].clone();
        apply(&mut st, "main-right").unwrap();
        match &st.root {
            Node::Split {
                direction,
                children,
                ..
            } => {
                assert_eq!(*direction, Direction::Row);
                assert_eq!(children.len(), 2);
                assert!(children[0].node.is_leaf(), "첫 칸이 큰 페인이다");
                assert_eq!(children[0].node.id(), first, "트리 첫 잎이 메인이 된다");
                assert!((children[0].weight - MAIN_WEIGHT).abs() < 1e-9);
                assert_eq!(children[1].node.leaf_ids().len(), 3, "나머지가 스택으로");
            }
            _ => panic!("뿌리가 분할이 아니다"),
        }
    }

    #[test]
    fn 비율은_정규화되고_등분이다() {
        let mut st = tree_with(8);
        apply(&mut st, "grid-2x4").unwrap();
        match &st.root {
            Node::Split { children, .. } => {
                assert_eq!(children.len(), 2);
                for c in children {
                    assert!((c.weight - 0.5).abs() < 1e-9);
                    match &c.node {
                        Node::Split { children, .. } => {
                            for cc in children {
                                assert!((cc.weight - 0.25).abs() < 1e-9);
                            }
                        }
                        _ => panic!("열이 분할이 아니다"),
                    }
                }
            }
            _ => panic!("뿌리가 분할이 아니다"),
        }
    }

    #[test]
    fn 모르는_프리셋은_거부하고_트리를_안_건드린다() {
        let mut st = tree_with(4);
        let before = identities(&st);
        assert!(apply(&mut st, "grid-3x3").is_err());
        assert_eq!(identities(&st), before);
        assert_eq!(st.preset, None);
    }

    #[test]
    fn 프리셋_이름은_적용으로_붙고_구조_변경으로_떨어진다() {
        let mut st = tree_with(4);
        apply(&mut st, "grid-2x4").unwrap();
        assert_eq!(st.preset.as_deref(), Some("grid-2x4"));
        assert!(still_matches(&st, "grid-2x4"));

        // 비율만 바뀐 것은 여전히 그 프리셋이다 (디자인 푸터 — 드래그로 조정 가능).
        let split_id = st.root.id().to_string();
        st.set_weights(&split_id, &[3.0, 1.0]).unwrap();
        assert_eq!(st.preset.as_deref(), Some("grid-2x4"));
        assert!(still_matches(&st, "grid-2x4"));

        // 구조가 바뀌면 이름이 떨어진다 — 상태바가 거짓말을 하면 안 된다.
        let leaf = st.root.leaf_ids()[0].clone();
        st.split(&leaf, Direction::Column).unwrap();
        assert_eq!(st.preset, None);
    }

    #[test]
    fn 닫아도_이름이_떨어진다() {
        let mut st = tree_with(4);
        apply(&mut st, "grid-4x2").unwrap();
        let leaf = st.root.leaf_ids()[0].clone();
        st.close(&leaf).unwrap();
        assert_eq!(st.preset, None);
    }

    #[test]
    fn 모양이_안_맞으면_이름을_안_믿는다() {
        let mut st = tree_with(8);
        apply(&mut st, "grid-2x4").unwrap();
        // 이름만 남기고 모양을 바꾼 파일 — 손으로 고쳤거나 다른 버전이 썼다.
        st.preset = Some("grid-8x1".into());
        assert!(!still_matches(&st, "grid-8x1"));
        assert!(still_matches(&st, "grid-2x4"));
    }

    #[test]
    fn 메타는_지금_세션수로_계산되고_현재_배치를_표시한다() {
        let mut st = tree_with(5);
        apply(&mut st, "grid-4x2").unwrap();
        let list = list(&st);
        assert_eq!(list.len(), 6);

        let cur = list.iter().filter(|p| p.current).collect::<Vec<_>>();
        assert_eq!(cur.len(), 1);
        assert_eq!(cur[0].id, "grid-4x2");
        assert_eq!(cur[0].groups, vec![2, 1, 1, 1], "정원(8)이 아니라 지금 세션 수(5) 기준이다");
        // 상태바(`S2-13`)가 `4 × 2 · GRID-COL`을 이 두 칸으로 만든다.
        assert_eq!((cur[0].short, cur[0].rule), ("4 × 2", "GRID-COL"));
    }
}
