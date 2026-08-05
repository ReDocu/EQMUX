//! S2-1 — 레이아웃 트리 모델과 직렬화.
//!
//! # 이 파일이 정하는 것
//!
//! 화면을 어떻게 나눌지의 **자료구조**와 그것을 디스크에 남기는 **포맷**이다.
//! 실제로 화면에 그리는 일은 `S2-2`, 분할선 드래그는 `S2-3`이다.
//!
//! `S2-2`~`S2-7`이 전부 이 트리 위에 얹히고 `S3-4`(세션 영속)가 이 포맷을 그대로 쓴다.
//! **여기서 정한 모양은 오래 간다** — 그래서 나중에 못 고치는 것부터 정했다.
//!
//! # 나중에 못 고치는 것 넷
//!
//! 1. **`version` 필드와 그 정책.** 숫자만 있고 행동이 없는 버전 필드는 장식이다.
//!    미래 버전을 만나면 **백업하고 초기화한다** — 근거는 §버전 정책.
//! 2. **잎은 터미널이 아니다.** `kind` 칸을 처음부터 둔다. `BACKLOG` B1(폴더 탐색기)이
//!    붙으면 터미널이 아닌 잎이 들어온다. 지금 안 두면 그때 트리를 다시 짠다.
//! 3. **잎은 PTY를 소유하지 않는다.** id만 든다. 소유자는 `PtyManager`다 (§소유권).
//! 4. **n분할을 중첩으로 흉내 내지 않는다.** `Split`은 자식을 여럿 갖고 각자 `weight`를 든다.
//!    4분할이 한 줄이면 트리도 한 줄이다 — 드래그 리사이즈(`S2-3`)가 인접 두 개만 만지면 된다.
//!
//! # 소유권 — 잎이 사라질 때 PTY는 누가 죽이나
//!
//! **`layout::LayoutState::close`가 죽일 id를 돌려주고, 그것을 호출한 명령
//! (`commands::layout::layout_close`)이 `PtyManager::kill`을 부른다. 프런트는 안 죽인다.**
//!
//! 프런트가 죽이는 구조였다면 새로고침·크래시·창 닫힘에서 고아 PTY가 남는다.
//! 프런트는 언제든 사라질 수 있는 쪽이고, `PtyManager`는 프로세스가 살아 있는 한 남는 쪽이다.
//! **죽이는 책임은 오래 사는 쪽에 둔다.**
//!
//! # 버전 정책 — 모르는 버전을 만나면
//!
//! | 상황 | 행동 |
//! |---|---|
//! | 파일 없음 | 기본 레이아웃(터미널 1개). 에러가 아니다 |
//! | `version` == 현재 | 읽는다. 검증 실패 시 아래 "깨짐"과 같게 처리 |
//! | `version` < 현재 | **이관(migrate)**. v1이 최초라 아직 해당 없음 |
//! | `version` > 현재 | **백업 후 초기화** + stderr 한 줄 |
//! | 깨짐·상한 초과 | **백업 후 초기화** + stderr 한 줄 |
//!
//! 왜 "읽을 수 있는 만큼만"(②)이 아닌가 — 미래 버전은 **필드가 늘어난 것만이 아니라
//! 뜻이 바뀐 것**일 수 있다. `weight`의 의미가 바뀌었는데 이름이 같으면, 읽히긴 하고
//! 화면만 조용히 틀어진다. **조용한 손상이 요란한 초기화보다 나쁘다.**
//! 왜 "거부"(①)가 아닌가 — 사용자 파일을 지우지 않고 남겨야 되돌릴 수 있다.
//! 백업은 `state.json.bak-v<발견한 버전>-<밀리초>`로 남는다.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// 현재 스키마 버전. **필드의 뜻이 바뀌면 올린다.** 필드가 늘기만 하면 안 올려도 된다.
pub const SCHEMA_VERSION: u32 = 1;

/// 상태 파일 상한. 레이아웃 트리는 KB 단위여야 한다.
///
/// `S3-4`가 이 파일을 **30초마다** 쓰게 된다. 스크롤백 같은 화면 내용이 새어 들어가면
/// 디스크 상한(KR2)이 그날로 무너진다 — `D9`를 제외로 못 박은 이유가 그것이다.
pub const MAX_STATE_BYTES: u64 = 1024 * 1024;

/// 노드 수 상한. 깊이·개수가 폭주한 트리를 파일로 굳히지 않는다.
pub const MAX_NODES: usize = 512;

/// 지금 있는 유일한 잎 종류. `BACKLOG` B1이 붙으면 여기에 하나 더 생긴다.
pub const KIND_TERMINAL: &str = "terminal";

/// 분할 방향.
///
/// `Row` = 자식이 **가로로** 늘어선다(좌우 분할) · `Column` = **세로로**(상하 분할).
/// CSS `flex-direction`과 같은 뜻으로 맞춰 뒀다 — `S2-2`에서 그대로 얹으려고.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Row,
    Column,
}

/// 트리 노드. `type` 태그로 갈린다 — JSON에서 사람이 읽을 수 있어야 한다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Node {
    Leaf {
        id: String,
        /// 이 잎이 무엇을 담는가. 지금은 `"terminal"` 뿐이다.
        ///
        /// **열거형이 아니라 문자열인 이유**: 모르는 값을 만나도 **버리지 않고 그대로 들고 있다가
        /// 그대로 다시 쓴다.** 열거형이면 파싱에서 죽거나 값이 증발한다.
        kind: String,
        /// 이 잎에 붙은 PTY의 id. **소유가 아니라 참조다**(§소유권).
        ///
        /// 재기동하면 그 프로세스는 없다(`FEATURES` D8 — 원리적으로 복구 불가).
        /// 그래서 **불러올 때 전부 `None`으로 지운다.** 안 지우면 죽은 id를 가리키는 잎이 남는다.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pty_id: Option<String>,
        /// 사용자가 붙인 이름 (`FEATURES` D3).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        /// 복구용 작업 디렉터리 (`FEATURES` D5).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
    },
    Split {
        id: String,
        direction: Direction,
        children: Vec<Child>,
    },
}

