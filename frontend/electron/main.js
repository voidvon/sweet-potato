const { ElectronEgg } = require("ee-core");
const path = require("path");
const { app: electronApp } = require("electron");
const { restoreMainWindow } = require("ee-core/electron/window");
const { Lifecycle } = require("./preload/lifecycle");
const { preload } = require("./preload");
const { startAutomationBridgeServer } = require("./service/browser-automation/bridge-server");
const { prepareCdpRuntime } = require("./service/browser-automation/cdp-runtime");

const appDataName = electronApp.isPackaged
  ? "ai-marketing-desktop-prod"
  : "ai-marketing-desktop-dev";
electronApp.setName(appDataName);
electronApp.setPath(
  "userData",
  path.join(electronApp.getPath("appData"), appDataName),
);

function restoreDockMainWindow() {
  restoreMainWindow();
}

async function bootstrap() {
  await prepareCdpRuntime();
  await startAutomationBridgeServer();

  electronApp.on("activate", restoreDockMainWindow);
  electronApp.on("second-instance", restoreDockMainWindow);

  // new app
  const app = new ElectronEgg();

  // register lifecycle
  const life = new Lifecycle();
  app.register("ready", life.ready);
  app.register("electron-app-ready", life.electronAppReady);
  app.register("window-ready", life.windowReady);
  app.register("before-close", life.beforeClose);

  // register preload
  app.register("preload", preload);

  // run
  app.run();
}

bootstrap().catch((error) => {
  console.error('[main] bootstrap failed:', error);
  electronApp.quit();
});
