/**
 * Deep Research example: run the deep-research skill programmatically.
 * Needs DEEPSEEK_API_KEY in .env or environment.
 *
 * Run: npx tsx examples/deep-research.ts "你的研究问题"
 */
import {
  CacheFirstLoop,
  DeepSeekClient,
  ImmutablePrefix,
  ToolRegistry,
  loadDotenv,
} from "../src/index.js";
import { SkillStore } from "../src/skills.js";
import { registerWebTools } from "../src/tools/web.js";
import { formatSubagentResult, spawnSubagent } from "../src/tools/subagent.js";

loadDotenv();

async function main() {
  const query = process.argv[2] ?? "What is prefix caching in DeepSeek?";

  console.log("═".repeat(60));
  console.log("Deep Research Example");
  console.log("═".repeat(60));
  console.log(`Query: ${query}`);
  console.log("");

  // Setup
  const client = new DeepSeekClient();
  const tools = new ToolRegistry();
  registerWebTools(tools);

  // Load skill
  const store = new SkillStore();
  const skill = store.read("deep-research");
  if (!skill) {
    console.error("ERROR: deep-research skill not found");
    process.exit(1);
  }

  console.log(`Skill: ${skill.name} (${skill.runAs})`);
  console.log(`Tools: ${tools.size} registered`);
  console.log("");

  // Run
  console.log("Starting research...");
  console.log("─".repeat(60));

  const t0 = Date.now();
  const result = await spawnSubagent({
    client,
    parentRegistry: tools,
    system: skill.body,
    task: query,
    model: "deepseek-v4-flash",
    skillName: "deep-research",
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("");
  console.log("═".repeat(60));
  console.log("Result");
  console.log("═".repeat(60));
  console.log(`Status: ${result.success ? "✓ SUCCESS" : "✗ FAILED"}`);
  console.log(`Elapsed: ${elapsed}s`);
  console.log(`Turns: ${result.turns}`);
  console.log(`Tool iters: ${result.toolIters}`);
  console.log(`Cost: $${result.costUsd.toFixed(4)}`);
  console.log(`Model: ${result.model}`);
  console.log("");

  if (result.success) {
    console.log("Output:");
    console.log("─".repeat(60));
    console.log(result.output);
  } else {
    console.log(`Error: ${result.error}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
