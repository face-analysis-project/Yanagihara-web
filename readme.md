# 柳原法 自動評価アプリ (Yanagihara Method Facial Palsy Evaluator)

Webブラウザ上で動作する、顔面神経麻痺の評価法「柳原法（40点法）」を支援するアプリケーションです。
Google MediaPipe Tasks Vision（Face Landmarker）で顔ランドマークを検出し、**左右差（mm）や比率（%）、角度（deg）**を数値化して閾値判定（4/2/0点）します。

このREADMEは **技術者向け** に、実装の考え方・計測指標・採点条件を中心にまとめています。

## 📌 実装状況

- **10項目すべて実装済み**
    - 安静時（rest）
    - 額のしわ寄せ（wrinkle）
    - 軽い閉眼（blink-light）
    - 強い閉眼（blink-heavy）
    - 片目つぶり（wink）
    - 鼻翼を動かす（nose）
    - 頬をふくらます（cheek）
    - 口笛（whistle）
    - イーと歯を見せる（eee）
    - 口をへの字に（henoji）
- **通し評価（all）実装済み**
    - 10項目を順番に測定し、合計スコアと内訳を表示
- **PDFレポート出力（非表示）**
    - 実装は残していますが、UIからは非表示にしています。現在開発中

## ✨ 主な機能（共通基盤）

1. **顔ランドマーク検出（常時推論）**
     - MediaPipe Face Landmarker（`detectForVideo`）で 468点 + 虹彩ランドマークを取得

2. **mm換算（虹彩径ベース）**
     - 虹彩直径を `CFG.IRIS_DIAMETER_MM = 11.7mm` と仮定し、`mmPerPx` を算出
     - 実装: `js/utils.js` の `calcMmPerPx()`

3. **自動水平補正（結果画像の回転補正）**
     - 虹彩中心（`468/473`）から両眼ベースライン角 `angleRad` を算出し、結果描画時にキャンバス座標系を回転
     - 実装: `js/main.js` の各 `render*Result()`

4. **インカメラ/外カメラ切替**
     - インカメラは「鏡像プレビュー＋保存も左右反転」
     - 外カメラは「正像」
     - 実装: `toggleCamera()` と `isFrontCamera` による `ctx.scale(-1, 1)` 分岐

## 🧭 計測パイプライン（3秒計測 + ベストフレーム抽出）

評価は大きく2系統です。

- **単発撮影型（rest）**: カウントダウン後に1フレーム撮影 → そのフレームを評価
- **動作中ベスト抽出型（eee/whistle/cheek/blink/wink）**: 3秒間ランドマークを取り続けて、
    - 基準（rest/open）フレームと
    - 動作の「最大/最小」フレーム
    を抽出して評価

抽出の考え方（例）:

- eee: 口幅（口角間距離）が **最大** のフレームをMaxとして採用
- whistle: 口幅が **最小** のフレームをActとして採用
- cheek: 鼻から頬点までのX距離が **最も増えた** フレームをMaxとして採用（候補点も利用）
- blink-light / blink-heavy: 目の上下瞼距離が **最小** のフレームをClosedとして採用
- wink: 対象目のみ、上記と同様（2ステップで右→左）

## 🧪 実装済み評価（10項目）

以降は「何を計測して、どの閾値で採点しているか」をコード準拠で記載します。
採点閾値は `js/config.js` の `CFG.THRESH_*` が唯一の真実です。

### 1) 安静時（rest）

- 実装: `js/modules/eval_rest.js`（`RestEvaluator.evaluate()`）
- 目的: 安静時の左右非対称（目・口）と人中傾きを定量化

計測:

- **目尻の高さ差**: `CFG.ID.EYE_L / EYE_R` の高さ差をmm換算
- **口角の高さ差**: `CFG.ID.MOUTH_L / MOUTH_R` の高さ差をmm換算
- **人中の傾き**: `CFG.ID.PHILTRUM_TOP / PHILTRUM_BTM` の角度を、顔の垂直軸（両眼線+90°）からの差分(deg)で評価

重要ポイント:

- 高さ差は「顔の傾き」を両眼中心基準で補正した座標（回転後Y）で計測（`getRelativeY()`）

閾値（4/2/0点）:

| 指標 | 4点 | 2点 | 0点 |
| --- | --- | --- | --- |
| 目尻の高さ左右差(mm) | `< 2.0` | `2.0–5.0` | `>= 5.0` |
| 口角の高さ左右差(mm) | `< 3.0` | `3.0–6.0` | `>= 6.0` |
| 人中の傾き(deg) | `< 10` | `10–20` | `>= 20` |

