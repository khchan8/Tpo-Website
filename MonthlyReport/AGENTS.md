# Agent Instructions & Herdr Toolkit Integration

## Required Skills for Herdr Operations
When coordinating across agents or terminals in this repository:
- For general Herdr multiplexer inspection and layout control, read `skill://herdr`.
- When sending prompts to an agent in a Herdr pane or waiting for pane completion, read `skill://agent-send`.
- When explicitly requested to start a detached Claude Code Remote Control session in Herdr, read `skill://spawn-session`.

*Note on catalog freshness:* If an active agent session was started before installation, the internal `skill://` catalog snapshot may report them as unknown. Use the native filesystem fallback paths instead:
- `~/.omp/agent/skills/agent-send/SKILL.md`
- `~/.omp/agent/skills/spawn-session/SKILL.md`
Subsequent and newly launched sessions discover both skills normally via `skill://agent-send` and `skill://spawn-session`.
## Operational Constraints & Scope of Applicability
Upstream `herdr-toolkit` skills (`agent-send`, `spawn-session`) must be used strictly within these project guardrails:

1. **`agent-send`**:
   - Applicable ONLY to authorized Herdr panes (panes spawned by this session or explicitly designated by the user).
   - Before any Herdr inspection or control, verify `HERDR_ENV=1`. If unset, do not inspect or control Herdr sessions.
   - Never send prompts to unmanaged, user-active, or unauthorized panes.

2. **`spawn-session`**:
   - Applicable ONLY when Claude Code Remote Control is explicitly requested by the user.
   - NEVER use `spawn-session` for Vibe worker tasks, local OMP subagents, or changing models/harnesses/subscription routes.
   - Do not change permission mode without explicit authorization; preserve applicable harness-specific permission rules (such as standing authorization for delegated AGY sessions), and do not alter existing provider credentials.

3. **Upstream Skill Integrity**:
   - Upstream skill instructions and scripts remain unmodified canonical sources. Compatibility constraints and environment rules are governed by this instruction file.
