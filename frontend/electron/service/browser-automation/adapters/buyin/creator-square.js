'use strict';

const { throwIfAborted, withAbort } = require('../../core/abort');
const { DAREN_SQUARE_URL, isLoginUrl } = require('./auth');

const BUYIN_MAIN_CATEGORY_LABELS = new Set([
  '玩具乐器',
  '服饰内衣',
  '个护家清',
  '智能家居',
  '生鲜',
  '美妆',
  '母婴宠物',
  '鲜花园艺',
  '本地生活',
  '食品饮料',
  '3C数码家电',
  '图书教育',
  '鞋靴箱包',
  '虚拟充值',
  '运动户外',
  '钟表配饰',
  '珠宝文玩',
  '医疗健康',
  '酒类',
  '滋补保健',
  '原料包装',
  '餐饮外卖',
]);

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePositiveInt(value, fallback = 1) {
  const number = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeBuyinFilterTokens(filters) {
  if (!filters || typeof filters !== 'object') {
    return [];
  }
  if (Array.isArray(filters.buyinFilterTokens)) {
    return filters.buyinFilterTokens.map(normalizeText).filter(Boolean);
  }
  return [];
}

async function openDarenSquare(page, signal) {
  const reusedCurrentPage = (() => {
    try {
      const parsed = new URL(page.url());
      return parsed.hostname === 'buyin.jinritemai.com'
        && parsed.pathname.startsWith('/dashboard/servicehall/daren-square');
    } catch {
      return false;
    }
  })();
  if (!reusedCurrentPage) {
    await withAbort(signal, page.goto(DAREN_SQUARE_URL, { waitUntil: 'domcontentloaded' }));
  }
  await withAbort(signal, page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}));
  if (isLoginUrl(page.url())) {
    throw new Error('进入精选联盟达人广场时登录态失效，请先进入账号后台确认登录状态');
  }
  return { reusedCurrentPage };
}

async function findSearchInput(page) {
  const selectors = [
    'input[placeholder*="请输入"]',
    'input[placeholder*="名称"]',
    'input[placeholder*="达人"]',
    'input[placeholder*="抖音"]',
    'input[placeholder*="昵称"]',
    'input[placeholder*="ID"]',
    'input[placeholder*="关键词"]',
    'input[placeholder*="搜索"]',
    'input[type="search"]',
    'input:not([type]), input[type="text"]',
  ];

  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = Math.min(await matches.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const locator = matches.nth(index);
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }
  }

  throw new Error('未找到精选联盟达人搜索输入框');
}

async function triggerSearch(page, searchInput, signal, strategy = 'near') {
  if (strategy === 'enter') {
    await withAbort(signal, searchInput.press('Enter'));
    return 'enter';
  }

  if (strategy === 'coordinate') {
    const box = await searchInput.boundingBox().catch(() => null);
    if (box) {
      await withAbort(signal, page.mouse.click(box.x + box.width + 28, box.y + (box.height / 2)));
      return 'coordinate';
    }
    await withAbort(signal, searchInput.press('Enter'));
    return 'coordinate-enter';
  }

  if (strategy === 'global') {
    const searchButtons = [
      page.getByRole('button', { name: /搜索|查询/ }).first(),
      page.locator('button').filter({ hasText: /搜索|查询/ }).first(),
      page.locator('[role="button"]').filter({ hasText: /搜索|查询/ }).first(),
      page.locator('button[class*="search"], button[class*="Search"], [role="button"][class*="search"], [role="button"][class*="Search"]').first(),
    ];

    for (const button of searchButtons) {
      if (await button.isVisible().catch(() => false)) {
        await withAbort(signal, button.click());
        return 'global-button';
      }
    }

    await withAbort(signal, searchInput.press('Enter'));
    return 'global-enter';
  }

  const clickedNearInput = await searchInput.evaluate((input) => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = (element) => String(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').replace(/\s+/g, ' ').trim();
    const isSearchControl = (element) => {
      if (!(element instanceof HTMLElement) || element === input || element.contains(input) || !visible(element)) {
        return false;
      }
      const text = textOf(element);
      const className = String(element.className || '');
      const role = String(element.getAttribute('role') || '');
      const cursor = window.getComputedStyle(element).cursor || '';
      const clickable = element.tagName.toLowerCase() === 'button'
        || role === 'button'
        || typeof element.onclick === 'function'
        || cursor === 'pointer'
        || /button/i.test(className);
      return clickable && (/搜索|查询/.test(text) || /search/i.test(className));
    };
    const ancestors = [];
    let current = input.parentElement;
    while (current && ancestors.length < 6) {
      ancestors.push(current);
      current = current.parentElement;
    }

    for (const ancestor of ancestors) {
      const controls = Array.from(ancestor.querySelectorAll('button, [role="button"], [class*="button"], [class*="Button"], [class*="search"], [class*="Search"]'));
      const inputRect = input.getBoundingClientRect();
      const target = controls
        .filter(isSearchControl)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const sameRow = rect.bottom >= inputRect.top && rect.top <= inputRect.bottom;
          const rightSide = rect.left >= inputRect.left;
          const distance = Math.abs((rect.left + rect.right) / 2 - inputRect.right) + Math.abs((rect.top + rect.bottom) / 2 - (inputRect.top + inputRect.bottom) / 2);
          return { element, score: (sameRow ? 1000 : 0) + (rightSide ? 500 : 0) - distance };
        })
        .sort((left, right) => right.score - left.score)[0]?.element;
      if (target instanceof HTMLElement) {
        target.click();
        return textOf(target) || String(target.className || '');
      }
    }

    return '';
  }).catch(() => '');

  if (clickedNearInput) {
    return `near:${clickedNearInput}`;
  }

  await withAbort(signal, page.keyboard.press('Enter'));
  return 'near-enter';
}

