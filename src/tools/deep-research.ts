/**
 * Deep Research — three-phase pipeline (Plan → Research → Synthesize)
 * using the lead-agent + parallel sub-agent fan-out pattern.
 *
 * Follows Reasonix's architecture philosophy: subagents as a cost-reduction
 * mechanism, not a coordination primitive. No orchestration framework,
 * no inter-agent communication, no shared blackboard.
 */

// ─── Types ───

export interface ResearchFinding {
  readonly text: string;
  readonly source: string;
  readonly confidence: "high" | "medium" | "low";
}

export interface ResearchSource {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
}

export interface ResearchState {
  readonly question: string;
  readonly findings: ResearchFinding[];
  readonly sources: ResearchSource[];
  readonly directions: string[];
  readonly searchedQueries: string[];
}

export interface ResearchEvaluation {
  readonly sufficient: boolean;
  readonly gaps: string[];
  readonly confidence: "high" | "medium" | "low";
}

export interface ResearchPlan {
  readonly research_question: string;
  readonly steps: ResearchStep[];
  readonly breadth: number;
  readonly depth: number;
}

export interface ResearchStep {
  readonly id: string;
  readonly title: string;
  readonly queries: string[];
  readonly goal: string;
}

// ─── Research State Accumulator ───

export function createResearchState(question: string): ResearchState {
  return {
    question,
    findings: [],
    sources: [],
    directions: [],
    searchedQueries: [],
  };
}

export function addFinding(state: ResearchState, finding: ResearchFinding): void {
  state.findings.push(finding);
}

export function addSource(state: ResearchState, source: ResearchSource): void {
  const isDuplicate = state.sources.some((s) => s.url === source.url);
  if (!isDuplicate) {
    state.sources.push(source);
  }
}

export function addDirection(state: ResearchState, direction: string): void {
  if (!state.directions.includes(direction)) {
    state.directions.push(direction);
  }
}

export function addSearchedQuery(state: ResearchState, query: string): void {
  if (!state.searchedQueries.includes(query)) {
    state.searchedQueries.push(query);
  }
}

export function getResearchSummary(state: ResearchState): string {
  const lines: string[] = [`Research question: ${state.question}`, ""];

  if (state.findings.length > 0) {
    lines.push(`## Findings (${state.findings.length})`);
    for (const f of state.findings) {
      lines.push(`- [${f.confidence}] ${f.text} (source: ${f.source})`);
    }
    lines.push("");
  }

  if (state.sources.length > 0) {
    lines.push(`## Sources (${state.sources.length})`);
    for (const s of state.sources) {
      lines.push(`- [${s.title}](${s.url})`);
    }
    lines.push("");
  }

  if (state.directions.length > 0) {
    lines.push("## Follow-up directions");
    for (const d of state.directions) {
      lines.push(`- ${d}`);
    }
  }

  return lines.join("\n");
}

// ─── Evaluator Prompt ───

export const EVALUATOR_PROMPT = `Given the research question and accumulated findings, assess:

1. Are the key claims supported by multiple sources?
2. Are there significant gaps in the evidence?
3. Would additional searches likely change the conclusion?

Return a JSON object with exactly these fields:
{
  "sufficient": boolean,
  "gaps": ["list of specific gaps that warrant further research"],
  "confidence": "high" | "medium" | "low"
}

Rules:
- "sufficient": true if the findings adequately answer the research question from multiple angles
- "gaps": empty array if sufficient is true; specific, actionable gaps otherwise
- "confidence": "high" if 3+ corroborating sources, "medium" if 1-2, "low" if conflicting or insufficient`;

// ─── Query Generation Prompt ───

export const QUERY_GENERATION_PROMPT = `Generate search queries for the given research step.

Rules:
- Produce exactly the requested number of queries
- Each query should target a different angle or source type
- Avoid duplicating any previously searched queries
- Queries should be concise (2-6 words) and specific
- Include both broad and narrow queries for diversity

Return a JSON array of strings: ["query1", "query2", ...]`;

// ─── Synthesis Prompt ───

export const SYNTHESIS_PROMPT = `Compile all accumulated research findings into a structured report.

Report structure:
1. **Summary** — 2-3 sentence executive summary answering the research question
2. **Key Findings** — numbered list, each with inline citation [source-url]
3. **Detailed Analysis** — organized by topic, with inline citations
4. **Sources** — numbered list with title, URL, and relevance note
5. **Confidence Assessment** — per-claim confidence rating

Rules:
- Every claim MUST have at least one source citation
- Distinguish "verified in code" from "read in documentation"
- If evidence is conflicting, present both sides with sources
- If confidence is low, say so explicitly — do not manufacture certainty`;
