"use strict";

/**
 * ForgeEngine desktop launcher.
 *
 * This file intentionally stays small. It is a shell around Gavin's existing
 * Express-based engine/editor, not a second copy of the engine. New ForgeEngine
 * modules should normally be added to the engine itself, not here.
 */

const path = require("node:path");
const { app, BrowserWindow, shell, dialog } = require("electron");

let mainWindow = null;
let forgeServer = null;

// Keep one ForgeEngine instance per Windows user. This prevents two local
// servers/editors from accidentally writing the same project at once.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function configureDesktopRuntime() {
  // Electron's userData directory is writable and survives application updates.
  // This keeps account/project data out of Program Files.
  const dataRoot = process.env.FORGE_DESKTOP_DATA_ROOT || app.getPath("userData");

  process.env.FORGE_DATA_ROOT = dataRoot;
  process.env.FORGE_LOCAL_HTTP = "1";
  process.env.HOST = "127.0.0.1";
  process.env.PORT = "0"; // Ask Windows for any free local port.
}

async function startForgeServer() {
  // Environment variables must be set before loading the server module because
  // its path/protocol configuration is intentionally read at startup.
  configureDesktopRuntime();
  const forgeApp = require("../core/index.js");
  return forgeApp.startServer();
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#101827",
    title: "ForgeEngine",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Do not allow arbitrary websites to replace the ForgeEngine UI. External
  // links, if the editor adds them later, open in the user's normal browser.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) shell.openExternal(target);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  mainWindow.loadURL(url);
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  try {
    const started = await startForgeServer();
    forgeServer = started.server;
    createMainWindow(started.url);
  } catch (error) {
    console.error("ForgeEngine desktop startup failed:", error);
    dialog.showErrorBox(
      "ForgeEngine could not start",
      "The local ForgeEngine service failed to start. Check the application log or run the development build from a terminal for details."
    );
    app.quit();
  }
});

app.on("activate", () => {
  if (!mainWindow && forgeServer) {
    const address = forgeServer.address();
    if (address && typeof address === "object") {
      createMainWindow(`http://127.0.0.1:${address.port}`);
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (forgeServer) {
    forgeServer.close();
    forgeServer = null;
  }
});
