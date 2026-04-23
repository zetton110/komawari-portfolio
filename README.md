# my-portfolio

ポートフォリオサイト (`portfolio.html`) のコンテンツを管理するCLIツールです。  
Top ページ・Blog 記事・Works をターミナルから追加・編集・削除できます。

## 必要な環境

- Node.js 18 以上

## セットアップ

```bash
npm install
```

## 使い方

### インタラクティブモード

引数なしで起動するとメニューが表示されます。

```bash
node portfolio-cli.js
```

### コマンドモード

#### Blog

```bash
node portfolio-cli.js blog list             # 記事一覧
node portfolio-cli.js blog show <id>        # 記事詳細
node portfolio-cli.js blog add              # 記事追加
node portfolio-cli.js blog edit <id>        # 記事編集
node portfolio-cli.js blog delete <id>      # 記事削除
```

#### Works

```bash
node portfolio-cli.js works list            # Works一覧
node portfolio-cli.js works add             # Work追加
node portfolio-cli.js works edit <番号>     # Work編集
node portfolio-cli.js works delete <番号>   # Work削除
```

#### Top ページ

```bash
node portfolio-cli.js top show              # Topページ表示
node portfolio-cli.js top edit              # Topページ編集
```

## ローカルサーバー

`server.js` を起動すると、ブラウザでポートフォリオを確認しながら編集できます。

```bash
npm start
# または
node server.js
```

| URL | 内容 |
|-----|------|
| http://localhost:3000 | ポートフォリオ本体 |
| http://localhost:3000/admin | 管理画面（GUI） |

`portfolio.html` を保存するとブラウザが自動でリロードされます（ホットリロード）。  
ポート番号は環境変数 `PORT` で変更できます。

```bash
PORT=8080 node server.js
```

## ファイル構成

```
my-portfolio/
├── portfolio.html       # ポートフォリオ本体
├── portfolio-cli.js     # コンテンツ管理CLI
├── server.js            # ローカル開発サーバー
├── images/              # アップロードした画像
└── package.json
```

## メモ

- 保存時に `portfolio.html.bak` が自動生成されます（直前のバックアップ）。
- 画像を登録すると `images/` フォルダへ自動コピーされます。
- デバッグ時は `DEBUG=1` 環境変数を付けるとスタックトレースが表示されます。
