# GraphAgent working-set architecture

## Status

Implemented.

## Problem

The original implementation bypassed the working-set mechanism by injecting the full design graph state into the GraphAgent prompt:

1. `buildGraphAgentPrompt` serialized the entire `graphState` into the user message.
2. IDs were then decorated as `name (id)` to make the prompt look friendlier, but the underlying data dump remained.
3. Finally the dump was moved to a `system` field added to the generic `task` tool, hiding it from the chat timeline but keeping the architectural violation.

These steps progressively violated the design principle that GraphAgent should access graph state through tools, not through prompt injection.

## Decision

Adopt a tool-driven, working-set-based memory model.

### Active working set

- Long-term cache persisted across sessions.
- Invisible to GraphAgent.
- Stores lightweight semantic entries (`id`, `name`, `type`, `briefSemantics`).
- Capacity-limited; LRU eviction per entry type.
- Context entries are evicted only after all nodes that belong to the context have been evicted.
- Updated by every design query or write (GraphAgent expansion, ChatAgent lookup, direct writes, etc.).

### Temporary working set

- Per-GraphAgent-session view.
- Visible to GraphAgent.
- Initialized as a copy of the active working set.
- Uncapped and never evicted.
- Stores the same lightweight semantic entries.
- Automatically extended by `design_expand_node`, `design_search_graph`, and write tools.

```
active working set (long-term memory, invisible)
    ↓ copy
temporary working set (current session view, visible)
    ↑ expand
GraphAgent
```

### Working-set entry

```ts
interface WorkingSetEntry {
  id: string
  name: string
  type: "context" | "node"
  briefSemantics: string
}
```

Edges and relation prototypes are not stored in the working set. Prototypes are listed through `design_list_prototypes`; edge semantics are returned by `design_get_concept` and `design_expand_node`.

## GraphAgent tools

### Read-only tools

| Tool | Input | Output | Side effect |
|---|---|---|---|
| `design_get_temporary_working_set` | none | Natural-language summary of temporary entries | none |
| `design_get_concept` | `name_or_id` | Concept details with related edges | none |
| `design_get_context` | `name_or_id` | Context and its concepts | none |
| `design_expand_node` | `name_or_id` | One-hop neighbors and edge semantics | Neighbors added to both working sets |
| `design_search_graph` | `query` | Matching nodes/contexts by name or alias | Matches added to both working sets |
| `design_get_state_summary` | none | Graph size statistics | none |
| `design_list_prototypes` | none | All relation prototypes | none |

Read-only tools strictly do not mutate the working set.

### Write tools

All write tools accumulate changes into a per-session accumulator and add affected entries to the temporary and active working sets.

| Tool | Input | Output |
|---|---|---|
| `design_define_context` | `name`, `semantics` | New context summary |
| `design_define_concept` | `name`, `context`, `kind`, `semantics`, `aliases` | New concept summary |
| `design_refine_concept` | `concept`, `semantics`, `aliases`, `kind` | Update summary |
| `design_withdraw_concept` | `concept`, `cascade` | Removal summary |
| `design_relate_concepts` | `from`, `to`, `relation`, `semantics`, `constraints` | Relation summary |
| `design_withdraw_relation` | `from`, `to` | Removal summary |
| `design_define_relation_prototype` | `name`, `semantics`, `constraints` | Prototype summary |
| `design_finalize_change` | none | Final approval question; applies or abandons accumulator |

### Removed from GraphAgent

- `design_workset_get`, `design_workset_add`, `design_workset_remove`, `design_workset_expand`
- `design_get_design`
- `design_get_relations`
- `design_resolve_reference` (deleted entirely)

## Prompt format

The user message is a short, human-readable text:

```text
mode: cognition
request: 请帮我设计“船”这个概念在当前游戏中的作用。

当前活跃工作集摘要（已从长期记忆加载到本次会话）：
- 上下文：太空探索、战斗系统
- 概念：海、玩家、飞船、星球、资源、任务、敌人、武器
- 设计图版本：7

请先读取临时工作集了解当前上下文，然后按需查询和展开相关概念。
```

No graph state JSON, no temporary working set JSON, and no internal IDs are injected.

## Refine mode

Refine runs in the same subagent session. The approved direction and authorization scope are described in plain text in the user message, for example:

```text
mode: refine
request: 用户已批准以下变更方向：在太空探索上下文下创建"船"概念，并与"海"建立关联。你已被授权自主合理化细节，请开始细化并调用写入工具累积变更。
```

## Output conventions

- Tool output uses semantic names instead of internal IDs, except for the node's own ID in concept detail output.
- `design_expand_node` returns only edges between the expanded node and its direct neighbors, including the prototype name and semantics.
- `design_get_temporary_working_set` renders entries as natural-language lines.

## Affected code

- `packages/opencode/src/tool/task.ts`: removed `system` parameter.
- `packages/opencode/src/tool/design.ts`: simplified `buildGraphAgentPrompt`, replaced workset tools with new query tools.
- `packages/opencode/src/design/core/working-set.ts`: semantic entries with type-separated eviction.
- `packages/opencode/src/design/system/temporary-working-set.ts`: semantic entries, automatic expansion API.
- `packages/opencode/src/design/design.ts`: removed `preprocessInput` and `resolveReference`, added `touchNode`/`touchContext` side effects.
- `packages/opencode/src/design/agent/prompt/graph.txt`: updated tool list and workflow.
- `packages/opencode/src/agent/agent.ts`: updated `design-graph` permissions.

## References

- Final design discussion: `docs/test/修正设计分析-已确认版.md`
