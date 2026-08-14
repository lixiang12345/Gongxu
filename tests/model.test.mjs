import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { validateBlueprint } from "../skills/bootstrap-ai-project/scripts/lib/model.mjs";
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
