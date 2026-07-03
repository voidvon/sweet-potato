'use strict';

const { ensureDouyinLoggedIn, isDouyinUrl } = require('./douyin/auth');
const { ensureNoDouyinCaptcha } = require('./douyin/captcha');
const {
  clickPrivateMessageEntryInPage,
  clickSendButtonInPage,
  focusMessageComposerInPage,
  hasAnyMessageComposerContentInPage,
  hasVisibleElementForSelectorInPage,
  readMessageComposerTextInPage,
  readMessageUiStateInPage,
  setMessageComposerContentInPage,
} = require('./douyin/message-page');
const { pollUntilWithPage, sleep } = require('../core/polling');

const DOUYIN_HOME_URL = 'https://www.douyin.com/';
const DEFAULT_MESSAGE_TEMPLATE = '\u4f60\u597d\uff0c\u6211\u4eec\u8fd9\u8fb9\u6709\u5408\u4f5c\u9700\u6c42\uff0c\u60f3\u548c\u4f60\u8fdb\u4e00\u6b65\u6c9f\u901a\uff0c\u65b9\u4fbf\u56de\u590d\u4e00\u4e0b\u5417\uff1f';
const MESSAGE_COMPOSER_SELECTOR = '.public-DraftEditor-content[contenteditable="true"]';
const UI_POLL_INTERVAL_MS = 100;
const PANEL_SETTLE_DELAY_MS = 300;
const PROFILE_LOAD_SETTLE_DELAY_MS = 3000;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeComparableText(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeCreators(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => ({
      href: normalizeText(item && item.href),
      name: normalizeText(item && item.name),
    }))
    .filter((item) => item.href);
}


async function clickDouyinPrivateMessageEntry(page) {
  return page.evaluate(clickPrivateMessageEntryInPage);
}

async function getMessageUiState(page) {
  return page.evaluate(readMessageUiStateInPage, MESSAGE_COMPOSER_SELECTOR).catch(() => ({
    entryVisible: false,
    composerVisible: false,
    sendVisible: false,
  }));
}

async function waitForPrivateMessageEntry(page, timeoutMs = 20000) {
  return pollUntilWithPage(page, async () => {
    const state = await getMessageUiState(page);
    return state.entryVisible;
  }, { timeoutMs, intervalMs: UI_POLL_INTERVAL_MS });
}

async function waitForMessageComposer(page, timeoutMs = 12000) {
  return pollUntilWithPage(page, async () => {
    const found = await page.evaluate(hasVisibleElementForSelectorInPage, MESSAGE_COMPOSER_SELECTOR).catch(() => false);
    return found;
  }, { timeoutMs, intervalMs: UI_POLL_INTERVAL_MS });
}

async function ensureMessagePanelReady(page, timeoutMs = 20000) {
  return pollUntilWithPage(page, async () => {
    const state = await getMessageUiState(page);
    if (state.composerVisible) {
      return true;
    }

    if (state.entryVisible) {
      const clicked = await clickDouyinPrivateMessageEntry(page);
      if (clicked.ok) {
        await page.waitForTimeout(PANEL_SETTLE_DELAY_MS).catch(() => {});
      }
    }
    return false;
  }, { timeoutMs, intervalMs: UI_POLL_INTERVAL_MS });
}

async function focusMessageComposer(page) {
  return page.evaluate(focusMessageComposerInPage, MESSAGE_COMPOSER_SELECTOR);
}

async function readMessageComposerText(page) {
  return page.evaluate(readMessageComposerTextInPage, MESSAGE_COMPOSER_SELECTOR).catch(() => '');
}

async function hasAnyMessageComposerContent(page) {
  return page.evaluate(hasAnyMessageComposerContentInPage, MESSAGE_COMPOSER_SELECTOR).catch(() => false);
}

async function hasExpectedMessageComposerContent(page, expectedText) {
  const actualText = await readMessageComposerText(page);
  const normalizedActual = normalizeComparableText(actualText);
  const normalizedExpected = normalizeComparableText(expectedText);
  return Boolean(normalizedActual && normalizedExpected && normalizedActual.includes(normalizedExpected));
}

async function fillMessageComposer(page, messageText) {
  const nextMessage = normalizeText(messageText);
  const composerInfo = await focusMessageComposer(page);

  if (!composerInfo.ok) {
    throw new Error('\u672a\u627e\u5230\u53ef\u8f93\u5165\u7684\u79c1\u4fe1\u8f93\u5165\u6846');
  }

  await page.keyboard.down('Control').catch(() => {});
  await page.keyboard.press('KeyA').catch(() => {});
  await page.keyboard.up('Control').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await page.keyboard.type(nextMessage, { delay: 20 }).catch(() => {});

  if (await hasExpectedMessageComposerContent(page, nextMessage)) {
    return;
  }

  const fallbackInfo = await page.evaluate(setMessageComposerContentInPage, {
    selector: MESSAGE_COMPOSER_SELECTOR,
    message: nextMessage,
  });

  if (!fallbackInfo.ok || !(await hasAnyMessageComposerContent(page))) {
    throw new Error('\u672a\u80fd\u5c06\u5185\u5bb9\u586b\u5165\u79c1\u4fe1\u8f93\u5165\u6846');
  }
}