/// 분할 안의 한 칸. `weight`는 형제들 사이의 비율이고 **합이 1.0이 되게 정규화**한다.
///
/// 픽셀이 아니라 비율인 이유: 창 크기가 바뀌어도 레이아웃이 그대로 따라와야 하고,
/// 다른 DPI·다른 기계에서 복원해도 같은 화면이 나와야 한다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Child {
    pub weight: f64,
    pub node: Node,
}

/// 상태 파일의 최상위 모양.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutState {
    pub version: u32,
    pub root: Node,
    /// 포커스된 **잎**의 id. 트리에 없는 id면 불러올 때 고쳐진다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus: Option<String>,
    /// 지금 걸려 있는 배치 프리셋 id (`S2-11` · `presets.rs`). 없으면 `None`.
    ///
    /// **스키마 자리는 여기까지가 `S2-11`이다.** 저장·복원은 `S3-4`(세션 영속)에서 한다 —
    /// AgentCommender도 `SavedTeam`에 프리셋을 저장한다(FEATURE-DIFF D3).
    /// 필드가 늘기만 하는 변경이라 `SCHEMA_VERSION`은 올리지 않는다(§버전 정책).
    ///
    /// 불러올 때 **모양이 안 맞으면 지운다**(`load`) — 틀린 배치 이름이 상태바에 뜨는 것은
    /// 이름이 없는 것보다 나쁘다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
}

