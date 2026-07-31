import test from "node:test";
import assert from "node:assert/strict";
import { SVG_NS, svgEl, svgText } from "../dom-utils.mjs";

// Mock document for Node environment test runner
if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElementNS(ns, tag) {
      const attrs = {};
      return {
        namespaceURI: ns,
        tagName: tag,
        setAttribute(k, v) {
          attrs[k] = String(v);
        },
        getAttribute(k) {
          return attrs[k];
        },
        textContent: "",
        attributes: attrs,
      };
    },
  };
}

test("svgEl creates SVG elements with namespace and attributes", () => {
  const circle = svgEl("circle", { cx: 10, cy: 20, r: 5 });
  assert.equal(circle.namespaceURI, SVG_NS);
  assert.equal(circle.tagName, "circle");
  assert.equal(circle.getAttribute("cx"), "10");
  assert.equal(circle.getAttribute("cy"), "20");
  assert.equal(circle.getAttribute("r"), "5");
});

test("svgEl sets textContent when text argument is provided", () => {
  const textNode = svgEl("text", { x: 0, y: 0 }, "Hello SVG");
  assert.equal(textNode.textContent, "Hello SVG");
});

test("svgText creates SVG text nodes", () => {
  const textNode = svgText("text", { x: 5 }, "Label");
  assert.equal(textNode.getAttribute("x"), "5");
  assert.equal(textNode.textContent, "Label");
});
