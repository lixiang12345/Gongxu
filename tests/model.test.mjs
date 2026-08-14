import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  managedOwnershipForPath,
  validateBlueprint,
} from "../skills/bootstrap-ai-project/scripts/lib/model.mjs";
import {
  cleanupFixture,
  createFixture,
  loadBlueprint,
  repositoryRoot,
} from "./helpers.mjs";

function validateMutation(fixture, mutate) {
  const blueprint = structuredClone(loadBlueprint());
  mutate(blueprint);
  return validateBlueprint(blueprint, fixture.root);
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

test("valid fixture blueprint passes semantic validation", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));

  const result = validateBlueprint(loadBlueprint(), fixture.root);
  assert.deepEqual(result, { errors: [], warnings: [] });
});

test("target architecture schema permits status without weakening additionalProperties", () => {
  const schema = JSON.parse(readFileSync(join(repositoryRoot, "skills/bootstrap-ai-project/assets/blueprint.schema.json"), "utf8"));
  const target = schema.$defs.targetArchitecture;

  assert.equal(target.additionalProperties, false);
  assert.deepEqual(target.required, ["summary", "style", "modules", "status"]);
  assert.deepEqual(target.properties.status.enum, ["preserve-current", "confirmed", "proposed"]);
  assert.equal("allOf" in target, false);
});

test("blueprint schema rejects empty source revisions", () => {
  const schema = JSON.parse(readFileSync(join(repositoryRoot, "skills/bootstrap-ai-project/assets/blueprint.schema.json"), "utf8"));
  const sourceRevision = schema.$defs.evidenceLedger.properties.sourceRevision;

  assert.deepEqual(sourceRevision.type, ["string", "null"]);
  assert.equal(sourceRevision.minLength, 1);
});

test("blueprint schema requires pointers for file-backed verification sources", () => {
  const schema = JSON.parse(readFileSync(join(repositoryRoot, "skills/bootstrap-ai-project/assets/blueprint.schema.json"), "utf8"));
  const pointerCondition = schema.$defs.checkSource.allOf[0];

  assert.deepEqual(pointerCondition.if.properties.kind.enum, ["file", "existing-config"]);
  assert.deepEqual(pointerCondition.then.required, ["pointer"]);
  assert.deepEqual(pointerCondition.then.properties.pointer, { $ref: "#/$defs/nonEmpty" });
});

test("managed artifact contract excludes canonical and human-owned paths", () => {
  assert.equal(managedOwnershipForPath("AGENTS.md"), "region");
  assert.equal(managedOwnershipForPath(".ai/rules/security.md"), "file");
  assert.equal(managedOwnershipForPath(".ai/skills/change-api/SKILL.md"), "file");
  assert.equal(managedOwnershipForPath(".agents/skills/gongxu-change-api/SKILL.md"), "file");
  assert.equal(managedOwnershipForPath("README.md"), null);
  assert.equal(managedOwnershipForPath(".ai/blueprint.json"), null);
  assert.equal(managedOwnershipForPath(".ai/architecture/decisions/001.md"), null);
  assert.equal(managedOwnershipForPath(".ai/memory/session.json"), null);
});

test("validator enforces evidence status provenance", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));

  const observed = validateMutation(fixture, (blueprint) => {
    blueprint.evidence.facts[0].evidence = [{ kind: "interview", note: "A user guess." }];
  });
  assert.ok(observed.errors.some((error) => error.includes("observed fact requires")));

  const confirmed = validateMutation(fixture, (blueprint) => {
    const fact = blueprint.evidence.facts.find((item) => item.id === "product-purpose");
    fact.evidence = [{ kind: "file", path: "README.md", note: "A file is not an explicit confirmation." }];
  });
  assert.ok(confirmed.errors.some((error) => error.includes("confirmed fact requires")));
});