// ── id 발급 ──────────────────────────────────────────────────────────────────
//
// uuid 의존성을 새로 들이지 않는다. 이 id는 **한 프로세스 안에서만 유일하면 된다** —
// 파일을 불러올 때 이미 쓰인 번호 위로 카운터를 올려 두므로 재기동 후에도 안 겹친다.

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn next_id(prefix: &str) -> String {
    format!("{prefix}-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

/// 불러온 트리가 쓰던 번호보다 위에서 다시 시작하게 만든다.
fn bump_counter_past(node: &Node) {
    let mut max = 0u64;
    walk(node, &mut |n| {
        let id = n.id();
        if let Some(num) = id.rsplit('-').next().and_then(|s| s.parse::<u64>().ok()) {
            max = max.max(num);
        }
    });
    NEXT_ID.fetch_max(max + 1, Ordering::Relaxed);
}

fn walk(node: &Node, f: &mut impl FnMut(&Node)) {
    f(node);
    if let Node::Split { children, .. } = node {
        for c in children {
            walk(&c.node, f);
        }
    }
}

fn walk_mut(node: &mut Node, f: &mut impl FnMut(&mut Node)) {
    f(node);
    if let Node::Split { children, .. } = node {
        for c in children {
            walk_mut(&mut c.node, f);
        }
    }
}

// ── Node ─────────────────────────────────────────────────────────────────────

impl Node {
    pub fn id(&self) -> &str {
        match self {
            Node::Leaf { id, .. } | Node::Split { id, .. } => id,
        }
    }

    pub fn is_leaf(&self) -> bool {
        matches!(self, Node::Leaf { .. })
    }

    pub fn terminal_leaf() -> Self {
        Node::Leaf {
            id: next_id("leaf"),
            kind: KIND_TERMINAL.to_string(),
            pty_id: None,
            title: None,
            cwd: None,
        }
    }

    /// 분할 노드를 만든다. **id 발급은 이 파일 밖으로 내보내지 않는다** —
    /// 트리 밖에서 지은 id는 `bump_counter_past`가 못 세고, 그러면 언젠가 겹친다.
    /// (`S2-11` 프리셋 엔진이 모양을 만들 때 쓴다)
    pub fn split(direction: Direction, children: Vec<Child>) -> Self {
        Node::Split {
            id: next_id("split"),
            direction,
            children,
        }
    }

    /// 트리 안의 잎 id를 왼쪽부터 차례로.
    pub fn leaf_ids(&self) -> Vec<String> {
        let mut out = Vec::new();
        walk(self, &mut |n| {
            if n.is_leaf() {
                out.push(n.id().to_string());
            }
        });
        out
    }

    fn count(&self) -> usize {
        let mut n = 0;
        walk(self, &mut |_| n += 1);
        n
    }
}

// ── 트리 조작 ────────────────────────────────────────────────────────────────

impl LayoutState {
    /// 기본 레이아웃 — 터미널 잎 하나.
    pub fn single_terminal() -> Self {
        let root = Node::terminal_leaf();
        let focus = Some(root.id().to_string());
        Self {
            version: SCHEMA_VERSION,
            root,
            focus,
            preset: None,
        }
    }

    /// 잎 하나를 둘로 나눈다. 새로 생긴 잎의 id를 돌려준다.
    ///
    /// **같은 방향의 분할 안에 있으면 형제로 끼운다** — 좌우 분할을 또 좌우로 나눌 때
    /// 트리가 깊어지지 않는다. 4분할이 한 줄이면 `children`도 넷이다.
    pub fn split(&mut self, target_leaf: &str, direction: Direction) -> Result<String> {
        if self.root.count() + 2 > MAX_NODES {
            return Err(Error::Path(format!("노드 상한 {MAX_NODES}을 넘는다")));
        }
        let new_leaf = Node::terminal_leaf();
        let new_id = new_leaf.id().to_string();

        match split_rec(&mut self.root, target_leaf, direction, new_leaf) {
            Ok(()) => {
                self.focus = Some(new_id.clone());
                // 구조가 바뀌었다 — 걸려 있던 배치 프리셋 이름은 더 이상 사실이 아니다(`S2-11`).
                // 비율 변경(드래그)은 이름을 지우지 않는다. 그쪽은 `set_weights`다.
                self.preset = None;
                Ok(new_id)
            }
            Err(_) => Err(Error::Path(format!("잎을 찾지 못했다: {target_leaf}"))),
        }
    }

    /// 잎을 닫는다. **죽여야 할 PTY id**를 돌려준다 — 죽이는 것은 호출자 몫이다(§소유권).
    ///
    /// 마지막 잎은 닫지 않는다. 빈 트리를 허용하면 `root`가 없는 상태가 생기고,
    /// 그때부터 모든 코드가 `Option<Node>`를 다뤄야 한다.
    pub fn close(&mut self, leaf_id: &str) -> Result<Vec<String>> {
        let leaves = self.root.leaf_ids();
        if !leaves.iter().any(|l| l == leaf_id) {
            return Err(Error::Path(format!("잎을 찾지 못했다: {leaf_id}")));
        }
        if leaves.len() == 1 {
            return Err(Error::Path("마지막 패널은 닫지 않는다".into()));
        }

        let mut killed = Vec::new();
        close_rec(&mut self.root, leaf_id, &mut killed);
        self.normalize();
        // 잎이 하나 빠졌으면 프리셋 모양도 깨졌다 (`S2-11`).
        self.preset = None;

        // 포커스가 사라진 잎이었으면 남은 첫 잎으로 옮긴다.
        let remaining = self.root.leaf_ids();
        if !self
            .focus
            .as_ref()
            .is_some_and(|f| remaining.iter().any(|l| l == f))
        {
            self.focus = remaining.first().cloned();
        }
        Ok(killed)
    }

    /// 한 분할의 비율을 통째로 바꾼다. 드래그(`S2-3`)는 인접 두 칸만 만지면 된다.
    pub fn set_weights(&mut self, split_id: &str, weights: &[f64]) -> Result<()> {
        let mut done = false;
        let mut err: Option<String> = None;
        walk_mut(&mut self.root, &mut |n| {
            if let Node::Split { id, children, .. } = n {
                if id == split_id && !done {
                    if weights.len() != children.len() {
                        err = Some(format!(
                            "칸 수가 다르다: 분할 {} · 받은 값 {}",
                            children.len(),
                            weights.len()
                        ));
                        return;
                    }
                    if weights.iter().any(|w| !w.is_finite() || *w <= 0.0) {
                        err = Some("비율은 0보다 큰 유한한 값이어야 한다".into());
                        return;
                    }
                    for (c, w) in children.iter_mut().zip(weights) {
                        c.weight = *w;
                    }
                    done = true;
                }
            }
        });
        if let Some(e) = err {
            return Err(Error::Path(e));
        }
        if !done {
            return Err(Error::Path(format!("분할을 찾지 못했다: {split_id}")));
        }
        self.normalize();
        Ok(())
    }

    /// 포커스를 옮긴다. 잎이 아니면 거부한다.
    pub fn set_focus(&mut self, leaf_id: &str) -> Result<()> {
        if self.root.leaf_ids().iter().any(|l| l == leaf_id) {
            self.focus = Some(leaf_id.to_string());
            Ok(())
        } else {
            Err(Error::Path(format!("잎을 찾지 못했다: {leaf_id}")))
        }
    }

    /// 잎에 PTY id를 붙이거나 뗀다. **소유가 아니라 참조다.**
    pub fn attach_pty(&mut self, leaf_id: &str, pty: Option<String>) -> Result<()> {
        let mut done = false;
        walk_mut(&mut self.root, &mut |n| {
            if let Node::Leaf { id, pty_id, .. } = n {
                if id == leaf_id {
                    *pty_id = pty.clone();
                    done = true;
                }
            }
        });
        if done {
            Ok(())
        } else {
            Err(Error::Path(format!("잎을 찾지 못했다: {leaf_id}")))
        }
    }

    /// 비율 합을 1.0으로 맞추고, 자식이 하나뿐인 분할을 걷어낸다.
    pub fn normalize(&mut self) {
        normalize_rec(&mut self.root);
    }

    /// 🔴 **잎을 그대로 들고 트리 모양만 다시 짠다** (`S2-11` 배치 프리셋).
    ///
    /// `build`는 **받은 잎만** 써서 새 트리를 만든다 — 잎을 새로 만들지도, 버리지도 않는다.
    /// 그래서 id·`pty_id`·`title`·`cwd`가 통째로 옮겨지고, **PTY도 xterm 버퍼도 안 죽는다.**
    ///
    /// 이 함수를 통과하지 않는 재배열 경로를 만들지 말 것. 잎을 새로 내는 순간
    /// 프런트 `reconcile`이 "사라진 잎"으로 보고 패널을 파괴하고, `layout_close`가 PTY를 죽인다.
    ///
    /// 잎 순서는 **호출자가 정한다** — 받은 벡터의 순서가 곧 화면 순서다(열 우선 규칙이 여기 얹힌다).
    pub fn rearrange(&mut self, build: impl FnOnce(Vec<Node>) -> Node) {
        let old = std::mem::replace(&mut self.root, placeholder());
        let mut leaves = Vec::new();
        take_leaves(old, &mut leaves);
        self.root = build(leaves);
        self.normalize();

        // 포커스는 잎을 따라간다 — 같은 잎이 그대로 있으니 보통은 그대로다.
        // 애초에 없었거나 트리 밖을 가리키고 있었으면 여기서 고친다.
        let leaves = self.root.leaf_ids();
        if !self
            .focus
            .as_ref()
            .is_some_and(|f| leaves.iter().any(|l| l == f))
        {
            self.focus = leaves.first().cloned();
        }
    }

    /// 저장·복원해도 되는 트리인가.
    ///
    /// **불러온 직후에 반드시 부른다.** 손으로 고친 파일, 다른 버전이 쓴 파일,
    /// 중간에 잘린 파일이 여기로 들어온다.
    pub fn validate(&self) -> std::result::Result<(), String> {
        if self.version != SCHEMA_VERSION {
            return Err(format!(
                "버전이 다르다: 파일 {} · 현재 {SCHEMA_VERSION}",
                self.version
            ));
        }
        let count = self.root.count();
        if count > MAX_NODES {
            return Err(format!("노드가 너무 많다: {count} > {MAX_NODES}"));
        }

        let mut seen: Vec<String> = Vec::with_capacity(count);
        let mut problem: Option<String> = None;
        walk(&self.root, &mut |n| {
            if problem.is_some() {
                return;
            }
            let id = n.id();
            if id.is_empty() {
                problem = Some("id가 비어 있다".into());
                return;
            }
            if seen.iter().any(|s| s == id) {
                problem = Some(format!("id가 겹친다: {id}"));
                return;
            }
            seen.push(id.to_string());

            match n {
                Node::Leaf { kind, .. } => {
                    if kind.is_empty() {
                        problem = Some(format!("잎 {id}의 kind가 비어 있다"));
                    }
                }
                Node::Split { children, .. } => {
                    if children.len() < 2 {
                        problem = Some(format!("분할 {id}의 칸이 {}개다", children.len()));
                    } else if children.iter().any(|c| !c.weight.is_finite() || c.weight <= 0.0) {
                        problem = Some(format!("분할 {id}에 0 이하이거나 유한하지 않은 비율이 있다"));
                    }
                }
            }
        });
        if let Some(p) = problem {
            return Err(p);
        }

        if let Some(f) = &self.focus {
            if !seen.iter().any(|s| s == f) {
                return Err(format!("포커스가 트리에 없는 id다: {f}"));
            }
        }
        Ok(())
    }
}

/// 자리 표시용 빈 잎. `mem::replace`로 노드를 꺼낼 때만 잠깐 쓰인다.
fn placeholder() -> Node {
    Node::Leaf {
        id: String::new(),
        kind: String::new(),
        pty_id: None,
        title: None,
        cwd: None,
    }
}

/// 트리를 해체해 잎만 **왼쪽부터 차례로** 꺼낸다. 노드를 복사하지 않고 옮긴다(`rearrange`).
fn take_leaves(node: Node, out: &mut Vec<Node>) {
    match node {
        Node::Leaf { .. } => out.push(node),
        Node::Split { children, .. } => {
            for c in children {
                take_leaves(c.node, out);
            }
        }
    }
}

/// 못 찾으면 `Err(새 잎)`으로 **원본을 돌려준다** — 형제 가지로 넘겨 다시 시도해야 하기 때문이다.
fn split_rec(
    node: &mut Node,
    target: &str,
    dir: Direction,
    new: Node,
) -> std::result::Result<(), Node> {
    match node {
        Node::Leaf { id, .. } => {
            if id != target {
                return Err(new);
            }
            let old = std::mem::replace(node, placeholder());
            *node = Node::Split {
                id: next_id("split"),
                direction: dir,
                children: vec![
                    Child {
                        weight: 0.5,
                        node: old,
                    },
                    Child {
                        weight: 0.5,
                        node: new,
                    },
                ],
            };
            Ok(())
        }
        Node::Split {
            direction,
            children,
            ..
        } => {
            // 같은 방향이면 형제로 끼운다. 트리가 깊어지지 않는다.
            if *direction == dir {
                if let Some(i) = children
                    .iter()
                    .position(|c| c.node.is_leaf() && c.node.id() == target)
                {
                    let half = children[i].weight / 2.0;
                    children[i].weight = half;
                    children.insert(
                        i + 1,
                        Child {
                            weight: half,
                            node: new,
                        },
                    );
                    return Ok(());
                }
            }
            let mut carry = new;
            for c in children.iter_mut() {
                match split_rec(&mut c.node, target, dir, carry) {
                    Ok(()) => return Ok(()),
                    Err(back) => carry = back,
                }
            }
            Err(carry)
        }
    }
}

/// 잎을 지우고, 지운 잎이 들고 있던 PTY id를 모은다.
fn close_rec(node: &mut Node, target: &str, killed: &mut Vec<String>) {
    if let Node::Split { children, .. } = node {
        if let Some(i) = children
            .iter()
            .position(|c| c.node.is_leaf() && c.node.id() == target)
        {
            if let Node::Leaf {
                pty_id: Some(p), ..
            } = &children[i].node
            {
                killed.push(p.clone());
            }
            children.remove(i);
            return;
        }
        for c in children.iter_mut() {
            close_rec(&mut c.node, target, killed);
        }
    }
}

/// 비율 정규화 + 외자식 분할 걷어내기.
///
/// 칸이 하나 남은 분할을 그대로 두면 트리에 의미 없는 층이 쌓이고,
/// 그 층마다 드래그 핸들이 생긴다.
fn normalize_rec(node: &mut Node) {
    if let Node::Split { children, .. } = node {
        for c in children.iter_mut() {
            normalize_rec(&mut c.node);
        }
        if children.len() == 1 {
            let only = children.remove(0).node;
            *node = only;
            return;
        }
        let sum: f64 = children.iter().map(|c| c.weight).sum();
        if !sum.is_finite() || sum <= 0.0 {
            let even = 1.0 / children.len() as f64;
            for c in children.iter_mut() {
                c.weight = even;
            }
        } else {
            for c in children.iter_mut() {
                c.weight /= sum;
            }
        }
    }
}

// ── 파일 입출력 ──────────────────────────────────────────────────────────────

/// 불러오기 결과. **어떻게 불러왔는지가 값만큼 중요하다** — 초기화된 것을 모르면
/// 사용자는 세션이 왜 사라졌는지 영영 모른다.
#[derive(Debug, Clone, PartialEq)]
pub enum LoadKind {
    /// 파일이 없었다. 처음 실행이다.
    New,
    /// 그대로 읽었다.
    Loaded,
    /// 미래 버전이라 백업하고 초기화했다.
    ResetFuture { found: u32, backup: PathBuf },
    /// 깨졌거나 상한을 넘어 백업하고 초기화했다.
    ResetBroken { reason: String, backup: Option<PathBuf> },
}

pub struct Loaded {
    pub state: LayoutState,
    pub kind: LoadKind,
}

/// 상태 파일을 읽는다. **어떤 경우에도 앱을 못 뜨게 하지 않는다.**
pub fn load(path: &Path) -> Loaded {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return fresh(LoadKind::New),
    };
    if meta.len() > MAX_STATE_BYTES {
        let reason = format!("상한 초과: {} B > {MAX_STATE_BYTES} B", meta.len());
        let backup = backup_file(path, "big");
        return fresh(LoadKind::ResetBroken { reason, backup });
    }

    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => {
            let reason = format!("읽기 실패: {e}");
            return fresh(LoadKind::ResetBroken {
                reason,
                backup: None,
            });
        }
    };

    // 버전을 **타입 파싱 전에** 본다. 미래 버전은 지금 타입으로 읽으면 안 되는 파일이다.
    let version = serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| v.get("version").and_then(|n| n.as_u64()));

    match version {
        Some(v) if v as u32 > SCHEMA_VERSION => {
            let backup = backup_file(path, &format!("v{v}"));
            return Loaded {
                state: LayoutState::single_terminal(),
                kind: LoadKind::ResetFuture {
                    found: v as u32,
                    backup: backup.unwrap_or_else(|| path.to_path_buf()),
                },
            };
        }
        Some(v) if (v as u32) < SCHEMA_VERSION => {
            // v1이 최초라 지금은 도달할 수 없다. 이관을 넣을 자리를 비워 둔다 —
            // 여기서 조용히 기본값으로 떨어뜨리면 그날 사용자 세션이 통째로 날아간다.
            let reason = format!("이관 경로가 없다: v{v} → v{SCHEMA_VERSION}");
            let backup = backup_file(path, &format!("v{v}"));
            return fresh(LoadKind::ResetBroken { reason, backup });
        }
        None => {
            let backup = backup_file(path, "noversion");
            return fresh(LoadKind::ResetBroken {
                reason: "version 필드가 없다".into(),
                backup,
            });
        }
        _ => {}
    }

    let mut state: LayoutState = match serde_json::from_str(&raw) {
        Ok(s) => s,
        Err(e) => {
            let backup = backup_file(path, "parse");
            return fresh(LoadKind::ResetBroken {
                reason: format!("JSON 파싱 실패: {e}"),
                backup,
            });
        }
    };

    state.normalize();
    if let Err(why) = state.validate() {
        let backup = backup_file(path, "invalid");
        return fresh(LoadKind::ResetBroken {
            reason: why,
            backup,
        });
    }

    // 지난 실행의 PTY는 살아 있지 않다(`FEATURES` D8). 죽은 id를 들고 있으면
    // `S2-2`가 "붙어 있다"고 착각하고 새 셸을 안 띄운다.
    walk_mut(&mut state.root, &mut |n| {
        if let Node::Leaf { pty_id, .. } = n {
            *pty_id = None;
        }
    });

    // 배치 프리셋 이름은 **모양이 맞을 때만** 믿는다 (`S2-11` · `presets::still_matches`).
    // 손으로 고친 파일·다른 버전이 쓴 파일이 이름만 남기고 모양이 다를 수 있다.
    if let Some(id) = state.preset.clone() {
        if !crate::presets::still_matches(&state, &id) {
            eprintln!("[eqmux][layout] 배치 프리셋 {id:?}가 트리 모양과 안 맞는다 — 이름을 버린다");
            state.preset = None;
        }
    }

    bump_counter_past(&state.root);
    Loaded {
        state,
        kind: LoadKind::Loaded,
    }
}

