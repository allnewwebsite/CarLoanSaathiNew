import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/pages/SubscriptionActivationPage.jsx", import.meta.url), "utf8");

test("subscription activation agreement is accessible and touch friendly", () => {
  assert.match(source, /label htmlFor="subscription-terms"/);
  assert.match(source, /id="subscription-terms"/);
  assert.match(source, /min-h-11 min-w-11/);
  assert.match(source, /h-5 w-5/);
  assert.match(source, /focus-visible:ring-2/);
  assert.match(source, /leading-6/);
});

test("subscription activation payment remains gated by agreement", () => {
  assert.match(source, /disabled=\{loading \|\| paying \|\| !accepted \|\| preview \|\| !canPay\}/);
  assert.match(source, /transition-colors duration-200/);
});
