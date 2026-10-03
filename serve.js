#!/usr/bin/env node
'use strict';

// Tiny static server so you can look at the dashboard locally: npm run serve  ->  http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = process.env.COT_DOCS_DIR || path.join(__dirname, '..', 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

http.createServer(function (req, res) {
  let file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (file.endsWith(path.sep)) file += 'index.html';
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(8080, function () { console.log('Dashboard at http://localhost:8080'); });