async function clickVisibleTextControl(page, label, signal) {
  const clicked = await page.evaluate((targetLabel) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const scoreElement = (element) => {
      const text = clean(element.textContent);
      if (!text || !text.includes(targetLabel)) {
        return Number.NEGATIVE_INFINITY;
      }
      const rect = element.getBoundingClientRect();
      const tagName = element.tagName.toLowerCase();
      const role = element.getAttribute('role') || '';
      const className = String(element.className || '');
      const clickable = tagName === 'button'
        || role === 'button'
        || typeof element.onclick === 'function'
        || window.getComputedStyle(element).cursor === 'pointer'
        || /button|select|dropdown|filter|trigger/i.test(className);
      return (clickable ? 1000 : 0)
        + (text === targetLabel ? 500 : 0)
        - Math.max(rect.width * rect.height, 0) / 1000;
    };
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], [class*="button"], [class*="Button"], [class*="select"], [class*="Select"], [class*="filter"], [class*="Filter"], div, span'))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .map((element) => ({ element, score: scoreElement(element) }))
      .filter((item) => item.score > Number.NEGATIVE_INFINITY)
      .sort((left, right) => right.score - left.score);
    const target = candidates[0]?.element;
    if (target instanceof HTMLElement) {
      target.click();
      return clean(target.textContent);
    }
    return '';
  }, label).catch(() => '');

  throwIfAborted(signal);
  if (clicked) {
    await withAbort(signal, page.waitForTimeout(250));
    return clicked;
  }
  return '';
}

async function clickVisiblePopupOption(page, option, signal) {
  const clicked = await page.evaluate((targetOption) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const popupLike = (element) => {
      const className = String(element.className || '');
      return /popover|popup|dropdown|select|menu|cascader/i.test(className);
    };
    const popupRoots = Array.from(document.querySelectorAll('[class*="popover"], [class*="Popover"], [class*="popup"], [class*="Popup"], [class*="dropdown"], [class*="Dropdown"], [class*="select"], [class*="Select"], [class*="menu"], [class*="Menu"]'))
      .filter((element) => element instanceof HTMLElement && visible(element) && popupLike(element));
    const roots = popupRoots.length ? popupRoots : [document.body];
    const candidates = roots.flatMap((root) => Array.from(root.querySelectorAll('button, [role="button"], [role="option"], li, div, span')))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .map((element) => {
        const text = clean(element.textContent);
        const rect = element.getBoundingClientRect();
        const exact = text === targetOption;
        const includes = text.includes(targetOption);
        const tagName = element.tagName.toLowerCase();
        const role = element.getAttribute('role') || '';
        const className = String(element.className || '');
        const clickable = tagName === 'button'
          || role === 'button'
          || role === 'option'
          || tagName === 'li'
          || typeof element.onclick === 'function'
          || window.getComputedStyle(element).cursor === 'pointer'
          || /item|option|button/i.test(className);
        return {
          element,
          score: (exact ? 2000 : includes ? 1000 : Number.NEGATIVE_INFINITY)
            + (clickable ? 300 : 0)
            - Math.max(rect.width * rect.height, 0) / 1000,
        };
      })
      .filter((item) => item.score > Number.NEGATIVE_INFINITY)
      .sort((left, right) => right.score - left.score);
    const target = candidates[0]?.element;
    if (target instanceof HTMLElement) {
      target.click();
      return clean(target.textContent);
    }
    return '';
  }, option).catch(() => '');

  throwIfAborted(signal);
  if (clicked) {
    await withAbort(signal, page.waitForTimeout(200));
    return clicked;
  }
  return '';
}

async function fillVisiblePopupRange(page, min, max, signal) {
  const filled = await page.evaluate(({ min, max }) => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const popupRoots = Array.from(document.querySelectorAll('[class*="popover"], [class*="Popover"], [class*="popup"], [class*="Popup"], [class*="dropdown"], [class*="Dropdown"]'))
      .filter((element) => element instanceof HTMLElement && visible(element));
    const roots = popupRoots.length ? popupRoots : [document.body];
    const inputs = roots.flatMap((root) => Array.from(root.querySelectorAll('input')))
      .filter((input) => input instanceof HTMLInputElement && visible(input));
    if (inputs.length < 2) {
      return false;
    }
    const assign = (input, value) => {
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    assign(inputs[0], min);
    assign(inputs[1], max);
    return true;
  }, { min, max }).catch(() => false);

  throwIfAborted(signal);
  if (filled) {
    await withAbort(signal, page.waitForTimeout(200));
    await clickVisiblePopupOption(page, '确定', signal).catch(() => '');
    return true;
  }
  return false;
}

async function clickQuickFilterButtonExact(page, label, signal) {
  const clicked = await page.evaluate((targetLabel) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const target = Array.from(document.querySelectorAll('.quick-filter button, .quick-filter a, .quick-filter [role="button"]'))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .find((element) => clean(element.innerText || element.textContent) === targetLabel);
    if (target instanceof HTMLElement) {
      target.click();
      return clean(target.innerText || target.textContent);
    }
    return '';
  }, label).catch(() => '');

  throwIfAborted(signal);
  if (clicked) {
    await withAbort(signal, page.waitForTimeout(250));
  }
  return clicked;
}

