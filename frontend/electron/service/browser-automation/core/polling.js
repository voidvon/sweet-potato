'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(predicate, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs || 0));
  const intervalMs = Math.max(0, Number(options.intervalMs || 100));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }

    await sleep(intervalMs);
  }

  return false;
}

async function pollUntilWithPage(page, predicate, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs || 0));
  const intervalMs = Math.max(0, Number(options.intervalMs || 100));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }

    await page.waitForTimeout(intervalMs).catch(() => {});
  }

  return false;
}

module.exports = {
  pollUntil,
  pollUntilWithPage,
  sleep,
};
