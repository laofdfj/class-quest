import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

if (!existsSync("index.html") || !existsSync("assets")) {
  throw new Error("Expected index.html and assets/ in the repository root.");
}

await rm("www", { recursive: true, force: true });
await mkdir("www", { recursive: true });
await cp("index.html", "www/index.html");
await cp("assets", "www/assets", { recursive: true });
console.log("Prepared www/ for the Class Quest Android app.");
