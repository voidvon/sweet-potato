'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = require('./douyin-open-search');

class FakeElement {
  constructor(tagName, options = {}) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    this._textContent = options.textContent || '';
    this._innerText = options.innerText || '';
    this.attributes = new Map(Object.entries(options.attributes || {}));
    this.src = options.src || '';
    this.href = options.href || '';
    this.style = options.style || {};
    this.className = options.className || '';
  }

  get textContent() {
    const childText = this.children.map((child) => child.textContent || '').join('');
    return `${this._textContent}${childText}`;
  }

  set textContent(value) {
    this._textContent = value || '';
  }

  get innerText() {
    const childText = this.children.map((child) => child.innerText || '').join(' ');
    return `${this._innerText || this._textContent}${childText ? ` ${childText}` : ''}`.trim();
  }

  set innerText(value) {
    this._innerText = value || '';
  }

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  getBoundingClientRect() {
    return { width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40 };
  }

  querySelector(selector) {
    const matches = this.querySelectorAll(selector);
    return matches[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  get nextElementSibling() {
    if (!this.parentElement) {
      return null;
    }
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] || null : null;
  }
}

class FakeHTMLElement extends FakeElement {}
class FakeHTMLAnchorElement extends FakeHTMLElement {}
class FakeHTMLImageElement extends FakeHTMLElement {}

class FakeDocument {
  constructor() {
    this.defaultView = {
      HTMLElement: FakeHTMLElement,
      HTMLAnchorElement: FakeHTMLAnchorElement,
      HTMLImageElement: FakeHTMLImageElement,
      getComputedStyle: (element) => ({
        visibility: element.style.visibility || 'visible',
        display: element.style.display || 'block',
      }),
    };
    this.body = new FakeHTMLElement('body');
    this.body.ownerDocument = this;
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }
}

function matchesSelector(element, selector) {
  const selectors = selector.split(',').map((item) => item.trim()).filter(Boolean);
  return selectors.some((item) => matchesSingleSelector(element, item));
}

function matchesSingleSelector(element, selector) {
  if (selector === '.search-result-card') {
    return element.className.split(/\s+/).includes('search-result-card');
  }
  if (selector === '[data-e2e="live-avatar"]') {
    return element.attributes.get('data-e2e') === 'live-avatar';
  }
  if (selector === 'img') {
    return element.tagName === 'IMG';
  }
  if (selector === 'a[href]') {
    return element.tagName === 'A' && Boolean(element.href);
  }
  if (selector === 'div' || selector === 'section' || selector === 'article' || selector === 'span') {
    return element.tagName === selector.toUpperCase();
  }
  return false;
}

function createElement(document, type, options = {}) {
  let element;
  if (type === 'a') {
    element = new FakeHTMLAnchorElement(type, options);
  } else if (type === 'img') {
    element = new FakeHTMLImageElement(type, options);
  } else {
    element = new FakeHTMLElement(type, options);
  }
  element.ownerDocument = document;
  return element;
}

function append(parent, child) {
  child.ownerDocument = parent.ownerDocument;
  parent.appendChild(child);
  return child;
}

test('builds douyin search url from keyword', () => {
  assert.equal(
    adapter.buildDouyinSearchUrl({ keyword: '\u7f8e\u5986 \u8fbe\u4eba' }),
    'https://www.douyin.com/search/%E7%BE%8E%E5%A6%86%20%E8%BE%BE%E4%BA%BA?type=user',
  );
});

test('falls back to douyin home when keyword is empty', () => {
  assert.equal(adapter.buildDouyinSearchUrl({ keyword: '   ' }), 'https://www.douyin.com/');
});

test('matches douyin pc urls', () => {
  assert.equal(adapter.isDouyinUrl('https://www.douyin.com/search/test'), true);
  assert.equal(adapter.isDouyinUrl('https://buyin.jinritemai.com/dashboard'), false);
});

