#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourceRoot = path.resolve(__dirname, '../src');
const chinesePattern = /[\u3400-\u9fff]/;
const findings = [];
const machineProperties = new Set([
  'action', 'code', 'contentType', 'dataIndex', 'fieldKey', 'fullPath', 'id', 'key', 'kind',
  'mediaKind', 'method', 'mimeType', 'mode', 'name', 'path', 'permissionCode', 'phase', 'platform',
  'resourceKey', 'resourceType', 'role', 'source', 'status', 'target', 'type', 'url', 'value',
]);

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'i18n' ? [] : files(filename);
    return /\.(ts|tsx)$/.test(entry.name) ? [filename] : [];
  });
}

function isTranslationArgument(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isCallExpression(parent)
      && ts.isIdentifier(parent.expression)
      && parent.expression.text === 't'
      && parent.arguments.includes(current)) {
      return true;
    }
    if (ts.isStatement(parent) || ts.isSourceFile(parent)) return false;
    current = parent;
  }
  return false;
}

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : '';
}

function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return `${calleeName(expression.expression)}.${expression.name.text}`;
  return '';
}

function isDisplayContext(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isJsxAttribute(parent) || ts.isJsxElement(parent) || ts.isJsxExpression(parent)) return true;
    if (ts.isParameter(parent) && parent.initializer === current) return true;
    if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
      return !machineProperties.has(propertyName(parent.name));
    }
    if (ts.isCallExpression(parent) && parent.arguments.includes(current)) {
      const name = calleeName(parent.expression);
      return /^(message|notification|Modal)\./.test(name)
        || ['Error', 'confirm', 'getAssetName', 'nonNegativePriceValidator', 'tooltipEvents', 'window.confirm'].includes(name);
    }
    if (ts.isNewExpression(parent) && parent.arguments?.includes(current)) return calleeName(parent.expression) === 'Error';
    if (ts.isBinaryExpression(parent)) return false;
    if (ts.isVariableDeclaration(parent)) return !/(code|id|key|kind|mode|path|role|status|type|url|value)s?$/i.test(propertyName(parent.name));
    if (ts.isReturnStatement(parent)) return true;
    if (ts.isStatement(parent) || ts.isSourceFile(parent)) return false;
    current = parent;
  }
  return false;
}

for (const filename of files(sourceRoot)) {
  const source = fs.readFileSync(filename, 'utf8');
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    const isText = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateExpression(node) || ts.isJsxText(node);
    if (isText && chinesePattern.test(node.getText(sourceFile)) && !isTranslationArgument(node) && isDisplayContext(node)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      findings.push(`${path.relative(sourceRoot, filename)}:${position.line + 1}: ${node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 180)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

if (findings.length) {
  process.stdout.write(`${findings.join('\n')}\n`);
  process.stderr.write(`Found ${findings.length} Chinese UI literals outside t().\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('No Chinese UI literals outside t().\n');
}