async function clickQuickFilterRowOption(page, rowLabel, option, signal) {
  const clicked = await page.evaluate(({ rowLabel, option }) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const rows = Array.from(document.querySelectorAll('.quick-filter .auxo-form-item'))
      .filter((element) => element instanceof HTMLElement && visible(element));
    const row = rows.find((element) => clean(element.querySelector('.auxo-form-item-label')?.textContent) === rowLabel);
    const roots = row ? [row] : rows;
    const target = roots
      .flatMap((root) => Array.from(root.querySelectorAll('button, a, [role="button"]')))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .find((element) => clean(element.innerText || element.textContent) === option);
    if (target instanceof HTMLElement) {
      target.click();
      return clean(target.innerText || target.textContent);
    }
    return '';
  }, { rowLabel, option }).catch(() => '');

  throwIfAborted(signal);
  if (clicked) {
    await withAbort(signal, page.waitForTimeout(500));
  }
  return clicked;
}

async function clickBuyinRadioOption(page, option, signal) {
  const box = await page.evaluate((targetOption) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const target = Array.from(document.querySelectorAll('.auxo-radio-group .auxo-radio-button-wrapper, .auxo-radio-group label'))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .find((element) => clean(element.innerText || element.textContent) === targetOption);
    if (target instanceof HTMLElement) {
      const rect = target.getBoundingClientRect();
      return {
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2),
      };
    }
    return null;
  }, option).catch(() => '');

  throwIfAborted(signal);
  if (box) {
    await withAbort(signal, page.mouse.click(box.x, box.y));
    await withAbort(signal, page.waitForTimeout(500));
    return option;
  }
  return '';
}

async function clickVisibleLayerOptionExact(page, option, signal) {
  const box = await page.evaluate((targetOption) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const roots = Array.from(document.querySelectorAll('.auxo-select-dropdown, .auxo-cascader-menus, .auxo-popover'))
      .filter((element) => element instanceof HTMLElement && visible(element));
    const candidates = roots
      .flatMap((root) => Array.from(root.querySelectorAll('.auxo-select-item-option-content, .quick-filter-button-select-option, .auxo-select-item, .auxo-cascader-menu-item, button, [role="button"], li, [role="option"]')))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .map((element) => {
        const text = clean(element.innerText || element.textContent);
        const rect = element.getBoundingClientRect();
        return {
          text,
          x: rect.left + (rect.width / 2),
          y: rect.top + (rect.height / 2),
          area: rect.width * rect.height,
        };
      })
      .filter((item) => item.text === targetOption)
      .sort((left, right) => left.area - right.area);
    return candidates[0] || null;
  }, option).catch(() => null);

  throwIfAborted(signal);
  if (!box) {
    return '';
  }
  await withAbort(signal, page.mouse.click(box.x, box.y));
  await withAbort(signal, page.waitForTimeout(250));
  return option;
}

async function hoverVisibleLayerOptionExact(page, option, signal) {
  const box = await page.evaluate((targetOption) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const roots = Array.from(document.querySelectorAll('.auxo-select-dropdown, .auxo-cascader-menus, .auxo-popover'))
      .filter((element) => element instanceof HTMLElement && visible(element));
    const candidates = roots
      .flatMap((root) => Array.from(root.querySelectorAll('.auxo-select-item-option-content, .quick-filter-button-select-option, .auxo-select-item, .auxo-cascader-menu-item, button, [role="button"], li, [role="option"]')))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .map((element) => {
        const text = clean(element.innerText || element.textContent);
        const rect = element.getBoundingClientRect();
        return {
          text,
          x: rect.left + (rect.width / 2),
          y: rect.top + (rect.height / 2),
          area: rect.width * rect.height,
        };
      })
      .filter((item) => item.text === targetOption)
      .sort((left, right) => left.area - right.area);
    return candidates[0] || null;
  }, option).catch(() => null);

  throwIfAborted(signal);
  if (!box) {
    return '';
  }
  await withAbort(signal, page.mouse.move(box.x, box.y));
  await withAbort(signal, page.waitForTimeout(300));
  return option;
}

async function clickAggregateFieldControl(page, fieldLabel, signal) {
  const box = await page.evaluate((targetFieldLabel) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const popover = Array.from(document.querySelectorAll('.quick-filter-button-agg-pop, .auxo-popover'))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .find((element) => /确认|取消|重置/.test(clean(element.innerText || element.textContent)));
    if (!popover) {
      return null;
    }
    const wrapper = Array.from(popover.querySelectorAll('.auxo-label-wrapper'))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .find((element) => clean(element.querySelector('.auxo-label-wrapper-label')?.textContent) === targetFieldLabel);
    const target = wrapper?.querySelector('.auxo-select, .auxo-cascader-picker');
    if (!(target instanceof HTMLElement) || !visible(target)) {
      return null;
    }
    const rect = target.getBoundingClientRect();
    return {
      x: rect.right - 20,
      y: rect.top + (rect.height / 2),
    };
  }, fieldLabel).catch(() => null);

  throwIfAborted(signal);
  if (!box) {
    return false;
  }
  await withAbort(signal, page.mouse.click(box.x, box.y));
  await withAbort(signal, page.waitForTimeout(350));
  return true;
}

