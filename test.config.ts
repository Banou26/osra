import type { EPKConfig } from 'epk'

import http from 'http'
import fs from 'fs'
import path from 'path'

import mime from 'mime'

let httpServer: http.Server

const config: EPKConfig = {
  configs: [
    {
      name: 'extension',
      platform: 'chromium',
      setup: () => {
        httpServer = http
          .createServer(async (req, res) => {
            const url = new URL(req.url, 'http://localhost:5566')
            res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5566')
            try {
              res.setHeader('Content-Type', mime.getType(path.resolve('./', path.join('tests/build', url.pathname))))
              await new Promise((resolve, reject) =>
                fs
                  .createReadStream(path.resolve('./', path.join('tests/build', url.pathname)))
                  .on('error', reject)
                  .on('finish', resolve)
                  .pipe(res)
              )
            } catch (err) {
              res.writeHead(404)
              res.end()
            }
          })
          .listen(5566)
      },
      teardown: () => {
        httpServer.close()
      },
      web: {
        match: ['./tests/**/index.ts']
      },
      browserConfig: {
        headless: false,
        devtools: true
      }
    }
  ]
}

export default config
