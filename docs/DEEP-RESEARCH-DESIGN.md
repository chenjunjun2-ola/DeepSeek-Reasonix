# Deep Research Feature Design Document

## 1. Overview

### Problem Statement

Reasonix currently has a built-in `research` skill that combines web search and code reading in an isolated subagent. However, this skill operates as a single-pass investigation -- it searches, reads, and returns. It lacks the iterative, multi-round research capability that characterizes "deep research" systems like OpenAI Deep Research, Google Gemini Deep Research, and GPT Researcher.

The goal is to evolve Reasonix's research capability into a proper deep-research feature that can autonomously plan, execute, and synthesize multi-step research while respecting Reasonix's core constraints: cache stability, cost control, and DeepSeek-native design.

### Design Principles (from Anthropic's "Building Effective Agents")

1. **Start simple** -- "Start with simple prompts, optimize them with comprehensive evaluation, and add multi-step agentic systems only when simpler solutions fall short."
2. **Orchestrator-workers for research** -- "This workflow is well-suited for complex tasks where you can't predict the subtasks needed... search tasks that involve gathering and analyzing information from multiple sources."
3. **Evaluator-optimizer for refinement** -- "For complex search tasks that require multiple rounds of searching and analysis... the evaluator decides whether the results meet a certain quality or completeness bar."
4. **Tool design matters** -- "We actually spent more time optimizing our tools than the overall prompt."
5. **Cost-aware complexity** -- "Consider adding complexity only when it demonstrably improves outcomes."

---

## 2. Architecture: Three-Phase Pipeline

Based on analysis of mainstream deep-research implementations, the most effective pattern is a **three-phase pipeline** with an evaluator gate between phases:

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: PLAN                                               │
│   User query → clarify → generate research plan             │
│   Output: structured research_plan with steps + queries     │
├─────────────────────────────────────────────────────────────┤
│ Phase 2: RESEARCH (orchestrator-workers)                    │
│   For each plan step:                                       │
│     - Generate search queries (breadth parameter)           │
│     - Execute parallel web_search + web_fetch               │
│     - Extract learnings + new directions                    │
│     - Evaluator gate: sufficient? → next step / dig deeper  │
│   Output: accumulated findings + sources                    │
├─────────────────────────────────────────────────────────────┤
│ Phase 3: SYNTHESIZE                                         │
│   Accumulated findings → structured report                  │
│   Inline citations, source tracking, confidence ratings     │
│   Output: final report with sources                         │
└─────────────────────────────────────────────────────────────┘
```

### Why This Architecture

| Pattern | Fit for Deep Research | Source |
|---|---|---|
| Orchestrator-workers | Best for "search tasks that involve gathering and analyzing information from multiple sources" | Anthropic |
| Evaluator-optimizer | Enables iterative refinement where "the evaluator decides whether further searches are warranted" | Anthropic |
| Recursive depth-controlled loop | Proven by Open Deep Research (<500 LoC), configurable breadth/depth | dzhng/deep-research |
| Planner-executor-publisher | Separates planning from execution, enables parallel crawling | GPT Researcher |

---

## 3. Integration with Reasonix's Existing Architecture

### 3.1 Leveraging Existing Infrastructure

Reasonix already has the building blocks:

| Component | Current State | Deep Research Use |
|---|---|---|
| `web_search` / `web_fetch` | Multi-engine (Bing, SearXNG, Metaso, Tavily, Perplexity, Exa, Ollama) | Primary research tools |
| `spawn_subagent` | Isolated child loop with flash/pro model selection | Worker subagents for parallel research |
| `submit_plan` / `mark_step_complete` | Plan review gate with user approval | Research plan presentation + step tracking |
| Skills system | SKILL.md playbooks, runAs: inline/subagent | Deep research as a skill |
| Context management | Auto-compaction, fold thresholds | Managing accumulated research context |
| Cost control | Flash-first, budget hints, token tracking | Research cost budgeting |

### 3.2 What Needs to Be Built

1. **`deep_research` skill** -- A new built-in skill (SKILL.md) that orchestrates the three-phase pipeline
2. **Research state management** -- A structured accumulator for findings, sources, and directions
3. **Evaluator logic** -- A prompt-driven quality gate between research iterations
4. **Depth/breadth controls** -- User-configurable parameters for research thoroughness
5. **Citation tracking** -- Source URL + title + snippet preservation through synthesis

### 3.3 What Does NOT Need to Be Built

Per Reasonix's non-goals (CLAUDE.md: "No multi-agent orchestration as first-class, no RAG/vector retrieval"):

- No vector store or embedding system
- No separate planner/executor/synthesizer agent classes
- No persistent research knowledge base
- No non-DeepSeek backend support

---

## 4. Detailed Design

### 4.1 Phase 1: Research Planning

**Entry point:** User invokes `/skill deep-research <query>` or the model calls `run_skill({ name: "deep-research", arguments: "<query>" })`.

**Behavior:**
1. The deep-research skill (runAs: subagent) receives the user's query
2. The subagent generates 3-5 clarifying questions (optional, skipped if query is specific)
3. The subagent generates a structured research plan:

```json
{
  "research_question": "How does X work in context Y?",
  "steps": [
    {
      "id": "step-1",
      "title": "Find official documentation",
      "queries": ["X official docs", "X API reference Y"],
      "goal": "Establish ground truth from canonical sources"
    },
    {
      "id": "step-2",
      "title": "Find implementation examples",
      "queries": ["X example Y", "X tutorial Y"],
      "goal": "Understand practical usage patterns"
    }
  ],
  "breadth": 4,
  "depth": 2
}
```

**Verification:** The plan is presented to the user via the existing `submit_plan` review gate. The user can approve, refine, or cancel.

**Why this matters:** Google Gemini Deep Research "creates a multi-step research plan for you to either revise or approve." This user-in-the-loop pattern prevents wasted compute on misaligned research directions.

### 4.2 Phase 2: Iterative Research Execution

**Core loop** (controlled by `depth` parameter):

```
for depth_level in range(depth):
    for step in research_plan.steps:
        # Generate search queries based on step + accumulated context
        queries = generate_queries(step, accumulated_learnings)

        # Execute searches in parallel (respecting REASONIX_PARALLEL_MAX)
        results = parallel_execute([
            web_search(q, { topK: breadth }) for q in queries
        ])

        # Fetch top results for deeper reading
        pages = parallel_execute([
            web_fetch(r.url) for r in top_results(results)
        ])

        # Extract learnings and new directions
        { learnings, directions } = extract_insights(results, pages)

        # Accumulate
        research_state.learnings.extend(learnings)
        research_state.sources.extend(citations)
        research_state.directions.extend(directions)

    # Evaluator gate: are findings sufficient?
    evaluation = evaluate_completeness(research_state)
    if evaluation.sufficient:
        break
    # Use new directions for next depth level
    research_plan.steps = generate_followup_steps(evaluation.gaps)