async function clickAggregateActionButton(page, label, signal) {
  const box = await page.evaluate((targetLabel) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const popover = Array.from(document.querySelectorAll('.quick-filter-button-agg-pop, .auxo-popover'))
      .filter((element) => element instanceof HTMLElement && visible(element))
      .find((element) => /确认|取消|重置/.test(clean(element.innerText || element.textContent)));
    const target = Array.from(popover?.querySelectorAll('button') || [])
      .filter((element) => element instanceof HTMLElement && visible(element))
      .find((element) => clean(element.innerText || element.textContent) === targetLabel);
    if (!(target instanceof HTMLElement)) {
      return null;
    }
    const rect = target.getBoundingClientRect();
    return {
      x: rect.left + (rect.width / 2),
      y: rect.top + (rect.height / 2),
    };
  }, label).catch(() => null);

  throwIfAborted(signal);
  if (!box) {
    return false;
  }
  await withAbort(signal, page.mouse.click(box.x, box.y));
  await withAbort(signal, page.waitForTimeout(500));
  return true;
}

async function clickAggregateFilterOption(page, triggerLabel, fieldLabel, option, signal) {
  const opened = await clickQuickFilterButtonExact(page, triggerLabel, signal);
  if (!opened) {
    return false;
  }
  const openedField = await clickAggregateFieldControl(page, fieldLabel, signal);
  if (!openedField) {
    await clickAggregateActionButton(page, '取消', signal).catch(() => false);
    return false;
  }
  const optionPath = String(option || '').split('>').map(normalizeText).filter(Boolean);
  let selected = '';
  if (optionPath.length > 1) {
    await hoverVisibleLayerOptionExact(page, optionPath[0], signal);
    selected = await clickVisibleLayerOptionExact(page, optionPath[optionPath.length - 1], signal);
  } else {
    selected = await clickVisibleLayerOptionExact(page, option, signal);
  }
  if (!selected) {
    await clickAggregateActionButton(page, '取消', signal).catch(() => false);
    return false;
  }
  await clickAggregateActionButton(page, '确认', signal);
  return true;
}

async function clickBuyinMainCategoryFilter(page, categoryLabel, option, parentLabel, signal) {
  const opened = await clickQuickFilterButtonExact(page, categoryLabel, signal)
    || await clickQuickFilterRowOption(page, '主推类目', categoryLabel, signal);
  if (!opened) {
    return false;
  }

  if (parentLabel) {
    await hoverVisibleLayerOptionExact(page, parentLabel, signal);
  }
  const targetOption = option && option !== categoryLabel ? option : '全部';
  const selected = await clickVisibleLayerOptionExact(page, targetOption, signal)
    || await clickVisiblePopupOption(page, targetOption, signal);
  await withAbort(signal, page.keyboard.press('Escape').catch(() => {}));
  return Boolean(selected);
}

async function applyBuyinFilters(page, filters, log, signal) {
  const tokens = normalizeBuyinFilterTokens(filters);
  if (!tokens.length) {
    return;
  }

  log.info(`应用精选联盟筛选: ${tokens.length}项`);
  for (const token of tokens) {
    throwIfAborted(signal);
    const parts = token.split('/').map(normalizeText).filter(Boolean);
    if (parts.length < 4) {
      continue;
    }
    const last = parts[parts.length - 1];
    const mainCategoryLabel = parts[1] === '主推类目' && BUYIN_MAIN_CATEGORY_LABELS.has(parts[2])
      ? parts[2]
      : '';
    if (mainCategoryLabel) {
      const parentLabel = parts.length >= 5 ? parts[3] : '';
      const selected = await clickBuyinMainCategoryFilter(page, mainCategoryLabel, last, parentLabel, signal);
      if (!selected) {
        log.warn(`精选联盟主推类目选项未找到: ${mainCategoryLabel} -> ${last}`);
      }
      continue;
    }

    const isRange = /^[^-~]*~[^~]*$/.test(last) && parts.length >= 5;
    const isAggregate = !isRange && parts.length >= 5;
    const triggerLabel = isAggregate ? parts[parts.length - 3] : parts[parts.length - 2];
    const fieldLabel = isAggregate ? parts[parts.length - 2] : '';
    const option = isRange ? '' : last;

    if (isAggregate) {
      const selected = await clickAggregateFilterOption(page, triggerLabel, fieldLabel, option, signal);
      if (!selected) {
        log.warn(`精选联盟复合筛选选项未找到: ${triggerLabel} -> ${fieldLabel} -> ${option}`);
      }
      continue;
    }

    if (triggerLabel === '主推类目' || triggerLabel === '内容类型') {
      const selected = await clickQuickFilterRowOption(page, triggerLabel, option, signal);
      if (!selected) {
        log.warn(`精选联盟快捷筛选选项未找到: ${triggerLabel} -> ${option}`);
      }
      continue;
    }

    if (triggerLabel === '达人类型') {
      const selected = await clickBuyinRadioOption(page, option, signal);
      if (!selected) {
        log.warn(`精选联盟达人类型选项未找到: ${option}`);
      }
      continue;
    }

    if (triggerLabel === option) {
      const selected = await clickQuickFilterRowOption(page, parts[1] || '', option, signal);
      if (!selected) {
        log.warn(`精选联盟开关筛选未找到: ${option}`);
      }
      continue;
    }

    const opened = await clickQuickFilterButtonExact(page, triggerLabel, signal)
      || await clickVisibleTextControl(page, triggerLabel, signal);
    if (!opened) {
      log.warn(`未找到精选联盟筛选触发器: ${triggerLabel}`);
      continue;
    }

    if (isRange) {
      const [min = '', max = ''] = last.split('~');
      const filled = await fillVisiblePopupRange(page, min === '-' ? '' : min, max === '-' ? '' : max, signal);
      if (!filled) {
        log.warn(`精选联盟筛选区间填写失败: ${triggerLabel} -> ${last}`);
      }
      continue;
    }

    if (!option || option === '不限') {
      continue;
    }
    const selected = await clickVisibleLayerOptionExact(page, option, signal)
      || await clickVisiblePopupOption(page, option, signal);
    if (!selected) {
      log.warn(`精选联盟筛选选项未找到: ${triggerLabel} -> ${option}`);
    }
    await withAbort(signal, page.keyboard.press('Escape').catch(() => {}));
  }
  await withAbort(signal, page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}));
}

