import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(root, "assets/public");
const targetDir = resolve(root, "public");

for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".png.base64")) continue;
  const encoded = await readFile(resolve(sourceDir, entry.name), "utf8");
  const data = Buffer.from(encoded.replace(/\s/g, ""), "base64");
  if (data.length === 0) throw new Error(`Empty asset: ${entry.name}`);
  const filename = entry.name.slice(0, -".base64".length);
  await writeFile(resolve(targetDir, filename), data);
  console.log(`Restored public/${filename}`);
}