```

**Key implementation details:**

1. **Parallel search execution:** Each step's queries execute via `web_search` in parallel (tools are `parallelSafe: true`). The existing `REASONIX_PARALLEL_MAX` (default 3) controls concurrency.

2. **Context management:** Research findings accumulate in the subagent's append-only log. The existing auto-compaction (3000-token cap per tool result) prevents context blowup. For deep research, we increase the cap to 8000 tokens for `web_fetch` results during the research phase.

3. **Cost control:** The subagent defaults to `deepseek-v4-flash` (cheap). The `max_tool_calls` pattern from OpenAI's deep research API is implemented via the existing `forceSummaryAfterIterLimit` mechanism -- if the subagent exceeds its tool call budget, it produces a partial synthesis.

4. **Evaluator gate:** A prompt-driven check after each depth level:

```
Given the research question and accumulated findings, assess:
1. Are the key claims supported by multiple sources?
2. Are there significant gaps in the evidence?
3. Would additional searches likely change the conclusion?

Return: { sufficient: boolean, gaps: string[], confidence: "low"|"medium"|"high" }
```

**Verification per iteration:**
- Each search returns results with titles, URLs, snippets
- Each fetch returns page content with source URL
- The evaluator produces a structured assessment
- All of these are logged in the subagent's append-only log

### 4.3 Phase 3: Synthesis and Report Generation

**Behavior:**
1. The subagent compiles all accumulated findings into a structured report
2. Each claim is linked to source URLs (inline citations)
3. Confidence ratings are included where evidence is mixed
4. The report is returned as the subagent's final answer

**Report structure:**

```markdown
# Research: [Original Question]

## Summary
[2-3 sentence executive summary]

## Key Findings
1. [Finding with citation](source-url)
2. [Finding with citation](source-url)
...

## Detailed Analysis
[Organized by topic, with inline citations]

## Sources
1. [Title](url) - relevance note
2. [Title](url) - relevance note
...

