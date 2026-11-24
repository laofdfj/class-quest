import { cp, mkdir, rm, readFile } from "node:fs/promises";
import sharp from "sharp";
import { existsSync } from "node:fs";

if (!existsSync("index.html") || !existsSync("assets")) {
  throw new Error("Expected index.html and assets/ in the repository root.");
}

await rm("www", { recursive: true, force: true });
await mkdir("www", { recursive: true });
await cp("index.html", "www/index.html");
await cp("assets", "www/assets", { recursive: true });
console.log("Prepared www/ for the Class Quest Android app.");

const mascot = await readFile("assets/class-quest-mascot.svg");
await mkdir("resources", { recursive: true });
const foreground = await sharp(mascot, { density: 220 })
  .resize(820, 820, { fit: "contain" })
  .png()
  .toBuffer();
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: "#f0e3ff" }
})
  .composite([{ input: foreground, gravity: "centre" }])
  .png()
  .toFile("resources/icon.png");
console.log("Generated the Class Quest Android launcher icon.");
