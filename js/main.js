import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js";
import { calcMmPerPx } from './utils.js';
import { RestEvaluator } from './modules/eval_rest.js';

// === DOM要素の取得 ===
const menuView = document.getElementById('menu-view');
const instructionView = document.getElementById('instruction-view');
const evalView = document.getElementById('eval-view');
const resultView = document.getElementById('result-view');

const currentTitle = document.getElementById('current-title');
const status = document.getElementById('status');
const video = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');
const ctx = canvas.getContext('2d');

// ボタン類
const btnInstBack = document.getElementById('btn-inst-back');
const btnStartCamera = document.getElementById('btn-start-camera');
const btnAction = document.getElementById('btn-action');
const btnBack = document.getElementById('btn-back');
const btnRetry = document.getElementById('btn-retry');
const btnHome = document.getElementById('btn-home');

// 結果表示用
const resultImg = document.getElementById('result-img');
const resultScore = document.getElementById('result-score');
const resultDetails = document.getElementById('result-details');
const countdownOverlay = document.getElementById('countdown-overlay');

const btnSwitchCamera = document.getElementById('btn-switch-camera');
btnSwitchCamera.addEventListener('click', toggleCamera);

// === 変数 ===
let faceLandmarker;
let runningMode = "VIDEO";
let lastVideoTime = -1;
let currentMode = null;      // 現在選ばれているモード
let currentEvaluator = null; // 現在の評価クラスインスタンス
let isFrontCamera = true; // デフォルトはインカメラ
let currentStream = null; // ストリーム保持用

// ★ 各評価クラスのインスタンスを準備
const evaluators = {
    'rest': new RestEvaluator(),
    // 'wrinkle': new WrinkleEvaluator(), // 今後追加
};

// === 1. 初期化 ===
async function init() {
    status.innerText = "Loading AI Model...";
    
    // MediaPipeロード
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
        },
        outputFaceBlendshapes: true,
        runningMode: runningMode,
        numFaces: 1
    });
    
    status.innerText = "Ready";
    
    // カメラ起動 (最初に許可を取ってしまう)
    startCamera();

    // メニューボタンのセットアップ
    setupMenu();
}

// === 2. カメラ起動関数 (修正) ===
async function startCamera() {
    // ストリームが残っていたら止める
    stopCamera();

    const constraints = {
        video: {
            // ★変更: フラグによってカメラを切り替える
            facingMode: isFrontCamera ? "user" : "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    };

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        currentStream = stream; // ストリームを保存
        video.srcObject = stream;
        
        // メタデータ読み込み待ち (非同期でしっかり待つ)
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                resolve(video);
            };
        });
        
        video.play();
        
        // ランドマーク検出ループ開始
        predictWebcam();

    } catch (err) {
        console.error("Camera Error:", err);
        alert("カメラの起動に失敗しました。カメラの権限を確認してください。");
    }
}

// ★追加: カメラ停止用関数
function stopCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
}

// ★追加: 切り替えボタンの処理
function toggleCamera() {
    isFrontCamera = !isFrontCamera; // フラグ反転

    // CSSクラスの付け外し (プレビューの反転/非反転)
    if (isFrontCamera) {
        video.classList.remove('normal-view'); // 鏡像
    } else {
        video.classList.add('normal-view');    // 正像 (見たまま)
    }

    // カメラ再起動
    startCamera();
}

// === 3. メニューと画面遷移 ===
function setupMenu() {
    document.querySelectorAll('.menu-item').forEach(btn => {
        btn.onclick = () => {
            const mode = btn.dataset.mode;
            
            if (mode === 'rest') {
                showInstruction(mode);
            } else if (mode === 'all') {
                alert("開発中: 通し評価モード");
            } else {
                alert("開発中: その他のモード");
            }
        };
    });
}

// 説明画面を表示
function showInstruction(mode) {
    currentMode = mode;
    menuView.classList.add('hidden');
    instructionView.classList.remove('hidden');
}

// 説明画面：「戻る」
btnInstBack.onclick = () => {
    instructionView.classList.add('hidden');
    menuView.classList.remove('hidden');
    currentMode = null;
};

// 説明画面：「カメラを起動する(次へ)」
btnStartCamera.onclick = () => {
    instructionView.classList.add('hidden');
    evalView.classList.remove('hidden');
    
    // 設定反映
    currentTitle.innerText = "安静時評価";
    currentEvaluator = evaluators[currentMode];
    
    // カメラは init() で既に動いているので、ここではステータス更新のみ
    btnAction.disabled = false;
    status.innerText = "ガイド枠に顔を合わせてください";
};

// 評価画面：「中断して戻る」
btnBack.onclick = () => {
    evalView.classList.add('hidden');
    menuView.classList.remove('hidden');
    
    // 状態リセット
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    status.innerText = "Select mode";
    currentMode = null;
    currentEvaluator = null;
};