## Confidence Assessment
- [Claim 1]: High confidence (3+ corroborating sources)
- [Claim 2]: Medium confidence (1-2 sources, conflicting details)
- [Claim 3]: Low confidence (insufficient evidence)
```

**Verification:** The final report is returned to the parent agent via `formatSubagentResult`. The parent can verify:
- Source count (minimum threshold)
- Citation presence (every claim has a URL)
- Report length (substantial vs. thin)

---

## 5. Implementation Plan (Iterative, Each Step Independently Verifiable)

### Step 1: Create the `deep-research` Skill File

**What:** Create `.reasonix/skills/deep-research/SKILL.md` with the research skill prompt.

**Why:** This is the entry point. The skill system already supports `runAs: subagent` with isolated execution. Creating the skill file is the minimal first step that can be tested immediately.

**Verification:**
- `reasonix code` loads the skill without errors
- `/skill deep-research` appears in the skills list
- Invoking it with a simple query produces a research plan

**Test:**
```typescript
// tests/deep-research-skill.test.ts
test("deep-research skill loads and has correct frontmatter", () => {
  const store = new SkillStore({ projectRoot: tmpdir });
  const skill = store.read("deep-research");
  expect(skill).not.toBeNull();
  expect(skill!.runAs).toBe("subagent");
  expect(skill!.description).toContain("research");
});
```

### Step 2: Implement Research State Accumulator

**What:** A lightweight data structure that accumulates findings, sources, and directions across research iterations.

**Why:** The subagent's append-only log preserves everything, but the evaluator and synthesizer need structured access to findings. A typed accumulator prevents information loss during multi-round research.

**Verification:**
- Accumulator correctly stores and retrieves findings
- Source deduplication works (same URL searched twice = one entry)
- Findings are ordered by insertion time

**Test:**
```typescript
// tests/research-state.test.ts
test("ResearchState accumulates findings and deduplicates sources", () => {
  const state = new ResearchState();
  state.addFinding({ text: "X works by Y", source: "https://example.com", confidence: "high" });
  state.addFinding({ text: "X also does Z", source: "https://example.com", confidence: "medium" });
  expect(state.findings).toHaveLength(2);
  expect(state.sources).toHaveLength(1); // deduplicated
});

