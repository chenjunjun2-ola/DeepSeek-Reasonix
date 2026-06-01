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

### Reference: Claude Deep Research Architecture

Based on Anthropic's engineering blog "How we built our multi-agent research system" (June 2025), Claude's deep research uses a 5-step process:

1. **PLAN** — Lead Agent (Opus) analyzes query, develops research strategy using extended thinking
2. **SEARCH** — 3-5 Subagents (Sonnet) perform parallel searches
3. **EVALUATE** — Lead Agent synthesizes results, decides if more research needed
4. **CITE** — CitationAgent attaches proper citations to findings
5. **REPORT** — Return final results to user

Key insights from Claude's approach:
- Token usage explains 80% of performance variance
- Multi-agent system outperformed single-agent by 90.2%
- Subagents serve as "intelligent filters" operating in parallel
- Separation of concerns reduces path dependency

---

## 2. Architecture: Five-Step Pipeline

Inspired by Claude's architecture, Reasonix adopts a **five-step pipeline** while maintaining its core philosophy: subagents as a cost-reduction mechanism, not a coordination primitive.

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: PLAN                                                │
│   User query → analyze complexity → generate research plan  │
│   Output: structured research_plan with steps + queries     │
├─────────────────────────────────────────────────────────────┤
│ Step 2: SEARCH (parallel subagents)                         │
│   For each plan step:                                       │
│     - Generate search queries (breadth parameter)           │
│     - Execute parallel web_search + web_fetch               │
│     - Extract raw findings + source URLs                    │
│   Output: raw findings with sources                         │
├─────────────────────────────────────────────────────────────┤
│ Step 3: EVALUATE                                            │
│   Assess accumulated findings:                              │
│     - Are key claims supported by multiple sources?         │
│     - Are there significant gaps?                           │
│     - Would additional searches change the conclusion?      │
│   Decision: sufficient → Step 4 / gaps → Step 2 (iterate)  │
│   Output: evaluation verdict + identified gaps              │
├─────────────────────────────────────────────────────────────┤
│ Step 4: CITE                                                │
│   Process findings + source documents:                      │
│     - Attach proper citations (URL, title, location)        │
│     - Verify citation accuracy                              │
│     - Deduplicate sources                                   │
│   Output: findings with verified citations                  │
├─────────────────────────────────────────────────────────────┤
│ Step 5: REPORT                                              │
│   Compile final structured report:                          │
│     - Executive summary                                     │
│     - Key findings with citations                           │
│     - Detailed analysis                                     │
│     - Confidence assessment                                 │
│   Output: final report with sources                         │
└─────────────────────────────────────────────────────────────┘
```

### Why 5 Steps Instead of 3

| Aspect | 3-Phase Design | 5-Step Design | Benefit |
|---|---|---|---|
| **Evaluation** | Embedded in RESEARCH loop | Distinct step with explicit decision | Clearer control flow, easier to optimize |
| **Citation** | Inline during synthesis | Dedicated step with verification | Higher citation quality, deduplication |
| **Planning** | Part of research phase | Distinct step with complexity analysis | Better resource allocation |
| **Iteration** | Implicit in evaluator gate | Explicit EVALUATE → SEARCH loop | Clearer retry logic |
| **Separation of concerns** | Mixed responsibilities | Each step has single responsibility | Easier to test and optimize |

### Mapping to Reasonix's Architecture

Following Reasonix's philosophy, all 5 steps execute within a **single subagent** (not multiple specialized agents). This keeps the architecture simple while gaining the benefits of distinct phases:

```
Parent Agent
  └─ deep-research subagent (single isolated loop)
       ├─ Step 1: PLAN (prompt-driven)
       ├─ Step 2: SEARCH (web_search + web_fetch)
       ├─ Step 3: EVALUATE (prompt-driven assessment)
       ├─ Step 4: CITE (prompt-driven verification)
       └─ Step 5: REPORT (prompt-driven synthesis)
