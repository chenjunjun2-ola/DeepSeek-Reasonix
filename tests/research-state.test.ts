import { describe, expect, it } from "vitest";
import {
  addDirection,
  addFinding,
  addSearchedQuery,
  addSource,
  createResearchState,
  getResearchSummary,
} from "../src/tools/deep-research.js";

describe("ResearchState", () => {
  it("creates empty state with question", () => {
    const state = createResearchState("How does X work?");
    expect(state.question).toBe("How does X work?");
    expect(state.findings).toHaveLength(0);
    expect(state.sources).toHaveLength(0);
    expect(state.directions).toHaveLength(0);
    expect(state.searchedQueries).toHaveLength(0);
  });

  it("accumulates findings", () => {
    const state = createResearchState("test");
    addFinding(state, { text: "X works by Y", source: "https://a.com", confidence: "high" });
    addFinding(state, { text: "X also does Z", source: "https://b.com", confidence: "medium" });
    expect(state.findings).toHaveLength(2);
    expect(state.findings[0].text).toBe("X works by Y");
    expect(state.findings[1].confidence).toBe("medium");
  });

  it("deduplicates sources by URL", () => {
    const state = createResearchState("test");
    addSource(state, { url: "https://example.com", title: "Example", snippet: "content" });
    addSource(state, { url: "https://example.com", title: "Example Again", snippet: "same" });
    addSource(state, { url: "https://other.com", title: "Other", snippet: "different" });
    expect(state.sources).toHaveLength(2);
    expect(state.sources[0].url).toBe("https://example.com");
    expect(state.sources[1].url).toBe("https://other.com");
  });

  it("deduplicates directions", () => {
    const state = createResearchState("test");
    addDirection(state, "Investigate X's interaction with Y");
    addDirection(state, "Investigate X's interaction with Y");
    addDirection(state, "Look into Z");
    expect(state.directions).toHaveLength(2);
  });

  it("deduplicates searched queries", () => {
    const state = createResearchState("test");
    addSearchedQuery(state, "X documentation");
    addSearchedQuery(state, "X documentation");
    addSearchedQuery(state, "X examples");
    expect(state.searchedQueries).toHaveLength(2);
  });

  it("generates research summary with all sections", () => {
    const state = createResearchState("How does X work?");
    addFinding(state, { text: "X works by Y", source: "https://a.com", confidence: "high" });
    addSource(state, { url: "https://a.com", title: "A", snippet: "content" });
    addDirection(state, "Investigate Z");

    const summary = getResearchSummary(state);
    expect(summary).toContain("How does X work?");
    expect(summary).toContain("Findings (1)");
    expect(summary).toContain("[high] X works by Y");
    expect(summary).toContain("Sources (1)");
    expect(summary).toContain("[A](https://a.com)");
    expect(summary).toContain("Follow-up directions");
    expect(summary).toContain("Investigate Z");
  });

  it("generates minimal summary when empty", () => {
    const state = createResearchState("test");
    const summary = getResearchSummary(state);
    expect(summary).toContain("test");
    expect(summary).not.toContain("Findings");
    expect(summary).not.toContain("Sources");
    expect(summary).not.toContain("Follow-up");
  });
});
