import { describe, expect, it } from "vitest";
import { SkillStore } from "../src/skills.js";

describe("deep-research skill", () => {
  it("is listed in builtin skills", () => {
    const store = new SkillStore();
    const skills = store.list();
    const deepResearch = skills.find((s) => s.name === "deep-research");
    expect(deepResearch).toBeDefined();
    expect(deepResearch!.runAs).toBe("subagent");
    expect(deepResearch!.description).toContain("Deep multi-round research");
    expect(deepResearch!.scope).toBe("builtin");
  });

  it("has a non-empty body", () => {
    const store = new SkillStore();
    const skill = store.read("deep-research");
    expect(skill).not.toBeNull();
    expect(skill!.body.length).toBeGreaterThan(100);
    expect(skill!.body).toContain("Three-Phase Pipeline");
    expect(skill!.body).toContain("Phase 1: Plan");
    expect(skill!.body).toContain("Phase 2: Research");
    expect(skill!.body).toContain("Phase 3: Synthesize");
  });

  it("includes citation requirements in body", () => {
    const store = new SkillStore();
    const skill = store.read("deep-research");
    expect(skill!.body).toContain("citation");
    expect(skill!.body).toContain("source");
  });

  it("includes breadth/depth parameters in body", () => {
    const store = new SkillStore();
    const skill = store.read("deep-research");
    expect(skill!.body).toContain("breadth");
    expect(skill!.body).toContain("depth");
  });
});
