'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { browserAutomationService } = require('./index');

let server = null;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('request body too large'));
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid json body'));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/internal/desktop-automation/health') {
    writeJson(res, 200, { ok: true, desktopReady: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/internal/desktop-automation/tasks') {
    const body = await readBody(req);
    const result = await browserAutomationService.startTask(body);
    writeJson(res, result && result.ok ? 200 : 400, result);
    return;
  }

  const taskMatch = pathname.match(/^\/internal\/desktop-automation\/tasks\/([^/]+)$/);
  if (req.method === 'GET' && taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1] || '');
    const result = await browserAutomationService.getTask({ taskId });
    writeJson(res, result && result.ok ? 200 : 404, result);
    return;
  }

  const cancelMatch = pathname.match(/^\/internal\/desktop-automation\/tasks\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && cancelMatch) {
    const taskId = decodeURIComponent(cancelMatch[1] || '');
    const result = await browserAutomationService.cancelTask({ taskId });
    writeJson(res, result && result.ok ? 200 : 400, result);
    return;
  }

  writeJson(res, 404, { ok: false, message: 'not found' });
}

async function startAutomationBridgeServer() {
  if (server) {
    return server;
  }

  const host = process.env.DESKTOP_AUTOMATION_BRIDGE_HOST || '127.0.0.1';
  const port = Number(process.env.DESKTOP_AUTOMATION_BRIDGE_PORT || 7074);

  server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      writeJson(res, 500, {
        ok: false,
        message: error instanceof Error ? error.message : 'internal server error',
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server?.off('error', reject);
      console.info('[browser-automation] bridge server listening', { host, port });
      resolve();
    });
  });

  return server;
}

async function stopAutomationBridgeServer() {
  if (!server) {
    return;
  }
  const current = server;
  server = null;
  await new Promise((resolve) => current.close(() => resolve()));
}

module.exports = {
  startAutomationBridgeServer,
  stopAutomationBridgeServer,
};

