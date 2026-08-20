#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src');
const apply = process.argv.includes('--apply');
const chinesePattern = /[\u3400-\u9fff]/;

const uiProperties = new Set([
  'accountLabel', 'alt', 'ariaLabel', 'brandContext', 'brandName', 'cancelText', 'children',
  'content', 'description', 'emptyText', 'eyebrow', 'help', 'label', 'message', 'name', 'okText',
  'panelDescription', 'panelEyebrow', 'panelTitle', 'placeholder', 'subtitle', 'text', 'title',
  'tooltip',
]);
const ignoredAttributes = new Set([
  'autoComplete', 'className', 'danger', 'dependencies', 'htmlFor', 'htmlType', 'href', 'id',
  'key', 'method', 'name', 'path', 'role', 'src', 'status', 'target', 'to', 'type', 'value',
]);
const machineProperties = new Set([
  'action', 'code', 'contentType', 'dataIndex', 'fieldKey', 'fullPath', 'id', 'key', 'kind',
  'mediaKind', 'method', 'mimeType', 'mode', 'name', 'opcode', 'path', 'permissionCode', 'phase',
  'platform', 'resourceKey', 'resourceType', 'role', 'source', 'status', 'target', 'type', 'url', 'value',
]);
const machineVariables = /(^|_)(code|id|key|kind|method|mode|path|role|status|type|url|value)s?$/i;

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(absolute);
    return /\.(ts|tsx)$/.test(entry.name) && !absolute.includes(`${path.sep}i18n${path.sep}`) ? [absolute] : [];
  });
}

function propertyName(node) {
  if (!node) return '';
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return '';
}

function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return `${calleeName(expression.expression)}.${expression.name.text}`;
  return '';
}

function isUiCall(call) {
  const name = calleeName(call.expression);
  return /^(message|notification|Modal)\./.test(name)
    || /^(setError|setErrorMessage|setNotice|setWarning|setStatusText)$/.test(name)
    || name === 'Error';
}

function isDisplayContext(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isJsxAttribute(parent)) {
      return !ignoredAttributes.has(parent.name.getText());
    }
    if (ts.isJsxExpression(parent) || ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) {
      return true;
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
      const name = propertyName(parent.name);
      return uiProperties.has(name) || !machineProperties.has(name);
    }
    if (ts.isCallExpression(parent) && parent.arguments.includes(current)) {
      return isUiCall(parent);
    }
    if (ts.isNewExpression(parent) && parent.arguments?.includes(current)) {
      return calleeName(parent.expression) === 'Error';
    }
    if (ts.isVariableDeclaration(parent)) {
      const name = propertyName(parent.name);
      return !machineVariables.test(name);
    }
    if (ts.isBinaryExpression(parent)
      && (parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        || parent.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
      return false;
    }
    if (ts.isReturnStatement(parent)) return true;
    if (ts.isArrowFunction(parent) && parent.body === current) return true;
    if (ts.isLiteralTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return false;
    if (ts.isStatement(parent) || ts.isSourceFile(parent)) return false;
    current = parent;
  }
  return false;
}

function templateReplacement(node, sourceFile) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { key: node.text, replacement: `t(${JSON.stringify(node.text)})` };
  }
  if (!ts.isTemplateExpression(node)) return null;
  let key = node.head.text;
  const values = [];
  node.templateSpans.forEach((span, index) => {
    key += `{{${index}}}${span.literal.text}`;
    values.push(`${JSON.stringify(String(index))}: ${span.expression.getText(sourceFile)}`);
  });
  return { key, replacement: `t(${JSON.stringify(key)}, { ${values.join(', ')} })` };
}

function migrateFile(filename, keys) {
  const source = fs.readFileSync(filename, 'utf8');
  const kind = filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, kind);
  const edits = [];

  function visit(node) {
    if (ts.isJsxText(node) && chinesePattern.test(node.text)) {
      const raw = node.getText(sourceFile);
      const leading = raw.match(/^\s*/)?.[0] || '';
      const trailing = raw.match(/\s*$/)?.[0] || '';
      const key = raw.trim().replace(/\s+/g, ' ');
      if (key) {
        keys.add(key);
        edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: `${leading}{t(${JSON.stringify(key)})}${trailing}` });
      }
      return;
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node))
      && chinesePattern.test(node.getText(sourceFile))
      && isDisplayContext(node)) {
      const result = templateReplacement(node, sourceFile);
      if (result) {
        keys.add(result.key);
        if (ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent)) {
          edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: `{${result.replacement}}` });
        } else {
          edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: result.replacement });
        }
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (!edits.length) return;
  if (!/import\s+\{[^}]*\bt\b[^}]*\}\s+from\s+['\"][^'\"]*i18n['\"]/.test(source)) {
    const imports = sourceFile.statements.filter(ts.isImportDeclaration);
    const position = imports.length ? imports[imports.length - 1].getEnd() : 0;
    edits.push({ start: position, end: position, text: "\nimport { t } from '@shared/i18n';" });
  }
  edits.sort((left, right) => right.start - left.start);
  let output = source;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  if (apply) fs.writeFileSync(filename, output);
}

const keys = new Set();
for (const filename of walkFiles(sourceRoot)) migrateFile(filename, keys);
process.stdout.write(`${JSON.stringify([...keys].sort(), null, 2)}\n`);