### 2) 軽い閉眼（blink-light）

- 実装: `js/modules/eval_light_close.js`（`LightCloseEvaluator.evaluateAndDraw()`）
- 入力: openフレーム + closedフレーム（`performLightCloseCapture()` で抽出）

計測:

- 基準線: 目頭–目尻を水平にするよう回転正規化
- **閉眼隙間（gap）**: 回転後の上下瞼Y差分（負値は0扱い）
- **閉じ度（%）**: $\mathrm{ratio}=\left(1-\frac{H_{closed}}{H_{open}}\right)\times 100$（範囲外は0–100%にクランプ）
- 参考として、上瞼/下瞼の移動量(mm)も表示（スコアには不使用）

採点:

- 右目・左目をそれぞれ **閉じ度(%)** で 4/2/0 点
- 合計（右+左）を2で割って平均表示

閾値:

| 指標 | 4点 | 2点 | 0点 |
| --- | --- | --- | --- |
| 閉じ度(%) | `>= 95` | `>= 60` | `< 60` |

### 3) 強い閉眼（blink-heavy）

- UI上は「強い閉眼」ですが、**現状は blink-light と同一実装**（同一 evaluator / 同一閾値）です
    - `js/main.js` で `blink-heavy: new LightCloseEvaluator()`
    - 閾値も `CFG.THRESH_LIGHT_CLOSE_RATIO` を共用

今後「強い閉眼」専用の判定を分ける場合は、
`THRESH_HEAVY_CLOSE_*` を追加して evaluator か mode 分岐を導入するのが自然です。

### 4) 片目つぶり（wink）

- 実装: `js/modules/eval_wink.js`（`WinkEvaluator.evaluateAndDraw()`）
- 2ステップ計測:
    - 右目 → 左目の順で `open/closed` を取り、個別に評価
    - 結果画面は左右別の画像＋表形式

計測/採点:

- 対象目のみ、上下瞼隙間（gap）と閉じ度(%)を算出
- 採点は **閉じ度(%)** ベース（blink-lightと同等の判定ロジック）

※ `js/config.js` に `THRESH_WINK_GAP_MM` は存在しますが、現状の採点は gap(mm) ではなく ratio(%) で行っています。

### 5) 頬をふくらます（cheek）

- 実装: `js/modules/eval_cheek.js`（`CheekEvaluator.evaluateAndDraw()`）
- 入力: restフレーム + maxフレーム（3秒内で「膨らみが最大」のフレームを抽出）

Max抽出（`performCheekCapture()`）:

- デフォルト頬点（`CFG.ID.CHEEK_L/R`）に加え、
    468点から「頬らしい候補点」を左右それぞれ複数（デフォルト4点）自動選定
- Max判定は候補点群の差分（鼻からの距離増加）が最大のフレームを採用

計測:

- 鼻中心（`CFG.ID.NOSE_CENTER`）から頬点までの **X方向距離(mm)** をrest/maxで比較
- **膨張率(%)**: $\frac{\Delta d}{d_{rest}}\times 100$
- **左右比率(%)**: $\frac{\min(p_L,p_R)}{\max(p_L,p_R)}\times 100$

採点:

- 右頬の膨張率（%）
- 左頬の膨張率（%）
- 左右比率（%）
の3指標をそれぞれ 4/2/0点

閾値（現状は実測に合わせてかなり低め）:

| 指標 | 4点 | 2点 | 0点 |
| --- | --- | --- | --- |
| 膨張率(%) | `>= 2` | `>= 1` | `< 1` |
| 左右比率(%) | `>= 25` | `>= 15` | `< 15` |

### 6) 口笛（whistle: 口をすぼめる）

- 実装: `js/modules/eval_whistle.js`（`WhistleEvaluator.evaluateAndDraw()`）
- 入力: restフレーム + actフレーム（3秒内で「口幅が最小」のフレームを抽出）

計測:

- 安静時口幅 $W_{rest}$ と すぼめ時口幅 $W_{act}$（口角間距離）
- **口幅比(%)**: $\frac{W_{act}}{W_{rest}}\times 100$
- 参考として左右口角の変化量(mm)も表示（スコアには不使用）

採点:

- 口幅比(%) を 4/2/0点（比が大きいほど良い＝「すぼめきれていない」方向に見えるので注意）
    - 現状のスコアは **口幅比が大きいほど高得点** になる実装です（`scoreByMouthRatioPercent()`）。
    - 意図が「よりすぼめられているほど高得点」であれば、閾値設計または不等号方向の見直しが必要です。

閾値:

