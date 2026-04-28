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
const DATA_FILE  = path.join(ROOT, 'data.json');
const ADMIN_FILE = path.join(ROOT, 'admin.html');
const IMAGES_DIR = path.join(ROOT, 'images');

// ─────────────────────────────────────────────────────────────────────────────
// データ I/O — data.json (CLI と共通ストア)
// ─────────────────────────────────────────────────────────────────────────────
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`data.json が見つかりません: ${DATA_FILE}`);
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  data.posts        = data.posts        || [];
  data.works        = data.works        || [];
  data.hero         = data.hero         || { title: '', lede: '', icon: '', nowItems: [] };
  data.hero.nowItems= data.hero.nowItems|| [];
  data.timeline     = data.timeline     || { work: [], edu: [], side: [] };
  data.timeline.work= data.timeline.work|| [];
  data.timeline.edu = data.timeline.edu || [];
  data.timeline.side= data.timeline.side|| [];
  data.catLabel     = data.catLabel     || { idea:'Idea', tech:'Tech', book:'Book', all:'All' };
  data.footerLinks  = data.footerLinks  || { twitter: '', github: '' };
  return data;
}

function writeData(data) {
  // バックアップは無限に膨らむのを避けるため最新1件のみ
  if (fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE + '.bak', fs.readFileSync(DATA_FILE));
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function nextPostId(posts) {
  return Math.max(0, ...posts.map(p => p.id)) + 1;
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

// data.json も監視（CLI 編集時にブラウザを再読み込み）
function startDataWatcher() {
  if (!fs.existsSync(DATA_FILE)) { setTimeout(startDataWatcher, 1000); return; }
  try {
    const w = fs.watch(DATA_FILE, event => {
      broadcast();
      if (event === 'rename') { w.close(); setTimeout(startDataWatcher, 300); }
    });
    w.on('error', () => setTimeout(startDataWatcher, 500));
  } catch(e) { setTimeout(startDataWatcher, 500); }
}
startDataWatcher();

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

// データJSON（index.html から fetch される）
app.get('/data.json', (_, res) => {
  res.type('application/json').sendFile(DATA_FILE);
});

// 管理画面
app.get('/admin', (_, res) => res.sendFile(ADMIN_FILE));

// ── API: Posts ───────────────────────────────────────────────────────────────
app.get('/api/posts', (_, res) => {
  try { res.json(readData().posts); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts', (req, res) => {
  try {
    const data  = readData();
    const post  = { tags: [], body: '', ...req.body, id: nextPostId(data.posts) };
    if (!post.img) delete post.img;
    data.posts = [post, ...data.posts];
    writeData(data);
    res.json(post);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/posts/:id', (req, res) => {
  try {
    const data = readData();
    const idx  = data.posts.findIndex(p => p.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data.posts[idx] = { ...data.posts[idx], ...req.body, id: data.posts[idx].id };
    if (!data.posts[idx].img) delete data.posts[idx].img;
    writeData(data);
    res.json(data.posts[idx]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/posts/:id', (req, res) => {
  try {
    const data = readData();
    const idx  = data.posts.findIndex(p => p.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    data.posts.splice(idx, 1);
    writeData(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Works ───────────────────────────────────────────────────────────────
app.get('/api/works', (_, res) => {
  try { res.json(readData().works); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/works', (req, res) => {
  try {
    const data = readData();
    data.works.push(req.body);
    writeData(data);
    res.json(req.body);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/works/:index', (req, res) => {
  try {
    const data = readData();
    const idx  = parseInt(req.params.index) - 1;
    if (idx < 0 || idx >= data.works.length) return res.status(404).json({ error: 'Not found' });
    data.works[idx] = req.body;
    writeData(data);
    res.json(req.body);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/works/:index', (req, res) => {
  try {
    const data = readData();
    const idx  = parseInt(req.params.index) - 1;
    if (idx < 0 || idx >= data.works.length) return res.status(404).json({ error: 'Not found' });
    data.works.splice(idx, 1);
    writeData(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: 並び替え ─────────────────────────────────────────────────────────────
app.patch('/api/posts/order', (req, res) => {
  try {
    const data    = readData();
    const { ids } = req.body; // 新しい順のID配列
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
    const postMap   = new Map(data.posts.map(p => [p.id, p]));
    data.posts      = ids.map(id => postMap.get(id)).filter(Boolean);
    writeData(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/works/order', (req, res) => {
  try {
    const works = req.body; // 新しい順のWorks配列
    if (!Array.isArray(works)) return res.status(400).json({ error: 'body must be an array' });
    const data = readData();
    data.works = works;
    writeData(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Top ─────────────────────────────────────────────────────────────────
app.get('/api/top', (_, res) => {
  try {
    const h = readData().hero;
    res.json({
      title: h.title || '',
      lede:  h.lede  || '',
      nowItems: h.nowItems || [],
      icon:  h.icon  || '',
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/top', (req, res) => {
  try {
    const data = readData();
    const cur  = data.hero || {};
    const next = req.body || {};
    data.hero = {
      title:    next.title    !== undefined ? next.title    : (cur.title    || ''),
      lede:     next.lede     !== undefined ? next.lede     : (cur.lede     || ''),
      icon:     next.icon     !== undefined ? next.icon     : (cur.icon     || ''),
      nowItems: next.nowItems !== undefined ? next.nowItems : (cur.nowItems || []),
    };
    writeData(data);
    res.json({ ok: true });
  } catch(e) {
    console.error('[PUT /api/top] エラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── API: Footer links ────────────────────────────────────────────────────────
app.get('/api/footer', (_, res) => {
  try {
    const f = readData().footerLinks || {};
    res.json({ twitter: f.twitter || '', github: f.github || '' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/footer', (req, res) => {
  try {
    const data = readData();
    data.footerLinks = {
      twitter: (req.body && req.body.twitter) || '',
      github:  (req.body && req.body.github)  || '',
    };
    writeData(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Timeline ────────────────────────────────────────────────────────────
const TL_GROUPS = ['work', 'edu', 'side'];

app.get('/api/timeline', (_, res) => {
  try { res.json(readData().timeline); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/timeline/:group', (req, res) => {
  try {
    const group = req.params.group;
    if (!TL_GROUPS.includes(group)) return res.status(400).json({ error: `Invalid group: ${group}` });
    const data = readData();
    data.timeline[group].push(req.body);
    writeData(data);
    res.json(req.body);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/timeline/:group/:index', (req, res) => {
  try {
    const group = req.params.group;
    const idx   = parseInt(req.params.index) - 1;
    if (!TL_GROUPS.includes(group)) return res.status(400).json({ error: `Invalid group: ${group}` });
    const data = readData();
    if (idx < 0 || idx >= data.timeline[group].length) return res.status(404).json({ error: 'Not found' });
    data.timeline[group][idx] = req.body;
    writeData(data);
    res.json(req.body);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/timeline/:group/:index', (req, res) => {
  try {
    const group = req.params.group;
    const idx   = parseInt(req.params.index) - 1;
    if (!TL_GROUPS.includes(group)) return res.status(400).json({ error: `Invalid group: ${group}` });
    const data = readData();
    if (idx < 0 || idx >= data.timeline[group].length) return res.status(404).json({ error: 'Not found' });
    data.timeline[group].splice(idx, 1);
    writeData(data);
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