fn fresh(kind: LoadKind) -> Loaded {
    Loaded {
        state: LayoutState::single_terminal(),
        kind,
    }
}

/// 못 쓰는 파일을 옆으로 치운다. **지우지 않는다** — 되돌릴 여지를 남긴다.
fn backup_file(path: &Path, tag: &str) -> Option<PathBuf> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let name = format!(
        "{}.bak-{tag}-{millis}",
        path.file_name()?.to_string_lossy()
    );
    let dest = path.with_file_name(name);
    std::fs::rename(path, &dest).ok()?;
    Some(dest)
}

/// 상태를 파일로 쓴다. **임시 파일에 쓰고 갈아끼운다** — 쓰다가 죽어도 옛 파일이 남는다.
///
/// `S3-4`가 30초마다 부르게 된다. 그 빈도로 "쓰는 도중"이 존재하면 언젠가 그 순간에 죽는다.
pub fn save(path: &Path, state: &LayoutState) -> Result<()> {
    if let Err(why) = state.validate() {
        return Err(Error::Path(format!("저장 거부 — {why}")));
    }
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| Error::Path(format!("직렬화 실패: {e}")))?;
    if json.len() as u64 > MAX_STATE_BYTES {
        return Err(Error::Path(format!(
            "저장 거부 — 상한 초과: {} B > {MAX_STATE_BYTES} B",
            json.len()
        )));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes())?;
    // Windows에서도 `rename`은 대상이 있으면 갈아끼운다(MoveFileEx REPLACE_EXISTING).
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// 불러온 방식을 stderr 한 줄로. 무인 실행에서 보이는 유일한 경로다.
pub fn log_load(loaded: &Loaded, path: &Path) {
    match &loaded.kind {
        LoadKind::New => eprintln!(
            "[eqmux][layout] 새 레이아웃 — 상태 파일 없음 ({})",
            path.display()
        ),
        LoadKind::Loaded => eprintln!(
            "[eqmux][layout] 복원 — 잎 {}개 · v{} ({})",
            loaded.state.root.leaf_ids().len(),
            loaded.state.version,
            path.display()
        ),
        LoadKind::ResetFuture { found, backup } => eprintln!(
            "[eqmux][layout] ⚠️ 미래 버전 v{found} (현재 v{SCHEMA_VERSION}) — 백업 후 초기화: {}",
            backup.display()
        ),
        LoadKind::ResetBroken { reason, backup } => eprintln!(
            "[eqmux][layout] ⚠️ 상태 파일을 못 쓴다 ({reason}) — 초기화{}",
            backup
                .as_ref()
                .map(|b| format!(" · 백업 {}", b.display()))
                .unwrap_or_default()
        ),
    }
}

