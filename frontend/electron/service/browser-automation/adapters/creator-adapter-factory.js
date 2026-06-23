'use strict';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSearchMode(value) {
  return normalizeText(value) === 'nickname' ? 'nickname' : 'content';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTargetPage(page, signal, isTargetUrl) {
  while (!signal.aborted) {
    try {
      if (page.isClosed()) {
        throw new Error('页面已关闭');
      }
      if (isTargetUrl(page.url())) {
        return;
      }
    } catch (error) {
      if (signal.aborted) {
        break;
      }
      throw error;
    }
    await sleep(300);
  }
  throw new Error('任务已取消');
}

function createWindowOptions(isCreatorUrl, extraOptions = {}) {
  return {
    backgroundThrottling: false,
    reuseExistingWindowWhen: isCreatorUrl,
    keepWindowOpenWhen: isCreatorUrl,
    skipInitialUrlOnReuse: true,
    ...extraOptions,
  };
}

function createCreatorSearchAdapter(config) {
  const {
    name,
    site,
    initialUrl,
    isCreatorUrl,
    ensureLoggedIn,
    collectCurrentCreatorResultsPage,
    searchCreators,
    snapshotPrefix,
    normalizeMode = normalizeSearchMode,
  } = config;

  return {
    name,
    site,
    initialUrl,
    closeWindowOnDone: false,
    closeWindowOnCancel: false,
    closeWindowOnFailure: false,
    windowOptions: createWindowOptions(isCreatorUrl, {
      restoreFocusToMain: true,
    }),

    async run(ctx, input) {
      const pageOnly = Boolean(input && input.pageOnly);
      await ensureLoggedIn(ctx);

      if (pageOnly) {
        const { results, diagnostics, pagination } = await collectCurrentCreatorResultsPage(ctx, {
          page: input && input.page,
        });
        if (input && input.debug) {
          await ctx.diagnostics.saveSnapshot(`${snapshotPrefix}-page-only`);
        }
        return {
          keyword: '',
          url: ctx.page.url(),
          results,
          pagination,
          diagnostics: input && input.debug ? diagnostics : undefined,
        };
      }

      const keyword = normalizeText(input && input.keyword);
      const searchMode = normalizeMode(input && input.searchMode);
      if (!keyword) {
        throw new Error('缺少搜索关键词');
      }

      const { results, diagnostics, pagination } = await searchCreators(ctx, keyword, input && input.filters, {
        page: input && input.page,
        searchMode,
      });
      if (input && input.debug) {
        await ctx.diagnostics.saveSnapshot(`${snapshotPrefix}-search`);
      }

      return {
        keyword,
        searchMode,
        url: ctx.page.url(),
        results,
        pagination,
        diagnostics: input && input.debug ? diagnostics : undefined,
      };
    },
  };
}

function createCreatorOpenProfileAdapter(config) {
  const {
    name,
    site,
    initialUrl,
    isCreatorUrl,
    confirmSession,
    openLogMessage,
  } = config;

  return {
    name,
    site,
    initialUrl,
    closeWindowOnDone: true,
    closeWindowOnCancel: true,
    closeWindowOnFailure: false,
    windowOptions: createWindowOptions(isCreatorUrl),

    async run(ctx) {
      ctx.log.info(openLogMessage);
      const nickname = await confirmSession(ctx);

      return {
        nickname,
        url: ctx.page.url(),
        title: await ctx.page.title().catch(() => ''),
      };
    },
  };
}

function createCreatorLoginAdapter(config) {
  const {
    name,
    site,
    initialUrl,
    targetUrl,
    isCreatorUrl,
    isTargetUrl,
    readAccountName,
    confirmSession,
    openLogMessage,
    waitLogMessage,
    readLogMessage,
    missingAccountMessage,
    stabilizeLogMessage,
  } = config;

  return {
    name,
    site,
    initialUrl,
    closeWindowOnDone: true,
    closeWindowOnCancel: true,
    closeWindowOnFailure: true,
    windowOptions: createWindowOptions(isCreatorUrl),

    async run(ctx) {
      ctx.log.info(openLogMessage);
      if (!isTargetUrl(ctx.page.url())) {
        await ctx.page.goto(initialUrl, { waitUntil: 'domcontentloaded' });
      }

      ctx.log.info(waitLogMessage || `等待登录成功并进入: ${targetUrl}`);
      await waitForTargetPage(ctx.page, ctx.task.signal, isTargetUrl);

      ctx.log.info(readLogMessage);
      const nickname = await readAccountName(ctx.page, 15000);
      if (!nickname) {
        throw new Error(missingAccountMessage);
      }
      if (stabilizeLogMessage) {
        ctx.log.info(stabilizeLogMessage);
      }
      const stableNickname = await confirmSession(ctx);

      return {
        loggedIn: true,
        nickname: stableNickname || nickname,
        url: ctx.page.url(),
      };
    },
  };
}

module.exports = {
  createCreatorLoginAdapter,
  createCreatorOpenProfileAdapter,
  createCreatorSearchAdapter,
  normalizeSearchMode,
  normalizeText,
};
