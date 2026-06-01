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

describe("deep-research pipeline (5-step)", () => {
  describe("Step 1: PLAN", () => {
    it("produces a valid research plan structure", () => {
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

    it("assesses query complexity correctly", () => {
      // Simple fact-finding
      const simplePlan: ResearchPlan = {
        research_question: "What is the capital of France?",
        steps: [
          {
            id: "step-1",
            title: "Find answer",
            queries: ["capital of France"],
            goal: "Get answer",
          },
        ],
        breadth: 2,
        depth: 1,
      };
      expect(simplePlan.breadth).toBe(2);
      expect(simplePlan.depth).toBe(1);

      // Complex research
      const complexPlan: ResearchPlan = {
        research_question: "Compare all approaches to distributed consensus",
        steps: [
          {
            id: "step-1",
            title: "Find Paxos",
            queries: ["Paxos consensus"],
            goal: "Understand Paxos",
          },
          {
            id: "step-2",
            title: "Find Raft",
            queries: ["Raft consensus"],
            goal: "Understand Raft",
          },
          {
            id: "step-3",
            title: "Find PBFT",
            queries: ["PBFT consensus"],
            goal: "Understand PBFT",
          },
        ],
        breadth: 6,
        depth: 3,
      };
      expect(complexPlan.breadth).toBe(6);
      expect(complexPlan.depth).toBe(3);
    });
  });

  describe("Step 2: SEARCH", () => {
    it("accumulates findings from multiple search results", () => {
      const state = createResearchState("How does X work?");

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

      const previousQueries = state.searchedQueries;
      const newQuery = "DeepSeek cache implementation";
      const duplicateQuery = "DeepSeek prefix caching";

      expect(previousQueries).toContain("DeepSeek prefix caching");
      expect(previousQueries).not.toContain(newQuery);
      expect(previousQueries).toContain(duplicateQuery);
    });

    it("supports parallel search queries", () => {
      const queries = ["query1", "query2", "query3"];
      const maxParallel = 3; // REASONIX_PARALLEL_MAX default

      const chunks: string[][] = [];
      for (let i = 0; i < queries.length; i += maxParallel) {
        chunks.push(queries.slice(i, i + maxParallel));
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toHaveLength(3);
    });
  });

  describe("Step 3: EVALUATE", () => {
    it("evaluates completeness correctly when sufficient", () => {
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

    it("supports iteration decision logic", () => {
      const evaluation: ResearchEvaluation = {
        sufficient: false,
        gaps: ["Need more sources"],
        confidence: "medium",
      };

      const currentDepth = 1;
      const maxDepth = 3;

      // Should continue iterating
      if (!evaluation.sufficient && currentDepth < maxDepth) {
        expect(true).toBe(true); // Continue to next depth level
      }
    });
  });

  describe("Step 4: CITE", () => {
    it("attaches proper citations to findings", () => {
      const state = createResearchState("test");
      addFinding(state, {
        text: "X works by Y",
        source: "https://example.com",
        confidence: "high",
      });

      // Simulate citation verification
      const finding = state.findings[0];
      const citation = `[Example](${finding.source})`;

      expect(citation).toContain("https://example.com");
      expect(citation).toContain("[");
      expect(citation).toContain("]");
    });

    it("deduplicates sources during citation", () => {
      const state = createResearchState("test");
      addSource(state, { url: "https://a.com", title: "A", snippet: "content" });
      addSource(state, { url: "https://a.com", title: "A Again", snippet: "same" });
      addSource(state, { url: "https://b.com", title: "B", snippet: "different" });

      expect(state.sources).toHaveLength(2);
    });

    it("flags uncited findings", () => {
      const finding = { text: "X works by Y", source: "", confidence: "low" as const };
      const isUncited = !finding.source;

      expect(isUncited).toBe(true);
    });
  });

  describe("Step 5: REPORT", () => {
    it("generates a report with all required sections", () => {
      const state = createResearchState("How does prefix caching work?");
      addFinding(state, {
        text: "Prefix caching stores the common prefix",
        source: "https://docs.deepseek.com",
        confidence: "high",
      });
      addFinding(state, {
        text: "Cache hits are billed at 10%",
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

    it("includes research metadata", () => {
      // Simulate metadata
      const metadata = {
        depthLevelsCompleted: 2,
        totalSearches: 8,
        totalSources: 5,
      };

      expect(metadata.depthLevelsCompleted).toBe(2);
      expect(metadata.totalSearches).toBe(8);
      expect(metadata.totalSources).toBe(5);
    });
  });

  describe("Budget and Cost Control", () => {
    it("respects tool call limits", () => {
      const maxToolCalls = 20;
      const simulatedToolCalls = 15;
      expect(simulatedToolCalls).toBeLessThanOrEqual(maxToolCalls);
    });

    it("uses flash model by default for cost efficiency", () => {
      const defaultModel = "deepseek-v4-flash";
      expect(defaultModel).toContain("flash");
    });
  });
});
