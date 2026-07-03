'use strict';

function clickPrivateMessageEntryInPage() {
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden';
  };

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const labels = Array.from(document.querySelectorAll('span.semi-button-content'));
  const label = labels.find((node) => (
    node instanceof HTMLElement
    && isVisible(node)
    && normalizeText(node.innerText || node.textContent || '') === '私信'
  ));

  if (!(label instanceof HTMLElement)) {
    return { ok: false, text: '', selector: 'span.semi-button-content' };
  }

  label.scrollIntoView({ block: 'center', inline: 'center' });
  label.click();
  return {
    ok: true,
    text: normalizeText(label.innerText || label.textContent || ''),
    selector: 'span.semi-button-content',
    className: label.className || '',
    tagName: label.tagName,
  };
}

function readMessageUiStateInPage(composerSelector) {
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden';
  };

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const labels = Array.from(document.querySelectorAll('span.semi-button-content'));
  const entryVisible = labels.some((node) => (
    node instanceof HTMLElement
    && isVisible(node)
    && normalizeText(node.innerText || node.textContent || '') === '私信'
  ));

  const composer = document.querySelector(composerSelector);
  const composerVisible = composer instanceof HTMLElement && isVisible(composer);

  const sendButton = document.querySelector('.e2e-send-msg-btn');
  const sendVisible = sendButton instanceof HTMLElement && isVisible(sendButton);

  return {
    entryVisible,
    composerVisible,
    sendVisible,
  };
}

function hasVisibleElementForSelectorInPage(selector) {
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden';
  };

  const candidates = Array.from(document.querySelectorAll(selector));
  return candidates.some((candidate) => candidate instanceof HTMLElement && isVisible(candidate));
}

function focusMessageComposerInPage(selector) {
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden';
  };

  const candidates = Array.from(document.querySelectorAll(selector));
  const target = candidates.find((candidate) => candidate instanceof HTMLElement && isVisible(candidate));
  if (!(target instanceof HTMLElement)) {
    return { ok: false, selector: '', kind: '' };
  }

  target.scrollIntoView({ block: 'center', inline: 'nearest' });
  target.click();
  target.focus();
  if (target.isContentEditable) {
    const selection = window.getSelection?.();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  return {
    ok: true,
    selector,
    kind: target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? 'input' : 'contenteditable',
  };
}

function readMessageComposerTextInPage(selector) {
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden';
  };

  const target = document.querySelector(selector);
  if (!(target instanceof HTMLElement) || !isVisible(target)) {
    return '';
  }

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return normalizeText(target.value);
  }

  return normalizeText(target.innerText || target.textContent || '');
}

function hasAnyMessageComposerContentInPage(selector) {
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden';
  };

  const target = document.querySelector(selector);
  if (!(target instanceof HTMLElement) || !isVisible(target)) {
    return false;
  }

  const rawText = String(target.innerText || target.textContent || '');
  const normalizedText = rawText
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .trim();
  return Boolean(normalizedText);
}

function setMessageComposerContentInPage(payload) {
  const { selector, message } = payload;
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden';
  };

  const target = document.querySelector(selector);
  if (!(target instanceof HTMLElement) || !isVisible(target)) {
    return { ok: false, selector: '', kind: '' };
  }

  target.focus();
  target.textContent = message;
  target.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    data: message,
    inputType: 'insertText',
  }));
  target.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    data: message,
    inputType: 'insertText',
  }));
  return { ok: true, selector, kind: 'contenteditable' };
}

function clickSendButtonInPage() {
  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const button = document.querySelector('.e2e-send-msg-btn');
  if (!(button instanceof HTMLElement)) {
    return { ok: false, text: '' };
  }

  button.click();
  return {
    ok: true,
    text: normalizeText(button.innerText || button.textContent || ''),
  };
}

module.exports = {
  clickPrivateMessageEntryInPage,
  clickSendButtonInPage,
  focusMessageComposerInPage,
  hasAnyMessageComposerContentInPage,
  hasVisibleElementForSelectorInPage,
  readMessageComposerTextInPage,
  readMessageUiStateInPage,
  setMessageComposerContentInPage,
};
