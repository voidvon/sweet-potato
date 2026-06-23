const net = require("node:net");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const preferredPort = Number(process.env.FRONTEND_PORT || 9527);
const rootDir = path.resolve(__dirname, "..");

function syncElectronSource() {
  const sourceDir = path.join(rootDir, "electron");
  const targetDir = path.join(rootDir, "public", "electron");

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available frontend port found from ${startPort} to ${startPort + 99}`);
}

async function main() {
  syncElectronSource();

  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`[dev] Port ${preferredPort} is in use, using ${port} for both Vite and Electron.`);
  }

  const child = spawn("ee-bin", ["dev"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FRONTEND_PORT: String(port),
    },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code || 0);
  });
}

main().catch((error) => {
  console.error(`[dev] ${error.message}`);
  process.exit(1);
});
