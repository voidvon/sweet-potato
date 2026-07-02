'use strict';

const { ensureDouyinLoggedIn, isDouyinUrl } = require('./douyin/auth');
const { ensureNoDouyinCaptcha: ensureNoDouyinCaptchaShared } = require('./douyin/captcha');

const DOUYIN_WEB_ORIGIN = 'https://www.douyin.com';
const DEFAULT_RESULT_LIMIT = 20;
const LOAD_MORE_SCROLL_STEP = 960;

function normalizeKeyword(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildDouyinSearchUrl(input = {}) {
  const keyword = normalizeKeyword(input.keyword);
  if (!keyword) {
    return `${DOUYIN_WEB_ORIGIN}/`;
  }

  return `${DOUYIN_WEB_ORIGIN}/search/${encodeURIComponent(keyword)}?type=user`;
}

async function waitForDouyinCreatorResults(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1200).catch(() => {});

  await page.waitForFunction(
    () => (
      document.querySelectorAll('.search-result-card').length > 0
      || document.querySelectorAll('a[href*="/user/"]').length > 0
    ),
    { timeout: 10000 },
  ).catch(() => {});

  await page.waitForTimeout(600).catch(() => {});
}

async function ensureNoDouyinCaptcha(ctx) {
  return ensureNoDouyinCaptchaShared(ctx);
}

function normalizePositiveInt(value, fallback) {
  const normalized = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }
  return normalized;
}

