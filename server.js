#!/usr/bin/env node
'use strict';

/**
 * server.js — portfolio ローカル開発サーバー
 *
 * 起動:  node server.js
 * Portfolio  →  http://localhost:3000
 * Admin      →  http://localhost:3000/admin
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let express, WebSocket, multer;
try {
  express   = require('express');
  WebSocket = require('ws');
  multer    = require('multer');
} catch(e) {
  console.error('\n  依存パッケージが見つかりません。以下を実行してください:\n');
  console.error('  npm install express ws multer\n');
  process.exit(1);
}

const PORT       = parseInt(process.env.PORT || '3000', 10);
const ROOT       = __dirname;
const HTML_FILE  = path.join(ROOT, 'index.html');
const ADMIN_FILE = path.join(ROOT, 'admin.html');
const IMAGES_DIR = path.join(ROOT, 'images');

// ─────────────────────────────────────────────────────────────────────────────
// データパース（CLI と共通ロジック）
// ─────────────────────────────────────────────────────────────────────────────
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];

function extractJSArray(html, marker, fromPos = 0) {
  const markerPos = html.indexOf(marker, fromPos);
  if (markerPos === -1) throw new Error(`マーカーが見つかりません: "${marker}"`);
  const arrStart = html.indexOf('[', markerPos + marker.length);
  if (arrStart === -1) throw new Error('配列の開始が見つかりません');
  let depth = 0, i = arrStart, inStr = false, strChar = '';
  while (i < html.length) {
    const ch = html[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === strChar) inStr = false;
    } else {
      if (ch === '"' || ch === "'") { inStr = true; strChar = ch; }
      else if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) return { raw: html.slice(arrStart, i + 1), startIdx: arrStart, endIdx: i + 1 };
      }
    }
    i++;
  }
  throw new Error('ブラケットが対応していません');
}

function evalJSValue(code) {
  const ctx = {};
  vm.runInNewContext(`__r = ${code}`, ctx);
  return ctx.__r;
}

// ── Posts ────────────────────────────────────────────────────────────────────
function getPosts(html) {
  return evalJSValue(extractJSArray(html, 'const POSTS = ').raw);
}

function serializePost(p) {
  const tags    = (p.tags || []).map(t => JSON.stringify(t)).join(', ');
  const imgLine = p.img ? `\n    img: ${JSON.stringify(p.img)},` : '';
  // body は文字列（Markdown）または配列（後方互換）
  const bodyField = Array.isArray(p.body)
    ? `    body: [\n${p.body.map(b => `      ${JSON.stringify(b)}`).join(',\n')}\n    ]`
    : `    body: ${JSON.stringify(p.body || '')}`;
  return [
    `  {`,
    `    id: ${p.id}, cat: ${JSON.stringify(p.cat)}, size: ${JSON.stringify(p.size)},`,
    `    title: ${JSON.stringify(p.title)},`,
    `    date: ${JSON.stringify(p.date)}, read: ${JSON.stringify(p.read)},`,
    `    tags: [${tags}],`,
    `    excerpt: ${JSON.stringify(p.excerpt)},${imgLine}`,
    bodyField,
    `  }`,
  ].join('\n');
}

function updatePosts(html, posts) {
  const { startIdx, endIdx } = extractJSArray(html, 'const POSTS = ');
  return html.slice(0, startIdx) + `[\n${posts.map(serializePost).join(',\n')}\n]` + html.slice(endIdx);
}

function nextPostId(posts) {
  return Math.max(0, ...posts.map(p => p.id)) + 1;
}

// ── Works ────────────────────────────────────────────────────────────────────
function getWorks(html) {
  const worksPos = html.indexOf('function Works(');
  if (worksPos === -1) throw new Error('Works関数が見つかりません');
  return evalJSValue(extractJSArray(html, 'const items = ', worksPos).raw);
}

function serializeWorks(works) {
  return `[\n${works.map(w => {
    const imgPart  = w.img  ? `, img:${JSON.stringify(w.img)}`   : '';
    const descPart = w.desc ? `, desc:${JSON.stringify(w.desc)}` : '';
    const urlPart  = w.url  ? `, url:${JSON.stringify(w.url)}`   : '';
    return `    { t:${JSON.stringify(w.t)}, y:${JSON.stringify(w.y)}, k:${JSON.stringify(w.k)}${imgPart}${descPart}${urlPart} }`;
  }).join(',\n')}\n  ]`;
}

function updateWorks(html, works) {
  const worksPos = html.indexOf('function Works(');
  if (worksPos === -1) throw new Error('Works関数が見つかりません');
  const { startIdx, endIdx } = extractJSArray(html, 'const items = ', worksPos);
  return html.slice(0, startIdx) + serializeWorks(works) + html.slice(endIdx);
}

// ── Timeline ─────────────────────────────────────────────────────────────────
function extractJSObject(html, marker, fromPos = 0) {
  const markerPos = html.indexOf(marker, fromPos);
  if (markerPos === -1) throw new Error(`マーカーが見つかりません: "${marker}"`);
  const objStart = html.indexOf('{', markerPos + marker.length);
  if (objStart === -1) throw new Error('オブジェクトの開始が見つかりません');
  let depth = 0, i = objStart, inStr = false, strChar = '';
  while (i < html.length) {
    const ch = html[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === strChar) inStr = false;
    } else {
      if (ch === '"' || ch === "'") { inStr = true; strChar = ch; }
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return { raw: html.slice(objStart, i + 1), startIdx: objStart, endIdx: i + 1 }; }
    }
    i++;
  }
  throw new Error('ブレースが対応していません');
}

function getTimeline(html) {
  return evalJSValue(extractJSObject(html, 'const TIMELINE = ').raw);
}

function serializeTimelineItem(item) {
  const tags = (item.tags || []).map(t => JSON.stringify(t)).join(', ');
  return [
    `    {`,
    `      ep: ${JSON.stringify(item.ep)}, year: ${JSON.stringify(item.year)}, month: ${JSON.stringify(item.month)}, page: ${JSON.stringify(item.page)},`,
    `      role: ${JSON.stringify(item.role)}, co: ${JSON.stringify(item.co)},`,
    `      title: ${JSON.stringify(item.title)}, desc: ${JSON.stringify(item.desc)},`,
    `      tags:[${tags}], icon:${JSON.stringify(item.icon)}`,
    `    }`,
  ].join('\n');
}

function serializeTimeline(tl) {
  const group = arr => (arr || []).map(serializeTimelineItem).join(',\n');
  return `{\n  work: [\n${group(tl.work)}\n  ],\n  edu: [\n${group(tl.edu)}\n  ],\n  side: [\n${group(tl.side)}\n  ]\n}`;
}

function updateTimeline(html, tl) {
  const { startIdx, endIdx } = extractJSObject(html, 'const TIMELINE = ');
  return html.slice(0, startIdx) + serializeTimeline(tl) + html.slice(endIdx);
}

// ── Hero (Top) ───────────────────────────────────────────────────────────────
function getHero(html) {
  const h1    = html.match(/<h1>\s*<small>[^<]*<\/small>\s*([\s\S]*?)\s*<\/h1>/);
  const lede_ = html.match(/<p className="lede">\s*([\s\S]*?)\s*<\/p>/);
  const now   = html.match(/<div className="hero-now">([\s\S]*?)<\/div>/);
  const nowItems = [];
  if (now) {
    const re = /<span className="k">([^<]+)<\/span><span>([^<]+)<\/span>/g;
    let m;
    while ((m = re.exec(now[1])) !== null) nowItems.push({ key: m[1], value: m[2] });
  }
  const iconMatch = html.match(/const HERO_ICON = "([^"]*)"/);
  return {
    title: h1    ? h1[1].trim() : '',
    lede:  lede_ ? lede_[1].replace(/\s+/g, ' ').trim() : '',
    nowItems,
    icon:  iconMatch ? iconMatch[1] : '',
  };
}

function updateHero(html, hero) {
  if (hero.title !== undefined) {
    html = html.replace(
      /(<h1>\s*<small>[^<]*<\/small>\s*)([\s\S]*?)(\s*<\/h1>)/,
      (_, pre, _o, post) => `${pre}${hero.title}${post}`
    );
  }
  if (hero.lede !== undefined) {
    html = html.replace(
      /(<p className="lede">)\s*[\s\S]*?\s*(<\/p>)/,
      (_, o, c) => `${o}\n          ${hero.lede}\n        ${c}`
    );
  }
  if (hero.nowItems) {
    hero.nowItems.forEach(item => {
      const esc = item.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // replacer 関数を使うことで item.value 内の $ 記号を安全に扱う
      html = html.replace(
        new RegExp(`(<span className="k">${esc}<\\/span><span>)[^<]*(<\\/span>)`),
        (_, g1, g2) => `${g1}${item.value}${g2}`
      );
    });
  }
  if (hero.icon !== undefined) {
    html = html.replace(
      /const HERO_ICON = "[^"]*"/,
      `const HERO_ICON = ${JSON.stringify(hero.icon)}`
    );
  }
  return html;
}

// ── Footer links ─────────────────────────────────────────────────────────────
function getFooterLinks(html) {
  return evalJSValue(extractJSObject(html, 'const FOOTER_LINKS = ').raw);
}

function updateFooterLinks(html, links) {
  const { startIdx, endIdx } = extractJSObject(html, 'const FOOTER_LINKS = ');
  const serialized = `{ twitter: ${JSON.stringify(links.twitter || '')}, github: ${JSON.stringify(links.github || '')} }`;
  return html.slice(0, startIdx) + serialized + html.slice(endIdx);
}

function writeHTML(html) {
  fs.writeFileSync(HTML_FILE + '.bak', fs.readFileSync(HTML_FILE));
  fs.writeFileSync(HTML_FILE, html, 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Express + WebSocket
// ─────────────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

app.use(express.json({ limit: '50mb' }));

// Multer（画像アップロード）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
    cb(null, IMAGES_DIR);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext);
    let   name = file.originalname;
    if (fs.existsSync(path.join(IMAGES_DIR, name))) name = `${base}_${Date.now()}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, IMG_EXT.includes(path.extname(file.originalname).toLowerCase())),
});

// images/ フォルダを起動時に作成
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  console.log('  images/ フォルダを作成しました');
}

// ─────────────────────────────────────────────────────────────────────────────
// ホットリロード
// ─────────────────────────────────────────────────────────────────────────────
const HOT_RELOAD = `<script>(function(){function c(){var w=new WebSocket('ws://'+location.host+'/ws');w.onmessage=function(e){if(e.data==='reload')location.reload();};w.onclose=function(){setTimeout(c,1000)};}c();})();<\/script>`;

let reloadTimer;
function broadcast() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send('reload'); });
  }, 200);
}

// ファイル監視（vim などの atomic write にも対応）
function startWatcher() {
  try {
    const w = fs.watch(HTML_FILE, event => {
      broadcast();
      if (event === 'rename') { w.close(); setTimeout(startWatcher, 300); }
    });
    w.on('error', () => setTimeout(startWatcher, 500));
  } catch(e) { setTimeout(startWatcher, 500); }
}
startWatcher();

// ─────────────────────────────────────────────────────────────────────────────
// ルーティング
// ─────────────────────────────────────────────────────────────────────────────

// ポートフォリオ（ホットリロードスクリプト注入）
app.get('/', (_, res) => {
  const html = fs.readFileSync(HTML_FILE, 'utf8');
  res.type('html').send(html.replace('</body>', HOT_RELOAD + '</body>'));
});

// 静的ファイル
app.use('/images', express.static(IMAGES_DIR));

// 管理画面
app.get('/admin', (_, res) => res.sendFile(ADMIN_FILE));

// ── API: Posts ───────────────────────────────────────────────────────────────
app.get('/api/posts', (_, res) => {
  try { res.json(getPosts(fs.readFileSync(HTML_FILE, 'utf8'))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts', (req, res) => {
  try {
    const html  = fs.readFileSync(HTML_FILE, 'utf8');
    const posts = getPosts(html);
    const post  = { tags: [], body: [], ...req.body, id: nextPostId(posts) };
    if (!post.img) delete post.img;
    writeHTML(updatePosts(html, [post, ...posts]));
    res.json(post);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/posts/:id', (req, res) => {
  try {
    const html  = fs.readFileSync(HTML_FILE, 'utf8');
    const posts = getPosts(html);
    const idx   = posts.findIndex(p => p.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    posts[idx] = { ...posts[idx], ...req.body, id: posts[idx].id };
    if (!posts[idx].img) delete posts[idx].img;
    writeHTML(updatePosts(html, posts));
    res.json(posts[idx]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/posts/:id', (req, res) => {
  try {
    const html  = fs.readFileSync(HTML_FILE, 'utf8');
    const posts = getPosts(html);
    const idx   = posts.findIndex(p => p.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    posts.splice(idx, 1);
    writeHTML(updatePosts(html, posts));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Works ───────────────────────────────────────────────────────────────
app.get('/api/works', (_, res) => {
  try { res.json(getWorks(fs.readFileSync(HTML_FILE, 'utf8'))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/works', (req, res) => {
  try {
    const html  = fs.readFileSync(HTML_FILE, 'utf8');
    const works = getWorks(html);
    works.push(req.body);
    writeHTML(updateWorks(html, works));
    res.json(req.body);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/works/:index', (req, res) => {
  try {
    const html  = fs.readFileSync(HTML_FILE, 'utf8');
    const works = getWorks(html);
    const idx   = parseInt(req.params.index) - 1;
    if (idx < 0 || idx >= works.length) return res.status(404).json({ error: 'Not found' });
    works[idx] = req.body;
    writeHTML(updateWorks(html, works));
    res.json(req.body);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/works/:index', (req, res) => {
  try {
    const html  = fs.readFileSync(HTML_FILE, 'utf8');
    const works = getWorks(html);
    const idx   = parseInt(req.params.index) - 1;
    if (idx < 0 || idx >= works.length) return res.status(404).json({ error: 'Not found' });
    works.splice(idx, 1);
    writeHTML(updateWorks(html, works));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: 並び替え ─────────────────────────────────────────────────────────────
app.patch('/api/posts/order', (req, res) => {
  try {
    const html    = fs.readFileSync(HTML_FILE, 'utf8');
    const posts   = getPosts(html);
    const { ids } = req.body; // 新しい順のID配列
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
    const postMap = new Map(posts.map(p => [p.id, p]));
    const reordered = ids.map(id => postMap.get(id)).filter(Boolean);
    writeHTML(updatePosts(html, reordered));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/works/order', (req, res) => {
  try {
    const html  = fs.readFileSync(HTML_FILE, 'utf8');
    const works = req.body; // 新しい順のWorks配列
    if (!Array.isArray(works)) return res.status(400).json({ error: 'body must be an array' });
    writeHTML(updateWorks(html, works));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Top ─────────────────────────────────────────────────────────────────
app.get('/api/top', (_, res) => {
  try { res.json(getHero(fs.readFileSync(HTML_FILE, 'utf8'))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/top', (req, res) => {
  try {
    writeHTML(updateHero(fs.readFileSync(HTML_FILE, 'utf8'), req.body));
    res.json({ ok: true });
  } catch(e) {
    console.error('[PUT /api/top] エラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── API: Footer links ────────────────────────────────────────────────────────
app.get('/api/footer', (_, res) => {
  try { res.json(getFooterLinks(fs.readFileSync(HTML_FILE, 'utf8'))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/footer', (req, res) => {
  try {
    writeHTML(updateFooterLinks(fs.readFileSync(HTML_FILE, 'utf8'), req.body));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Timeline ────────────────────────────────────────────────────────────
const TL_GROUPS = ['work', 'edu', 'side'];

app.get('/api/timeline', (_, res) => {
  try { res.json(getTimeline(fs.readFileSync(HTML_FILE, 'utf8'))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/timeline/:group', (req, res) => {
  try {
    const group = req.params.group;
    if (!TL_GROUPS.includes(group)) return res.status(400).json({ error: `Invalid group: ${group}` });
    const html = fs.readFileSync(HTML_FILE, 'utf8');
    const tl   = getTimeline(html);
    tl[group].push(req.body);
    writeHTML(updateTimeline(html, tl));
    res.json(req.body);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/timeline/:group/:index', (req, res) => {
  try {
    const group = req.params.group;
    const idx   = parseInt(req.params.index) - 1;
    if (!TL_GROUPS.includes(group)) return res.status(400).json({ error: `Invalid group: ${group}` });
    const html = fs.readFileSync(HTML_FILE, 'utf8');
    const tl   = getTimeline(html);
    if (idx < 0 || idx >= tl[group].length) return res.status(404).json({ error: 'Not found' });
    tl[group][idx] = req.body;
    writeHTML(updateTimeline(html, tl));
    res.json(req.body);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/timeline/:group/:index', (req, res) => {
  try {
    const group = req.params.group;
    const idx   = parseInt(req.params.index) - 1;
    if (!TL_GROUPS.includes(group)) return res.status(400).json({ error: `Invalid group: ${group}` });
    const html = fs.readFileSync(HTML_FILE, 'utf8');
    const tl   = getTimeline(html);
    if (idx < 0 || idx >= tl[group].length) return res.status(404).json({ error: 'Not found' });
    tl[group].splice(idx, 1);
    writeHTML(updateTimeline(html, tl));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: 画像アップロード ─────────────────────────────────────────────────────
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ファイルがありません' });
  res.json({ path: `./images/${req.file.filename}` });
});

// ─────────────────────────────────────────────────────────────────────────────
// 起動
// ─────────────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  const c = s => `\x1b[36m${s}\x1b[0m`;
  const b = s => `\x1b[1m${s}\x1b[0m`;
  console.log('');
  console.log(b('  portfolio-server') + '  // hot reload enabled');
  console.log('');
  console.log(`  Portfolio  →  ${c(`http://localhost:${PORT}`)}`);
  console.log(`  Admin      →  ${c(`http://localhost:${PORT}/admin`)}`);
  console.log('');
  console.log('  \x1b[2mCtrl+C で停止\x1b[0m');
  console.log('');
});
