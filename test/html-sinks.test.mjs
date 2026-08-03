import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("application modules do not write strings through HTML parser sinks", async () => {
  const files = (await readdir(root)).filter((file) => /\.(?:js|mjs)$/.test(file));
  const violations = [];

  for (const file of files) {
    const source = await readFile(path.join(root, file), "utf8");
    if (/\.innerHTML\s*=|insertAdjacentHTML\s*\(|\.outerHTML\s*=/.test(source)) {
      violations.push(file);
    }
  }

  assert.deepEqual(violations, []);
});