function extractStructuredResults(root, options = {}) {
  const fallbackLimit = 20;
  const defaultView = root.ownerDocument?.defaultView || root.defaultView;
  if (!defaultView) {
    return [];
  }
  const limitValue = Number.parseInt(String(options.limit || ''), 10);
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : fallbackLimit;

  const DOUYIN_ID_LABEL = '抖音号';
  const LIKE_LABEL = '获赞';
  const FOLLOWER_LABEL = '粉丝';
  const PROFILE_LABEL = '查看主页';

  function normalizeLocalText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isVisibleElement(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = defaultView.getComputedStyle?.(element);
    return rect.width > 0
      && rect.height > 0
      && style?.visibility !== 'hidden'
      && style?.display !== 'none';
  }

  function isStatsText(text) {
    return text.includes(DOUYIN_ID_LABEL)
      || text.includes(LIKE_LABEL)
      || text.includes(FOLLOWER_LABEL);
  }

  function collectRows(card) {
    return Array.from(card.children).filter((child) => {
      if (!(child instanceof defaultView.HTMLElement)) {
        return false;
      }
      if (!isVisibleElement(child)) {
        return false;
      }
      const text = normalizeLocalText(child.innerText || child.textContent || '');
      return Boolean(text || child.querySelector('[data-e2e="live-avatar"]'));
    });
  }

  function findStatsRow(card) {
    const candidates = Array.from(card.querySelectorAll('div, section, article')).filter((element) => (
      element instanceof defaultView.HTMLElement && isVisibleElement(element)
    ));
    let bestCandidate = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      const text = normalizeLocalText(candidate.innerText || candidate.textContent || '');
      if (!isStatsText(text)) {
        continue;
      }

      const directChildren = Array.from(candidate.children).filter((child) => (
        child instanceof defaultView.HTMLElement && isVisibleElement(child)
      ));
      const directChildMatchCount = directChildren.reduce((count, child) => {
        const childText = normalizeLocalText(child.innerText || child.textContent || '');
        return count + (isStatsText(childText) ? 1 : 0);
      }, 0);
      const score = directChildMatchCount * 10 + directChildren.length;
      if (score > bestScore) {
        bestCandidate = candidate;
        bestScore = score;
      }
    }

    return bestCandidate;
  }

  function findIntroRow(card, statsRow) {
    const candidates = Array.from(card.querySelectorAll('div, section, article')).filter((element) => (
      element instanceof defaultView.HTMLElement && isVisibleElement(element)
    ));
    const startIndex = statsRow ? candidates.indexOf(statsRow) : -1;

    for (let index = startIndex + 1; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const text = normalizeLocalText(candidate.innerText || candidate.textContent || '');
      if (!text) {
        continue;
      }
      if (isStatsText(text)) {
        continue;
      }
      if (candidate.querySelector('[data-e2e="live-avatar"]')) {
        continue;
      }
      return candidate;
    }

    return null;
  }

  function childTexts(element) {
    if (!element) {
      return [];
    }

    const values = [];
    const seen = new Set();
    for (const child of Array.from(element.children)) {
      const text = normalizeLocalText(child.textContent || '');
      if (!text || seen.has(text)) {
        continue;
      }
      seen.add(text);
      values.push(text);
    }
    return values;
  }

  function directChildTexts(element) {
    if (!element) {
      return [];
    }

    const values = [];
    const seen = new Set();
    for (const child of Array.from(element.children)) {
      if (!(child instanceof defaultView.HTMLElement)) {
        continue;
      }

      const directText = normalizeLocalText(child.innerText || child.textContent || '');
      if (directText && !seen.has(directText)) {
        seen.add(directText);
        values.push(directText);
      }

      const nestedLeafTexts = Array.from(child.querySelectorAll('span, div'))
        .filter((node) => (
          node instanceof defaultView.HTMLElement
          && isVisibleElement(node)
          && node.children.length === 0
        ))
        .map((node) => normalizeLocalText(node.innerText || node.textContent || ''))
        .filter(Boolean);

      for (const text of nestedLeafTexts) {
        if (seen.has(text)) {
          continue;
        }
        seen.add(text);
        values.push(text);
      }
    }

    return values;
  }

  function extractDouyinId(parts, rowText) {
    const matchedPart = parts.find((item) => item.includes(DOUYIN_ID_LABEL));
    const sourceText = matchedPart || rowText;
    const match = sourceText.match(new RegExp(`${DOUYIN_ID_LABEL}[：:]?\\s*([^\\s:：]+)`));
    return match ? `${DOUYIN_ID_LABEL}: ${match[1]}` : '';
  }

  function extractCountStat(parts, rowText, label) {
    const matchedPart = parts.find((item) => item.includes(label) && item !== rowText);
    if (matchedPart) {
      return matchedPart;
    }

    const match = rowText.match(new RegExp(`([^\\s]+${label})`));
    return match ? match[1] : '';
  }

  function findProfileAnchor(card) {
    const anchors = Array.from(card.querySelectorAll('a[href]'));
    return anchors.find((anchor) => (
      anchor instanceof defaultView.HTMLAnchorElement
      && anchor.href.includes('/user/')
    )) || anchors.find((anchor) => anchor instanceof defaultView.HTMLAnchorElement) || null;
  }

  const cards = Array.from(root.querySelectorAll('.search-result-card')).filter((card) => (
    card instanceof defaultView.HTMLElement && isVisibleElement(card)
  ));
  const results = [];
  const seen = new Set();

  for (const card of cards) {
    const rows = collectRows(card);
    const firstRow = rows[0] || null;
    const secondRow = findStatsRow(card) || rows[1] || null;
    const thirdRow = findIntroRow(card, secondRow) || rows[2] || null;
    const avatarHost = firstRow?.querySelector('[data-e2e="live-avatar"]') || null;
    const avatar = avatarHost?.querySelector('img') || firstRow?.querySelector('img') || null;
    const infoContainer = avatarHost?.nextElementSibling instanceof defaultView.HTMLElement
      ? avatarHost.nextElementSibling
      : null;
    const infoParts = childTexts(infoContainer);
    const secondRowParts = directChildTexts(secondRow);
    const secondRowText = normalizeLocalText(secondRow?.innerText || secondRow?.textContent || '');
    const fallbackLines = normalizeLocalText(card.innerText || card.textContent || '')
      .split(/\n+/)
      .map(normalizeLocalText)
      .filter(Boolean);
    const anchor = findProfileAnchor(card);
    const href = normalizeLocalText(anchor?.href || '');
    const name = infoParts[0] || normalizeLocalText(anchor?.textContent || '') || fallbackLines[0] || '';
    const creatorType = infoParts[1] || '';
    const douyinId = extractDouyinId(secondRowParts, secondRowText);
    const likeCount = extractCountStat(secondRowParts, secondRowText, LIKE_LABEL);
    const followerCount = extractCountStat(secondRowParts, secondRowText, FOLLOWER_LABEL);
    const intro = normalizeLocalText(thirdRow?.innerText || thirdRow?.textContent || '') || fallbackLines[2] || '';
    const stats = [douyinId, likeCount, followerCount].filter(Boolean);
    const dedupeKey = href || `${name}-${stats.join('|')}`;

    if (!name || name.length > 40 || !dedupeKey || seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    results.push({
      name,
      href,
      avatarUrl: avatar instanceof defaultView.HTMLImageElement ? normalizeLocalText(avatar.src) : '',
      creatorType,
      douyinId,
      likeCount,
      followerCount,
      intro,
      summary: intro,
      badges: creatorType ? [creatorType] : [],
      stats,
      operationLabel: PROFILE_LABEL,
    });

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

async function collectDouyinCreatorResults(page, options = {}) {
  const limit = Boolean(options.collectAll)
    ? Number.MAX_SAFE_INTEGER
    : normalizePositiveInt(options.limit, DEFAULT_RESULT_LIMIT);
  return page.evaluate(
    ({ nextLimit }) => window.__DOUYIN_EXTRACT_STRUCTURED_RESULTS__(document, { limit: nextLimit }),
    { nextLimit: limit },
  );
}

async function scrollDouyinResultsDown(page, step) {
  return page.evaluate(({ nextStep }) => {
    const target = document.scrollingElement || document.documentElement || document.body;
    if (!(target instanceof HTMLElement)) {
      return { moved: false, before: 0, after: 0, maxScrollTop: 0, cardCount: 0 };
    }

    const cardCount = document.querySelectorAll('.search-result-card').length;
    const before = target.scrollTop;
    const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    const nextTop = Math.max(maxScrollTop, Math.min(maxScrollTop, before + nextStep));

    window.scrollTo({ top: nextTop, left: window.scrollX, behavior: 'auto' });
    target.scrollTop = nextTop;
    target.dispatchEvent(new Event('scroll', { bubbles: true }));
    window.dispatchEvent(new Event('scroll'));

    return {
      moved: target.scrollTop > before + 2,
      before,
      after: target.scrollTop,
      maxScrollTop,
      cardCount,
    };
  }, { nextStep: step });
}

async function loadMoreDouyinCreatorResults(ctx, options = {}) {
  const previousCount = normalizePositiveInt(options.previousCount, 0);
  await ensureNoDouyinCaptcha(ctx);
  const beforeResults = await collectDouyinCreatorResults(ctx.page, { collectAll: true });
  await scrollDouyinResultsDown(ctx.page, LOAD_MORE_SCROLL_STEP);
  await ctx.page.waitForTimeout(1200).catch(() => {});
  await ensureNoDouyinCaptcha(ctx);
  await waitForDouyinCreatorResults(ctx.page);
  await ensureNoDouyinCaptcha(ctx);
  const bestResults = await collectDouyinCreatorResults(ctx.page, { collectAll: true });
  const reachedEnd = bestResults.length <= Math.max(previousCount, beforeResults.length);

  return {
    allResults: bestResults,
    appendedResults: bestResults.slice(Math.min(previousCount, bestResults.length)),
    hasMore: !reachedEnd,
  };
}

const adapter = {
  name: 'douyin-open-search',
  site: 'douyin',
  initialUrl: buildDouyinSearchUrl,
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
    const keyword = normalizeKeyword(input.keyword);
    const loadMore = Boolean(input.loadMore);
    const previousCount = normalizePositiveInt(input.previousCount, 0);
    const limit = normalizePositiveInt(input.limit, DEFAULT_RESULT_LIMIT);
    if (!keyword) {
      throw new Error('缺少搜索关键词');
    }

    await ensureDouyinLoggedIn(ctx);
    await ensureNoDouyinCaptcha(ctx);

    await ctx.page.addInitScript(
      ({ source }) => {
        // eslint-disable-next-line no-new-func
        window.__DOUYIN_EXTRACT_STRUCTURED_RESULTS__ = new Function(`return (${source});`)();
      },
      { source: extractStructuredResults.toString() },
    ).catch(() => {});

    const targetUrl = buildDouyinSearchUrl({ keyword });
    if (!loadMore && ctx.page.url() !== targetUrl) {
      await ctx.page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    await ctx.page.evaluate(
      ({ source }) => {
        // eslint-disable-next-line no-new-func
        window.__DOUYIN_EXTRACT_STRUCTURED_RESULTS__ = new Function(`return (${source});`)();
      },
      { source: extractStructuredResults.toString() },
    ).catch(() => {});

    await ensureNoDouyinCaptcha(ctx);
    await waitForDouyinCreatorResults(ctx.page);
    await ensureNoDouyinCaptcha(ctx);
    if (loadMore) {
      const nextBatch = await loadMoreDouyinCreatorResults(ctx, { previousCount, limit });
      ctx.log.info(`Douyin appended results: ${nextBatch.appendedResults.length}`);

      return {
        keyword,
        url: ctx.page.url(),
        title: await ctx.page.title().catch(() => ''),
        results: nextBatch.appendedResults,
        totalResults: nextBatch.allResults.length,
        previousCount,
        hasMore: nextBatch.hasMore,
        loadMore: true,
      };
    }

    await ensureNoDouyinCaptcha(ctx);
    const results = await collectDouyinCreatorResults(ctx.page, { limit });
    ctx.log.info(`抖音达人搜索结果数: ${results.length}`);

    if (!results.length) {
      await ctx.diagnostics.saveSnapshot('douyin-search-empty', { screenshot: true }).catch(() => {});
    }

    return {
      keyword,
      url: ctx.page.url(),
      title: await ctx.page.title().catch(() => ''),
      results,
    };
  },
};

adapter.buildDouyinSearchUrl = buildDouyinSearchUrl;
adapter.isDouyinUrl = isDouyinUrl;
adapter.extractStructuredResults = extractStructuredResults;
adapter.normalizeText = normalizeText;
adapter.collectDouyinCreatorResults = collectDouyinCreatorResults;

module.exports = adapter;
