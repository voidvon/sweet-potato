'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const { dialog } = require('electron');

function sanitizeFileName(fileName) {
  return String(fileName || 'download')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'download';
}

function downloadToFile(url, targetPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadToFile(response.headers.location, targetPath).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`下载失败：${response.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(targetPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

class FileController {
  async saveAsset(args) {
    try {
      const fileName = sanitizeFileName(args && args.fileName);
      const result = await dialog.showSaveDialog({
        title: '保存文件',
        defaultPath: fileName,
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true };
      }
      if (args && args.sourcePath && fs.existsSync(args.sourcePath)) {
        await fs.promises.copyFile(args.sourcePath, result.filePath);
      } else if (args && /^https?:\/\//i.test(args.url || '')) {
        await downloadToFile(args.url, result.filePath);
      } else {
        throw new Error('缺少可保存的本地文件路径或下载地址');
      }
      return { ok: true, filePath: result.filePath };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '保存失败',
      };
    }
  }
}

FileController.toString = () => '[class FileController]';

module.exports = FileController;