// ── 살아 있는 상태 ───────────────────────────────────────────────────────────

/// 앱이 도는 동안의 레이아웃. 파일 경로를 함께 든다 —
/// 명령마다 `Paths`를 다시 뒤지면 격리 스위치를 한 군데서만 존중하게 되기 쉽다.
pub struct LayoutStore {
    path: PathBuf,
    state: Mutex<LayoutState>,
}

impl LayoutStore {
    pub fn new(path: PathBuf, state: LayoutState) -> Self {
        Self {
            path,
            state: Mutex::new(state),
        }
    }

    /// 잠금이 깨진 상태(다른 스레드가 들고 죽었다)에서도 값은 살아 있다.
    /// 레이아웃 때문에 앱을 못 쓰게 만들지 않는다.
    fn lock(&self) -> std::sync::MutexGuard<'_, LayoutState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn get(&self) -> LayoutState {
        self.lock().clone()
    }

    /// 트리를 고친다. 고친 뒤 값을 돌려준다.
    pub fn update<T>(&self, f: impl FnOnce(&mut LayoutState) -> Result<T>) -> Result<T> {
        let mut st = self.lock();
        f(&mut st)
    }

    /// 지금 트리를 파일로 남긴다. `S3-4`가 이걸 30초마다 부르게 된다.
    pub fn persist(&self) -> Result<()> {
        let st = self.lock();
        save(&self.path, &st)
    }
}

