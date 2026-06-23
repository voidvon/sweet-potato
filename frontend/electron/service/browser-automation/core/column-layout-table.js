'use strict';

async function extractColumnLayoutTable(page, options) {
  return page.evaluate((input) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function compact(value) {
      return clean(value).replace(/\s/g, '');
    }

    function visible(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 4 && rect.height > 4 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function textLines(value) {
      return String(value || '').split('\n').map(clean).filter(Boolean);
    }

    function rectContains(parent, child) {
      return child.left >= parent.left - 1
        && child.right <= parent.right + 1
        && child.top >= parent.top - 1
        && child.bottom <= parent.bottom + 1;
    }

    function elementHref(element) {
      const anchor = element.closest('a[href]') || element.querySelector?.('a[href]');
      const href = anchor?.getAttribute('href') || '';
      return href ? new URL(href, window.location.href).toString() : '';
    }

    function isHeaderText(value) {
      const key = compact(value).replace(/[：:]/g, '').toLowerCase();
      return input.columns.some((column) => key.includes(compact(column.label).toLowerCase()));
    }

    function meaningfulCellText(value) {
      const text = clean(value);
      if (!text || isHeaderText(text)) {
        return false;
      }
      if (input.excludeTextPattern && new RegExp(input.excludeTextPattern).test(text)) {
        return false;
      }
      return text.length <= (input.maxCellTextLength || 260);
    }

    function findHeader(label) {
      const expected = compact(label);
      const elements = Array.from(document.querySelectorAll('body *')).filter((element) => {
        if (!(element instanceof HTMLElement) || !visible(element)) {
          return false;
        }
        const key = compact(element.innerText);
        return key === expected || key.includes(expected);
      });

      elements.sort((left, right) => {
        const leftText = compact(left.innerText);
        const rightText = compact(right.innerText);
        const leftExact = leftText === expected ? 0 : 1;
        const rightExact = rightText === expected ? 0 : 1;
        if (leftExact !== rightExact) {
          return leftExact - rightExact;
        }
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
      });

      return elements[0] || null;
    }

    function collectTextBlocks(columns, headerBottom) {
      const left = Math.min(...columns.map((column) => column.left));
      const right = Math.max(...columns.map((column) => column.right));
      const blocks = [];

      for (const element of Array.from(document.querySelectorAll('body *'))) {
        if (!(element instanceof HTMLElement) || !visible(element)) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        if (rect.bottom <= headerBottom + 2 || rect.right < left || rect.left > right) {
          continue;
        }

        const text = clean(element.innerText);
        if (!meaningfulCellText(text)) {
          continue;
        }

        const visibleTextChildren = Array.from(element.children).filter((child) => (
          child instanceof HTMLElement
          && visible(child)
          && clean(child.innerText)
          && rectContains(rect, child.getBoundingClientRect())
        ));
        const hasSameTextChild = visibleTextChildren.some((child) => clean(child.innerText) === text);
        const hasMultipleTextChildren = visibleTextChildren.length > 1;
        if (hasSameTextChild || hasMultipleTextChildren) {
          continue;
        }

        let bestColumnIndex = -1;
        let bestOverlap = 0;
        for (let index = 0; index < columns.length; index += 1) {
          const column = columns[index];
          const overlap = Math.min(rect.right, column.right) - Math.max(rect.left, column.left);
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestColumnIndex = index;
          }
        }
        if (bestColumnIndex < 0 || bestOverlap <= 0) {
          continue;
        }

        blocks.push({
          columnIndex: bestColumnIndex,
          text,
          lines: textLines(element.innerText),
          href: elementHref(element),
          top: rect.top,
          bottom: rect.bottom,
          centerY: rect.top + rect.height / 2,
          left: rect.left,
          right: rect.right,
        });
      }

      const seen = new Set();
      return blocks.filter((block) => {
        const key = [block.columnIndex, Math.round(block.top), Math.round(block.left), block.text].join('|');
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    }

    function clusterCenters(blocks, threshold) {
      const centers = blocks.map((block) => block.centerY).filter(Number.isFinite).sort((left, right) => left - right);
      const clusters = [];

      for (const center of centers) {
        const last = clusters[clusters.length - 1];
        if (last && center - last.max <= threshold) {
          last.values.push(center);
          last.max = Math.max(last.max, center);
          last.center = last.values.reduce((sum, value) => sum + value, 0) / last.values.length;
        } else {
          clusters.push({ values: [center], max: center, center });
        }
      }

      return clusters.map((cluster) => cluster.center);
    }

    const headers = input.columns
      .map((column) => {
        const element = findHeader(column.label);
        if (!element) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return {
          ...column,
          rect,
          centerX: rect.left + rect.width / 2,
          bottom: rect.bottom,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.centerX - right.centerX);

    if (headers.length < (input.minColumns || 2)) {
      return { rows: [], diagnostics: { headers, blocks: [], reason: 'missing_headers' } };
    }

    const pageWidth = document.documentElement.clientWidth || window.innerWidth;
    const columns = headers.map((header, index) => {
      const previous = headers[index - 1];
      const next = headers[index + 1];
      const left = previous ? (previous.centerX + header.centerX) / 2 : Math.max(0, header.rect.left - (input.firstColumnLeftPadding || 80));
      const right = next ? (header.centerX + next.centerX) / 2 : Math.min(pageWidth, header.rect.right + (input.lastColumnRightPadding || 120));
      return { ...header, left, right };
    });

    const headerBottom = Math.max(...columns.map((column) => column.bottom));
    const blocks = collectTextBlocks(columns, headerBottom);
    if (!blocks.length) {
      return { rows: [], diagnostics: { headers: columns, blocks, reason: 'missing_blocks' } };
    }

    const anchorIndexes = (input.rowAnchorKeys || [])
      .map((key) => columns.findIndex((column) => column.key === key))
      .filter((index) => index >= 0);
    const anchorBlocks = blocks.filter((block) => anchorIndexes.includes(block.columnIndex));
    let rowCenters = clusterCenters(
      anchorBlocks.length >= 2 ? anchorBlocks : blocks,
      anchorBlocks.length >= 2 ? (input.anchorRowThreshold || 42) : (input.rowThreshold || 68),
    );
    rowCenters = rowCenters.filter((center) => {
      const rowBlocks = blocks.filter((block) => Math.abs(block.centerY - center) <= (input.rowCenterTolerance || 54));
      return new Set(rowBlocks.map((block) => block.columnIndex)).size >= (input.minCellsPerRow || 2);
    });

    const rows = [];
    for (let rowIndex = 0; rowIndex < rowCenters.length; rowIndex += 1) {
      const previous = rowCenters[rowIndex - 1];
      const current = rowCenters[rowIndex];
      const next = rowCenters[rowIndex + 1];
      const top = previous ? (previous + current) / 2 : current - (input.firstRowPadding || 80);
      const bottom = next ? (current + next) / 2 : current + (input.lastRowPadding || 80);
      const rowBlocks = blocks.filter((block) => block.centerY >= top && block.centerY < bottom);
      if (new Set(rowBlocks.map((block) => block.columnIndex)).size < (input.minCellsPerRow || 2)) {
        continue;
      }

      const row = {};
      const hrefs = [];
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        const column = columns[columnIndex];
        const values = [];
        const seenValues = new Set();
        const columnBlocks = rowBlocks
          .filter((block) => block.columnIndex === columnIndex)
          .sort((leftBlock, rightBlock) => leftBlock.top - rightBlock.top || leftBlock.left - rightBlock.left);

        for (const block of columnBlocks) {
          if (block.href) {
            hrefs.push(block.href);
          }
          const candidates = block.lines.length ? block.lines : [block.text];
          for (const candidate of candidates) {
            const value = clean(candidate);
            if (!meaningfulCellText(value) || seenValues.has(value)) {
              continue;
            }
            seenValues.add(value);
            values.push(value);
          }
        }
        row[column.key] = values.join(input.valueSeparator || ' / ');
      }
      row.href = hrefs.find(Boolean) || '';
      rows.push(row);
      if (rows.length >= (input.maxRows || 20)) {
        break;
      }
    }

    return {
      rows,
      diagnostics: {
        headers: columns.map((column) => ({
          key: column.key,
          label: column.label,
          left: Math.round(column.left),
          right: Math.round(column.right),
          centerX: Math.round(column.centerX),
          bottom: Math.round(column.bottom),
        })),
        blocks: blocks.slice(0, 300).map((block) => ({
          columnIndex: block.columnIndex,
          text: block.text,
          top: Math.round(block.top),
          left: Math.round(block.left),
          centerY: Math.round(block.centerY),
        })),
        rowCenters: rowCenters.map((center) => Math.round(center)),
      },
    };
  }, {
    columns: options.columns,
    minColumns: options.minColumns,
    minCellsPerRow: options.minCellsPerRow,
    maxRows: options.maxRows,
    maxCellTextLength: options.maxCellTextLength,
    excludeTextPattern: options.excludeTextPattern,
    rowAnchorKeys: options.rowAnchorKeys,
    anchorRowThreshold: options.anchorRowThreshold,
    rowThreshold: options.rowThreshold,
    rowCenterTolerance: options.rowCenterTolerance,
    firstColumnLeftPadding: options.firstColumnLeftPadding,
    lastColumnRightPadding: options.lastColumnRightPadding,
    firstRowPadding: options.firstRowPadding,
    lastRowPadding: options.lastRowPadding,
    valueSeparator: options.valueSeparator,
  });
}

module.exports = {
  extractColumnLayoutTable,
};
