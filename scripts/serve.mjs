import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const onRender = process.env.RENDER === "true";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, ...args], {
      stdio: "inherit",
      env: process.env,
    });
    const forward = (signal) => child.kill(signal);
    process.on("SIGTERM", forward);
    process.on("SIGINT", forward);
    child.on("exit", (code, signal) => {
      process.off("SIGTERM", forward);
      process.off("SIGINT", forward);
      if (signal) reject(new Error(String(signal)));
      else if (code === 0) resolve();
      else reject(new Error(`next ${args[0]} exited ${code}`));
    });
  });
}

if (onRender) {
  if (!existsSync(new URL("../.next/BUILD_ID", import.meta.url))) {
    await run(["build"]);
  }
  const port = process.env.PORT || "10000";
  await run(["start", "-H", "0.0.0.0", "-p", port]);
} else {
  await run(["dev", ...process.argv.slice(2)]);
}