test("validator reports missing and stale Git source revisions", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));
  git(fixture.root, ["init", "--quiet"]);
  git(fixture.root, ["add", "."]);
  git(fixture.root, [
    "-c", "user.name=Gongxu Tests",
    "-c", "user.email=gongxu-tests@example.invalid",
    "commit", "--quiet", "-m", "initial fixture",
  ]);
  const inspectedRevision = git(fixture.root, ["rev-parse", "HEAD"]);
  const blueprint = loadBlueprint();
  blueprint.evidence.sourceRevision = inspectedRevision;

  const current = validateBlueprint(blueprint, fixture.root);
  assert.equal(current.warnings.some((warning) => warning.includes("sourceRevision")), false);

  appendFileSync(join(fixture.root, "README.md"), "\nA later repository change.\n");
  git(fixture.root, ["add", "README.md"]);
  git(fixture.root, [
    "-c", "user.name=Gongxu Tests",
    "-c", "user.email=gongxu-tests@example.invalid",
    "commit", "--quiet", "-m", "later change",
  ]);
  const currentRevision = git(fixture.root, ["rev-parse", "HEAD"]);

  const stale = validateBlueprint(blueprint, fixture.root);
  assert.ok(stale.warnings.includes(
    `evidence.sourceRevision ${inspectedRevision} differs from current Git HEAD ${currentRevision}; refresh repository evidence before adding new rules.`
  ));

  blueprint.evidence.sourceRevision = null;
  const missing = validateBlueprint(blueprint, fixture.root);
  assert.ok(missing.warnings.includes(
    `evidence.sourceRevision is missing; current Git HEAD is ${currentRevision}.`
  ));

  blueprint.evidence.sourceRevision = "";
  const empty = validateBlueprint(blueprint, fixture.root);
  assert.ok(empty.errors.includes("evidence.sourceRevision must be a non-empty string or null."));
});

test("validator reports dirty repository state without flagging Gongxu outputs", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));
  git(fixture.temporary, ["init", "--quiet"]);
  git(fixture.temporary, ["add", "repository"]);
  git(fixture.temporary, [
    "-c", "user.name=Gongxu Tests",
    "-c", "user.email=gongxu-tests@example.invalid",
    "commit", "--quiet", "-m", "initial fixture",
  ]);
  const blueprint = loadBlueprint();
  blueprint.evidence.sourceRevision = git(fixture.root, ["rev-parse", "HEAD"]);
  const warningPrefix = "Git worktree has uncommitted repository changes not captured by evidence.sourceRevision:";

  const architecturePath = join(fixture.root, "docs/architecture.md");
  const architecture = readFileSync(architecturePath, "utf8");
  appendFileSync(architecturePath, "\nUncommitted architecture change.\n");
  const projectChange = validateBlueprint(blueprint, fixture.root);
  assert.ok(projectChange.warnings.includes(`${warningPrefix} \"docs/architecture.md\".`));
  writeFileSync(architecturePath, architecture);
  assert.equal(git(fixture.root, ["status", "--short"]), "");

  mkdirSync(join(fixture.root, ".ai/project"), { recursive: true });
  writeFileSync(join(fixture.root, ".ai/blueprint.json"), "{}\n");
  writeFileSync(join(fixture.root, ".ai/manifest.json"), "{}\n");
  writeFileSync(join(fixture.root, ".ai/project/profile.md"), "generated\n");
  appendFileSync(join(fixture.root, "AGENTS.md"), "\n<!-- gongxu:begin -->\ngenerated\n<!-- gongxu:end -->\n");
  const generatedState = validateBlueprint(blueprint, fixture.root);
  assert.equal(generatedState.warnings.some((warning) => warning.startsWith(warningPrefix)), false);

  git(fixture.temporary, ["add", "repository"]);
  git(fixture.temporary, [
    "-c", "user.name=Gongxu Tests",
    "-c", "user.email=gongxu-tests@example.invalid",
    "commit", "--quiet", "-m", "generated baseline",
  ]);
  blueprint.evidence.sourceRevision = git(fixture.root, ["rev-parse", "HEAD"]);
  const generatedAgents = readFileSync(join(fixture.root, "AGENTS.md"), "utf8")
    .replace("\ngenerated\n", "\nregenerated\n");
  writeFileSync(join(fixture.root, "AGENTS.md"), generatedAgents);
  const managedRegionChange = validateBlueprint(blueprint, fixture.root);
  assert.equal(managedRegionChange.warnings.some((warning) => warning.startsWith(warningPrefix)), false);

  appendFileSync(join(fixture.root, "AGENTS.md"), "\nUser-authored suffix.\n");
  const userAdapterChange = validateBlueprint(blueprint, fixture.root);
  assert.ok(userAdapterChange.warnings.includes(`${warningPrefix} "AGENTS.md".`));
  writeFileSync(join(fixture.root, "AGENTS.md"), generatedAgents);

  mkdirSync(join(fixture.root, ".ai/architecture/decisions"), { recursive: true });
  writeFileSync(join(fixture.root, ".ai/architecture/decisions/001.md"), "Human-owned decision.\n");
  const humanState = validateBlueprint(blueprint, fixture.root);
  assert.ok(humanState.warnings.includes(`${warningPrefix} \".ai/architecture/decisions/001.md\".`));
});