| 指標 | 4点 | 2点 | 0点 |
| --- | --- | --- | --- |
| 口幅比(%) | `>= 50` | `>= 30` | `< 30` |

### 7) イー（eee: 歯を見せる）

- 実装: `js/modules/eval_mouth_corner.js`（`EeeEvaluator.evaluateAndDraw()`）
- 入力: restフレーム + maxフレーム（3秒内で「口幅が最大」のフレームを抽出）

計測:

- 左口角は「外側（左）」、右口角は「外側（右）」への水平移動量のみを採用
    - 左: `restL.x - maxL.x`（mm）
    - 右: `maxR.x - restR.x`（mm）
- **対称性(%)**: $\frac{\min(d_L,d_R)}{\max(d_L,d_R)}\times 100$

採点（対称性）:

| 指標 | 4点 | 2点 | 0点 |
| --- | --- | --- | --- |
| 対称性(%) | `>= 70` | `>= 30` | `< 30` |

### 8) 額のしわ寄せ（wrinkle）

- 実装: `js/modules/eval_wrinkle.js`
- 眉毛の挙上距離（mm）と左右比率（%）を計測
- 基準点は目頭、計測点は眉中央（`105/334`）

閾値:

| 指標 | 4点 | 2点 | 0点 |
| --- | --- | --- | --- |
| 眉の挙上距離(mm) | `>= 6.0` | `>= 3.0` | `< 3.0` |
| 左右比率(%) | `>= 70` | `>= 30` | `< 30` |

### 9) 鼻翼を動かす（nose）

- 実装: `js/modules/eval_nose.js`
- 鼻先（ID:1）と鼻翼内側（`79/309`）の距離変化で評価
- 口角などの横移動を除外するため、距離差分のみを使用

閾値:

| 指標 | 4点 | 2点 | 0点 |
| --- | --- | --- | --- |
| 鼻翼の拡張距離(mm) | `>= 1.5` | `>= 0.5` | `< 0.5` |

### 10) 口をへの字に（henoji）

- 実装: `js/modules/eval_henoji.js`
- 目頭から口角までの垂直距離の増加量を評価
- X方向の変化は無視し、下降方向のみを採点

閾値:

| 指標 | 4点 | 2点 | 0点 |
| --- | --- | --- | --- |
| 口角の下降距離(mm) | `>= 3.0` | `>= 1.0` | `< 1.0` |

## 🧭 通し評価（all）モード

- 実装: `js/modules/sequence_manager.js`
- 10項目を順番に測定し、合計スコアと内訳を表示
- 途中の再撮影（Retry）に対応

## ⚙️ 設定（閾値・ランドマークID）

- 閾値: `js/config.js` の `CFG.THRESH_*`
- 使用ランドマークID: `js/config.js` の `CFG.ID.*`

調整の入口は基本的に `js/config.js` です。
（特に頬・口笛は、健常者での実測に合わせて暫定チューニングが入っています）

## 💻 技術スタック

- Frontend: HTML5, CSS3, JavaScript (ES6 Modules)
- AI/ML: Google MediaPipe Tasks Vision (Face Landmarker)
- Target: Mobile & Desktop Browsers (Chrome, Safari, Edge)

## 📂 ディレクトリ構成

```text
.
├── index.html
├── readme.md
├── css/
│   └── style.css
└── js/
        ├── config.js
        ├── main.js
        ├── utils.js
        └── modules/
            ├── eval_rest.js
            ├── eval_light_close.js
            ├── eval_wink.js
            ├── eval_cheek.js
            ├── eval_whistle.js
            ├── eval_mouth_corner.js
            ├── eval_wrinkle.js
            ├── eval_nose.js
            ├── eval_henoji.js
            ├── sequence_manager.js
            └── pdf_generator.js (開発中)
```

## ⚠️ 免責事項 (Disclaimer)

- 本アプリケーションは開発中のプロトタイプであり、医療機器ではありません。
- 表示されるスコアや計測値はあくまで参考値であり、医師の診断を代替するものではありません。
- 本アプリの使用によって生じた損害等について、開発者は一切の責任を負いません。

## 📝 TO-DO
- パラメータ調整
- 使いやすいUI開発
- 違う評価手法の実装


## 📅 更新履歴

- 2026/01/15: 安静時評価、外カメラ対応、自動水平補正の追加
- 2026/01/20: 7項目（rest / blink-light / blink-heavy / wink / cheek / whistle / eee）の実装とREADME更新
- 2026/02/02: 10項目+通し評価の実装とREADME更新
- 2026/02/20: github repository を変更。face-analysis-project oganizationを作成。

---