import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const MANAGED_BEGIN = "<!-- gongxu:begin -->";
export const MANAGED_END = "<!-- gongxu:end -->";

export function normalizeRelative(path) {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

function scopedStatusPath(path, prefix) {
  const normalized = normalizeRelative(path);
  if (prefix && !normalized.startsWith(prefix)) {
    throw new Error("Git status returned a path outside the inspection target.");
  }
  const scoped = prefix ? normalized.slice(prefix.length) : normalized;
  if (!scoped || isAbsolute(scoped) || /^[A-Za-z]:\//.test(scoped) || scoped.split("/").includes("..")) {
    throw new Error("Git status returned an invalid target-relative path.");
  }
  return scoped;
}

function parseGitStatus(output, prefix) {
  if (output === "") return [];
  const records = output.split("\0");
  if (records.pop() !== "") throw new Error("Git status output is not NUL terminated.");
  const changes = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4 || record[2] !== " ") throw new Error("Git status output is malformed.");
    const code = record.slice(0, 2);
    const path = scopedStatusPath(record.slice(3), prefix);
    changes.push({ code, path, tracked: code !== "??" });
    if (code.includes("R") || code.includes("C")) {
      if (index + 1 >= records.length) throw new Error("Git rename status is incomplete.");
      index += 1;
    }
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

export function readScopedGitStatus(cwd) {
  try {
    const options = {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    };
    const prefix = normalizeRelative(
      execFileSync("git", ["--no-optional-locks", "rev-parse", "--show-prefix"], options)
        .replace(/\r?\n$/, "")
    );
    if (prefix && (!prefix.endsWith("/") || isAbsolute(prefix) || prefix.split("/").includes(".."))) {
      throw new Error("Git returned an invalid target prefix.");
    }
    const output = execFileSync("git", [
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
    ], options);
    return { prefix, changes: parseGitStatus(output, prefix) };
  } catch {
    return null;
  }
}

export function resolveInside(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.includes("\0")) {
    throw new Error(`Invalid repository-relative path: ${String(relativePath)}`);
  }
  const absolute = resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  let current = root;
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Managed path traverses a symbolic link: ${relativePath}`);
    }
  }
  return absolute;
}

export function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function managedBlock(content) {
  return `${MANAGED_BEGIN}\n${content.trim()}\n${MANAGED_END}`;
}

function appendManagedBlock(existing, block) {
  if (existing === null || existing.length === 0) return `${block}\n`;
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${separator}${block}\n`;
}

export function extractManagedBlock(content) {
  const start = content.indexOf(MANAGED_BEGIN);
  const end = content.indexOf(MANAGED_END);
  if (start === -1 && end === -1) return null;
  if (start === -1 || end === -1 || end < start) throw new Error("Malformed Gongxu managed region.");
  const secondStart = content.indexOf(MANAGED_BEGIN, start + MANAGED_BEGIN.length);
  const secondEnd = content.indexOf(MANAGED_END, end + MANAGED_END.length);
  if (secondStart !== -1 || secondEnd !== -1) throw new Error("Multiple Gongxu managed regions are not supported.");
  return content.slice(start, end + MANAGED_END.length);
}

export function mergeManagedBlock(existing, body) {
  const block = managedBlock(body);
  if (existing === null || existing.length === 0) return appendManagedBlock(existing, block);
  const currentBlock = extractManagedBlock(existing);
  if (currentBlock === null) return appendManagedBlock(existing, block);
  return existing.replace(currentBlock, block);
}

export function removeManagedRegion(content) {
  const block = extractManagedBlock(content);
  if (block === null) return content;
  const result = content.replace(block, "");
  return result.trim().length > 0 ? result : "";
}

export function isManagedRegionOnlyChange(before, after) {
  const beforeContent = before ?? "";
  const afterContent = after ?? "";
  if (beforeContent === afterContent) return false;

  const beforeBlock = before === null ? null : extractManagedBlock(beforeContent);
  const afterBlock = after === null ? null : extractManagedBlock(afterContent);
  if (beforeBlock !== null && afterBlock !== null) {
    return beforeContent.replace(beforeBlock, afterBlock) === afterContent;
  }
  if (beforeBlock !== null) return removeManagedRegion(beforeContent) === afterContent;
  if (afterBlock !== null) return appendManagedBlock(before, afterBlock) === afterContent;
  return false;
}

export function hashOwnedContent(content, ownership) {
  if (ownership === "file") return sha256(content);
  if (ownership === "region") {
    const region = extractManagedBlock(content);
    if (region === null) throw new Error("Managed region is missing.");
    return sha256(region);
  }
  throw new Error(`Unsupported ownership mode: ${ownership}`);
}

export function writeAtomic(path, content, mode = null) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.gongxu-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: mode ?? 0o644 });
    chmodSync(temporary, mode ?? 0o644);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