test('extracts stats row from simple direct text spans', () => {
  const document = new FakeDocument();
  const card = append(document.body, createElement(document, 'div', { className: 'search-result-card' }));

  const row1 = append(card, createElement(document, 'div', { innerText: '\u8fbe\u4ebaA \u7f8e\u5986 \u4e3b\u9875' }));
  const avatarHost = append(row1, createElement(document, 'div', { attributes: { 'data-e2e': 'live-avatar' } }));
  append(avatarHost, createElement(document, 'img', { src: 'https://example.com/avatar-a.jpg' }));
  const info = append(row1, createElement(document, 'div'));
  append(info, createElement(document, 'div', { textContent: '\u8fbe\u4ebaA' }));
  append(info, createElement(document, 'div', { textContent: '\u7f8e\u5986' }));
  append(row1, createElement(document, 'a', { href: 'https://www.douyin.com/user/abc', textContent: '\u4e3b\u9875' }));

  const row2Wrapper = append(card, createElement(document, 'div'));
  const row2 = append(row2Wrapper, createElement(document, 'div', { className: 'jjebLXt0' }));
  append(row2, createElement(document, 'span', { textContent: '\u6296\u97f3\u53f7: Xvwenzhai', innerText: '\u6296\u97f3\u53f7: Xvwenzhai' }));
  append(row2, createElement(document, 'span', { className: 'KKCYD6Yv', textContent: '', innerText: '' }));
  append(row2, createElement(document, 'span', { textContent: '1993.9\u4e07\u83b7\u8d5e', innerText: '1993.9\u4e07\u83b7\u8d5e' }));
  append(row2, createElement(document, 'span', { className: 'KKCYD6Yv', textContent: '', innerText: '' }));
  append(row2, createElement(document, 'span', { textContent: '257.5\u4e07\u7c89\u4e1d', innerText: '257.5\u4e07\u7c89\u4e1d' }));

  const row3Wrapper = append(card, createElement(document, 'div'));
  append(row3Wrapper, createElement(document, 'div', {
    textContent: '\u4e13\u6ce8\u5267\u60c5\u89e3\u8bf4\u548c\u4eba\u7269\u6df7\u526a',
    innerText: '\u4e13\u6ce8\u5267\u60c5\u89e3\u8bf4\u548c\u4eba\u7269\u6df7\u526a',
  }));

  const results = adapter.extractStructuredResults(document);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    name: '\u8fbe\u4ebaA',
    href: 'https://www.douyin.com/user/abc',
    avatarUrl: 'https://example.com/avatar-a.jpg',
    creatorType: '\u7f8e\u5986',
    douyinId: '\u6296\u97f3\u53f7: Xvwenzhai',
    likeCount: '1993.9\u4e07\u83b7\u8d5e',
    followerCount: '257.5\u4e07\u7c89\u4e1d',
    intro: '\u4e13\u6ce8\u5267\u60c5\u89e3\u8bf4\u548c\u4eba\u7269\u6df7\u526a',
    summary: '\u4e13\u6ce8\u5267\u60c5\u89e3\u8bf4\u548c\u4eba\u7269\u6df7\u526a',
    badges: ['\u7f8e\u5986'],
    stats: ['\u6296\u97f3\u53f7: Xvwenzhai', '1993.9\u4e07\u83b7\u8d5e', '257.5\u4e07\u7c89\u4e1d'],
    operationLabel: '\u67e5\u770b\u4e3b\u9875',
  });
});

test('extracts stats row when douyin id is nested inside label span', () => {
  const document = new FakeDocument();
  const card = append(document.body, createElement(document, 'div', { className: 'search-result-card' }));

  const row1 = append(card, createElement(document, 'div', { innerText: '\u8fbe\u4ebaB \u77ed\u5267 \u4e3b\u9875' }));
  const avatarHost = append(row1, createElement(document, 'div', { attributes: { 'data-e2e': 'live-avatar' } }));
  append(avatarHost, createElement(document, 'img', { src: 'https://example.com/avatar-b.jpg' }));
  const info = append(row1, createElement(document, 'div'));
  append(info, createElement(document, 'div', { textContent: '\u8fbe\u4ebaB' }));
  append(info, createElement(document, 'div', { textContent: '\u77ed\u5267' }));
  append(row1, createElement(document, 'a', { href: 'https://www.douyin.com/user/xyz', textContent: '\u4e3b\u9875' }));

  const row2Wrapper = append(card, createElement(document, 'div'));
  const row2 = append(row2Wrapper, createElement(document, 'div', { className: 'jjebLXt0' }));
  const douyinIdHost = append(row2, createElement(document, 'span', { innerText: '\u6296\u97f3\u53f7: LJSH8866' }));
  append(douyinIdHost, createElement(document, 'span', { textContent: 'LJSH8866', innerText: 'LJSH8866' }));
  append(row2, createElement(document, 'span', { className: 'KKCYD6Yv', textContent: '', innerText: '' }));
  append(row2, createElement(document, 'span', { textContent: '8541.2\u4e07\u83b7\u8d5e', innerText: '8541.2\u4e07\u83b7\u8d5e' }));
  append(row2, createElement(document, 'span', { className: 'KKCYD6Yv', textContent: '', innerText: '' }));
  append(row2, createElement(document, 'span', { textContent: '617.0\u4e07\u7c89\u4e1d', innerText: '617.0\u4e07\u7c89\u4e1d' }));

  const row3Wrapper = append(card, createElement(document, 'div'));
  append(row3Wrapper, createElement(document, 'div', {
    textContent: '\u7b80\u4ecb\u793a\u4f8b',
    innerText: '\u7b80\u4ecb\u793a\u4f8b',
  }));

  const results = adapter.extractStructuredResults(document);
  assert.equal(results.length, 1);
  assert.equal(results[0].douyinId, '\u6296\u97f3\u53f7: LJSH8866');
  assert.equal(results[0].likeCount, '8541.2\u4e07\u83b7\u8d5e');
  assert.equal(results[0].followerCount, '617.0\u4e07\u7c89\u4e1d');
});