async function readResultSurfaceState(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const tableRows = Array.from(document.querySelectorAll('tbody tr, .semi-table-row, .byted-table-row, .ant-table-row'))
      .filter(visible);
    const cards = Array.from(document.querySelectorAll('[class*="author"], [class*="daren"], [class*="creator"], [class*="kol"]'))
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const text = clean(element.textContent);
        return rect.width >= 180 && rect.height >= 48 && text.length >= 6;
      });
    const sourceElements = tableRows.length ? tableRows : cards;
    const firstTexts = sourceElements
      .slice(0, 5)
      .map((element) => clean(element.innerText || element.textContent || ''))
      .filter(Boolean);
    const text = document.body ? document.body.innerText || '' : '';
    const empty = /暂无|无结果|没有找到|换个关键词|没有符合/.test(text);

    return {
      tableRows: tableRows.length,
      cards: cards.length,
      empty,
      signature: firstTexts.join('\n---\n'),
      firstTexts,
    };
  }).catch(() => ({
    tableRows: 0,
    cards: 0,
    empty: false,
    signature: '',
    firstTexts: [],
  }));
}

async function waitForResultSurface(page, timeout = 12000, signal, options = {}) {
  const deadline = Date.now() + timeout;
  const previousSignature = String(options.previousSignature || '');
  const requireRefresh = Boolean(options.requireRefresh && previousSignature);
  let lastState = null;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const state = await readResultSurfaceState(page);
    lastState = state;
    const hasSurface = state.tableRows > 0 || state.cards > 0 || state.empty;
    const refreshed = !requireRefresh || state.empty || (state.signature && state.signature !== previousSignature);
    if (hasSurface && refreshed) {
      return state;
    }
    await withAbort(signal, page.waitForTimeout(300));
  }
  return lastState;
}

async function extractPagination(page, fallbackPage = 1, fallbackPageSize = 20) {
  return page.evaluate(({ fallbackPage, fallbackPageSize }) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const text = clean(document.body ? document.body.innerText || '' : '');
    const currentCandidate = Array.from(document.querySelectorAll('[class*="pagination"] [class*="active"], [class*="Pagination"] [class*="active"], .active'))
      .map((element) => clean(element.textContent))
      .find((value) => /^\d+$/.test(value));
    const currentPage = Number.parseInt(currentCandidate || String(fallbackPage), 10) || fallbackPage;
    const pageNumbers = Array.from(text.matchAll(/(?:^|\D)(\d{1,4})(?=\D|$)/g))
      .map((match) => Number.parseInt(match[1], 10))
      .filter((value) => Number.isFinite(value) && value > 0 && value < 10000);
    const totalPages = Math.max(currentPage, ...pageNumbers.slice(-10), 1);

    return {
      currentPage,
      totalPages,
      pageSize: fallbackPageSize,
      estimatedTotal: Math.max(totalPages * fallbackPageSize, fallbackPageSize),
      hasPrev: currentPage > 1,
      hasNext: currentPage < totalPages,
      visiblePages: Array.from(new Set(pageNumbers.filter((value) => value <= totalPages))).slice(0, 10),
      showQuickJumper: false,
    };
  }, { fallbackPage, fallbackPageSize }).catch(() => ({
    currentPage: fallbackPage,
    totalPages: fallbackPage,
    pageSize: fallbackPageSize,
    estimatedTotal: fallbackPageSize,
    hasPrev: fallbackPage > 1,
    hasNext: false,
    visiblePages: [fallbackPage],
    showQuickJumper: false,
  }));
}

async function resetResultScrollToTop(page, signal) {
  await page.evaluate(async () => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const pause = (ms) => new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
    const scrollables = Array.from(document.querySelectorAll('*'))
      .filter((element) => {
        if (!(element instanceof HTMLElement) || !visible(element)) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const overflowY = style.overflowY || '';
        return element.scrollHeight > element.clientHeight + 20 && /(auto|scroll|overlay)/.test(overflowY);
      })
      .map((element) => ({
        element,
        area: element.clientWidth * element.clientHeight,
        rowCount: element.querySelectorAll('tbody tr, .semi-table-row, .byted-table-row, .ant-table-row, [class*="author"], [class*="daren"], [class*="creator"], [class*="kol"]').length,
      }))
      .filter((item) => item.rowCount > 0)
      .sort((left, right) => (right.rowCount - left.rowCount) || (right.area - left.area));

    const targets = scrollables.length ? scrollables.slice(0, 3).map((item) => item.element) : [document.scrollingElement || document.documentElement];
    for (const target of targets) {
      target.scrollTop = 0;
      target.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    window.scrollTo({ top: 0, left: window.scrollX });
    await pause(300);
  }).catch(() => {});
  throwIfAborted(signal);
  await withAbort(signal, page.waitForTimeout(200));
}