test("validator links command and interview evidence to concrete provenance", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));

  const result = validateMutation(fixture, (blueprint) => {
    const confirmed = blueprint.evidence.facts.find((fact) => fact.id === "product-purpose");
    confirmed.evidence[0].pointer = "missing-answer";
    blueprint.evidence.facts[0].evidence.push({
      kind: "command",
      note: "A command was reportedly run."
    });
    blueprint.verification[0].source = {
      kind: "interview",
      path: "missing-answer",
      note: "The project owner supplied this command."
    };
  });

  assert.ok(result.errors.some((error) => error.includes("pointer must reference an evidence.answers id")));
  assert.ok(result.errors.some((error) => error.includes("pointer must record the observed command")));
  assert.ok(result.errors.some((error) => error.includes("source.path references unknown interview answer")));
});

test("validator resolves file provenance to the exact verification command", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));

  const composed = validateMutation(fixture, (blueprint) => {
    blueprint.verification[0].source = {
      kind: "file",
      path: "package.json",
      pointer: "scripts.test",
      note: "This script does not literally contain the package-manager invocation."
    };
  });
  assert.ok(composed.errors.some((error) => error.includes("does not resolve to the exact command \"npm test\"")));

  const wrongLine = validateMutation(fixture, (blueprint) => {
    blueprint.verification[0].source.pointer = "line:12";
  });
  assert.ok(wrongLine.errors.some((error) => error.includes("does not resolve to the exact command \"npm test\"")));

  const missingPointer = validateMutation(fixture, (blueprint) => {
    delete blueprint.verification[0].source.pointer;
  });
  assert.ok(missingPointer.errors.some((error) => error.includes("must identify an exact line or JSON value")));

  appendFileSync(
    join(fixture.root, ".github/workflows/ci.yml"),
    "      - run: |\n          npm test\n      - run: |\n          npm ci\n          npm test\n"
  );
  const blockHeader = validateMutation(fixture, (blueprint) => {
    blueprint.verification[0].command = "|";
    blueprint.verification[0].source.pointer = "line:14";
  });
  assert.ok(blockHeader.errors.some((error) => error.includes("does not resolve to the exact command \"|\"")));

  const singleCommandBlock = validateMutation(fixture, (blueprint) => {
    blueprint.verification[0].source.pointer = "line:15";
  });
  assert.deepEqual(singleCommandBlock, { errors: [], warnings: [] });

  const multiCommandBlock = validateMutation(fixture, (blueprint) => {
    blueprint.verification[0].command = "npm ci";
    blueprint.verification[0].source.pointer = "line:17";
  });
  assert.ok(multiCommandBlock.errors.some((error) => error.includes("does not resolve to the exact command \"npm ci\"")));

  symlinkSync(".github/workflows/ci.yml", join(fixture.root, "ci-workflow.yml"));
  const aliasedMultiCommandBlock = validateMutation(fixture, (blueprint) => {
    blueprint.verification[0].command = "npm ci";
    blueprint.verification[0].source.path = "ci-workflow.yml";
    blueprint.verification[0].source.pointer = "line:17";
  });
  assert.ok(aliasedMultiCommandBlock.errors.some((error) => error.includes("does not resolve to the exact command \"npm ci\"")));

  const scriptBody = validateMutation(fixture, (blueprint) => {
    blueprint.verification[0].command = "node --test apps/web/specs/*.fixture.mjs services/api/specs/*.fixture.mjs";
    blueprint.verification[0].source = {
      kind: "existing-config",
      path: "package.json",
      pointer: "/scripts/test",
      note: "The root package manifest contains this exact script body."
    };
  });
  assert.deepEqual(scriptBody, { errors: [], warnings: [] });
});

