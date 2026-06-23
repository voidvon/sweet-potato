'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

function safeName(value) {
  return String(value || 'snapshot').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function diagnosticsDir(taskId) {
  return path.join(os.tmpdir(), 'agent-tool-automation', safeName(taskId));
}

async function captureVisibleDom(page) {
  return page.evaluate(() => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && Number(style.opacity || 1) !== 0;
    }

    const blocks = Array.from(document.querySelectorAll('body *'))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .map((element) => {
        const text = clean(element.innerText);
        if (!text || text.length > 1000) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        const childrenWithText = Array.from(element.children).filter((child) => (
          child instanceof HTMLElement
          && visible(child)
          && clean(child.innerText)
        ));
        return {
          tag: element.tagName,
          className: String(element.className || '').slice(0, 260),
          role: element.getAttribute('role') || '',
          text,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          childCount: element.children.length,
          childrenWithText: childrenWithText.length,
          href: element.closest('a[href]')?.getAttribute('href')
            || element.querySelector('a[href]')?.getAttribute('href')
            || '',
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.y - right.y || left.x - right.x);

    return {
      url: window.location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      bodyTextStart: clean(document.body?.innerText || '').slice(0, 12000),
      blocks,
    };
  });
}

async function saveSnapshot(ctx, label, options = {}) {
  const dir = diagnosticsDir(ctx.task.id);
  await fs.mkdir(dir, { recursive: true });
  const name = safeName(label);
  const dom = await captureVisibleDom(ctx.page);
  const domPath = path.join(dir, `${name}.json`);
  await fs.writeFile(domPath, `${JSON.stringify(dom, null, 2)}\n`, 'utf8');

  let screenshotPath = '';
  if (options.screenshot !== false) {
    screenshotPath = path.join(dir, `${name}.png`);
    await ctx.page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {
      screenshotPath = '';
    });
  }

  ctx.log.info(`自动化诊断快照已保存: ${domPath}`);
  return {
    domPath,
    screenshotPath,
  };
}

module.exports = {
  captureVisibleDom,
  diagnosticsDir,
  saveSnapshot,
};