test('serialized extractor runs without outer-scope helpers', () => {
  const document = new FakeDocument();
  const card = append(document.body, createElement(document, 'div', { className: 'search-result-card' }));
  const row1 = append(card, createElement(document, 'div', { innerText: '\u8fbe\u4ebaC \u63a2\u5e97 \u4e3b\u9875' }));
  const avatarHost = append(row1, createElement(document, 'div', { attributes: { 'data-e2e': 'live-avatar' } }));
  append(avatarHost, createElement(document, 'img', { src: 'https://example.com/avatar-c.jpg' }));
  const info = append(row1, createElement(document, 'div'));
  append(info, createElement(document, 'div', { textContent: '\u8fbe\u4ebaC' }));
  append(info, createElement(document, 'div', { textContent: '\u63a2\u5e97' }));
  append(row1, createElement(document, 'a', { href: 'https://www.douyin.com/user/ccc', textContent: '\u4e3b\u9875' }));
  const row2Wrapper = append(card, createElement(document, 'div'));
  const row2 = append(row2Wrapper, createElement(document, 'div'));
  append(row2, createElement(document, 'span', { textContent: '\u6296\u97f3\u53f7: daren-c', innerText: '\u6296\u97f3\u53f7: daren-c' }));
  append(row2, createElement(document, 'span', { textContent: '5.4\u4e07\u83b7\u8d5e', innerText: '5.4\u4e07\u83b7\u8d5e' }));
  append(row2, createElement(document, 'span', { textContent: '3.1\u4e07\u7c89\u4e1d', innerText: '3.1\u4e07\u7c89\u4e1d' }));
  const row3Wrapper = append(card, createElement(document, 'div'));
  append(row3Wrapper, createElement(document, 'div', { textContent: '\u672c\u5730\u63a2\u5e97\u4e0e\u9910\u5385\u6d4b\u8bc4', innerText: '\u672c\u5730\u63a2\u5e97\u4e0e\u9910\u5385\u6d4b\u8bc4' }));

  // eslint-disable-next-line no-new-func
  const hydratedExtractor = new Function(`return (${adapter.extractStructuredResults.toString()});`)();
  const results = hydratedExtractor(document);

  assert.equal(results.length, 1);
  assert.equal(results[0].douyinId, '\u6296\u97f3\u53f7: daren-c');
  assert.equal(results[0].likeCount, '5.4\u4e07\u83b7\u8d5e');
  assert.equal(results[0].followerCount, '3.1\u4e07\u7c89\u4e1d');
});

test('extractStructuredResults respects the provided limit', () => {
  const document = new FakeDocument();

  for (let index = 0; index < 3; index += 1) {
    const card = append(document.body, createElement(document, 'div', { className: 'search-result-card' }));
    const row1 = append(card, createElement(document, 'div', { innerText: `达人${index} 美妆 主页` }));
    const avatarHost = append(row1, createElement(document, 'div', { attributes: { 'data-e2e': 'live-avatar' } }));
    append(avatarHost, createElement(document, 'img', { src: `https://example.com/avatar-${index}.jpg` }));
    const info = append(row1, createElement(document, 'div'));
    append(info, createElement(document, 'div', { textContent: `达人${index}` }));
    append(info, createElement(document, 'div', { textContent: '美妆' }));
    append(row1, createElement(document, 'a', { href: `https://www.douyin.com/user/${index}`, textContent: '主页' }));

    const row2 = append(append(card, createElement(document, 'div')), createElement(document, 'div'));
    append(row2, createElement(document, 'span', { textContent: `抖音号: user-${index}`, innerText: `抖音号: user-${index}` }));
    append(row2, createElement(document, 'span', { textContent: `${index + 1}万获赞`, innerText: `${index + 1}万获赞` }));
    append(row2, createElement(document, 'span', { textContent: `${index + 2}万粉丝`, innerText: `${index + 2}万粉丝` }));

    append(append(card, createElement(document, 'div')), createElement(document, 'div', {
      textContent: `简介${index}`,
      innerText: `简介${index}`,
    }));
  }

  const results = adapter.extractStructuredResults(document, { limit: 2 });
  assert.equal(results.length, 2);
  assert.equal(results[0].name, '达人0');
  assert.equal(results[1].name, '达人1');
});
