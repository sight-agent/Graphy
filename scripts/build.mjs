import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const publicDir = path.join(projectRoot, "public");
const distDir = path.join(projectRoot, "dist");

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });

// Copy the static site as-is. Asset URLs are relative so it works under GitHub Pages subpaths.
await fs.cp(publicDir, distDir, { recursive: true });

// GitHub Pages: avoid Jekyll processing.
await fs.writeFile(path.join(distDir, ".nojekyll"), "");

console.log("Built to dist/.");

