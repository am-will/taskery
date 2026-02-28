import { cp, mkdir, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(cliRoot, "..", "..");
const apiRoot = resolve(workspaceRoot, "apps", "api");
const webRoot = resolve(workspaceRoot, "apps", "web");

const runtimeRoot = resolve(cliRoot, "dist", "runtime");
const runtimeApiRoot = resolve(runtimeRoot, "api");
const runtimeWebRoot = resolve(runtimeRoot, "web");

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeApiRoot, { recursive: true });
await mkdir(runtimeWebRoot, { recursive: true });

await cp(resolve(apiRoot, "dist"), runtimeApiRoot, {
  recursive: true,
});

await cp(resolve(apiRoot, "prisma"), resolve(runtimeApiRoot, "prisma"), {
  recursive: true,
  filter: (sourcePath) => basename(sourcePath) !== "dev.db",
});

await cp(resolve(webRoot, "dist"), runtimeWebRoot, {
  recursive: true,
});
