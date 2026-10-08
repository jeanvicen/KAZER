const { runWorker } = require("./background-worker");

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => controller.abort());
}

runWorker({ signal: controller.signal }).catch((error) => {
  console.error("KAZER background worker could not start", String(error?.message || "unknown"));
  process.exitCode = 1;
});
