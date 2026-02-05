import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";

const projectRoot = process.cwd();
const html = await fs.readFile(path.join(projectRoot, "public", "index.html"), "utf8");
const dom = new JSDOM(html);
const { document } = dom.window;

const requiredIds = [
  "graphCanvas",
  "imageInput",
  "pathsList",
  "exportJson",
  "exportPng",
  "overlayHint",
  "nodeLabelEditor",
  "statusBar",
];

requiredIds.forEach((id) => {
  assert.ok(document.getElementById(id), `Missing #${id}`);
});

const hasStyles = Array.from(document.querySelectorAll("link[rel='stylesheet']")).some((link) =>
  link.getAttribute("href")?.includes("styles.css"),
);
assert.ok(hasStyles, "styles.css not linked");

const hasScript = Array.from(document.querySelectorAll("script")).some((script) =>
  script.getAttribute("src")?.includes("app.js"),
);
assert.ok(hasScript, "app.js not linked");

console.log("Smoke tests passed.");