```

**Why single subagent (not multiple specialized agents):**
- Follows Reasonix's "subagents as cost-reduction mechanism" philosophy
- No inter-agent communication needed
- Simpler orchestration
- Cache-friendly (single prefix)
- Cost-effective (flash model for entire process)

**Trade-off accepted:**
- Less separation of concerns than Claude's 3-tier architecture
- Subagent must handle all 5 steps in one context window
- No dedicated CitationAgent (citation quality depends on prompt engineering)

---

## 3. Integration with Reasonix's Existing Architecture

### 3.1 Leveraging Existing Infrastructure

Reasonix already has the building blocks:

| Component | Current State | Deep Research Use |
|---|---|---|
| `web_search` / `web_fetch` | Multi-engine (Bing, SearXNG, Metaso, Tavily, Perplexity, Exa, Ollama) | Primary research tools |
| `spawn_subagent` | Isolated child loop with flash/pro model selection | Single subagent for entire pipeline |
| `submit_plan` / `mark_step_complete` | Plan review gate with user approval | Research plan presentation + step tracking |
| Skills system | SKILL.md playbooks, runAs: inline/subagent | Deep research as a skill |
| Context management | Auto-compaction, fold thresholds | Managing accumulated research context |
| Cost control | Flash-first, budget hints, token tracking | Research cost budgeting |

### 3.2 What Needs to Be Built

1. **`deep_research` skill** -- A new built-in skill (SKILL.md) that orchestrates the five-step pipeline
2. **Research state management** -- A structured accumulator for findings, sources, and directions
3. **Evaluator logic** -- A prompt-driven quality gate between research iterations
4. **Citation verification** -- A dedicated step to verify and attach citations
5. **Depth/breadth controls** -- User-configurable parameters for research thoroughness

### 3.3 What Does NOT Need to Be Built

Per Reasonix's non-goals (CLAUDE.md: "No multi-agent orchestration as first-class, no RAG/vector retrieval"):

- No vector store or embedding system
- No separate planner/executor/synthesizer agent classes
- No persistent research knowledge base
- No non-DeepSeek backend support
- No dedicated CitationAgent (citation handled by prompt engineering)

---

## 4. Detailed Design

### 4.1 Step 1: Research Planning

**Entry point:** User invokes `/skill deep-research <query>` or the model calls `run_skill({ name: "deep-research", arguments: "<query>" })`.

**Behavior:**
1. The deep-research skill (runAs: subagent) receives the user's query
2. The subagent analyzes query complexity and determines resource allocation:
   - Simple fact-finding: breadth=2, depth=1
   - Direct comparisons: breadth=4, depth=2
   - Complex research: breadth=6, depth=3
3. The subagent generates a structured research plan:

```json
{
  "research_question": "How does X work in context Y?",
  "complexity": "moderate",
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

**Complexity analysis (inspired by Claude):**

| Query Type | Breadth | Depth | Est. Tool Calls | Est. Cost |
|---|---|---|---|---|
| Simple fact-finding | 2 | 1 | 3-10 | <$0.01 |
| Direct comparisons | 4 | 2 | 10-20 | <$0.05 |
| Complex research | 6 | 3 | 20-40 | <$0.10 |

### 4.2 Step 2: Parallel Search Execution

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

        # Extract raw findings with source URLs
        for result in results:
            add_finding(state, {
                text: extract_insight(result),
                source: result.url,
                confidence: assess_confidence(result)
            })
```

**Key implementation details:**

1. **Parallel search execution:** Each step's queries execute via `web_search` in parallel (tools are `parallelSafe: true`). The existing `REASONIX_PARALLEL_MAX` (default 3) controls concurrency.

2. **Context management:** Research findings accumulate in the subagent's append-only log. The existing auto-compaction (3000-token cap per tool result) prevents context blowup. For deep research, we increase the cap to 8000 tokens for `web_fetch` results during the research phase.

3. **Cost control:** The subagent defaults to `deepseek-v4-flash` (cheap). The `max_tool_calls` pattern from OpenAI's deep research API is implemented via the existing `forceSummaryAfterIterLimit` mechanism -- if the subagent exceeds its tool call budget, it produces a partial synthesis.

**Verification per iteration:**
- Each search returns results with titles, URLs, snippets
- Each fetch returns page content with source URL
- Findings are accumulated with source citations

### 4.3 Step 3: Evaluation Gate

**Behavior:**
After each depth level, the subagent evaluates the accumulated findings:

```
Given the research question and accumulated findings, assess:

1. Coverage: Are the key aspects of the question addressed?
2. Corroboration: Are claims supported by multiple sources?
3. Gaps: Are there significant gaps in the evidence?
4. Confidence: Would additional searches likely change the conclusion?

Return a structured assessment:
{
  "sufficient": boolean,
  "gaps": ["list of specific gaps"],
  "confidence": "high" | "medium" | "low",
  "reasoning": "explanation of assessment"
}
```

**Decision logic:**
- If `sufficient: true` → proceed to Step 4 (CITE)
- If `sufficient: false` AND `depth_level < max_depth` → generate follow-up steps and return to Step 2
- If `sufficient: false` AND `depth_level >= max_depth` → proceed to Step 4 with available findings

**Why a distinct evaluation step:**
- Clearer control flow than embedded evaluator
- Easier to test and optimize independently
- Can be enhanced with structured scoring in v2
- Mirrors Claude's architecture where Lead Agent evaluates after each search round

**Verification:**
- Evaluator returns structured JSON with `sufficient`, `gaps`, `confidence`
- Evaluator correctly identifies when evidence is sufficient
- Evaluator correctly identifies gaps that warrant further research

### 4.4 Step 4: Citation Verification

**Behavior:**
Before compiling the final report, the subagent verifies and attaches proper citations:

```
For each finding in accumulated findings:
  1. Verify source URL is valid and accessible
  2. Extract title and relevant snippet from source
  3. Attach citation in consistent format: [Title](URL)
  4. Deduplicate sources (same URL = one entry)
  5. Flag findings without sources as "uncited"
```

**Citation format:**
```markdown
[Finding text](source-url "Title - relevant snippet")
```

**Verification rules:**
- Every major claim MUST have at least one source citation
- All cited URLs must be from actual search results (no fabricated URLs)
- Source count must meet minimum threshold (2+ for high confidence)
- Findings without sources are flagged as "uncited" with warning

**Why a distinct citation step:**
- Higher citation quality than inline generation
- Deduplication reduces report length
- Verification prevents hallucinated URLs
- Mirrors Claude's CitationAgent pattern (simplified)

**Verification:**
- Every major claim has a URL
- All cited URLs are from actual search results
- Source count meets minimum threshold
- No fabricated URLs

### 4.5 Step 5: Report Synthesis

**Behavior:**
The subagent compiles all verified findings into a structured report:

```markdown
# Research: [Original Question]

## Summary
[2-3 sentence executive summary answering the research question]

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

## Research Metadata
- Depth levels completed: X
- Total searches: Y
- Total sources: Z
- Research cost: $W
```

**Verification:** The final report is returned to the parent agent via `formatSubagentResult`. The parent can verify:
- Source count (minimum threshold)
- Citation presence (every claim has a URL)
- Report length (substantial vs. thin)
- Confidence assessment present

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

### Step 5: Implement Citation Verification

**What:** A prompt template that verifies and attaches proper citations to findings.

**Why:** Citation quality is a key differentiator of deep research. Without verification, the model might hallucinate URLs or attach incorrect citations. A dedicated citation step ensures accuracy.

**Verification:**
- Every major claim has a URL
- All cited URLs are from actual search results
- No fabricated URLs
- Sources are deduplicated

**Test:**
```typescript
// tests/citation-verification.test.ts
test("citation verification attaches proper citations", async () => {
  const findings = [
    { text: "X works by Y", source: "https://example.com", confidence: "high" },
    { text: "X also does Z", source: "https://example.com", confidence: "medium" },
  ];
  const cited = await verifyCitations(findings);
  expect(cited[0].citation).toContain("https://example.com");
  expect(cited[0].citation).toContain("[");
  expect(cited[0].citation).toContain("]");
});

test("citation verification deduplicates sources", async () => {
  const findings = [
    { text: "Finding 1", source: "https://a.com", confidence: "high" },
    { text: "Finding 2", source: "https://a.com", confidence: "medium" },
    { text: "Finding 3", source: "https://b.com", confidence: "high" },
  ];
  const cited = await verifyCitations(findings);
  const uniqueSources = new Set(cited.map(c => c.source));
  expect(uniqueSources.size).toBe(2);
});
```

### Step 6: Wire Up the Five-Step Pipeline

**What:** Integrate planning, search, evaluation, citation, and synthesis into the deep-research skill body.

**Why:** This is the core integration step. The skill body orchestrates the five steps using the existing subagent infrastructure.

**Verification:**
- End-to-end test: given a research question, the system produces a report with citations
- The report contains findings from multiple sources
- The research plan was followed (steps completed in order)
- Citations are properly attached and verified

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

### Step 7: Add Depth/Breadth Configuration

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

### Step 8: Add Cost Budgeting

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

### Step 9: Add Streaming Progress Events

**What:** Progress events that the TUI can display during long-running research.

**Why:** Deep research can take 2-5 minutes. The user needs visibility into what's happening. Reasonix already has `SubagentEvent` with `start`, `progress`, `end`, `phase`, `stream-progress` kinds. We add research-specific phases: "planning", "searching", "evaluating", "citing", "synthesizing".

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
  expect(phases).toContain("evaluating");
  expect(phases).toContain("citing");
  expect(phases).toContain("synthesizing");
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
- Complexity analysis in Step 1 prevents over-investment in simple queries

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

### 6.5 Citation Quality

**Risk:** Citations may be hallucinated or incorrect.

**Mitigation:**
- Dedicated citation verification step (Step 4)
- Verification rules: URLs must be from actual search results
- Findings without sources flagged as "uncited"
- Minimum source count threshold

---

## 7. File Layout

```
src/
├── skills.ts                          # Add deep-research to BUILTIN_SKILLS
├── tools/
│   ├── deep-research.ts               # Research state accumulator + evaluator + citation
│   └── subagent.ts                    # Existing -- no changes needed
└── prompt-fragments.ts                # Existing -- may add research-specific fragments

tests/
├── deep-research-skill.test.ts        # Step 1: skill loading
├── research-state.test.ts             # Step 2: accumulator
├── research-evaluator.test.ts         # Step 3: evaluator
├── query-generation.test.ts           # Step 4: query gen
├── citation-verification.test.ts      # Step 5: citation verification
├── deep-research-pipeline.test.ts     # Step 6: pipeline
├── deep-research-config.test.ts       # Step 7: config
├── deep-research-budget.test.ts       # Step 8: budget
├── deep-research-events.test.ts       # Step 9: events
└── deep-research-integration.test.ts  # Step 10: integration

scripts/
└── probe-deep-research.mts            # Integration test with real API
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
8. **Well-cited:** Every major claim has at least one verified source citation

---

## 9. Comparison with Claude Deep Research

| Aspect | Claude Deep Research | Reasonix Deep Research |
|---|---|---|
| **Agent hierarchy** | 3-tier: Lead (Opus) → Subagents (Sonnet) → CitationAgent | 1-tier: Single subagent handles all steps |
| **Planning** | Lead Agent uses extended thinking | Subagent prompt-driven |
| **Search** | 3-5 parallel subagents | Single subagent with parallel web_search |
| **Evaluation** | Lead Agent evaluates after each round | Subagent evaluates internally |
| **Citation** | Dedicated CitationAgent | Dedicated step within subagent |
| **Cost** | ~15x chat tokens | ~8x chat tokens |
| **Performance gain** | 90.2% vs single agent | TBD (needs benchmarking) |
| **Complexity** | High (multi-agent orchestration) | Low (single subagent) |

**Reasonix trade-offs accepted:**
- Less separation of concerns than Claude's 3-tier architecture
- Subagent must handle all 5 steps in one context window
- No dedicated CitationAgent (citation quality depends on prompt engineering)
- Simpler orchestration, lower cost, easier to maintain

---

## 10. Sources

1. Anthropic, "How we built our multi-agent research system" (2025-06-13) -- 5-step architecture, CitationAgent, performance metrics
2. Anthropic, "Building Effective Agents" (2024-12-20) -- orchestrator-workers, evaluator-optimizer patterns
3. OpenAI, "Deep Research API Documentation" -- multi-step agentic architecture, tool orchestration
4. Google, "Gemini Deep Research" -- interactive research planning, iterative search
5. dzhng/deep-research (GitHub) -- recursive depth-controlled loop, breadth/depth parameters
6. assafelovic/gpt-researcher (GitHub) -- planner-executor-publisher, parallel crawling
7. Reasonix CLAUDE.md, ARCHITECTURE.md -- existing infrastructure and constraints