// === 4. ループ処理 (推論のみ、描画なし) ===
async function predictWebcam() {

    if (!video.videoWidth || !video.videoHeight) {
        window.requestAnimationFrame(predictWebcam);
        return;
    }

    if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }

    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        // 常に推論だけは回しておく（準備用）
        if (faceLandmarker) {
            faceLandmarker.detectForVideo(video, startTimeMs);
        }
    }
    window.requestAnimationFrame(predictWebcam);
}

// === 5. アクションボタン（カウントダウン開始） ===
btnAction.onclick = () => {
    if (!faceLandmarker || !currentEvaluator) return;

    btnAction.disabled = true;

    // 3秒カウントダウン → 撮影
    startCountdown(3, () => {
        performCapture();
    });
};

// カウントダウン処理
function startCountdown(seconds, callback) {
    let counter = seconds;
    
    countdownOverlay.innerText = counter;
    countdownOverlay.classList.remove('hidden');

    const timer = setInterval(() => {
        counter--;
        if (counter > 0) {
            countdownOverlay.innerText = counter;
        } else {
            clearInterval(timer);
            countdownOverlay.classList.add('hidden');
            callback(); // 完了コールバック
        }
    }, 1000);
}


// 6. 実際の撮影・解析・結果表示 (丸ごと差し替え)
function performCapture() {
    let startTimeMs = performance.now();
    let results = faceLandmarker.detectForVideo(video, startTimeMs);

    if (results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        const w = canvas.width;
        const h = canvas.height;
        const mmPerPx = calcMmPerPx(landmarks, w, h);
        
        // --- 角度計算 (撮影用) ---
        // 黒目の位置から顔の傾きを算出
        const il = landmarks[468]; 
        const ir = landmarks[473];
        
        const ix1 = il.x * w; const iy1 = il.y * h;
        const ix2 = ir.x * w; const iy2 = ir.y * h;
        
        // 中心点
        const cx = (ix1 + ix2) / 2;
        const cy = (iy1 + iy2) / 2;
        
        // 傾き角度 (ラジアン)
        const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);

        // --- 描画処理 ---
        ctx.save();
        
        // ▼▼▼ 条件分岐 ▼▼▼
        if (isFrontCamera) {
            // 【インカメラ (自撮り)】
            // 1. 鏡面反転 (左右反転)
            ctx.translate(w, 0);
            ctx.scale(-1, 1);
            
            // 2. 回転補正 (顔を水平にする)
            // 鏡面反転済みの座標系なので、回転方向の扱いに注意して回す
            ctx.translate(cx, cy);    
            ctx.rotate(angleRad);     
            ctx.translate(-cx, -cy);  

        } else {
            // 【外カメラ (医師撮影)】
            // ★反転させない！ (scaleを使わない)
            
            // 1. 回転補正のみ行う
            ctx.translate(cx, cy);
            ctx.rotate(angleRad);
            ctx.translate(-cx, -cy);
        }
        // ▲▲▲ 条件分岐ここまで ▲▲▲

        // 3. 画像描画
        // (補正された座標系の上に描くので、結果的に真っ直ぐな画像になる)
        ctx.drawImage(video, 0, 0, w, h);

        // --- 評価実行 ---
        // 評価ロジックには、補正に使った angleRad も渡す (eval_rest.js 側の対応が必要)
        const resultData = currentEvaluator.evaluate(landmarks, ctx, w, h, mmPerPx, angleRad);

        ctx.restore(); // 座標系を元に戻す

        // --- 結果画面へ反映 ---
        resultImg.src = canvas.toDataURL('image/png');
        
        const avgScore = Math.round(resultData.total / resultData.count);
        resultScore.innerText = avgScore;

        resultDetails.innerHTML = "";
        resultData.details.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${item.name}</td><td>${item.value}</td><td>${item.score}</td>`;
            resultDetails.appendChild(row);
        });

        evalView.classList.add('hidden');
        resultView.classList.remove('hidden');

    } else {
        alert("顔が見つかりません。枠内に顔を入れてください。");
    }
    btnAction.disabled = false;
}

// === 7. 結果画面のボタン ===

// 「再撮影」
btnRetry.onclick = () => {
    resultView.classList.add('hidden');
    evalView.classList.remove('hidden');
    
    // キャンバスをクリアしてカメラ映像のみにする
    ctx.clearRect(0, 0, canvas.width, canvas.height);
};

// 「評価選択画面に戻る」
btnHome.onclick = () => {
    resultView.classList.add('hidden');
    menuView.classList.remove('hidden');
    
    // リセット
    currentMode = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    status.innerText = "Select mode";
};

// アプリ起動
init();