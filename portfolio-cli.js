#!/usr/bin/env node
'use strict';

/**
 * portfolio-cli.js — data.json のコンテンツ管理CLI
 *
 * 使い方:
 *   node portfolio-cli.js                  インタラクティブメニュー
 *   node portfolio-cli.js blog list        Blog記事一覧
 *   node portfolio-cli.js blog show <id>   Blog記事詳細
 *   node portfolio-cli.js blog add         Blog記事追加
 *   node portfolio-cli.js blog edit <id>   Blog記事編集
 *   node portfolio-cli.js blog delete <id> Blog記事削除
 *   node portfolio-cli.js works list       Works一覧
 *   node portfolio-cli.js works add        Work追加
 *   node portfolio-cli.js works edit <番号> Work編集
 *   node portfolio-cli.js works delete <番号> Work削除
 *   node portfolio-cli.js top show         Topページ表示
 *   node portfolio-cli.js top edit         Topページ編集
 */

const fs     = require('fs');
const path   = require('path');
const rl_    = require('readline');

// サポートする画像MIME
const IMG_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',  '.gif':  'image/gif',
  '.webp':'image/webp', '.svg':  'image/svg+xml',
};

const HTML_FILE = path.resolve(__dirname, 'index.html');
const DATA_FILE = path.resolve(__dirname, 'data.json');

// ─────────────────────────────────────────────────────────────────────────────
// ターミナルカラー
// ─────────────────────────────────────────────────────────────────────────────
const R    = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM  = '\x1b[2m';

const col = {
  red    : s => `\x1b[31m${s}${R}`,
  green  : s => `\x1b[32m${s}${R}`,
  yellow : s => `\x1b[33m${s}${R}`,
  blue   : s => `\x1b[34m${s}${R}`,
  cyan   : s => `\x1b[36m${s}${R}`,
  gray   : s => `\x1b[90m${s}${R}`,
  bold   : s => `${BOLD}${s}${R}`,
  dim    : s => `${DIM}${s}${R}`,
};

function hr(char = '─', width = 62) {
  return col.dim(char.repeat(width));
}

function banner() {
  console.log('');
  console.log(col.bold('  portfolio-cli') + col.dim(' // data.json manager'));
  console.log(hr());
}

// ─────────────────────────────────────────────────────────────────────────────
// Readline ヘルパー
// ─────────────────────────────────────────────────────────────────────────────
function createRL() {
  return rl_.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question, defaultVal = '') {
  return new Promise(resolve => {
    const suffix = defaultVal !== '' ? col.dim(` (${defaultVal})`) : '';
    rl.question(`  ${question}${suffix}: `, answer => {
      resolve(answer.trim() === '' ? defaultVal : answer.trim());
    });
  });
}

async function confirm(rl, question) {
  const answer = await ask(rl, `${question} [y/N]`, 'N');
  return answer.toLowerCase() === 'y';
}

async function askChoice(rl, label, choices, defaultVal = '') {
  console.log(`\n  ${col.bold(label)}:`);
  choices.forEach((ch, i) => {
    const active = ch === defaultVal;
    const marker = active ? col.green('▸') : ' ';
    console.log(`    ${marker} ${col.dim((i + 1) + '.')} ${ch}${active ? col.dim(' ← 現在') : ''}`);
  });
  const answer = await ask(rl, `番号を入力 (Enter = 変更なし)`, '');
  const num = parseInt(answer, 10);
  if (!isNaN(num) && num >= 1 && num <= choices.length) return choices[num - 1];
  return defaultVal;
}