async function hydrateVisibleResultImages(page, signal) {
  await page.evaluate(async () => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const pause = (ms) => new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
    const waitForImages = async (element) => {
      const images = Array.from(element.querySelectorAll('img'))
        .filter((image) => image instanceof HTMLImageElement);
      if (!images.length) {
        return;
      }
      await Promise.race([
        Promise.all(images.map((image) => {
          if (image.complete && image.naturalWidth > 0) {
            return Promise.resolve();
          }
          return new Promise((resolve) => {
            const done = () => resolve();
            image.addEventListener('load', done, { once: true });
            image.addEventListener('error', done, { once: true });
            window.setTimeout(done, 300);
          });
        })),
        pause(350),
      ]);
    };

    const rowElements = Array.from(document.querySelectorAll('tbody tr, .semi-table-row, .byted-table-row, .ant-table-row'))
      .filter(visible);
    const cardElements = Array.from(document.querySelectorAll('[class*="author"], [class*="daren"], [class*="creator"], [class*="kol"]'))
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const text = clean(element.textContent);
        return rect.width >= 180 && rect.height >= 48 && text.length >= 6;
      });
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
    const sourceElements = (rowElements.length ? rowElements : cardElements)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom >= 0 && rect.top <= viewportHeight;
      })
      .slice(0, 20);

    for (const element of sourceElements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      await pause(80);
      await waitForImages(element);
    }
  }).catch(() => {});
  throwIfAborted(signal);
  await withAbort(signal, page.waitForTimeout(200));
}

async function scrollResultViewportDown(page, signal) {
  const state = await page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const scrollables = Array.from(document.querySelectorAll('*'))
      .filter((element) => {
        if (!(element instanceof HTMLElement) || !visible(element)) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const overflowY = style.overflowY || '';
        return element.scrollHeight > element.clientHeight + 20 && /(auto|scroll|overlay)/.test(overflowY);
      })
      .map((element) => ({
        element,
        area: element.clientWidth * element.clientHeight,
        rowCount: element.querySelectorAll('tbody tr, .semi-table-row, .byted-table-row, .ant-table-row, [class*="author"], [class*="daren"], [class*="creator"], [class*="kol"]').length,
      }))
      .filter((item) => item.rowCount > 0)
      .sort((left, right) => (right.rowCount - left.rowCount) || (right.area - left.area));
    const target = scrollables[0]?.element || document.scrollingElement || document.documentElement;
    if (!(target instanceof Element)) {
      return { moved: false, scrollTop: 0, nextScrollTop: 0, maxScrollTop: 0 };
    }
    const before = target.scrollTop;
    const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    const step = Math.max(160, Math.floor((target.clientHeight || window.innerHeight || 600) * 0.75));
    target.scrollTop = Math.min(maxScrollTop, before + step);
    target.dispatchEvent(new Event('scroll', { bubbles: true }));
    return {
      moved: target.scrollTop > before + 2,
      scrollTop: before,
      nextScrollTop: target.scrollTop,
      maxScrollTop,
    };
  }).catch(() => ({ moved: false, scrollTop: 0, nextScrollTop: 0, maxScrollTop: 0 }));
  throwIfAborted(signal);
  await withAbort(signal, page.waitForTimeout(300));
  return state;
}

