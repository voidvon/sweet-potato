'use strict';

const { app } = require('electron');
const net = require('net');

let cdpPort = null;
let browserPromise = null;

function warn(message, error) {
  try {
    const { logger } = require('ee-core/log');
    logger.warn(message, error);
  } catch {
    console.warn(message, error);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port);
          return;
        }
        reject(new Error('无法分配 CDP 端口'));
      });
    });
  });
}

async function prepareCdpRuntime() {
  if (cdpPort) {
    return cdpPort;
  }
  if (app.isReady()) {
    throw new Error('CDP 端口必须在 Electron app ready 前初始化');
  }
  cdpPort = await getFreePort();
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort));
  console.info('[browser-automation] CDP runtime prepared');
  return cdpPort;
}

async function getConnectedBrowser() {
  if (!cdpPort) {
    throw new Error('CDP runtime 尚未初始化');
  }
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = require('playwright-core');
      return chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    })().catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

async function closeCdpRuntime() {
  if (!browserPromise) {
    return;
  }
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (error) {
    warn('[browser-automation] close CDP browser failed:', error);
  } finally {
    browserPromise = null;
  }
}

module.exports = {
  prepareCdpRuntime,
  getConnectedBrowser,
  closeCdpRuntime,
};