async function ensureMessageReadyForSend(page, messageText, timeoutMs = 12000) {
  const nextMessage = normalizeText(messageText);

  return pollUntilWithPage(page, async () => {
    const state = await getMessageUiState(page);
    if (state.composerVisible && state.sendVisible && await hasExpectedMessageComposerContent(page, nextMessage)) {
      return true;
    }

    if (state.entryVisible) {
      const clicked = await clickDouyinPrivateMessageEntry(page);
      if (clicked.ok) {
        await page.waitForTimeout(PANEL_SETTLE_DELAY_MS).catch(() => {});
      }
    }

    const refreshedState = await getMessageUiState(page);
    if (refreshedState.composerVisible && !(await hasExpectedMessageComposerContent(page, nextMessage))) {
      await fillMessageComposer(page, nextMessage);
    }
    return false;
  }, { timeoutMs, intervalMs: UI_POLL_INTERVAL_MS });
}

async function clickSendButton(page) {
  return page.evaluate(clickSendButtonInPage);
}

async function captureMessagePanelDiagnostics(ctx, snapshotName) {
  await ctx.diagnostics.saveSnapshot(snapshotName, { screenshot: true }).catch(() => {});
}

async function openCreatorMessagePanel(ctx, creator) {
  await ctx.page.goto(creator.href, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await ctx.page.waitForTimeout(PROFILE_LOAD_SETTLE_DELAY_MS).catch(() => {});
  await ensureNoDouyinCaptcha(ctx);

  const entryReady = await waitForPrivateMessageEntry(ctx.page);
  if (!entryReady) {
    await captureMessagePanelDiagnostics(ctx, 'douyin-connect-message-entry-timeout');
    throw new Error(`\u672a\u7b49\u5230\u79c1\u4fe1\u5165\u53e3: ${creator.name || creator.href}`);
  }

  const panelReady = await ensureMessagePanelReady(ctx.page);
  if (!panelReady) {
    await captureMessagePanelDiagnostics(ctx, 'douyin-connect-message-panel-missing');
    throw new Error(`\u672a\u7b49\u5230\u79c1\u4fe1\u7a97\u53e3\u6253\u5f00: ${creator.name || creator.href}`);
  }

  await ensureNoDouyinCaptcha(ctx);
  const ready = await waitForMessageComposer(ctx.page);
  if (!ready) {
    await captureMessagePanelDiagnostics(ctx, 'douyin-connect-composer-missing');
    throw new Error(`\u672a\u627e\u5230\u79c1\u4fe1\u8f93\u5165\u6846: ${creator.name || creator.href}`);
  }
}

async function sendMessageToCreator(ctx, creator, messageText) {
  await openCreatorMessagePanel(ctx, creator);
  await fillMessageComposer(ctx.page, messageText);
  await ctx.page.waitForTimeout(PANEL_SETTLE_DELAY_MS).catch(() => {});

  const sendReady = await ensureMessageReadyForSend(ctx.page, messageText);
  if (!sendReady) {
    await captureMessagePanelDiagnostics(ctx, 'douyin-connect-send-not-ready');
    throw new Error(`\u53d1\u9001\u524d\u79c1\u4fe1\u9762\u677f\u72b6\u6001\u4e0d\u7a33\u5b9a: ${creator.name || creator.href}`);
  }

  const sent = await clickSendButton(ctx.page);
  if (!sent.ok) {
    await captureMessagePanelDiagnostics(ctx, 'douyin-connect-send-missing');
    throw new Error(`\u672a\u627e\u5230\u53d1\u9001\u6309\u94ae: ${creator.name || creator.href}`);
  }
}

const adapter = {
  name: 'douyin-connect-creators',
  site: 'douyin',
  initialUrl: DOUYIN_HOME_URL,
  closeWindowOnDone: false,
  closeWindowOnCancel: false,
  closeWindowOnFailure: false,
  windowOptions: {
    backgroundThrottling: false,
    reuseExistingWindowWhen: isDouyinUrl,
    keepWindowOpenWhen: isDouyinUrl,
    skipInitialUrlOnReuse: true,
    restoreFocusToMain: true,
  },

  async run(ctx, input = {}) {
    const creators = normalizeCreators(input.creators);
    const messageTemplate = normalizeText(input.messageTemplate) || DEFAULT_MESSAGE_TEMPLATE;

    if (!creators.length) {
      throw new Error('\u7f3a\u5c11\u8981\u5efa\u8054\u7684\u8fbe\u4eba');
    }

    await ensureDouyinLoggedIn(ctx);
    await ensureNoDouyinCaptcha(ctx);

    const processed = [];
    const failed = [];

    for (const creator of creators) {
      if (ctx.task.signal.aborted) {
        throw new Error('\u4efb\u52a1\u5df2\u53d6\u6d88');
      }

      ctx.log.info(`Start connect: ${creator.name || creator.href}`);

      try {
        await sendMessageToCreator(ctx, creator, messageTemplate);
        processed.push(creator);
        ctx.log.info(`Connect done: ${creator.name || creator.href}`);
        await sleep(600);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({
          ...creator,
          error: message,
        });
        ctx.log.warn(`Connect failed: ${creator.name || creator.href} - ${message}`);
      }
    }

    return {
      successCount: processed.length,
      failCount: failed.length,
      processed,
      failed,
      messageTemplate,
    };
  },
};

module.exports = adapter;
