import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const target = join(root, "..", "dist", "runtime");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(join(root, "..", "..", "server", "dist", "cli.mjs"), join(target, "server.mjs"));
await cp(join(root, "..", "..", "web", "dist"), join(target, "web"), { recursive: true });
await cp(join(root, "..", "runtime", "tray.ps1"), join(target, "tray.ps1"));
await cp(
  join(root, "..", "..", "..", "assets", "activity.svg"),
  join(root, "..", "dist", "activity.svg"),
);
await cp(
  join(root, "..", "..", "..", "assets", "Teloverge-lum-logo.png"),
  join(root, "..", "dist", "logo.png"),
);
const runtimeId = await hashTree(target);
await writeFile(join(target, "runtime.json"), `${JSON.stringify({ runtimeId }, null, 2)}\n`);

async function hashTree(directory) {
  const hash = createHash("sha256");
  for (const file of await filesUnder(directory)) {
    hash.update(file.slice(directory.length + 1).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else files.push(path);
  }
  return files.sort();
}
