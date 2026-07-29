import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import process from "node:process";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const SCAN_ROOTS = ["apps", "packages"];
const ALLOWED_SCALE_MODULE = resolve("packages/shared/src/money.ts");
// Project guardrails forbid edits to invariant tests. They remain independent historical oracles
// and are reviewed separately; this policy check covers mutable production code and test fixtures.
const IMMUTABLE_INVARIANT_ROOT = `${resolve("apps/worker/test/invariants")}${sep}`;
const JUSTIFICATION_PATTERN = /(?:\/\/|\/\*)\s*scale-factor-ok:\s*\S/;

function extension(path) {
  const match = /\.[^.\\/]+$/.exec(path);
  return match?.[0] ?? "";
}

function collectSourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (entry !== ".wrangler" && entry !== "dist" && entry !== "node_modules") {
        files.push(...collectSourceFiles(path));
      }
    } else if (SOURCE_EXTENSIONS.has(extension(path))) {
      files.push(path);
    }
  }
  return files;
}

function stripCommentsAndStrings(sourceText) {
  const chars = [...sourceText];
  let state = "code";
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    const next = chars[index + 1];
    if (state === "code") {
      if (char === "'" || char === '"') {
        state = char;
        chars[index] = " ";
      } else if (char === "/" && next === "/") {
        state = "line-comment";
        chars[index] = " ";
        chars[index + 1] = " ";
        index++;
      } else if (char === "/" && next === "*") {
        state = "block-comment";
        chars[index] = " ";
        chars[index + 1] = " ";
        index++;
      }
    } else if (state === "line-comment") {
      if (char === "\n") state = "code";
      else chars[index] = " ";
    } else if (state === "block-comment") {
      if (char === "*" && next === "/") {
        chars[index] = " ";
        chars[index + 1] = " ";
        index++;
        state = "code";
      } else if (char !== "\n") {
        chars[index] = " ";
      }
    } else {
      chars[index] = char === "\n" ? "\n" : " ";
      if (char === "\\") {
        if (chars[index + 1] !== "\n") chars[index + 1] = " ";
        index++;
      } else if (char === state) {
        state = "code";
      }
    }
  }
  return chars.join("");
}

function hasJustification(sourceText, line) {
  const lines = sourceText.split(/\r?\n/);
  return [line - 1, line].some((index) => index >= 0 && JUSTIFICATION_PATTERN.test(lines[index]));
}

export function findScaleLiteralViolations(sourceText, _filePath = "source.ts") {
  const code = stripCommentsAndStrings(sourceText);
  const scaleLiteralPattern = /(?<![0-9_])(?:1_?000|1e3|1E3|1_?000_?000|1e6|1E6)(?![0-9_])/g;
  const violations = [];
  for (const match of code.matchAll(scaleLiteralPattern)) {
    const index = match.index;
    const before = code.slice(Math.max(0, index - 80), index);
    const after = code.slice(index + match[0].length, index + match[0].length + 80);
    const isArithmetic = /[*/%]\s*\(*\s*$/.test(before) || /^\s*\)*\s*[*/%]/.test(after);
    if (!isArithmetic) continue;

    const lineStart = code.lastIndexOf("\n", index - 1) + 1;
    const line = code.slice(0, index).split("\n").length - 1;
    if (!hasJustification(sourceText, line)) {
      violations.push({
        column: index - lineStart + 1,
        line: line + 1,
        literal: match[0],
      });
    }
  }
  return violations;
}

export function checkScaleLiterals(root = process.cwd()) {
  const violations = [];
  for (const scanRoot of SCAN_ROOTS.map((path) => resolve(root, path))) {
    for (const filePath of collectSourceFiles(scanRoot)) {
      if (filePath === ALLOWED_SCALE_MODULE || filePath.startsWith(IMMUTABLE_INVARIANT_ROOT)) {
        continue;
      }
      const sourceText = readFileSync(filePath, "utf8");
      for (const violation of findScaleLiteralViolations(sourceText, filePath)) {
        violations.push({ filePath, ...violation });
      }
    }
  }
  return violations;
}

function main() {
  const violations = checkScaleLiterals();
  if (violations.length === 0) {
    console.log("Scale-literal guard passed.");
    return;
  }

  console.error(
    "Scale-literal guard failed. Use totalCentavos/rateFromTotal, or add " +
      "`// scale-factor-ok: <specific non-money reason>` immediately above a legitimate conversion.",
  );
  for (const violation of violations) {
    console.error(
      `${relative(process.cwd(), violation.filePath)}:${violation.line}:${violation.column} ` +
        `bare ${violation.literal} in arithmetic`,
    );
  }
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
