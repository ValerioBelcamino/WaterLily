import { join, resolve } from 'node:path';

import { createLocalWaterLilyService } from '@waterlily/server';
import { app, BrowserWindow, Menu, protocol, session } from 'electron';
import started from 'electron-squirrel-startup';

import { bundledMigrations } from './migrations.js';
import { createDesktopProtocolRouter } from './protocolRouter.js';

const APP_ORIGIN = 'waterlily://app';
const APP_URL = `${APP_ORIGIN}/`;

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      codeCache: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: 'waterlily',
  },
]);

const userDataOverride = process.env.WATERLILY_DESKTOP_USER_DATA;
if (userDataOverride !== undefined && userDataOverride.length > 0)
  app.setPath('userData', resolve(userDataOverride));

function staticDirectory(): string {
  return app.isPackaged
    ? join(app.getAppPath(), 'dist', 'renderer')
    : resolve(import.meta.dirname, '../../web/dist');
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    backgroundColor: '#0c1017',
    height: 900,
    minHeight: 640,
    minWidth: 960,
    show: false,
    title: 'WaterLily',
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webSecurity: true,
    },
    width: 1440,
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  void window.loadURL(APP_URL);
  return window;
}

async function start(): Promise<void> {
  if (started) {
    app.quit();
    return;
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  await app.whenReady();
  app.setAppUserModelId('io.github.valeriobelcamino.waterlily');
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  const service = createLocalWaterLilyService({
    dataDirectory: join(app.getPath('userData'), 'data'),
    enableHostPython: process.env.WATERLILY_DESKTOP_ENABLE_HOST_PYTHON === '1',
    environment: process.env,
    migrations: bundledMigrations,
  });
  protocol.handle(
    'waterlily',
    createDesktopProtocolRouter({
      apiHandler: service.handler,
      staticDirectory: staticDirectory(),
    }),
  );

  let mainWindow = createWindow();
  app.on('second-instance', () => {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.once('before-quit', () => service.close());
}

void start().catch((error: unknown) => {
  process.stderr.write(
    `WaterLily failed to start: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  app.exit(1);
});
