#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const inspectorScript = join(repositoryRoot, "skills/bootstrap-ai-project/scripts/inspect-project.mjs");
const compilerScript = join(repositoryRoot, "skills/bootstrap-ai-project/scripts/compile-project.mjs");
const validatorScript = join(repositoryRoot, "skills/bootstrap-ai-project/scripts/validate-project.mjs");

function usage() {
  return `Usage: bootstrap-project.mjs [--root <repo>] [--adapters <codex,claude>] [--check <command>] [--yes] [--dry-run]\n`;
}

function parseArgs(argv) {
  const options = { root: process.cwd(), adapters: null, adaptersProvided: false, checks: [], yes: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = argv[++index];
    else if (arg === "--adapters") {
      options.adapters = argv[++index];
      options.adaptersProvided = true;
    }
    else if (arg === "--check") options.checks.push(argv[++index]);
    else if (arg === "--yes") options.yes = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (argv[index] === undefined && ["--root", "--adapters", "--check"].includes(arg)) {
      throw new Error(`${arg} requires a value.`);
    }
  }
  return options;
}

function fail(message, code = 1) {
  process.stderr.write(`bootstrap-project: ${message}\n`);
  process.exit(code);
}

function runJson(script, args, cwd) {
  try {
    return JSON.parse(execFileSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" }));
  } catch (error) {
    const detail = error.stdout || error.stderr || error.message;
    throw new Error(`Cannot run ${basename(script)}: ${detail}`);
  }
}

function runNode(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
}

function parseList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value, fallback = "project") {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function readPackageSummary(root, report) {
  const packagePath = report.inventory.manifestPaths.find((path) => path === "package.json")
    || report.inventory.manifestPaths.find((path) => path.endsWith("package.json"));
  if (!packagePath) return { name: basename(root), summary: "" };
  try {
    const packageJson = JSON.parse(readFileSync(join(root, packagePath), "utf8"));
    return {
      name: typeof packageJson.name === "string" ? packageJson.name : basename(root),
      summary: typeof packageJson.description === "string" ? packageJson.description.trim() : "",
    };
  } catch {
    return { name: basename(root), summary: "" };
  }
}

function defaultDomain(report) {
  if (report.detected.frameworks?.length > 0) return report.detected.frameworks.map((item) => item.name).join(", ");
  if (report.detected.languages?.length > 0) return `${report.detected.languages[0].name} software`;
  return "software project";
}

function selectAdapters(value) {
  const adapters = parseList(value || "codex,claude");
  if (adapters.length === 0) return [];
  if (new Set(adapters).size !== adapters.length || adapters.some((item) => !["codex", "claude"].includes(item))) {
    throw new Error("--adapters accepts only codex and claude, separated by commas.");
  }
  return adapters;
}

function observedChecks(report) {
  const seen = new Set();
  return report.verificationCandidates
    .filter((candidate) => candidate.status === "observed" && candidate.command && candidate.source?.path && candidate.source?.pointer)
    .filter((candidate) => {
      if (seen.has(candidate.command)) return false;
      seen.add(candidate.command);
      return true;
    });
}

function answer(id, question, value) {
  return { id, question, answer: value };
}

function fact(id, subject, value, status, evidence) {
  return { id, subject, value, status, confidence: status === "confirmed" ? 1 : 0.9, evidence };
}

function fileEvidence(candidate) {
  return {
    kind: "file",
    path: candidate.source.path,
    pointer: candidate.source.pointer,
    note: candidate.source.note || `Observed command: ${candidate.command}`,
  };
}

function buildBlueprint(root, report, answers, defaults, adapters, checks) {
  const packageInfo = readPackageSummary(root, report);
  const projectName = packageInfo.name || basename(root);
  const projectId = slugify(projectName);
  const repositoryShape = report.detected.repositoryShape || "single-project";
  const checkFacts = checks.map((check, index) => fact(
    `verification-${index + 1}`,
    `Verification command ${index + 1}`,
    check.command,
    check.confirmed ? "confirmed" : "observed",
    [check.confirmed
      ? { kind: "interview", pointer: check.answerId, note: "The user explicitly supplied this verification command." }
      : fileEvidence(check)],
  ));
  const facts = [
    fact(
      "project-purpose",
      "Project purpose",
      defaults.summary,
      "confirmed",
      [{ kind: "interview", pointer: "answer-project-purpose", note: "The project owner accepted the project purpose used for initialization." }],
    ),
    fact(
      "repository-shape",
      "Repository shape",
      repositoryShape,
      "observed",
      [{ kind: "command", pointer: "node skills/bootstrap-ai-project/scripts/inspect-project.mjs <repo-root>", note: "The Gongxu inspector reported the repository shape." }],
    ),
    ...checkFacts,
  ];
  const module = {
    id: "repository",
    name: projectName,
    responsibilities: ["Contain the existing project implementation and its repository-level workflows."],
    dependencies: [],
    paths: ["."],
    planned: false,
  };
  const context = [".ai/project/repo-map.md"];
  for (const path of ["README.md", "AGENTS.md", "CLAUDE.md", ...report.inventory.documentationPaths]) {
    if (path !== ".ai/project/repo-map.md" && existsSync(join(root, path)) && !context.includes(path)) context.push(path);
  }
  const verification = checks.map((check, index) => ({
    id: `verification-${index + 1}`,
    name: check.name || `Verification ${index + 1}`,
    command: check.command,
    cwd: check.cwd || ".",
    required: true,
    source: check.confirmed
      ? { kind: "interview", path: check.answerId, note: "The user explicitly supplied this exact command." }
      : { kind: "file", path: check.source.path, pointer: check.source.pointer, note: check.source.note || `Observed command: ${check.command}` },
  }));
  const rules = verification.map((check, index) => ({
    id: `run-verification-${index + 1}`,
    scope: "verification",
    statement: `Run ${check.command} before reporting this project change complete.`,
    rationale: "The command is an exact repository-backed verification check.",
    severity: "block",
    sourceFactIds: [`verification-${index + 1}`],
    checkId: check.id,
  }));
  const skill = {
    id: "change-project",
    name: "Change Project",
    description: `Change ${projectName} while preserving its observed repository boundaries and verification checks.`,
    triggers: ["implementing a feature", "fixing a defect", "changing project behavior"],
    context,
    steps: [
      "Inspect the repository map and the affected implementation before editing.",
      `Keep the change within the observed ${repositoryShape} repository boundary unless architecture approval is recorded.`,
      "Update the relevant tests and run every required verification check.",
    ],
    verificationCheckIds: verification.map((check) => check.id),
  };
  const workflowSteps = [
    { id: "inspect", action: "Inspect the existing implementation and relevant project evidence.", required: true },
    { id: "implement", action: "Implement the smallest scoped change that follows the selected project rules.", required: true },
    ...verification.map((check, index) => ({
      id: `verify-${index + 1}`,
      action: `Run ${check.command}.`,
      required: true,
      checkId: check.id,
    })),
  ];
  return {
    schemaVersion: 1,
    project: {
      id: projectId,
      name: projectName,
      summary: defaults.summary,
      stage: "active",
      kind: repositoryShape === "monorepo" ? "software-monorepo" : "software-project",
      primaryUsers: defaults.primaryUsers,
      domains: defaults.domains,
      constraints: [],
    },
    evidence: {
      sourceRevision: report.git.head || null,
      facts,
      unknowns: [],
      answers,
      assumptions: defaults.assumptions,
    },
    architecture: {
      current: {
        summary: `The repository is a ${repositoryShape} whose existing implementation remains the source of truth.`,
        style: repositoryShape,
        modules: [module],
      },
      target: {
        summary: "Preserve the observed repository architecture until a migration is explicitly requested.",
        style: repositoryShape,
        modules: [module],
        status: "preserve-current",
      },
      boundaries: [],
    },
    rules,
    skills: [skill],
    workflows: [{
      id: "repository-change",
      name: "Repository Change",
      triggers: ["implementing a feature", "fixing a defect"],
      steps: workflowSteps,
    }],
    examples: report.inventory.testPaths.length > 0
      ? [{
        id: "existing-test-example",
        path: report.inventory.testPaths[0],
        demonstrates: ["the repository's existing test location"],
        sourceFactIds: ["repository-shape"],
      }]
      : [],
    verification,
    adapters,
  };
}

async function collectInput(options, report) {
  const packageInfo = readPackageSummary(options.root, report);
  const defaults = {
    summary: packageInfo.summary || `A ${report.detected.repositoryShape === "monorepo" ? "monorepo" : "software project"} named ${packageInfo.name || basename(options.root)}.`,
    primaryUsers: ["repository maintainers"],
    domains: defaultDomain(report) ? [defaultDomain(report)] : [],
    assumptions: [],
  };
  const answers = [];
  const interactive = !options.yes;
  const prompt = interactive ? await createPromptSession() : {
    ask: async (_question, fallback) => fallback,
    approve: async () => true,
    close: () => {},
  };
  try {
    defaults.summary = await prompt.ask("Project purpose/summary", defaults.summary);
    if (!defaults.summary) throw new Error("A project purpose/summary is required; pass it through the interactive prompt or package metadata.");
    answers.push(answer("answer-project-purpose", "What is this project for?", defaults.summary));
    const users = await prompt.ask("Primary users (comma-separated)", defaults.primaryUsers.join(", "));
    defaults.primaryUsers = parseList(users);
    answers.push(answer("answer-primary-users", "Who are the primary users?", defaults.primaryUsers.join(", ")));
    if (options.yes) defaults.assumptions.push("Accepted the CLI defaults for project purpose and primary users.");
    if (!packageInfo.summary && options.yes) defaults.assumptions.push("The project purpose was not documented in package metadata; the CLI used a repository-shape summary.");
    if (!options.adaptersProvided) {
      defaults.assumptions.push("Generated Codex and Claude Code adapters by default; pass --adapters to change the selection.");
    }
    if (options.checks.length === 0 && observedChecks(report).length === 0) {
      const command = await prompt.ask("Exact verification command (required when CI has none)", "");
      if (!command) throw new Error("No verification command was supplied. Use --check <command> or answer the prompt.");
      options.checks.push(command);
    }
    return { answers, defaults, prompt };
  } finally {
    if (!interactive) prompt.close();
  }
}

async function createPromptSession() {
  if (!stdin.isTTY) {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    const lines = chunks.join("").split(/\r?\n/);
    const next = (fallback) => lines.shift()?.trim() || fallback;
    return {
      ask: async (_question, fallback) => next(fallback),
      approve: async () => /^(?:y|yes)$/i.test(next("")),
      close: () => {},
    };
  }
  const rl = createInterface({ input: stdin, output: stdout });
  return {
    ask: async (question, fallback) => {
      const suffix = fallback ? ` [${fallback}]` : "";
      const value = (await rl.question(`${question}${suffix}: `)).trim();
      return value || fallback;
    },
    approve: async () => (await rl.question("Compile this blueprint into the target repository? [y/N]: ")).trim().toLowerCase() === "y",
    close: () => rl.close(),
  };
}

function normalizeChecks(report, explicitCommands) {
  const observed = observedChecks(report).map((candidate) => ({ ...candidate, confirmed: false }));
  const existing = new Set(observed.map((candidate) => candidate.command));
  for (const command of explicitCommands) {
    if (!command || /[\r\n\0]/.test(command)) throw new Error("Verification commands must be single-line values without NUL bytes.");
    if (existing.has(command)) continue;
    const answerId = `answer-verification-${observed.length + 1}`;
    observed.push({
      id: `explicit-${observed.length + 1}`,
      name: `Confirmed verification ${observed.length + 1}`,
      command,
      cwd: ".",
      confirmed: true,
      answerId,
      source: { path: answerId, pointer: answerId, note: "Explicitly supplied verification command." },
    });
    existing.add(command);
  }
  return observed;
}

function printPreview(blueprint, root) {
  process.stdout.write("\nBlueprint preview\n");
  process.stdout.write(`${JSON.stringify({
    root,
    project: blueprint.project,
    architecture: blueprint.architecture.target,
    adapters: blueprint.adapters,
    verification: blueprint.verification.map((check) => check.command),
    generated: [".ai/", "AGENTS.md", ...(blueprint.adapters.includes("claude") ? ["CLAUDE.md"] : [])],
  }, null, 2)}\n\n`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    options.root = resolve(options.root);
    if (!existsSync(options.root)) throw new Error(`target does not exist: ${options.root}`);
    if (existsSync(join(options.root, ".ai/blueprint.json")) || existsSync(join(options.root, ".ai/manifest.json"))) {
      throw new Error("target already has Gongxu state; use the Agent Skill update workflow instead of fresh bootstrap.");
    }
    options.adapters = selectAdapters(options.adapters);
    const report = runJson(inspectorScript, [options.root], repositoryRoot);
    const input = await collectInput(options, report);
    const checks = normalizeChecks(report, options.checks);
    if (checks.length === 0) throw new Error("No exact verification commands were found; pass --check <command> to make the result verifiable.");
    for (const check of checks.filter((item) => item.confirmed)) {
      input.answers.push(answer(check.answerId, "Which exact verification command should run?", check.command));
    }
    const blueprint = buildBlueprint(options.root, report, input.answers, input.defaults, options.adapters, checks);
    const temporaryRoot = mkdtempSync(join(tmpdir(), "gongxu-bootstrap-"));
    const blueprintPath = join(temporaryRoot, "blueprint.json");
    writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
    try {
      printPreview(blueprint, options.root);
      const preview = runNode(compilerScript, ["--root", options.root, "--blueprint", blueprintPath, "--dry-run"], repositoryRoot);
      process.stdout.write(preview.stdout);
      if (preview.stderr) process.stderr.write(preview.stderr);
      if (preview.status !== 0) throw new Error("dry-run found conflicts; no files were written.");
      if (options.dryRun) {
        input.prompt.close();
        return;
      }
      if (!options.yes) {
        if (!(await input.prompt.approve())) {
          process.stdout.write("Aborted; no target files were written.\n");
          input.prompt.close();
          return;
        }
      }
      const compile = runNode(compilerScript, ["--root", options.root, "--blueprint", blueprintPath], repositoryRoot);
      process.stdout.write(compile.stdout);
      if (compile.stderr) process.stderr.write(compile.stderr);
      if (compile.status !== 0) throw new Error("compile failed; inspect the compiler output above.");
      const validate = runNode(validatorScript, [options.root], repositoryRoot);
      process.stdout.write(validate.stdout);
      if (validate.stderr) process.stderr.write(validate.stderr);
      if (validate.status !== 0) throw new Error("validation failed; generated output is not complete.");
      const runner = runNode(join(options.root, ".ai/verification/run.mjs"), [], options.root);
      process.stdout.write(runner.stdout);
      if (runner.stderr) process.stderr.write(runner.stderr);
      if (runner.status !== 0) throw new Error("a generated verification check failed.");
      process.stdout.write("Bootstrap complete.\n");
      input.prompt.close();
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  } catch (error) {
    fail(error.message, error.message.includes("Usage:") ? 2 : 1);
  }
}

await main();