test("validator requires interview provenance to confirm the exact verification command", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));

  const mismatch = validateMutation(fixture, (blueprint) => {
    blueprint.evidence.answers.push({
      id: "answer-project-test-command",
      question: "What exact command must run the project tests?",
      answer: "Use the root test script."
    });
    blueprint.verification[0].source = {
      kind: "interview",
      path: "answer-project-test-command",
      note: "The project owner confirmed the command."
    };
  });
  assert.ok(mismatch.errors.some((error) => error.includes("interview answer must exactly equal the command \"npm test\"")));

  const malformed = validateMutation(fixture, (blueprint) => {
    blueprint.evidence.answers.push({
      id: "answer-project-test-command",
      question: "What exact command must run the project tests?",
      answer: 42
    });
    blueprint.verification[0].source = {
      kind: "interview",
      path: "answer-project-test-command",
      note: "The answer has an invalid value."
    };
  });
  assert.ok(malformed.errors.some((error) => error.includes("evidence.answers[1] needs question and answer")));
  assert.ok(malformed.errors.some((error) => error.includes("interview answer must exactly equal the command \"npm test\"")));

  const exact = validateMutation(fixture, (blueprint) => {
    blueprint.evidence.answers.push({
      id: "answer-project-test-command",
      question: "What exact command must run the project tests?",
      answer: "npm test"
    });
    blueprint.verification[0].source = {
      kind: "interview",
      path: "answer-project-test-command",
      note: "The project owner confirmed the command."
    };
  });
  assert.deepEqual(exact, { errors: [], warnings: [] });
});

test("validator rejects unsupported fields and malformed nested values without crashing", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));

  const extra = validateMutation(fixture, (blueprint) => {
    blueprint.untracked = true;
    blueprint.project.untracked = true;
  });
  assert.ok(extra.errors.includes("blueprint.untracked is not supported."));
  assert.ok(extra.errors.includes("project.untracked is not supported."));

  assert.doesNotThrow(() => validateMutation(fixture, (blueprint) => {
    blueprint.skills = [null];
    blueprint.rules = [null];
    blueprint.architecture.current.modules = [null];
  }));
  const malformed = validateMutation(fixture, (blueprint) => {
    blueprint.skills = [null];
    blueprint.rules = [null];
    blueprint.architecture.current.modules = [null];
  });
  assert.ok(malformed.errors.some((error) => error.includes("must be an object")));
});

test("validator rejects unsafe repository paths and unresolved blocking unknowns", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));

  const result = validateMutation(fixture, (blueprint) => {
    blueprint.skills[0].context.push(".ai/../outside.md");
    blueprint.architecture.target.modules[0].planned = true;
    blueprint.architecture.target.modules[0].paths = ["../outside"];
    blueprint.evidence.unknowns.push({
      id: "deployment-owner",
      question: "Who approves production deployment?",
      impact: "Changes the deployment approval rule.",
      blocking: true
    });
  });

  assert.ok(result.errors.some((error) => error.includes("context path is not repository-relative")));
  assert.ok(result.errors.some((error) => error.includes("not a safe repository-relative path")));
  assert.ok(result.errors.some((error) => error.includes("Blocking unknown must be resolved")));
});

test("validator requires enforceable blocking rules and valid check provenance", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));

  const result = validateMutation(fixture, (blueprint) => {
    delete blueprint.rules[1].checkId;
    blueprint.verification[0].source = {
      kind: "interview",
      path: "",
      note: "The owner supplied a command."
    };
  });

  assert.ok(result.errors.some((error) => error.includes("blocking rule needs checkId or approvalRequired=true")));
  assert.ok(result.errors.some((error) => error.includes("must identify the confirming interview answer")));
});