test("ResearchState tracks directions for next iteration", () => {
  const state = new ResearchState();
  state.addDirection("Investigate X's interaction with Y");
  expect(state.directions).toContain("Investigate X's interaction with Y");
});
```

### Step 3: Implement the Evaluator Prompt

**What:** A prompt template that assesses research completeness after each depth level.

**Why:** Without evaluation, the research loop either runs to max depth (wasteful) or stops too early (incomplete). The evaluator provides an intelligent stopping condition. Per Anthropic: "the evaluator decides whether further searches are warranted."

**Verification:**
- Evaluator returns structured JSON with `sufficient`, `gaps`, `confidence`
- Evaluator correctly identifies when evidence is sufficient
- Evaluator correctly identifies gaps that warrant further research

**Test:**
```typescript
// tests/research-evaluator.test.ts
test("evaluator returns structured assessment", async () => {
  const result = await evaluateCompleteness({
    question: "How does X work?",
    findings: [
      { text: "X works by Y", source: "https://a.com" },
      { text: "X works by Y", source: "https://b.com" },
    ],
  });
  expect(result).toHaveProperty("sufficient");
  expect(result).toHaveProperty("gaps");
  expect(result).toHaveProperty("confidence");
  expect(typeof result.sufficient).toBe("boolean");
});
```

### Step 4: Implement Query Generation Logic

**What:** A prompt template that generates search queries from a research step + accumulated context.

**Why:** Good queries are the foundation of good research. The query generator must produce diverse, targeted queries that avoid redundancy with previous searches. GPT Researcher's planner "generates questions that collectively form an objective opinion on the task."

**Verification:**
- Generated queries are relevant to the research step
- Queries avoid duplicating previous searches
- Query count respects the breadth parameter

**Test:**
```typescript
// tests/query-generation.test.ts
test("query generator produces diverse, non-redundant queries", async () => {
  const queries = await generateQueries({
    step: { title: "Find official docs", goal: "Establish ground truth" },
    previousQueries: ["X official documentation"],
    breadth: 3,
  });
  expect(queries).toHaveLength(3);
  expect(queries.every(q => q !== "X official documentation")).toBe(true);
});
```

### Step 5: Wire Up the Three-Phase Pipeline

**What:** Integrate planning, research loop, and synthesis into the deep-research skill body.

**Why:** This is the core integration step. The skill body orchestrates the three phases using the existing subagent infrastructure.

**Verification:**
- End-to-end test: given a research question, the system produces a report with citations
- The report contains findings from multiple sources
- The research plan was followed (steps completed in order)

**Test:**
```typescript
// tests/deep-research-pipeline.test.ts
test("deep-research produces a report with citations", async () => {
  // Mock web_search and web_fetch to return controlled results
  const result = await runDeepResearch({
    query: "What is the capital of France?",
    client: mockClient,
    maxDepth: 1,
    breadth: 2,
  });
  expect(result.success).toBe(true);
  expect(result.output).toContain("Paris");
  expect(result.output).toMatch(/https?:\/\//); // has URLs
});
```

### Step 6: Add Depth/Breadth Configuration

**What:** User-configurable parameters for research thoroughness, with sensible defaults.

**Why:** Different research questions need different levels of investigation. A quick fact check needs breadth=2, depth=1. A comprehensive technology comparison needs breadth=6, depth=3. Per Open Deep Research: "Breadth (3-10, default 4): controls query diversity per iteration; Depth (1-5, default 2): controls recursion levels."

**Verification:**
- Default values produce reasonable research
- Custom values are respected
- Extreme values (breadth=1, depth=1) still produce valid output

**Test:**
```typescript
// tests/deep-research-config.test.ts
test("depth controls number of research iterations", async () => {
  const shallow = await runDeepResearch({ query: "test", depth: 1, breadth: 2 });
  const deep = await runDeepResearch({ query: "test", depth: 3, breadth: 2 });
  // Deep should have more tool calls than shallow
  expect(deep.toolIters).toBeGreaterThan(shallow.toolIters);
});
```

### Step 7: Add Cost Budgeting

**What:** A USD budget cap for deep research sessions, with warning at 80% and hard stop at 100%.

**Why:** Deep research can be expensive. GPT Researcher reports ~$0.40 per research with o3-mini. With DeepSeek flash, costs should be much lower, but the user needs visibility and control. Reasonix already has `budgetUsd` on CacheFirstLoop -- we extend this to the research skill.

**Verification:**
- Budget warning fires at 80% of cap
- Research stops at 100% of cap
- Partial results are returned when budget is exceeded

**Test:**
```typescript
// tests/deep-research-budget.test.ts
test("research stops at budget cap and returns partial results", async () => {
  const result = await runDeepResearch({
    query: "test",
    budgetUsd: 0.01, // very low to trigger quickly
    depth: 5,
    breadth: 10,
  });
  // Should succeed with partial results
  expect(result.costUsd).toBeLessThanOrEqual(0.012); // small overshoot tolerance
  expect(result.output.length).toBeGreaterThan(0);
});
```

### Step 8: Add Citation Verification

**What:** A post-synthesis check that verifies every claim in the report has at least one source citation.

**Why:** The value of deep research over single-pass research is grounded, cited information. OpenAI Deep Research produces "inline citations as structured annotations. Each annotation includes url, title, start_index, and end_index, linking claims to specific sources." Without citation verification, the model might hallucinate unsupported claims.

**Verification:**
- Every major claim in the output has a URL
- All cited URLs are from the actual search results (no fabricated URLs)
- Source count meets minimum threshold

**Test:**
```typescript
// tests/deep-research-citations.test.ts
test("every claim in the report has a citation", async () => {
  const result = await runDeepResearch({ query: "test", depth: 1, breadth: 2 });
  const claims = extractClaims(result.output);
  const citedClaims = claims.filter(c => c.hasUrl);
  // At least 80% of claims should be cited
  expect(citedClaims.length / claims.length).toBeGreaterThan(0.8);
});
```

### Step 9: Add Streaming Progress Events

**What:** Progress events that the TUI can display during long-running research.

**Why:** Deep research can take 2-5 minutes. The user needs visibility into what's happening. Reasonix already has `SubagentEvent` with `start`, `progress`, `end`, `phase`, `stream-progress` kinds. We add research-specific phases: "planning", "searching", "reading", "evaluating", "synthesizing".

**Verification:**
- Progress events fire at each phase transition
- The TUI displays current phase and progress
- Event stream doesn't block research execution

**Test:**
```typescript
// tests/deep-research-events.test.ts
test("research emits phase events for each pipeline stage", async () => {
  const events: SubagentEvent[] = [];
  const sink: SubagentSink = { current: (ev) => events.push(ev) };
  await runDeepResearch({ query: "test", sink });
  const phases = events.filter(e => e.kind === "phase").map(e => e.phase);
  expect(phases).toContain("planning");
  expect(phases).toContain("searching");
  expect(phases).toContain("synthesising");
});
```

### Step 10: Integration Test with Real Search

**What:** An end-to-end test that runs deep research against a real search engine with a known-answer question.

**Why:** Unit tests with mocks verify logic, but integration tests verify the full pipeline works with real-world search results. This is the final validation that the system produces useful research output.

**Verification:**
- Research completes within timeout (60s)
- Output contains the known answer
- Output has multiple sources
- Cost is within expected range

**Test:**
```typescript
// tests/deep-research-integration.test.ts
test.skipIf(!process.env.TAVILY_API_KEY)(
  "deep research produces accurate answer with real search",
  async () => {
    const result = await runDeepResearch({
      query: "What year was the Eiffel Tower completed?",
      depth: 1,
      breadth: 3,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("1889");
    expect(result.costUsd).toBeLessThan(0.10);
  },
  { timeout: 60_000 },
);
```

---

## 6. Risk Mitigation

### 6.1 Cost Explosion

**Risk:** Deep research with breadth=10, depth=5 could consume significant tokens.

**Mitigation:**
- Default to flash model (1/12 the cost of pro)
- Budget cap with hard stop
- Auto-compaction of tool results (existing 3000-token cap)
- Subagent budget hints (existing `subagentBudgetHint`)

### 6.2 Context Window Overflow

**Risk:** Accumulated research findings exceed the context window.

**Mitigation:**
- Existing context management with fold thresholds (75%/78%/80%/90%)
- Tool result compaction at turn end
- Research state accumulator provides a structured summary that replaces raw tool output
- Force summary at context limit (existing `forceSummaryAfterIterLimit`)

### 6.3 Search Quality

**Risk:** Web search returns irrelevant or low-quality results.

**Mitigation:**
- Multi-engine support (Bing, SearXNG, Tavily, Perplexity, Exa, Ollama)
- Evaluator gate filters out low-quality findings
- Breadth parameter ensures multiple perspectives
- User can refine the research plan before execution

### 6.4 DeepSeek Tool-Call Failures

**Risk:** DeepSeek's known failure modes (missing tool calls, truncated JSON, call storms) disrupt research.

**Mitigation:**
- Existing tool-call repair pipeline (scavenge, truncation, storm)
- Schema flattening for complex research tools
- Flash model with high reasoning effort for research subagents

---

## 7. File Layout

```
src/
├── skills.ts                          # Add deep-research to BUILTIN_SKILLS
├── tools/
│   ├── deep-research.ts               # Research state accumulator + evaluator
│   └── subagent.ts                    # Existing -- no changes needed
└── prompt-fragments.ts                # Existing -- may add research-specific fragments

tests/
├── deep-research-skill.test.ts        # Step 1: skill loading
├── research-state.test.ts             # Step 2: accumulator
├── research-evaluator.test.ts         # Step 3: evaluator
├── query-generation.test.ts           # Step 4: query gen
├── deep-research-pipeline.test.ts     # Step 5: pipeline
├── deep-research-config.test.ts       # Step 6: config
├── deep-research-budget.test.ts       # Step 7: budget
├── deep-research-citations.test.ts    # Step 8: citations
├── deep-research-events.test.ts       # Step 9: events
└── deep-research-integration.test.ts  # Step 10: integration
```

---

## 8. Success Criteria

1. **Functional:** `/skill deep-research` produces a multi-source report with inline citations
2. **Cost-effective:** Default research costs <$0.10 per query (flash model, depth=2, breadth=4)
3. **Fast:** Default research completes in <60 seconds
4. **Accurate:** Reports cite real sources, claims are grounded in evidence
5. **User-controlled:** Research plan is reviewable before execution
6. **Cache-friendly:** Deep research sessions maintain >80% cache hit rate (subagent prefix reuse)
7. **Iterative:** Each step is independently testable and verifiable

---

## 9. Sources

1. Anthropic, "Building Effective Agents" (2024-12-20) -- orchestrator-workers, evaluator-optimizer patterns
2. OpenAI, "Deep Research API Documentation" -- multi-step agentic architecture, tool orchestration
3. Google, "Gemini Deep Research" -- interactive research planning, iterative search
4. dzhng/deep-research (GitHub) -- recursive depth-controlled loop, breadth/depth parameters
5. assafelovic/gpt-researcher (GitHub) -- planner-executor-publisher, parallel crawling
6. Reasonix CLAUDE.md, ARCHITECTURE.md -- existing infrastructure and constraints
