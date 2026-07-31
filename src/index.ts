#!/usr/bin/env node
import { createServer } from "./server.js";

async function main() {
  const { server } = await createServer();
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
