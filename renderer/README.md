# Music Room UI — ONNX (WebGPU) + Mixer M/S

- File Import → **Format (44.1k/stereo/float/0.98)** → **Analyze (MDX skeleton)**
- Mixer に **M（Mute）/ S（Solo）** を追加（Soloは同時に1つ）
- Two states: **Normal / Hide**（Hideはオーバーレイ文言切替できる）
- 分離ステムは **メモリ保持**（Blob+URL）。**確認用に自動ダウンロード**。
- 既定では **builtin://mdx-lite**（擬似マスク）で即実行可能。高精度化する場合は **/public/models** に .onnx を配置し `public/models.json` を編集してください。

## 起動
```bash
npm i
npm run dev
```

## ONNXモデルの入れ方
`public/models/` に .onnx を置き、`public/models.json` を次のように書き換えます。
```jsonc
{
  "models": [
    { "name": "mdx-vocals", "path": "/models/mdx-vocals.onnx", "target": "Vocal",  "n_fft": 2048, "hop_length": 512, "window": "hann", "inputLayout": "NCHW", "magOnly": true },
    { "name": "mdx-bass",   "path": "/models/mdx-bass.onnx",   "target": "Bass",   "n_fft": 2048, "hop_length": 512, "window": "hann", "inputLayout": "NCHW", "magOnly": true },
    { "name": "mdx-drums",  "path": "/models/mdx-drums.onnx",  "target": "Drums",  "n_fft": 2048, "hop_length": 512, "window": "hann", "inputLayout": "NCHW", "magOnly": true },
    { "name": "mdx-other",  "path": "/models/mdx-other.onnx",  "target": "Others", "n_fft": 2048, "hop_length": 512, "window": "hann", "inputLayout": "NCHW", "magOnly": true }
  ]
}
```
> 6ステム化（Piano/Guitar 追加）も同様にOK。

## 実装メモ
- `src/workers/mdx-worker.ts` の `runORT()` に **onnxruntime-web** 推論を実装すれば高精度化。
- `builtin://mdx-lite` は帯域ベースの簡易マスク（デモ用）。
- 分離完了後、ステムの `peak` で存在推定 → **UIのフェーダーを自動グレーアウト**。

## イベント
- `musicroom:formatted` / `musicroom:separated` / `musicroom:mixChange`
- エラー時：`musicroom:formatOrAnalysisError`（UIはHide + 文言）
