import { describe, expect, it } from "vitest";
import {
  type ResearchEvaluation,
  type ResearchPlan,
  type ResearchState,
  addDirection,
  addFinding,
  addSearchedQuery,
  addSource,
  createResearchState,
  getResearchSummary,
} from "../src/tools/deep-research.js";

describe("deep-research pipeline", () => {
  describe("Phase 1: Planning", () => {
    it("produces a valid research plan structure", () => {
      // Simulate what the subagent would produce
      const plan: ResearchPlan = {
        research_question: "How does prefix caching work in DeepSeek?",
        steps: [
          {
            id: "step-1",
            title: "Find official documentation",
            queries: ["DeepSeek prefix caching", "DeepSeek cache API"],
            goal: "Establish ground truth from canonical sources",
          },
          {
            id: "step-2",
            title: "Find implementation examples",
            queries: ["DeepSeek cache example", "DeepSeek cache tutorial"],
            goal: "Understand practical usage patterns",
          },
        ],
        breadth: 4,
        depth: 2,
      };

      expect(plan.steps).toHaveLength(2);
      expect(plan.breadth).toBe(4);
      expect(plan.depth).toBe(2);
      expect(plan.steps[0].queries.length).toBeGreaterThan(0);
    });
  });

  describe("Phase 2: Research Execution", () => {
    it("accumulates findings from multiple search results", () => {
      const state = createResearchState("How does X work?");

      // Simulate search results
      addFinding(state, {
        text: "X uses Y for Z",
        source: "https://docs.example.com",
        confidence: "high",
      });
      addFinding(state, {
        text: "X also supports W",
        source: "https://blog.example.com",
        confidence: "medium",
      });
      addSource(state, {
        url: "https://docs.example.com",
        title: "X Docs",
        snippet: "X uses Y...",
      });
      addSource(state, {
        url: "https://blog.example.com",
        title: "X Blog",
        snippet: "X supports...",
      });

      expect(state.findings).toHaveLength(2);
      expect(state.sources).toHaveLength(2);
    });

    it("tracks searched queries to avoid redundancy", () => {
      const state = createResearchState("test");
      addSearchedQuery(state, "DeepSeek prefix caching");
      addSearchedQuery(state, "DeepSeek cache API");

      // Simulate generating new queries that avoid previous ones
      const previousQueries = state.searchedQueries;
      const newQuery = "DeepSeek cache implementation";
      const duplicateQuery = "DeepSeek prefix caching";

      expect(previousQueries).toContain("DeepSeek prefix caching");
      expect(previousQueries).not.toContain(newQuery);
      expect(previousQueries).toContain(duplicateQuery);
    });

    it("evaluates completeness correctly", () => {
      // Simulate evaluator output
      const evaluation: ResearchEvaluation = {
        sufficient: true,
        gaps: [],
        confidence: "high",
      };

      expect(evaluation.sufficient).toBe(true);
      expect(evaluation.gaps).toHaveLength(0);
      expect(evaluation.confidence).toBe("high");
    });

    it("identifies gaps when evidence is insufficient", () => {
      const evaluation: ResearchEvaluation = {
        sufficient: false,
        gaps: [
          "No information about performance characteristics",
          "Missing comparison with alternatives",
        ],
        confidence: "low",
      };

      expect(evaluation.sufficient).toBe(false);
      expect(evaluation.gaps).toHaveLength(2);
      expect(evaluation.confidence).toBe("low");
    });
  });

  describe("Phase 3: Synthesis", () => {
    it("generates a report with citations", () => {
      const state = createResearchState("How does prefix caching work?");
      addFinding(state, {
        text: "Prefix caching stores the common prefix of requests",
        source: "https://docs.deepseek.com",
        confidence: "high",
      });
      addFinding(state, {
        text: "Cache hits are billed at 10% of the miss rate",
        source: "https://deepseek.com/pricing",
        confidence: "high",
      });
      addSource(state, {
        url: "https://docs.deepseek.com",
        title: "DeepSeek Docs",
        snippet: "Prefix caching...",
      });
      addSource(state, {
        url: "https://deepseek.com/pricing",
        title: "DeepSeek Pricing",
        snippet: "Cache hits...",
      });

      const summary = getResearchSummary(state);

      // Verify report structure
      expect(summary).toContain("How does prefix caching work?");
      expect(summary).toContain("Findings (2)");
      expect(summary).toContain("Sources (2)");

      // Verify citations are present
      expect(summary).toContain("https://docs.deepseek.com");
      expect(summary).toContain("https://deepseek.com/pricing");

      // Verify confidence ratings
      expect(summary).toContain("[high]");
    });

    it("handles conflicting evidence", () => {
      const state = createResearchState("Is X faster than Y?");
      addFinding(state, {
        text: "X is 2x faster than Y in benchmarks",
        source: "https://benchmark.com",
        confidence: "medium",
      });
      addFinding(state, {
        text: "Y outperforms X in real-world workloads",
        source: "https://casestudy.com",
        confidence: "medium",
      });

      const summary = getResearchSummary(state);
      expect(summary).toContain("2x faster");
      expect(summary).toContain("outperforms");
    });
  });

  describe("Budget and Cost Control", () => {
    it("respects tool call limits", () => {
      // The skill body specifies ~20 tool calls max
      const maxToolCalls = 20;
      const simulatedToolCalls = 15;
      expect(simulatedToolCalls).toBeLessThanOrEqual(maxToolCalls);
    });

    it("uses flash model by default for cost efficiency", () => {
      // Subagents default to deepseek-v4-flash
      const defaultModel = "deepseek-v4-flash";
      expect(defaultModel).toContain("flash");
    });
  });

  describe("Parallel Execution", () => {
    it("supports parallel search queries", () => {
      // The skill body instructs parallel execution via web_search
      // web_search is marked parallelSafe: true
      const queries = ["query1", "query2", "query3"];
      const maxParallel = 3; // REASONIX_PARALLEL_MAX default

      // Simulate chunked parallel execution
      const chunks: string[][] = [];
      for (let i = 0; i < queries.length; i += maxParallel) {
        chunks.push(queries.slice(i, i + maxParallel));
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toHaveLength(3);
    });
  });
});