// ── 무인 왕복 검증 (`--layout-probe`) ────────────────────────────────────────

pub struct LayoutProbe {
    pub enabled: bool,
    pub out_path: Option<PathBuf>,
}

impl LayoutProbe {
    pub fn from_args() -> Self {
        let mut enabled = false;
        let mut out_path = None;
        for a in std::env::args() {
            if a == "--layout-probe" {
                enabled = true;
            } else if let Some(v) = a.strip_prefix("--layout-probe-out=") {
                enabled = true;
                out_path = Some(PathBuf::from(v));
            }
        }
        Self { enabled, out_path }
    }
}

/// 저장 → 불러오기 → 같은 트리인가. **실제 상태 경로로** 돈다 —
/// 격리 스위치(`EQMUX_STATE_PATH`)를 존중하는지까지 같이 증명된다.
///
/// 0이면 통과. 창을 열지 않는다.
pub fn run_probe(path: &Path, out: Option<&Path>) -> i32 {
    let mut st = LayoutState::single_terminal();
    let first = st.root.leaf_ids()[0].clone();

    // 4분할: 좌우로 한 번, 각 칸을 상하로 한 번씩.
    let right = match st.split(&first, Direction::Row) {
        Ok(id) => id,
        Err(e) => {
            eprintln!("[eqmux][layout-probe] 미달 — 분할 실패: {e}");
            return 1;
        }
    };
    for target in [first.clone(), right.clone()] {
        if let Err(e) = st.split(&target, Direction::Column) {
            eprintln!("[eqmux][layout-probe] 미달 — 분할 실패: {e}");
            return 1;
        }
    }
    st.set_focus(&first).ok();
    let _ = st.attach_pty(&first, Some("pty-probe".into()));

    let before = match serde_json::to_string(&st) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[eqmux][layout-probe] 미달 — 직렬화 실패: {e}");
            return 1;
        }
    };
    let leaves_before = st.root.leaf_ids().len();

    if let Err(e) = save(path, &st) {
        eprintln!("[eqmux][layout-probe] 미달 — 저장 실패: {e}");
        return 1;
    }
    let loaded = load(path);
    log_load(&loaded, path);

    // 불러오면 `pty_id`는 의도적으로 지워진다(죽은 프로세스). 그 한 자리만 맞춰 놓고 비교한다.
    let mut expect = st.clone();
    walk_mut(&mut expect.root, &mut |n| {
        if let Node::Leaf { pty_id, .. } = n {
            *pty_id = None;
        }
    });
    let after = serde_json::to_string(&loaded.state).unwrap_or_default();
    let expect_json = serde_json::to_string(&expect).unwrap_or_default();

    let same = after == expect_json;
    let pty_cleared = !after.contains("pty-probe");
    let leaves_after = loaded.state.root.leaf_ids().len();
    let pass = same && pty_cleared && leaves_after == leaves_before;

    eprintln!(
        "[eqmux][layout-probe] {} — 잎 {leaves_before}→{leaves_after} · 왕복 동일 {} · pty 정리 {} · {} B · {}",
        if pass { "통과" } else { "미달" },
        if same { "예" } else { "아니오" },
        if pty_cleared { "예" } else { "아니오" },
        before.len(),
        path.display()
    );

    if let Some(o) = out {
        let report = serde_json::json!({
            "pass": pass,
            "roundtrip_identical": same,
            "pty_cleared": pty_cleared,
            "leaves_before": leaves_before,
            "leaves_after": leaves_after,
            "bytes": before.len(),
            "state_file": path.display().to_string(),
            "version": SCHEMA_VERSION,
            "saved": serde_json::from_str::<serde_json::Value>(&expect_json).ok(),
        });
        if let Some(parent) = o.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(o, serde_json::to_string_pretty(&report).unwrap_or_default());
        eprintln!("[eqmux][layout-probe] out = {}", o.display());
    }

    if pass {
        0
    } else {
        1
    }
}

