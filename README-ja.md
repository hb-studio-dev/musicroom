
# MusicRoom Standalone（Electron）

このパッケージは、添付いただいた React/Vite 製 UI を **スタンドアロン（Electron）** として動作させるための最小構成です。
将来的に「UI」と「音声処理」を明確に分離するための土台（`electron/` に IPC API を用意）も含めています。

> **現状**: 音源分離やフォーマット処理は未実装のスタブです（`electron/main.js`）。まずは「アプリとして起動・配布できる」状態にしました。

---

## ディレクトリ構成

```
MusicRoom-Standalone/
├─ electron/            # メインプロセス（UIと分離した音声処理の入り口）
│  ├─ main.js           # Electron エントリ。IPC ハンドラに audio:format / audio:separate / audio:timePitch を用意
│  └─ preload.js        # レンダラに安全に API を公開（window.musicroom.*）
├─ renderer/            # 既存 UI プロジェクト（Vite/React）
│  ├─ src/, public/ …   # 添付ZIPの内容を移植。vite.config.ts は Electron 用に base:'./' を追加済み
│  └─ package.json      # 元の依存はルートに取り込み済み（ルートで npm i すればOK）
├─ package.json         # ルートのパッケージ設定（Electron + Vite 一括管理）
└─ README-ja.md
```

今後は `electron/` 側に「フォーマット」「音源分離（MVSEP-MDX23）」「ピッチ/スピード」を **別ファイル** として実装していきます（UI からは `window.musicroom.audio.*` 経由で呼び出し）。

---

## セットアップ & 起動

```bash
# Node.js 18 以上推奨（LTS）
npm install

# 開発起動（Vite + Electron）
npm run dev
#  → http://localhost:5173 でViteが起動し、ElectronがそのURLを読み込みます
```

ビルド（配布用）:

```bash
npm run build      # レンダラを build してから electron-builder でパッケージ化
# もしくは
npm run dist:mac   # macOS 向け
npm run dist:win   # Windows 向け
npm run dist:linux # Linux 向け
```

> 署名やGatekeeper回りは各OSごとに別途設定が必要な場合があります。

---

## 将来の実装方針（分離）

- `electron/audio/format/` … ffmpeg-static + fluent-ffmpeg 等で **フォーマット変換/正規化** を実装
- `electron/audio/separate/` … **MVSEP-MDX23**（onnxruntime-node）での音源分離を実装
- `electron/audio/time-pitch/` … **ピッチ/スピード** 変更（Rubber Band Library, SoundTouch 等のラッパー）

それぞれを `ipcMain.handle('audio:…')` にぶら下げ、`preload.js` 経由で `window.musicroom.audio.*` から呼べるようにします。

---

## UI 側（renderer）の変更について

現時点では **UI のコードは最小限の変更**（`vite.config.ts` に `base:'./'` 追加）に留めています。  
Electron からの API を使う場合は、レンダラの任意の場所で以下のように呼び出せます。

```ts
// 例: スタブ呼び出し
const result = await window.musicroom.audio.separate({ inputPath: '/path/to/file.wav' });
console.log(result);
```

> 型定義が必要なら `src/types/global.d.ts` を追加し `declare global { interface Window { musicroom: any } }` などを定義してください。

---

## 既知の注意点

- Web 向けに `onnxruntime-web` / `@ffmpeg/ffmpeg` を使っている部分は、
  将来的に **ネイティブ向け（onnxruntime-node / ffmpeg-static）** に差し替える想定です。
- モデルファイル（`public/models/**`）は `extraResources` としてアプリに同梱されます。

---

## ライセンス

添付プロジェクトのライセンス条件に従ってください。Electron ランタイムや各依存パッケージはそれぞれのライセンスに従います。


---

## GitHub Actions で各OSビルド

`.github/workflows/ci-build.yml` を追加済みです。  
`main` ブランチに push / PR するか、**Run workflow** で手動実行すると、`macOS / Windows / Linux` 各ランナーでビルドして成果物を **Artifacts** にアップロードします。

- 署名は無効化（`CSC_IDENTITY_AUTO=false`）。配布前にローカル or 秘密鍵で署名へ切替可。
- GitHub Release を使う場合は `release.yml`（タグ `v*.*.*`）を利用。`GITHUB_TOKEN` でドラフトリリースに成果物を添付します。