async function askMultilineBody(rl, existing = null) {
  // existing は文字列（Markdown）または配列（後方互換）
  const existingStr = Array.isArray(existing)
    ? existing.join('\n\n')
    : (existing || '');

  if (existingStr) {
    console.log(col.dim('  現在の本文 (Markdown):'));
    existingStr.split('\n').slice(0, 6).forEach(line => console.log(col.dim(`    ${line}`)));
    if (existingStr.split('\n').length > 6) console.log(col.dim('    ...'));
    const keep = await confirm(rl, '  本文を保持しますか？');
    if (keep) return existingStr;
  }

  console.log(col.dim('  Markdownで本文を入力してください。空行を2回連続で入力すると終了。'));
  const lines = [];
  let emptyCount = 0;
  while (true) {
    const line = await new Promise(resolve =>
      rl.question('  ', resolve)
    );
    if (line === '') {
      emptyCount++;
      if (emptyCount >= 2) break;
      lines.push('');
    } else {
      emptyCount = 0;
      lines.push(line);
    }
  }
  // 末尾の空行を除去
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

// 画像ファイルを images/ フォルダにコピーして相対パスを返す
async function askImageFile(rl, existing = '') {
  if (existing) {
    console.log(col.dim(`  現在の画像: ${existing}`));
    const choice = await ask(rl, '  画像を [k]eep / [r]eplace / [d]elete ?', 'k');
    if (choice.toLowerCase() === 'd') return '';
    if (choice.toLowerCase() !== 'r') return existing;
  }

  const filepath = await ask(rl, '画像ファイルのパス (Enterでスキップ)', '');
  if (!filepath) return existing;

  const resolved = path.resolve(filepath);
  if (!fs.existsSync(resolved)) {
    console.log(col.red(`  ファイルが見つかりません: ${resolved}`));
    return existing;
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!IMG_MIME[ext]) {
    console.log(col.red(`  未対応の形式: ${ext}`));
    console.log(col.dim(`  対応形式: ${Object.keys(IMG_MIME).join(', ')}`));
    return existing;
  }

  // images/ フォルダを用意
  const imagesDir = path.join(path.dirname(HTML_FILE), 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
    console.log(col.dim(`  フォルダを作成しました: images/`));
  }

  // コピー先ファイル名の決定
  let basename = path.basename(resolved);
  let destPath = path.join(imagesDir, basename);

  // 同名ファイルが存在し内容が異なる場合はタイムスタンプを付与
  if (fs.existsSync(destPath)) {
    const existing_buf = fs.readFileSync(destPath);
    const new_buf      = fs.readFileSync(resolved);
    if (!existing_buf.equals(new_buf)) {
      const stem   = path.basename(resolved, ext);
      basename = `${stem}_${Date.now()}${ext}`;
      destPath = path.join(imagesDir, basename);
      console.log(col.yellow(`  同名ファイルが既に存在するため別名で保存します: ${basename}`));
    }
  }

  fs.copyFileSync(resolved, destPath);
  const sizeKB = (fs.statSync(destPath).size / 1024).toFixed(1);
  console.log(col.green(`  ✓ images/${basename} にコピーしました (${sizeKB} KB)`));
  return `./images/${basename}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ファイル I/O — data.json
// ─────────────────────────────────────────────────────────────────────────────
function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(col.red(`  Error: ${DATA_FILE} が見つかりません`));
    process.exit(1);
  }
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // 既定値で穴埋め
    data.posts        = data.posts        || [];
    data.works        = data.works        || [];
    data.hero         = data.hero         || { title: '', lede: '', icon: '', nowItems: [] };
    data.hero.nowItems= data.hero.nowItems|| [];
    data.timeline     = data.timeline     || { work: [], edu: [], side: [] };
    data.catLabel     = data.catLabel     || { idea:'Idea', tech:'Tech', book:'Book', all:'All' };
    data.footerLinks  = data.footerLinks  || { twitter: '', github: '' };
    return data;
  } catch (e) {
    console.error(col.red(`  data.json の読み込みに失敗: ${e.message}`));
    process.exit(1);
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE + '.bak', fs.readFileSync(DATA_FILE));
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(col.dim('  (バックアップ: data.json.bak)'));
}

// ─────────────────────────────────────────────────────────────────────────────
// POSTS — Blog記事
// ─────────────────────────────────────────────────────────────────────────────
function getPosts(data) { return data.posts; }
function setPosts(data, posts) { data.posts = posts; return data; }

function nextPostId(posts) {
  return Math.max(0, ...posts.map(p => p.id)) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKS — 制作物
// ─────────────────────────────────────────────────────────────────────────────
function getWorks(data) { return data.works; }
function setWorks(data, works) { data.works = works; return data; }

// ─────────────────────────────────────────────────────────────────────────────
// HERO — Topページ
// ─────────────────────────────────────────────────────────────────────────────
function getHero(data) {
  const h = data.hero || {};
  return {
    title: h.title || '',
    lede:  h.lede  || '',
    nowItems: h.nowItems || [],
    icon: h.icon || '',
  };
}

function setHero(data, hero) {
  data.hero = {
    title: hero.title !== undefined ? hero.title : (data.hero && data.hero.title) || '',
    lede:  hero.lede  !== undefined ? hero.lede  : (data.hero && data.hero.lede)  || '',
    icon:  hero.icon  !== undefined ? hero.icon  : (data.hero && data.hero.icon)  || '',
    nowItems: hero.nowItems || (data.hero && data.hero.nowItems) || [],
  };
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// 表示ヘルパー
// ─────────────────────────────────────────────────────────────────────────────
const SIZES = ['s-hero', 's-tall', 's-wide', 's-wide-lg', 's-full', 's-sq', 's-sm'];
const CATS  = ['idea', 'tech', 'book'];
const CAT_COL = { idea: col.green, tech: col.cyan, book: col.yellow };

function displayPostRow(p) {
  const catFn = CAT_COL[p.cat] || col.gray;
  const id    = col.dim(String(p.id).padStart(3, '0'));
  const cat   = catFn((p.cat || '').padEnd(4));
  const date  = col.dim(p.date);
  const size  = col.dim(('[' + p.size + ']').padEnd(12));
  console.log(`  ${id}  ${cat}  ${date}  ${size}  ${p.title}`);
}

function displayPost(p) {
  const catFn = CAT_COL[p.cat] || col.gray;
  console.log(hr());
  console.log(`  ${col.bold('ID')}       : ${p.id}`);
  console.log(`  ${col.bold('タイトル')} : ${p.title}`);
  console.log(`  ${col.bold('カテゴリ')} : ${catFn(p.cat)}`);
  console.log(`  ${col.bold('サイズ')}   : ${p.size}`);
  console.log(`  ${col.bold('日付')}     : ${p.date}`);
  console.log(`  ${col.bold('読了時間')} : ${p.read}`);
  console.log(`  ${col.bold('タグ')}     : ${(p.tags || []).map(t => '#' + t).join('  ')}`);
  console.log(`  ${col.bold('概要')}     : ${p.excerpt}`);
  const imgStatus = p.img ? col.green(p.img) : col.dim('なし');
  console.log(`  ${col.bold('画像')}     : ${imgStatus}`);
  if (p.body && p.body.length > 0) {
    console.log(`  ${col.bold('本文')}     :`);
    if (Array.isArray(p.body)) {
      // 旧フォーマット（配列）への後方互換
      p.body.forEach((b, i) => console.log(col.dim(`    [${i + 1}] ${b}`)));
    } else {
      // Markdown 文字列
      const lines = String(p.body).split('\n');
      const previewLen = 8;
      lines.slice(0, previewLen).forEach(line => console.log(col.dim(`    ${line}`)));
      if (lines.length > previewLen) console.log(col.dim(`    ... (+${lines.length - previewLen} 行)`));
    }
  }
  console.log(hr());
}

function displayWorkRow(w, i) {
  const img = w.img ? col.green(w.img) : col.dim('なし');
  console.log(
    `  ${col.dim((i + 1) + '.')}  ${col.bold(w.t)}` +
    `  ${col.dim(w.y)}  ${col.cyan(w.k)}  thumb:${img}`
  );
}

function displayHero(hero) {
  console.log(hr());
  console.log(`  ${col.bold('タイトル')} : ${hero.title}`);
  console.log(`  ${col.bold('紹介文')}   :`);
  // 長い文は折り返し表示
  const words = hero.lede;
  const wrapped = words.match(/.{1,56}/g) || [words];
  wrapped.forEach(line => console.log(`    ${col.dim(line)}`));
  console.log(`  ${col.bold('NOW items')} :`);
  hero.nowItems.forEach(item => {
    console.log(`    ${col.cyan(item.key.padEnd(6))}  ${item.value}`);
  });
  console.log(hr());
}

// ─────────────────────────────────────────────────────────────────────────────
// Blog コマンド
// ─────────────────────────────────────────────────────────────────────────────
async function cmdBlogList() {
  const data  = readData();
  const posts = getPosts(data);
  console.log(col.bold(`\n  Blog 記事一覧 (${posts.length}件)`));
  console.log(hr());
  console.log(col.dim('  ID   CAT    DATE         SIZE          TITLE'));
  console.log(hr('-'));
  posts.forEach(displayPostRow);
  console.log(hr());
}

async function cmdBlogShow(id) {
  if (!id) { console.error(col.red('  ID を指定してください')); return; }
  const data  = readData();
  const posts = getPosts(data);
  const post  = posts.find(p => p.id === parseInt(id, 10));
  if (!post) { console.error(col.red(`  記事 ID ${id} が見つかりません`)); return; }
  console.log(col.bold(`\n  Blog 記事 詳細`));
  displayPost(post);
}

async function cmdBlogAdd() {
  const rl = createRL();
  try {
    const data  = readData();
    const posts = getPosts(data);

    console.log(col.bold('\n  Blog 記事を追加'));
    console.log(hr());

    const cat     = await askChoice(rl, 'カテゴリ', CATS, 'idea');
    const size    = await askChoice(rl, 'サイズ', SIZES, 's-sq');
    const title   = await ask(rl, 'タイトル');
    const today   = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const date    = await ask(rl, '日付 (YYYY.MM.DD)', today);
    const read    = await ask(rl, '読了時間', '3 min');
    const tagsRaw = await ask(rl, 'タグ (カンマ区切り)', '');
    const tags    = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    const excerpt = await ask(rl, '概要');
    console.log('');
    console.log(`  ${col.bold('画像ファイル')} ${col.dim('(jpg/png/webp/gif/svg — Enterでスキップ)')}`);
    const img  = await askImageFile(rl);
    const body = await askMultilineBody(rl);

    const newPost = {
      id: nextPostId(posts),
      cat, size, title, date, read, tags, excerpt,
      ...(img ? { img } : {}),
      body, // Markdown 文字列
    };

    console.log(col.bold('\n  追加する記事:'));
    displayPost(newPost);

    const ok = await confirm(rl, '  この内容で保存しますか？');
    if (ok) {
      writeData(setPosts(data, [newPost, ...posts]));
      console.log(col.green(`  ✓ 記事「${newPost.title}」を追加しました (ID: ${newPost.id})`));
    } else {
      console.log(col.yellow('  キャンセルしました'));
    }
  } finally {
    rl.close();
  }
}

async function cmdBlogEdit(id) {
  if (!id) { console.error(col.red('  ID を指定してください')); return; }
  const rl = createRL();
  try {
    const data  = readData();
    const posts = getPosts(data);
    const idx   = posts.findIndex(p => p.id === parseInt(id, 10));
    if (idx === -1) { console.error(col.red(`  記事 ID ${id} が見つかりません`)); return; }
    const ex = posts[idx];

    console.log(col.bold(`\n  Blog 記事を編集 (ID: ${id})`));
    displayPost(ex);
    console.log(col.dim('  ※ Enterキーで現在の値を保持'));
    console.log(hr());

    const cat     = await askChoice(rl, 'カテゴリ', CATS, ex.cat);
    const size    = await askChoice(rl, 'サイズ', SIZES, ex.size);
    const title   = await ask(rl, 'タイトル', ex.title);
    const date    = await ask(rl, '日付 (YYYY.MM.DD)', ex.date);
    const read    = await ask(rl, '読了時間', ex.read);
    const tagsRaw = await ask(rl, 'タグ (カンマ区切り)', (ex.tags || []).join(', '));
    const tags    = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    const excerpt = await ask(rl, '概要', ex.excerpt);
    console.log('');
    console.log(`  ${col.bold('画像ファイル')} ${col.dim('(jpg/png/webp/gif/svg)')}`);
    const img  = await askImageFile(rl, ex.img || '');
    const body = await askMultilineBody(rl, ex.body || []);

    const updated = {
      ...ex, cat, size, title, date, read, tags, excerpt,
      ...(img ? { img } : {}),
      body,
    };
    if (!img) delete updated.img;

    console.log(col.bold('\n  更新後:'));
    displayPost(updated);

    const ok = await confirm(rl, '  この内容で保存しますか？');
    if (ok) {
      posts[idx] = updated;
      writeData(setPosts(data, posts));
      console.log(col.green(`  ✓ 記事「${updated.title}」を更新しました`));
    } else {
      console.log(col.yellow('  キャンセルしました'));
    }
  } finally {
    rl.close();
  }
}

async function cmdBlogDelete(id) {
  if (!id) { console.error(col.red('  ID を指定してください')); return; }
  const rl = createRL();
  try {
    const data  = readData();
    const posts = getPosts(data);
    const idx   = posts.findIndex(p => p.id === parseInt(id, 10));
    if (idx === -1) { console.error(col.red(`  記事 ID ${id} が見つかりません`)); return; }

    displayPost(posts[idx]);
    const ok = await confirm(rl, col.red('  この記事を削除しますか？'));
    if (ok) {
      const [removed] = posts.splice(idx, 1);
      writeData(setPosts(data, posts));
      console.log(col.green(`  ✓ 記事「${removed.title}」を削除しました`));
    } else {
      console.log(col.yellow('  キャンセルしました'));
    }
  } finally {
    rl.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Works コマンド
// ─────────────────────────────────────────────────────────────────────────────
async function cmdWorksList() {
  const data  = readData();
  const works = getWorks(data);
  console.log(col.bold(`\n  Works 一覧 (${works.length}件)`));
  console.log(hr());
  works.forEach((w, i) => displayWorkRow(w, i));
  console.log(hr());
}

async function cmdWorksAdd() {
  const rl = createRL();
  try {
    const data  = readData();
    const works = getWorks(data);

    console.log(col.bold('\n  Work を追加'));
    console.log(hr());

    const t = await ask(rl, 'プロジェクト名');
    const y = await ask(rl, '年 (例: 2025)', String(new Date().getFullYear()));
    const k = await ask(rl, 'キーワード / プラットフォーム (例: iOS)');
    console.log('');
    console.log(`  ${col.bold('サムネイル画像')} ${col.dim('(jpg/png/webp/gif/svg — Enterでスキップ)')}`);
    const img  = await askImageFile(rl);
    const desc = await askMultilineBody(rl, null);
    const url  = await ask(rl, 'URL (Enterでスキップ)', '');

    const newWork = { t, y, k, ...(img ? { img } : {}), ...(desc ? { desc } : {}), ...(url ? { url } : {}) };
    console.log('\n  追加するWork:');
    displayWorkRow(newWork, works.length);

    const ok = await confirm(rl, '  この内容で保存しますか？');
    if (ok) {
      works.push(newWork);
      writeData(setWorks(data, works));
      console.log(col.green(`  ✓ Work「${t}」を追加しました`));
    } else {
      console.log(col.yellow('  キャンセルしました'));
    }
  } finally {
    rl.close();
  }
}

async function cmdWorksEdit(index) {
  if (!index) { console.error(col.red('  番号を指定してください')); return; }
  const rl = createRL();
  try {
    const data  = readData();
    const works = getWorks(data);
    const idx   = parseInt(index, 10) - 1;

    if (idx < 0 || idx >= works.length) {
      console.error(col.red(`  Work番号 ${index} が見つかりません (1〜${works.length})`));
      return;
    }
    const ex = works[idx];

    console.log(col.bold(`\n  Work を編集 (${index})`));
    displayWorkRow(ex, idx);
    console.log(col.dim('  ※ Enterキーで現在の値を保持'));
    console.log(hr());

    const t = await ask(rl, 'プロジェクト名', ex.t);
    const y = await ask(rl, '年', ex.y);
    const k = await ask(rl, 'キーワード / プラットフォーム', ex.k);
    console.log('');
    console.log(`  ${col.bold('サムネイル画像')} ${col.dim('(jpg/png/webp/gif/svg)')}`);
    const img  = await askImageFile(rl, ex.img || '');
    const desc = await askMultilineBody(rl, ex.desc || null);
    const url  = await ask(rl, 'URL (Enterでスキップ)', ex.url || '');

    const updated = { t, y, k, ...(img ? { img } : {}), ...(desc ? { desc } : {}), ...(url ? { url } : {}) };
    console.log('\n  更新後:');
    displayWorkRow(updated, idx);

    const ok = await confirm(rl, '  この内容で保存しますか？');
    if (ok) {
      works[idx] = updated;
      writeData(setWorks(data, works));
      console.log(col.green(`  ✓ Work「${t}」を更新しました`));
    } else {
      console.log(col.yellow('  キャンセルしました'));
    }
  } finally {
    rl.close();
  }
}

async function cmdWorksDelete(index) {
  if (!index) { console.error(col.red('  番号を指定してください')); return; }
  const rl = createRL();
  try {
    const data  = readData();
    const works = getWorks(data);
    const idx   = parseInt(index, 10) - 1;

    if (idx < 0 || idx >= works.length) {
      console.error(col.red(`  Work番号 ${index} が見つかりません`));
      return;
    }

    displayWorkRow(works[idx], idx);
    const ok = await confirm(rl, col.red('  このWorkを削除しますか？'));
    if (ok) {
      const [removed] = works.splice(idx, 1);
      writeData(setWorks(data, works));
      console.log(col.green(`  ✓ Work「${removed.t}」を削除しました`));
    } else {
      console.log(col.yellow('  キャンセルしました'));
    }
  } finally {
    rl.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Top コマンド
// ─────────────────────────────────────────────────────────────────────────────
async function cmdTopShow() {
  const data = readData();
  const hero = getHero(data);
  console.log(col.bold('\n  Top ページ'));
  displayHero(hero);
}

async function cmdTopEdit() {
  const rl = createRL();
  try {
    const data = readData();
    const hero = getHero(data);

    console.log(col.bold('\n  Top ページを編集'));
    displayHero(hero);
    console.log(col.dim('  ※ Enterキーで現在の値を保持'));
    console.log(hr());

    const title = await ask(rl, 'メインタイトル', hero.title);

    console.log(`\n  ${col.bold('紹介文')}:`);
    console.log(col.dim(`    現在: ${hero.lede.slice(0, 60)}…`));
    const editLede = await confirm(rl, '  紹介文を編集しますか？');
    let lede = hero.lede;
    if (editLede) {
      console.log(col.dim('  新しい紹介文を入力 (空行で終了):'));
      const lines = [];
      while (true) {
        const line = await new Promise(resolve =>
          rl.question(col.dim(`  > `), resolve)
        );
        if (line.trim() === '') break;
        lines.push(line.trim());
      }
      if (lines.length > 0) lede = lines.join(' ');
    }

    console.log(col.bold('\n  NOW items:'));
    const nowItems = [];
    for (const item of hero.nowItems) {
      const value = await ask(rl, `  ${col.cyan(item.key)}`, item.value);
      nowItems.push({ key: item.key, value });
    }

    const updated = { title, lede, nowItems };
    console.log(col.bold('\n  更新後:'));
    displayHero(updated);

    const ok = await confirm(rl, '  この内容で保存しますか？');
    if (ok) {
      writeData(setHero(data, updated));
      console.log(col.green('  ✓ Topページを更新しました'));
    } else {
      console.log(col.yellow('  キャンセルしました'));
    }
  } finally {
    rl.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// インタラクティブメニュー
// ─────────────────────────────────────────────────────────────────────────────
async function interactiveMenu() {
  const rl = createRL();

  const items = [
    { label: 'Blog  — 記事一覧を見る',            cmd: async () => { rl.close(); await cmdBlogList(); } },
    { label: 'Blog  — 記事を追加する',            cmd: async () => { rl.close(); await cmdBlogAdd(); } },
    { label: 'Blog  — 記事を編集する',            cmd: async () => {
        const id = await ask(rl, '編集する記事のID'); rl.close(); await cmdBlogEdit(id); } },
    { label: 'Blog  — 記事を削除する',            cmd: async () => {
        const id = await ask(rl, '削除する記事のID'); rl.close(); await cmdBlogDelete(id); } },
    { label: 'Works — 一覧を見る',               cmd: async () => { rl.close(); await cmdWorksList(); } },
    { label: 'Works — Workを追加する',            cmd: async () => { rl.close(); await cmdWorksAdd(); } },
    { label: 'Works — Workを編集する',            cmd: async () => {
        const idx = await ask(rl, '編集するWork番号'); rl.close(); await cmdWorksEdit(idx); } },
    { label: 'Works — Workを削除する',            cmd: async () => {
        const idx = await ask(rl, '削除するWork番号'); rl.close(); await cmdWorksDelete(idx); } },
    { label: 'Top   — Topページを確認する',        cmd: async () => { rl.close(); await cmdTopShow(); } },
    { label: 'Top   — Topページを編集する',        cmd: async () => { rl.close(); await cmdTopEdit(); } },
    { label: '終了',                              cmd: async () => { rl.close(); process.exit(0); } },
  ];

  console.log(col.bold('\n  メインメニュー'));
  console.log(hr());
  items.forEach((item, i) => {
    console.log(`  ${col.dim((i + 1) + '.')} ${item.label}`);
  });
  console.log(hr());

  const answer = await ask(rl, '番号を入力');
  const num    = parseInt(answer, 10);

  if (isNaN(num) || num < 1 || num > items.length) {
    console.log(col.yellow('  無効な入力です'));
    rl.close();
    return;
  }

  await items[num - 1].cmd();
}

// ─────────────────────────────────────────────────────────────────────────────
// ヘルプ表示
// ─────────────────────────────────────────────────────────────────────────────
function showHelp() {
  console.log(col.bold('\n  使い方:'));
  console.log('');
  console.log('  node portfolio-cli.js');
  console.log(col.dim('    インタラクティブメニューを起動'));
  console.log('');
  console.log(col.bold('  Blog:'));
  console.log('  node portfolio-cli.js blog list             記事一覧');
  console.log('  node portfolio-cli.js blog show <id>        記事詳細');
  console.log('  node portfolio-cli.js blog add              記事追加');
  console.log('  node portfolio-cli.js blog edit <id>        記事編集');
  console.log('  node portfolio-cli.js blog delete <id>      記事削除');
  console.log('');
  console.log(col.bold('  Works:'));
  console.log('  node portfolio-cli.js works list            Works一覧');
  console.log('  node portfolio-cli.js works add             Work追加');
  console.log('  node portfolio-cli.js works edit <番号>     Work編集');
  console.log('  node portfolio-cli.js works delete <番号>   Work削除');
  console.log('');
  console.log(col.bold('  Top:'));
  console.log('  node portfolio-cli.js top show              Topページ表示');
  console.log('  node portfolio-cli.js top edit              Topページ編集');
  console.log('');
  console.log(col.dim('  ※ 保存時に data.json.bak がバックアップとして作成されます。'));
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// エントリーポイント
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  banner();

  const args = process.argv.slice(2);
  const [cmd, sub, arg] = args;

  if (!cmd) {
    await interactiveMenu();
    return;
  }

  switch (cmd) {
    case 'blog':
      switch (sub) {
        case 'list':   await cmdBlogList();      break;
        case 'show':   await cmdBlogShow(arg);   break;
        case 'add':    await cmdBlogAdd();        break;
        case 'edit':   await cmdBlogEdit(arg);   break;
        case 'delete': await cmdBlogDelete(arg); break;
        default: console.log(col.yellow('  blog list | show <id> | add | edit <id> | delete <id>'));
      }
      break;

    case 'works':
      switch (sub) {
        case 'list':   await cmdWorksList();        break;
        case 'add':    await cmdWorksAdd();          break;
        case 'edit':   await cmdWorksEdit(arg);     break;
        case 'delete': await cmdWorksDelete(arg);   break;
        default: console.log(col.yellow('  works list | add | edit <番号> | delete <番号>'));
      }
      break;

    case 'top':
      switch (sub) {
        case 'show': await cmdTopShow(); break;
        case 'edit': await cmdTopEdit(); break;
        default: console.log(col.yellow('  top show | edit'));
      }
      break;

    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;

    default:
      console.log(col.yellow(`  不明なコマンド: ${cmd}`));
      showHelp();
  }
}

main().catch(e => {
  console.error(col.red(`\n  エラー: ${e.message}`));
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
