// A few dependency-free stand-ins for jest-dom matchers (jest-dom is not a
// project dependency). Import this file in a test to use them.
//
// toHaveAccessibleName is deliberately simple: aria-label, else the element's
// text with aria-hidden parts left out. That is enough for the buttons here; it
// is not a full accessible-name computation.

import { expect } from "vitest";

function accessibleName(el) {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  const walk = (node) => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || node.getAttribute("aria-hidden") === "true") return "";
    return Array.from(node.childNodes).map(walk).join("");
  };
  return walk(el).replace(/\s+/g, " ").trim();
}

function accessibleDescription(el) {
  const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  return ids.map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
}

expect.extend({
  toBeInTheDocument(el) {
    const pass = !!el && el.ownerDocument.contains(el);
    return { pass, message: () => `expected the element ${pass ? "not " : ""}to be in the document` };
  },
  toHaveAttribute(el, name, value) {
    const has = el.hasAttribute(name);
    const pass = value === undefined ? has : has && el.getAttribute(name) === value;
    return { pass, message: () => `expected attribute ${name}${value === undefined ? "" : `="${value}"`} ${pass ? "not " : ""}on the element (found ${has ? `"${el.getAttribute(name)}"` : "none"})` };
  },
  toHaveAccessibleName(el, expected) {
    const name = accessibleName(el);
    const pass = expected instanceof RegExp ? expected.test(name) : name === expected;
    return { pass, message: () => `expected accessible name ${pass ? "not " : ""}to be ${expected}, got "${name}"` };
  },
  toHaveAccessibleDescription(el, expected) {
    const text = accessibleDescription(el);
    const pass = expected instanceof RegExp ? expected.test(text) : text === expected;
    return { pass, message: () => `expected accessible description ${pass ? "not " : ""}to be ${expected}, got "${text}"` };
  },
});
