import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export const MANAGED_BEGIN = "<!-- gongxu:begin -->";
export const MANAGED_END = "<!-- gongxu:end -->";

export function normalizeRelative(path) {
  return path.split(sep).join("/").replace(/^\.\//, "");
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
  if (existing === null || existing.length === 0) return `${block}\n`;
  const currentBlock = extractManagedBlock(existing);
  if (currentBlock === null) {
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    return `${existing}${separator}${block}\n`;
  }
  return existing.replace(currentBlock, block);
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
  writeFileSync(temporary, content, { encoding: "utf8", mode: mode ?? 0o644 });
  renameSync(temporary, path);
}
