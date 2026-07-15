import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const versionFile = path.resolve(currentDir, '../../VERSION')
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]?\d)\.(0|[1-9]?\d)$/

function resolveVersion() {
  const version = (process.env.APP_VERSION || fs.readFileSync(versionFile, 'utf8')).trim()

  if (!versionPattern.test(version)) {
    throw new Error(`Invalid app version: ${version}`)
  }

  return version
}

function versionScript(version) {
  return `window.version = ${JSON.stringify(version)}\n`
}

export function versionAssetPlugin() {
  const version = resolveVersion()
  let base = '/'

  return {
    name: 'app-version-asset',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0].endsWith('/version.js')) {
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/javascript; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(versionScript(version))
          return
        }

        next()
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.js',
        source: versionScript(version),
      })
    },
    transformIndexHtml(html) {
      const normalizedBase = base.endsWith('/') ? base : `${base}/`
      const versionedHtml = html.replace(
        /<title>(.*?)<\/title>/,
        (_match, title) => `<title>${title} v${version}</title>`,
      )

      return {
        html: versionedHtml,
        tags: [
          {
            tag: 'script',
            attrs: { src: `${normalizedBase}version.js` },
            injectTo: 'head',
          },
        ],
      }
    },
  }
}
