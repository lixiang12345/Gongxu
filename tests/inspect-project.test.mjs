import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupFixture,
  createFixture,
  inspectScript,
  parseJsonOutput,
  runNode,
} from "./helpers.mjs";

test("inspector identifies a brownfield Node monorepo without reading secrets", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));

  const secret = "GONGXU_SENTINEL_SECRET_VALUE";
  writeFileSync(join(fixture.root, ".env.development"), `TOKEN=${secret}\n`);
  mkdirSync(join(fixture.root, ".ssh"));
  writeFileSync(join(fixture.root, ".ssh/id_rsa"), secret);
  writeFileSync(join(fixture.temporary, "outside-secret.txt"), secret);
  symlinkSync(join(fixture.temporary, "outside-secret.txt"), join(fixture.root, "linked-secret"));

  const result = runNode(inspectScript, [fixture.root]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(secret), false);

  const report = parseJsonOutput(result);
  assert.equal(report.detected.repositoryShape, "monorepo");
  assert.equal(report.detected.packageManager, "npm");
  assert.equal(report.detected.packageManagerStatus, "observed");
  assert.ok(report.detected.packageManagerEvidence.some((item) =>
    item.kind === "package-json" && item.path === "package.json" && item.manager === "npm"
  ));
  assert.deepEqual(report.detected.packages.map((item) => item.name).sort(), [
    "@fixture/api",
    "@fixture/web",
    "fixture-workspace",
  ]);
  assert.deepEqual(report.detected.frameworks.map((item) => item.name), ["Express", "Next.js", "React"]);
  assert.ok(report.inventory.skippedSensitivePaths.includes(".env.development"));
  assert.ok(report.inventory.skippedSensitivePaths.includes(".ssh/"));
  assert.ok(report.inventory.testPaths.some((path) => path.endsWith("page.fixture.mjs")));
  assert.ok(report.verificationCandidates.some((check) => check.command === "npm run test" && check.status === "inferred"));
  assert.ok(report.verificationCandidates.some((check) => check.command === "npm test" && check.status === "observed"));
  assert.equal(report.warnings.includes("Sensitive-looking files were listed but never read."), true);
});

test("inspector does not invent an npm package manager for a Python service", (t) => {
  const fixture = createFixture("python-service");
  t.after(() => cleanupFixture(fixture));

  const result = runNode(inspectScript, [fixture.root]);
  assert.equal(result.status, 0, result.stderr);
  const report = parseJsonOutput(result);

  assert.equal(report.detected.repositoryShape, "single-project");
  assert.equal(report.detected.packageManager, null);
  assert.equal(report.detected.packageManagerStatus, "unknown");
  assert.deepEqual(report.detected.packageManagerEvidence, []);
  assert.deepEqual(report.detected.frameworks, [{ name: "FastAPI", evidence: "pyproject.toml" }]);
  assert.ok(report.detected.languages.some((item) => item.name === "Python"));
  assert.ok(report.verificationCandidates.some((check) => check.command === "python -m pytest"));
});

test("inspector keeps nested fixtures out of project package and framework signals", (t) => {
  const fixture = createFixture("python-service");
  t.after(() => cleanupFixture(fixture));
  writeFileSync(join(fixture.root, "package.json"), JSON.stringify({ name: "mixed-service", private: true }));
  const nested = join(fixture.root, "tests/fixtures/example-app");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "package.json"), JSON.stringify({
    name: "fixture-only",
    dependencies: { next: "15.0.0", react: "19.0.0" }
  }));

  const result = runNode(inspectScript, [fixture.root]);
  assert.equal(result.status, 0, result.stderr);
  const report = parseJsonOutput(result);

  assert.equal(report.detected.repositoryShape, "single-project");
  assert.deepEqual(report.detected.packages.map((item) => item.name), ["mixed-service"]);
  assert.equal(report.detected.frameworks.some((item) => item.name === "Next.js"), false);
  assert.equal(report.detected.frameworks.some((item) => item.name === "React"), false);
});

test("inspector does not invent a package manager or package-script commands", (t) => {
  const fixture = createFixture("python-service");
  t.after(() => cleanupFixture(fixture));
  writeFileSync(join(fixture.root, "package.json"), JSON.stringify({
    name: "manager-unknown",
    scripts: { test: "node --test" },
  }));

  const result = runNode(inspectScript, [fixture.root]);
  assert.equal(result.status, 0, result.stderr);
  const report = parseJsonOutput(result);

  assert.equal(report.detected.packageManager, null);
  assert.equal(report.detected.packageManagerStatus, "unknown");
  assert.equal(report.verificationCandidates.some((check) => /^npm\b/.test(check.command)), false);
  assert.ok(report.warnings.includes(
    "Package scripts were found without package manager evidence; package-script commands were not generated."
  ));
});

test("inspector reports conflicting package manager evidence without choosing one", (t) => {
  const fixture = createFixture("python-service");
  t.after(() => cleanupFixture(fixture));
  writeFileSync(join(fixture.root, "package.json"), JSON.stringify({
    name: "manager-conflict",
    packageManager: "pnpm@10.0.0",
    scripts: { test: "node --test" },
  }));
  writeFileSync(join(fixture.root, "package-lock.json"), "{}\n");

  const result = runNode(inspectScript, [fixture.root]);
  assert.equal(result.status, 0, result.stderr);
  const report = parseJsonOutput(result);

  assert.equal(report.detected.packageManager, null);
  assert.equal(report.detected.packageManagerStatus, "conflicting");
  assert.deepEqual(
    [...new Set(report.detected.packageManagerEvidence.map((item) => item.manager))].sort(),
    ["npm", "pnpm"]
  );
  assert.equal(report.verificationCandidates.some((check) => check.id === "package-json-test"), false);
  assert.ok(report.warnings.includes(
    "Conflicting package manager evidence found (npm, pnpm); package-script commands were not generated."
  ));
});
