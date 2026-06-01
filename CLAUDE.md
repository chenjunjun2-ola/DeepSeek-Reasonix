# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run build         # full build: dashboard (Vite) + tsup → dist/
npm run dev           # tsx src/cli/index.ts (live source, no build)
npm run chat          # tsx src/cli/index.ts chat
npm run test          # vitest run
npm run test:watch    # vitest (watch mode)
npm run lint          # biome check src tests
npm run lint:fix      # biome check --write src tests
npm run format        # biome format --write src tests
npm run typecheck     # tsc --noEmit (main + dashboard)
npm run verify        # build → lint → typecheck → test (CI gate, runs pre-push)
```

Run a single test file: `npx vitest run tests/loop.test.ts`

Mutation testing: `npm run test:mutation` (Stryker, targets load-bearing modules only)

## Architecture

Reasonix is a DeepSeek-native coding agent. The north star is "stays cheap enough to leave on." Four pillars:

**Pillar 1 — Cache-First Loop** (`src/loop.ts`, `src/memory/runtime.ts`). Context is partitioned into three regions to maximize DeepSeek's automatic prefix caching (~10% of miss rate on cache hit):
- **ImmutablePrefix** — system prompt + tool specs + few-shots, computed once per session, pinned by hash
- **AppendOnlyLog** — assistant/tool entries serialized in order, never rewritten
- **VolatileScratch** — R1 thought / transient plan state, never sent upstream

Parallel tool dispatch groups `parallelSafe` tools via `Promise.allSettled` with a serial barrier for mutating tools. Env: `REASONIX_PARALLEL_MAX` (default 3, cap 16), `REASONIX_TOOL_DISPATCH=serial`.

**Pillar 2 — Tool-Call Repair** (`src/repair/`). DeepSeek-specific failure recovery in four passes:
1. `flatten` — auto-detect complex schemas (>10 params or depth >2), present in dot-notation
2. `scavenge` — regex + JSON parser sweeps `reasoning_content` for missed tool calls
3. `truncation` — detect and repair unbalanced JSON
4. `storm` — suppress identical (tool, args) tuples within a sliding window

**Pillar 3 — Cost Control** (`src/context-manager.ts`, `src/config.ts`). Flash-first tiered defaults (`v4-flash` default, `v4-pro` for hard turns), turn-end auto-compaction (tool results >3000 tokens shrunk, 40% context-ratio threshold), explicit `/model` switching (sticky), model self-report via `<<<NEEDS_PRO>>>` marker.

**Pillar 4 — Shared Prompt Fragments** (`src/prompt-fragments.ts`). `TUI_FORMATTING_RULES` and `NEGATIVE_CLAIM_RULE` reused by main, subagent, and skill prompts.

### Key Modules

| Module | What |
|---|---|
| `src/loop.ts` + `src/loop/` | Core agent loop: streaming, dispatch, compaction, session persistence |
| `src/client.ts` | DeepSeekClient (fetch + SSE), Usage token tracking |
| `src/tools.ts` | ToolRegistry: registration, schema flattening, plan-mode gating, dispatch |
| `src/repair/` | Tool-call repair pipeline (scavenge → truncation → storm) |
| `src/memory/` | ImmutablePrefix, AppendOnlyLog, VolatileScratch, project/user/session memory |
| `src/context-manager.ts` | Context folding at 75%/78%/80%/90% thresholds |
| `src/code/` | SEARCH/REPLACE edit-block parser + apply gate |
| `src/core/` | Event-log kernel: Event union, pure reducers, eventize |
| `src/cli/` | Commander CLI entry + Ink TUI (~130 files in `ui/`) |
| `src/mcp/` | MCP client + transports (stdio, SSE, streamable-http) + registry |
| `src/tools/` | Tool implementations: filesystem, shell, plan, subagent, web, memory, skills |
| `src/config.ts` | Zod-validated config (`~/.reasonix/settings.json`), models, edit modes |
| `src/tokenizer.ts` | DeepSeek V3 BPE tokenizer (ported from Python) |
| `packages/ink` | Forked Ink (React terminal UI framework) — local workspace package |
| `packages/core-utils` | Shared utilities across CLI, Desktop, Dashboard, ACP surfaces |
| `packages/dsnix` | Thin alias package providing the `dsnix` CLI binary |

### Non-Goals

No multi-agent orchestration as first-class, no RAG/vector retrieval, no non-DeepSeek backend support, no Web UI/SaaS, no silent cost escalation.

## Conventions

- **TypeScript** — strict, ES2022, ESM. `noUncheckedIndexedAccess`, `noImplicitOverride`. Explicit `import type` for type-only imports.
- **Exports** — named only, no `export default`.
- **Imports** — direct relative imports within project, no barrel re-exports.
- **JSX** — `.tsx` for Ink components. `jsx: "react"` in tsconfig.
- **Formatting** — Biome: 2-space indent, 100 line width, double quotes, semicolons always, trailing commas all.
- **Comments** — only for non-obvious "why". No "what" comments, no module-level essays, no section banners.
- **Errors** — no try/catch for internal errors. Trust your own code. Boundary code (user input, network, FS) validates.
- **Files** — one responsibility per file. No `index.ts` re-exports unless they meaningfully shrink the public surface.
- **Path aliases** — `@/*` maps to `src/*`, `ink` maps to `packages/ink/src/index.ts`.

## Testing

- **Framework**: Vitest with `forks` pool (per-file process isolation, max 8 forks).
- **Location**: `tests/` (flat, ~250 files). Naming: `<module>.test.ts` or `<module>.test.tsx`.
- **FakeFetch pattern**: Tests create a fake `fetch` returning canned responses, then construct a `DeepSeekClient` with it. No network calls.
- **Architecture invariants** (`tests/architecture-invariants.test.ts`): Verifies ImmutablePrefix fingerprint determinism, reducer projection determinism, append-only semantics.
- **Repair tests** (`tests/repair/`): Separate files per pass (flatten, scavenge, storm, truncation, pipeline).
- **UI tests** (`.test.tsx`): `@testing-library/react` + `ink-testing-library`.
- **Comment policy gate**: `tests/comment-policy.test.ts` runs under `npm run verify` and blocks comments that explain "what" instead of "why".

## Watch Out For

- **`src/loop.ts`, `src/repair/`, `src/tools/`, `src/mcp/`** affect every session. Test before publishing.
- **SEARCH blocks must match byte-for-byte** — the edit-gate in `src/code/edit-blocks.ts` enforces exact match. Trailing whitespace or wrong indent = mismatch.
- **`dist/`** is generated by tsup. Never hand-edit.
- **`.reasonix/semantic/`** is auto-generated vector index. Never hand-edit.
- **Sessions** (`sessions/`, `.reasonix/sessions/`) are user-private, git-ignored.
- **No `Co-Authored-By: Claude` trailer** in commits.
- **Don't touch `CHANGELOG.md`** — release notes are written by the maintainer at release time.