async function extractCreatorResults(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const firstHref = (element) => element.querySelector('a[href]')?.href || '';
    const normalizeUrl = (value) => {
      const text = clean(value);
      if (!text || /^data:/i.test(text) || /^blob:/i.test(text)) {
        return '';
      }
      try {
        return new URL(text, window.location.href).toString();
      } catch {
        return text;
      }
    };
    const firstSrcsetUrl = (value) => {
      const first = clean(value).split(',').map(clean).filter(Boolean)[0] || '';
      return first.split(/\s+/)[0] || '';
    };
    const backgroundImageUrl = (element) => {
      const background = window.getComputedStyle(element).backgroundImage || '';
      const match = background.match(/url\((['"]?)(.*?)\1\)/);
      return match ? match[2] : '';
    };
    const imageUrl = (image) => {
      const candidates = [
        image.currentSrc,
        image.getAttribute('src'),
        firstSrcsetUrl(image.getAttribute('srcset')),
        image.getAttribute('data-src'),
        image.getAttribute('data-original'),
        image.getAttribute('data-lazy-src'),
        image.getAttribute('data-lazy'),
        image.getAttribute('data-url'),
        firstSrcsetUrl(image.getAttribute('data-srcset')),
      ];
      return candidates.map(normalizeUrl).find(Boolean) || '';
    };
    const findNameElement = (element, name) => {
      if (!name) {
        return null;
      }
      const candidates = Array.from(element.querySelectorAll('a[href], span, div, p'))
        .filter((candidate) => candidate instanceof HTMLElement && visible(candidate))
        .map((candidate) => {
          const text = clean(candidate.textContent);
          const rect = candidate.getBoundingClientRect();
          const exact = text === name;
          const includes = text.includes(name);
          const area = rect.width * rect.height;
          return {
            candidate,
            score: (exact ? 2000 : includes ? 1000 : 0) - Math.max(area, 0) / 100,
          };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score);
      return candidates[0]?.candidate || null;
    };
    const imageScore = (image, nameElement, root) => {
      if (!(image instanceof HTMLImageElement) || !visible(image)) {
        return Number.NEGATIVE_INFINITY;
      }
      const url = imageUrl(image);
      if (!url) {
        return Number.NEGATIVE_INFINITY;
      }
      const rect = image.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const squareness = Math.abs(rect.width - rect.height);
      let score = 0;

      if (size >= 24 && size <= 96) {
        score += 500;
      } else if (size < 16 || size > 140) {
        score -= 500;
      }
      score -= squareness * 4;
      if (rect.left < rootRect.left + Math.max(rootRect.width * 0.45, 160)) {
        score += 120;
      }

      if (nameElement instanceof HTMLElement) {
        const nameRect = nameElement.getBoundingClientRect();
        const sameRow = rect.bottom >= nameRect.top - 12 && rect.top <= nameRect.bottom + 12;
        const leftOfName = rect.right <= nameRect.right;
        const distance = Math.abs((rect.left + rect.right) / 2 - nameRect.left)
          + Math.abs((rect.top + rect.bottom) / 2 - (nameRect.top + nameRect.bottom) / 2);
        if (sameRow) {
          score += 800;
        }
        if (leftOfName) {
          score += 250;
        }
        score -= distance;
      }

      return score;
    };
    const firstImage = (element, name) => {
      const nameElement = findNameElement(element, name);
      const searchRoots = [];
      if (nameElement instanceof HTMLElement) {
        let current = nameElement;
        while (current && current !== element.parentElement && searchRoots.length < 4) {
          searchRoots.push(current);
          current = current.parentElement;
        }
      }
      searchRoots.push(element);

      const scoredImages = [];
      for (const root of searchRoots) {
        if (!(root instanceof HTMLElement)) {
          continue;
        }
        for (const image of Array.from(root.querySelectorAll('img'))) {
          scoredImages.push({
            url: imageUrl(image),
            score: imageScore(image, nameElement, element),
          });
        }
      }

      const best = scoredImages
        .filter((item) => item.url && Number.isFinite(item.score))
        .sort((left, right) => right.score - left.score)[0];
      if (best?.url) {
        return best.url;
      }

      const images = Array.from(element.querySelectorAll('img'));
      for (const image of images) {
        const url = imageUrl(image);
        if (url) {
          return url;
        }
      }

      const backgroundElements = [element, ...Array.from(element.querySelectorAll('*'))];
      for (const backgroundElement of backgroundElements) {
        const url = normalizeUrl(backgroundImageUrl(backgroundElement));
        if (url) {
          return url;
        }
      }
      return '';
    };
    const lineParts = (text) => clean(text).split(/ (?=[\u4e00-\u9fa5A-Za-z0-9￥¥])/).map(clean).filter(Boolean);
    const inferName = (element, parts) => {
      const linkText = clean(element.querySelector('a[href]')?.textContent);
      if (linkText && linkText.length <= 40 && !/查看|合作|邀约|详情|搜索/.test(linkText)) {
        return linkText;
      }
      return parts.find((part) => part.length >= 2 && part.length <= 40 && !/达人广场|精选联盟|查看|合作|邀约|详情|粉丝|销量|佣金|报价/.test(part)) || '';
    };
    const inferPrice = (parts) => parts.find((part) => /[￥¥]\s*\d|报价|佣金/.test(part)) || '';

    const rowElements = Array.from(document.querySelectorAll('tbody tr, .semi-table-row, .byted-table-row, .ant-table-row'))
      .filter(visible);
    const cardElements = Array.from(document.querySelectorAll('[class*="author"], [class*="daren"], [class*="creator"], [class*="kol"]'))
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const text = clean(element.textContent);
        return rect.width >= 180 && rect.height >= 48 && text.length >= 6;
      })
      .filter((element, _index, elements) => {
        const nestedResult = elements.some((other) => {
          if (other === element || !element.contains(other)) {
            return false;
          }
          const rect = other.getBoundingClientRect();
          const text = clean(other.textContent);
          return rect.width >= 160 && rect.height >= 42 && text.length >= 6;
        });
        return !nestedResult;
      });

    const sourceElements = rowElements.length ? rowElements : cardElements;
    const seen = new Set();
    const results = [];

    for (const element of sourceElements) {
      const text = clean(element.innerText || element.textContent || '');
      if (!text || /暂无|无结果|没有找到/.test(text)) {
        continue;
      }
      const parts = lineParts(text);
      const name = inferName(element, parts);
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      results.push({
        name,
        summary: text,
        href: firstHref(element),
        avatarUrl: firstImage(element, name),
        creatorType: parts.find((part) => /达人|作者|主播|店铺/.test(part) && part !== name) || '',
        contentTopic: '',
        contentTopics: [],
        connectedUsers: parts.find((part) => /粉丝|人气|用户/.test(part)) || '',
        quote21To60s: inferPrice(parts),
        operationText: parts.find((part) => /查看|合作|邀约|联系|详情/.test(part)) || '',
        operationLabel: '查看',
      });
      if (results.length >= 20) {
        break;
      }
    }

    const avatarCounts = new Map();
    for (const result of results) {
      if (!result.avatarUrl) {
        continue;
      }
      avatarCounts.set(result.avatarUrl, (avatarCounts.get(result.avatarUrl) || 0) + 1);
    }
    for (const result of results) {
      if (result.avatarUrl && avatarCounts.get(result.avatarUrl) > 1) {
        result.avatarUrl = '';
      }
    }

    return {
      results,
      diagnostics: {
        reason: results.length ? 'generic_buyin_rows' : 'empty_generic_buyin_rows',
        rowCount: rowElements.length,
        cardCount: cardElements.length,
        firstRows: results.slice(0, 3),
      },
    };
  });
}

async function collectCreatorResultsWithVirtualScroll(page, signal, options = {}) {
  const limit = normalizePositiveInt(options.limit, 20);
  const results = [];
  const seen = new Set();
  let diagnostics = null;
  let staleRounds = 0;

  await resetResultScrollToTop(page, signal);
  await waitForResultSurface(page, 5000, signal);

  for (let round = 0; round < 8 && results.length < limit; round += 1) {
    await hydrateVisibleResultImages(page, signal);
    const table = await extractCreatorResults(page);
    diagnostics = table.diagnostics || diagnostics;
    let added = 0;

    for (const item of table.results || []) {
      const key = normalizeText(item.name) || normalizeText(item.href) || normalizeText(item.summary);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      results.push({ ...item });
      added += 1;
      if (results.length >= limit) {
        break;
      }
    }

    if (results.length >= limit) {
      break;
    }

    if (added === 0) {
      staleRounds += 1;
    } else {
      staleRounds = 0;
    }

    const scrollState = await scrollResultViewportDown(page, signal);
    if (!scrollState.moved || staleRounds >= 2) {
      break;
    }
  }

  const avatarCounts = new Map();
  for (const result of results) {
    if (!result.avatarUrl) {
      continue;
    }
    avatarCounts.set(result.avatarUrl, (avatarCounts.get(result.avatarUrl) || 0) + 1);
  }
  for (const result of results) {
    if (result.avatarUrl && avatarCounts.get(result.avatarUrl) > 1) {
      result.avatarUrl = '';
    }
  }

  await resetResultScrollToTop(page, signal);

  return {
    results: results.slice(0, limit),
    diagnostics: {
      ...(diagnostics || {}),
      reason: results.length ? 'buyin_virtual_scroll_rows' : (diagnostics?.reason || 'empty_buyin_virtual_scroll_rows'),
      collectedCount: results.length,
    },
  };
}

async function collectCurrentCreatorResultsPage(ctx, options = {}) {
  const signal = ctx && ctx.task ? ctx.task.signal : null;
  ctx.log.info('复用当前精选联盟达人广场结果页');
  await openDarenSquare(ctx.page, signal);
  const targetPage = normalizePositiveInt(options.page, 1);
  await waitForResultSurface(ctx.page, 12000, signal);
  const table = await collectCreatorResultsWithVirtualScroll(ctx.page, signal, { limit: 20 });
  if (!table.results.length) {
    throw new Error('当前精选联盟页面暂无可展示的达人结果');
  }
  return {
    results: table.results,
    diagnostics: table.diagnostics,
    pagination: await extractPagination(ctx.page, targetPage, Math.max(table.results.length, 20)),
  };
}

async function searchCreators(ctx, keyword, filters, options = {}) {
  const signal = ctx && ctx.task ? ctx.task.signal : null;
  throwIfAborted(signal);
  ctx.log.info('打开精选联盟达人广场');
  await openDarenSquare(ctx.page, signal);

  await applyBuyinFilters(ctx.page, filters, ctx.log, signal);

  throwIfAborted(signal);
  ctx.log.info(`输入达人关键词: ${keyword}`);
  const searchInput = await findSearchInput(ctx.page);
  const previousKeyword = normalizeText(await searchInput.inputValue().catch(() => ''));
  const previousResultState = await readResultSurfaceState(ctx.page);
  await withAbort(signal, searchInput.click());
  await withAbort(signal, searchInput.fill(keyword));

  throwIfAborted(signal);
  const refreshOptions = {
    previousSignature: previousResultState.signature,
    requireRefresh: Boolean(previousResultState.signature && previousKeyword !== keyword),
  };
  const triggerStrategies = refreshOptions.requireRefresh
    ? ['near', 'global', 'enter', 'coordinate']
    : ['near'];
  let resultState = null;
  let refreshed = false;

  for (let index = 0; index < triggerStrategies.length; index += 1) {
    const strategy = triggerStrategies[index];
    throwIfAborted(signal);
    ctx.log.info(`触发精选联盟达人搜索: ${strategy}`);
    const triggerMethod = await triggerSearch(ctx.page, searchInput, signal, strategy);
    ctx.log.info(`精选联盟搜索触发方式: ${triggerMethod}`);
    await withAbort(signal, ctx.page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {}));
    resultState = await waitForResultSurface(ctx.page, index === triggerStrategies.length - 1 ? 12000 : 3500, signal, refreshOptions);
    refreshed = !refreshOptions.requireRefresh
      || Boolean(resultState?.empty)
      || Boolean(resultState?.signature && resultState.signature !== previousResultState.signature);
    if (refreshed) {
      break;
    }
    ctx.log.warn(`精选联盟搜索结果未刷新，继续尝试下一种触发方式: ${strategy}`);
  }

  if (refreshOptions.requireRefresh && !refreshed) {
    throw new Error('精选联盟搜索结果未刷新，请确认页面已完成搜索后重试');
  }
  await withAbort(signal, ctx.page.waitForTimeout(800));

  const targetPage = normalizePositiveInt(options.page, 1);
  const table = await collectCreatorResultsWithVirtualScroll(ctx.page, signal, { limit: 20 });
  if (table.results.length) {
    return {
      results: table.results,
      diagnostics: table.diagnostics,
      pagination: await extractPagination(ctx.page, targetPage, Math.max(table.results.length, 20)),
    };
  }

  throw new Error('当前精选联盟搜索暂无结果，请调整关键词后重试');
}

module.exports = {
  DAREN_SQUARE_URL,
  collectCurrentCreatorResultsPage,
  searchCreators,
};
