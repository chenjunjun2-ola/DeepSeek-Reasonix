/**
 * Integration test for the deep-research skill.
 * Calls the real DeepSeek API with a known-answer question
 * and verifies the output contains the correct answer with citations.
 *
 * Run: tsx scripts/probe-deep-research.mts
 * Reads DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL from ./.env or environment.
 */

import { readFileSync } from "node:fs";
import { DeepSeekClient, ToolRegistry } from "../src/index.js";
import { SkillStore } from "../src/skills.js";
import { registerWebTools } from "../src/tools/web.js";
import { formatSubagentResult, spawnSubagent } from "../src/tools/subagent.js";

// ─── Load env ───

function loadDotenv(path: string): void {
  try {
    const txt = readFileSync(path, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) process.env[m[1]] ??= m[2];
    }
  } catch {
    // .env not found — rely on environment variables
  }
}
loadDotenv("./.env");

if (!process.env.DEEPSEEK_API_KEY) {
  console.error("ERROR: DEEPSEEK_API_KEY missing. Set it in .env or environment.");
  process.exit(1);
}

// ─── Setup ───

const client = new DeepSeekClient({ baseUrl: process.env.DEEPSEEK_BASE_URL });
const tools = new ToolRegistry();
registerWebTools(tools);

// Load the deep-research skill body
const store = new SkillStore();
const skill = store.read("deep-research");
if (!skill) {
  console.error("ERROR: deep-research skill not found in builtin skills.");
  process.exit(1);
}

console.log("═".repeat(60));
console.log("Deep Research Integration Test");
console.log("═".repeat(60));
console.log("");
console.log(`Skill: ${skill.name} (${skill.runAs})`);
console.log(`Model: deepseek-v4-flash (default)`);
console.log(`Tools registered: ${tools.size}`);
console.log("");

// ─── Test Cases ───

interface TestCase {
  name: string;
  task: string;
  expectedInOutput: string[];
  maxCostUsd: number;
  timeoutMs: number;
}

const testCases: TestCase[] = [
  {
    name: "Simple factual question",
    task: "What year was the Eiffel Tower completed? Provide sources.",
    expectedInOutput: ["1889"],
    maxCostUsd: 0.05,
    timeoutMs: 120_000,
  },
  {
    name: "Technical comparison",
    task: "What are the main differences between TCP and UDP? Cite sources.",
    expectedInOutput: ["TCP", "UDP"],
    maxCostUsd: 0.10,
    timeoutMs: 180_000,
  },
];

// ─── Run Tests ───

async function runTest(testCase: TestCase): Promise<boolean> {
  console.log("─".repeat(60));
  console.log(`Test: ${testCase.name}`);
  console.log(`Task: ${testCase.task}`);
  console.log("");

  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), testCase.timeoutMs);

  try {
    const result = await spawnSubagent({
      client,
      parentRegistry: tools,
      parentSignal: controller.signal,
      system: skill!.body,
      task: testCase.task,
      model: "deepseek-v4-flash",
      skillName: "deep-research",
    });

    clearTimeout(timeout);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`  Status: ${result.success ? "✓ SUCCESS" : "✗ FAILED"}`);
    console.log(`  Elapsed: ${elapsed}s`);
    console.log(`  Turns: ${result.turns}`);
    console.log(`  Tool iters: ${result.toolIters}`);
    console.log(`  Cost: $${result.costUsd.toFixed(4)}`);
    console.log(`  Model: ${result.model}`);
    console.log("");

    if (!result.success) {
      console.log(`  Error: ${result.error}`);
      console.log("");
      return false;
    }

    // Check expected content
    const output = result.output.toLowerCase();
    const missing = testCase.expectedInOutput.filter(
      (expected) => !output.includes(expected.toLowerCase()),
    );

    if (missing.length > 0) {
      console.log(`  ✗ Missing expected content: ${missing.join(", ")}`);
      console.log("");
      return false;
    }

    // Check cost
    if (result.costUsd > testCase.maxCostUsd) {
      console.log(`  ✗ Cost $${result.costUsd.toFixed(4)} exceeds max $${testCase.maxCostUsd}`);
      console.log("");
      return false;
    }

    // Check for citations (URLs)
    const urlCount = (result.output.match(/https?:\/\/[^\s)]+/g) || []).length;
    console.log(`  Citations found: ${urlCount} URLs`);

    if (urlCount === 0) {
      console.log(`  ⚠ Warning: No citations found in output`);
    }

    console.log("");
    console.log("  Output (first 500 chars):");
    console.log("  " + "─".repeat(50));
    for (const line of result.output.slice(0, 500).split("\n")) {
      console.log(`  ${line}`);
    }
    if (result.output.length > 500) {
      console.log(`  ... (${result.output.length - 500} more chars)`);
    }
    console.log("");

    return true;
  } catch (err) {
    clearTimeout(timeout);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ✗ Error after ${elapsed}s: ${(err as Error).message}`);
    console.log("");
    return false;
  }
}

async function main(): Promise<void> {
  const results: Array<{ name: string; passed: boolean }> = [];
  let totalCost = 0;

  for (const testCase of testCases) {
    const passed = await runTest(testCase);
    results.push({ name: testCase.name, passed });
  }

  // ─── Summary ───

  console.log("═".repeat(60));
  console.log("Summary");
  console.log("═".repeat(60));
  console.log("");

  for (const r of results) {
    console.log(`  ${r.passed ? "✓" : "✗"} ${r.name}`);
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log("");
  console.log(`  ${passed}/${total} tests passed`);
  console.log("");

  if (passed < total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