// ── 테스트 ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn four_way() -> LayoutState {
        let mut st = LayoutState::single_terminal();
        let a = st.root.leaf_ids()[0].clone();
        let b = st.split(&a, Direction::Row).unwrap();
        st.split(&a, Direction::Column).unwrap();
        st.split(&b, Direction::Column).unwrap();
        st
    }

    #[test]
    fn 기본은_터미널_잎_하나다() {
        let st = LayoutState::single_terminal();
        assert_eq!(st.root.leaf_ids().len(), 1);
        assert!(st.root.is_leaf());
        assert_eq!(st.focus.as_deref(), Some(st.root.id()));
        st.validate().unwrap();
    }

    #[test]
    fn 같은_방향_분할은_깊어지지_않고_형제로_붙는다() {
        let mut st = LayoutState::single_terminal();
        let a = st.root.leaf_ids()[0].clone();
        let b = st.split(&a, Direction::Row).unwrap();
        st.split(&b, Direction::Row).unwrap();

        match &st.root {
            Node::Split { children, .. } => assert_eq!(children.len(), 3, "한 줄에 세 칸이어야 한다"),
            _ => panic!("루트가 분할이 아니다"),
        }
    }

    #[test]
    fn 비율_합은_항상_1이다() {
        let st = four_way();
        let mut sums = Vec::new();
        walk(&st.root, &mut |n| {
            if let Node::Split { children, .. } = n {
                sums.push(children.iter().map(|c| c.weight).sum::<f64>());
            }
        });
        assert!(!sums.is_empty());
        for s in sums {
            assert!((s - 1.0).abs() < 1e-9, "합이 {s}");
        }
    }

    #[test]
    fn 왕복하면_같은_트리다() {
        let st = four_way();
        let json = serde_json::to_string(&st).unwrap();
        let back: LayoutState = serde_json::from_str(&json).unwrap();
        back.validate().unwrap();
        assert_eq!(json, serde_json::to_string(&back).unwrap());
        assert_eq!(back.root.leaf_ids().len(), 4);
    }

    #[test]
    fn 닫으면_pty를_돌려주고_외자식_분할은_걷힌다() {
        let mut st = LayoutState::single_terminal();
        let a = st.root.leaf_ids()[0].clone();
        let b = st.split(&a, Direction::Row).unwrap();
        st.attach_pty(&b, Some("pty-9".into())).unwrap();

        let killed = st.close(&b).unwrap();
        assert_eq!(killed, vec!["pty-9".to_string()]);
        // 칸이 하나 남은 분할은 사라지고 잎이 루트로 올라온다.
        assert!(st.root.is_leaf());
        assert_eq!(st.focus.as_deref(), Some(a.as_str()));
    }

    #[test]
    fn 마지막_잎은_못_닫는다() {
        let mut st = LayoutState::single_terminal();
        let only = st.root.leaf_ids()[0].clone();
        assert!(st.close(&only).is_err());
    }

    #[test]
    fn 비율은_정규화돼_저장된다() {
        let mut st = LayoutState::single_terminal();
        let a = st.root.leaf_ids()[0].clone();
        st.split(&a, Direction::Row).unwrap();
        let split_id = st.root.id().to_string();

        st.set_weights(&split_id, &[3.0, 1.0]).unwrap();
        match &st.root {
            Node::Split { children, .. } => {
                assert!((children[0].weight - 0.75).abs() < 1e-9);
                assert!((children[1].weight - 0.25).abs() < 1e-9);
            }
            _ => panic!("루트가 분할이 아니다"),
        }
        assert!(st.set_weights(&split_id, &[1.0]).is_err(), "칸 수가 다르면 거부");
        assert!(st.set_weights(&split_id, &[1.0, 0.0]).is_err(), "0은 거부");
    }

    #[test]
    fn 모르는_kind는_버리지_않고_그대로_왕복한다() {
        let json = r#"{
            "version": 1,
            "root": {
              "type": "split", "id": "split-1", "direction": "row",
              "children": [
                {"weight": 0.5, "node": {"type":"leaf","id":"leaf-1","kind":"terminal"}},
                {"weight": 0.5, "node": {"type":"leaf","id":"leaf-2","kind":"file_explorer"}}
              ]
            },
            "focus": "leaf-1"
        }"#;
        let st: LayoutState = serde_json::from_str(json).unwrap();
        st.validate().unwrap();
        assert!(serde_json::to_string(&st).unwrap().contains("file_explorer"));
    }

    #[test]
    fn 검증은_겹치는_id와_한칸짜리_분할을_잡는다() {
        let dup = r#"{"version":1,"root":{"type":"split","id":"s","direction":"row","children":[
            {"weight":0.5,"node":{"type":"leaf","id":"same","kind":"terminal"}},
            {"weight":0.5,"node":{"type":"leaf","id":"same","kind":"terminal"}}]}}"#;
        let st: LayoutState = serde_json::from_str(dup).unwrap();
        assert!(st.validate().is_err());

        let one = r#"{"version":1,"root":{"type":"split","id":"s","direction":"row","children":[
            {"weight":1.0,"node":{"type":"leaf","id":"a","kind":"terminal"}}]}}"#;
        let st: LayoutState = serde_json::from_str(one).unwrap();
        assert!(st.validate().is_err());
    }

    #[test]
    fn 파일이_없으면_새_레이아웃이다() {
        let dir = std::env::temp_dir().join(format!("eqmux-layout-{}", next_id("t")));
        let path = dir.join("state.json");
        let loaded = load(&path);
        assert_eq!(loaded.kind, LoadKind::New);
        assert_eq!(loaded.state.root.leaf_ids().len(), 1);
    }

    #[test]
    fn 저장하고_다시_읽으면_같다_그리고_pty는_지워진다() {
        let dir = std::env::temp_dir().join(format!("eqmux-layout-{}", next_id("t")));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");

        let mut st = four_way();
        let leaf = st.root.leaf_ids()[0].clone();
        st.attach_pty(&leaf, Some("pty-1".into())).unwrap();
        save(&path, &st).unwrap();

        let loaded = load(&path);
        assert_eq!(loaded.kind, LoadKind::Loaded);
        assert_eq!(loaded.state.root.leaf_ids(), st.root.leaf_ids());
        // 지난 실행의 PTY는 살아 있지 않다 — 참조를 남기지 않는다.
        let json = serde_json::to_string(&loaded.state).unwrap();
        assert!(!json.contains("pty-1"));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// `S2-11` — 프리셋 이름의 스키마 자리가 왕복하는가. 저장·복원 본편은 `S3-4`다.
    #[test]
    fn 프리셋_이름은_왕복하고_모양이_어긋나면_버려진다() {
        let dir = std::env::temp_dir().join(format!("eqmux-layout-{}", next_id("t")));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");

        let mut st = four_way();
        crate::presets::apply(&mut st, "grid-2x4").unwrap();
        save(&path, &st).unwrap();
        assert_eq!(
            load(&path).state.preset.as_deref(),
            Some("grid-2x4"),
            "모양이 맞으면 이름이 살아온다"
        );

        // 이름만 남기고 모양이 다른 파일 — 이름을 버린다.
        st.preset = Some("grid-8x1".into());
        save(&path, &st).unwrap();
        assert_eq!(load(&path).state.preset, None);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 미래_버전은_백업하고_초기화한다() {
        let dir = std::env::temp_dir().join(format!("eqmux-layout-{}", next_id("t")));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        std::fs::write(&path, r#"{"version":99,"root":{"type":"leaf","id":"x","kind":"terminal"}}"#)
            .unwrap();

        let loaded = load(&path);
        match loaded.kind {
            LoadKind::ResetFuture { found, backup } => {
                assert_eq!(found, 99);
                // 원본을 지우지 않았다 — 되돌릴 수 있어야 한다.
                assert!(backup.exists());
                assert!(std::fs::read_to_string(&backup).unwrap().contains("99"));
            }
            other => panic!("미래 버전을 못 잡았다: {other:?}"),
        }
        assert_eq!(loaded.state.root.leaf_ids().len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 깨진_파일도_백업하고_앱은_뜬다() {
        let dir = std::env::temp_dir().join(format!("eqmux-layout-{}", next_id("t")));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        std::fs::write(&path, "{ 이건 JSON이 아니다").unwrap();

        let loaded = load(&path);
        assert!(matches!(loaded.kind, LoadKind::ResetBroken { .. }));
        assert_eq!(loaded.state.root.leaf_ids().len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 상한을_넘는_저장은_거부한다() {
        let mut st = LayoutState::single_terminal();
        let leaf = st.root.leaf_ids()[0].clone();
        st.attach_pty(&leaf, Some("x".repeat(MAX_STATE_BYTES as usize + 16)))
            .unwrap();
        let dir = std::env::temp_dir().join(format!("eqmux-layout-{}", next_id("t")));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        assert!(save(&path, &st).is_err(), "상한을 넘으면 저장하지 않는다");
        std::fs::remove_dir_all(&dir).ok();
    }
}
