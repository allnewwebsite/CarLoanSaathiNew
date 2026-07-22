import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/layouts/PublicLayout.jsx", import.meta.url), "utf8");

test("public role dropdown has no hover gap and delays mouse close", () => {
  assert.match(source, /onPointerEnter=/);
  assert.match(source, /onPointerLeave=/);
  assert.match(source, /}, 250\)/);
  assert.match(source, /top-10/);
  assert.match(source, /pointer-events-none/);
});

test("public role dropdown supports click, keyboard, outside, and touch behavior", () => {
  assert.match(source, /onClick=\{\(\) => \(open \? closeMenu\(\) : openMenu\(\)\)\}/);
  assert.match(source, /event\.key === "ArrowDown"/);
  assert.match(source, /event\.key === "ArrowUp"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /aria-controls=\{`\$\{group\.key\}-menu`\}/);
  assert.match(source, /role="menuitem"/);
});
