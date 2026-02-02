import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js";
import { calcMmPerPx, getCoord } from './utils.js';
import { CFG } from './config.js';
import { RestEvaluator } from './modules/eval_rest.js';
import { EeeEvaluator } from './modules/eval_mouth_corner.js';
import { LightCloseEvaluator } from './modules/eval_light_close.js';
import { WinkEvaluator } from './modules/eval_wink.js';
import { WhistleEvaluator } from './modules/eval_whistle.js';
import { CheekEvaluator } from './modules/eval_cheek.js';
import { WrinkleEvaluator } from './modules/eval_wrinkle.js';
import { NoseEvaluator } from './modules/eval_nose.js';
import { HenojiEvaluator } from './modules/eval_henoji.js';
import { SequenceManager } from './modules/sequence_manager.js';

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
const btnNext = document.getElementById('btn-next');
const instructionTitle = document.getElementById('instruction-title');

// 結果表示用
const resultImg = document.getElementById('result-img');
const resultScore = document.getElementById('result-score');
const resultDetails = document.getElementById('result-details');
const countdownOverlay = document.getElementById('countdown-overlay');
const allProgressEls = document.querySelectorAll('.all-progress');
const finalView = document.getElementById('final-view');
const finalTotal = document.getElementById('final-total');
const finalDetails = document.getElementById('final-details');
const btnFinalHome = document.getElementById('btn-final-home');

// ウィンク結果表示用
const winkResultBox = document.getElementById('wink-result-box');
const resultImgRight = document.getElementById('result-img-right');
const resultImgLeft = document.getElementById('result-img-left');
const resultTableHeadRow = document.querySelector('.score-table thead tr');
const defaultResultTableHeadHtml = resultTableHeadRow ? resultTableHeadRow.innerHTML : '';

// ガイド枠
const faceGuideOverlay = document.querySelector('.face-guide-overlay');
const eyeGuideOverlay = document.querySelector('.eye-guide-overlay');

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
let isMeasuring = false;

// 頬候補点（試行用）: { left: number[], right: number[] }
let cheekCandidatePreview = null;

function pickCheekCandidateIndices(landmarks, width, height, count = 4) {
    if (!landmarks) return null;

    const nose = getCoord(landmarks, CFG.ID.NOSE_CENTER ?? 168, width, height);
    const mouthL = getCoord(landmarks, CFG.ID.MOUTH_L, width, height);
    const mouthR = getCoord(landmarks, CFG.ID.MOUTH_R, width, height);
    const mouthMidY = (mouthL.y + mouthR.y) / 2;

    // 口角より少し上〜口角付近を狙う（下に落ちる候補を抑える）
    const yMin = mouthMidY - height * 0.10;
    const yMax = mouthMidY + height * 0.06;

    const selectSide = (side) => {
        const wantLeft = side === 'left';
        const candidates = [];
        for (let i = 0; i < 468; i++) {
            const p = getCoord(landmarks, i, width, height);
            if (p.y < yMin || p.y > yMax) continue;
            if (wantLeft && p.x >= nose.x - width * 0.02) continue;
            if (!wantLeft && p.x <= nose.x + width * 0.02) continue;

            const xDist = Math.abs(p.x - nose.x);
            const above = Math.max(0, mouthMidY - p.y);
            const below = Math.max(0, p.y - mouthMidY);
            // 下方向（below）は強くペナルティ：顎寄りの点が混ざりにくい
            const yPenalty = (1.0 * above) + (2.2 * below);
            const score = xDist - (1.2 * yPenalty);
            candidates.push({ idx: i, p, xDist, score });
        }

        // 横に張り出しつつ、口角高さに近い順
        candidates.sort((a, b) => b.score - a.score);

        // yが近い点ばかりにならないように間引く
        const picked = [];
        const minSepY = height * 0.03;
        for (const c of candidates) {
            if (picked.length >= count) break;
            const ok = picked.every(p => Math.abs(p.p.y - c.p.y) >= minSepY);
            if (ok) picked.push(c);
        }

        // 足りない場合は近接許容して補完
        if (picked.length < count) {
            for (const c of candidates) {
                if (picked.length >= count) break;
                if (picked.some(p => p.idx === c.idx)) continue;
                picked.push(c);
            }
        }

        return picked.slice(0, count).map(x => x.idx);
    };

    const left = selectSide('left');
    const right = selectSide('right');
    const n = Math.min(left.length, right.length);
    if (n === 0) {
        return {
            left: [CFG.ID.CHEEK_L],
            right: [CFG.ID.CHEEK_R]
        };
    }
    return {
        left: left.slice(0, n),
        right: right.slice(0, n)
    };
}

// ウィンク用の状態
let winkStep = 1; // 1:右目 2:左目
let winkRight = null;
let winkLeft = null;
let winkRightImgUrl = '';
let winkLeftImgUrl = '';

function resetWinkState() {
    winkStep = 1;
    winkRight = null;
    winkLeft = null;
    winkRightImgUrl = '';
    winkLeftImgUrl = '';
}

function setInstructionButtonLabel(mode) {
    const ui = MODE_UI[mode] ?? MODE_UI.rest;
    const label = ui.startButtonText ?? 'カメラを起動する';
    btnStartCamera.innerText = label;
}

function setResultViewMode(mode) {
    // mode: 'wink' | 'single'
    if (mode === 'wink') {
        resultImg.classList.add('hidden');
        if (winkResultBox) winkResultBox.classList.remove('hidden');
        if (resultTableHeadRow) {
            resultTableHeadRow.innerHTML = '<th>項目</th><th>右目</th><th>左目</th>';
        }
        return;
    }

    // single
    resultImg.classList.remove('hidden');
    if (winkResultBox) winkResultBox.classList.add('hidden');
    if (resultTableHeadRow) {
        resultTableHeadRow.innerHTML = defaultResultTableHeadHtml;
    }
}

function setGuideOverlayMode(mode) {
    // デフォルト: 顔用の楕円
    if (faceGuideOverlay) faceGuideOverlay.classList.remove('hidden');
    if (eyeGuideOverlay) eyeGuideOverlay.classList.add('hidden');

    if (mode === 'blink-light' || mode === 'blink-heavy' || mode === 'wink') {
        if (faceGuideOverlay) faceGuideOverlay.classList.add('hidden');
        if (eyeGuideOverlay) eyeGuideOverlay.classList.remove('hidden');
    }
}

// ★ 各評価クラスのインスタンスを準備
const evaluators = {
    'rest': new RestEvaluator(),
    'eee': new EeeEvaluator(),
    'blink-light': new LightCloseEvaluator(),
    'blink-heavy': new LightCloseEvaluator(),
    'wink': new WinkEvaluator(),
    'whistle': new WhistleEvaluator(),
    'cheek': new CheekEvaluator(),
    'wrinkle': new WrinkleEvaluator(),
    'nose': new NoseEvaluator(),
    'henoji': new HenojiEvaluator(),
};

const ALL_STEPS = [
    { id: 'rest', name: '安静時' },
    { id: 'wrinkle', name: '額のしわ寄せ' },
    { id: 'blink-light', name: '軽い閉眼' },
    { id: 'blink-heavy', name: '強い閉眼' },
    { id: 'wink', name: '片目つぶり' },
    { id: 'nose', name: '鼻翼を動かす' },
    { id: 'cheek', name: '頬をふくらます' },
    { id: 'whistle', name: '口笛' },
    { id: 'eee', name: 'イーと歯を見せる' },
    { id: 'henoji', name: '口をへの字にする' }
];

const sequenceManager = new SequenceManager(ALL_STEPS);

function isAllModeActive() {
    return sequenceManager?.active === true;
}

function updateAllProgress() {
    if (!allProgressEls) return;
    if (!isAllModeActive()) {
        allProgressEls.forEach(el => el.classList.add('hidden'));
        return;
    }
    const step = sequenceManager.currentStep();
    const idx = sequenceManager.currentStepIndex + 1;
    const total = ALL_STEPS.length;
    const text = step ? `STEP ${idx}/${total} : ${step.name}` : '';
    allProgressEls.forEach(el => {
        el.textContent = text;
        el.classList.remove('hidden');
    });
}

function updateResultButtons() {
    if (!btnNext || !btnHome) return;
    if (isAllModeActive()) {
        btnNext.classList.remove('hidden');
        btnHome.classList.add('hidden');
    } else {
        btnNext.classList.add('hidden');
        btnHome.classList.remove('hidden');
    }
}

function startAllMode() {
    const step = sequenceManager.start();
    if (!step) return;
    setResultViewMode('single');
    resetWinkState();
    if (finalView) finalView.classList.add('hidden');
    showInstruction(step.id);
    updateAllProgress();
}

function showFinalResults() {
    if (!finalView || !finalTotal || !finalDetails) return;

    const total = sequenceManager.totalScore();
    finalTotal.innerText = `${total} / 40`;

    finalDetails.innerHTML = '';
    sequenceManager.results.forEach((r, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${idx + 1}. ${r.name}</td><td>${r.score} 点</td>`;
        finalDetails.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.innerHTML = `<td><strong>合計</strong></td><td><strong>${total} 点</strong></td>`;
    finalDetails.appendChild(totalRow);

    menuView.classList.add('hidden');
    instructionView.classList.add('hidden');
    evalView.classList.add('hidden');
    resultView.classList.add('hidden');
    finalView.classList.remove('hidden');
    allProgressEls.forEach(el => el.classList.add('hidden'));
}

const MODE_UI = {
    rest: {
        instructionTitle: '安静時評価の手順',
        stepTexts: [
            '真正面を向き、カメラに顔を向けます。',
            '画面に表示される<span class="highlight">緑の枠</span>に顔の輪郭を合わせます。',
            '顔の力を抜き、リラックスした状態で「撮影」ボタンを押してください。'
        ],
        evalTitle: '安静時評価'
    },
    eee: {
        instructionTitle: 'イー（歯を見せる）評価の手順',
        stepTexts: [
            '「3・2・1」のカウントダウンのあと、',
            '全力で「イー」と歯を見せるように口を横に広げてください。',
            'そのまま3秒間キープし、終わったら力を抜いてください。'
        ],
        evalTitle: 'イー（歯を見せる）評価'
    },
    wrinkle: {
        instructionTitle: '額のしわ寄せ評価の手順',
        stepTexts: [
            '「3・2・1」のカウントダウンのあと、',
            '眉毛を上に向かって<span class="highlight">ぐっと持ち上げて</span>ください。',
            'おでこにシワを寄せるイメージで驚いた表情を作ってください。'
        ],
        evalTitle: '額のしわ寄せ評価'
    },
    nose: {
        instructionTitle: '鼻翼を動かす評価の手順',
        stepTexts: [
            '「3・2・1」のカウントダウンのあと、',
            '鼻の穴を大きく広げるように<span class="highlight">小鼻を横に膨らませて</span>ください。',
            '口は閉じたまま行ってください。'
        ],
        evalTitle: '鼻翼を動かす評価'
    },
    henoji: {
        instructionTitle: '口をへの字にする評価の手順',
        stepTexts: [
            '「3・2・1」のカウントダウンのあと、',
            '口の両端を下に引いて「不満がある顔」を作ってください。',
            '下の歯が見えるくらい、口角を首の方へ引き下げてください。'
        ],
        evalTitle: '口をへの字にする評価'
    },
    whistle: {
        instructionTitle: '口笛（口をすぼめる）評価の手順',
        stepTexts: [
            '「3・2・1」のカウントダウンのあと、',
            '口笛を吹くように、唇を前に突き出して<span class="highlight">強くすぼめて</span>ください。',
            'そして戻してください。測定は3秒間行います。'
        ],
        evalTitle: '口笛（口をすぼめる）評価'
    },
    cheek: {
        instructionTitle: '頬をふくらます評価の手順',
        stepTexts: [
            '「3・2・1」のカウントダウンのあと、',
            '息をためて<span class="highlight">頬をふくらませて</span>ください。',
            'そのまま戻してください。測定は3秒間行います。'
        ],
        evalTitle: '頬をふくらます評価'
    },
    'blink-light': {
        instructionTitle: '軽い閉眼評価の手順',
        stepTexts: [
            '「3・2・1」のカウントダウンのあと、',
            '軽く目を閉じてください。',
            '終わったら目を開けてください。'
        ],
        evalTitle: '軽い閉眼評価'
    },
    'blink-heavy': {
        instructionTitle: '強い閉眼評価の手順',
        stepTexts: [
            '「3・2・1」のカウントダウンのあと、',
            '強く目を閉じてください。',
            '終わったら目を開けてください。'
        ],
        evalTitle: '強い閉眼評価'
    },
    wink: {
        instructionTitle: '片目つぶり（ウィンク）評価の手順',
        stepTexts: [
            'このテストは片目ずつ行います。',
            '反対の目は開けたまま、指定された方の目だけをつぶってください。',
            'まず右目、次に左目の順で測定します。'
        ],
        evalTitle: '片目つぶり（ウィンク）評価',
        startButtonText: '測定を開始する（まずは右目）'
    }
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
        canvas.classList.remove('normal-view');
    } else {
        video.classList.add('normal-view');    // 正像 (見たまま)
        canvas.classList.add('normal-view');
    }

    // カメラ再起動
    startCamera();
}

// === 3. メニューと画面遷移 ===
function setupMenu() {
    document.querySelectorAll('.menu-item').forEach(btn => {
        btn.onclick = () => {
            const mode = btn.dataset.mode;
            
            if (mode === 'rest' || mode === 'eee' || mode === 'whistle' || mode === 'cheek' || mode === 'blink-light' || mode === 'blink-heavy' || mode === 'wink' || mode === 'wrinkle' || mode === 'nose' || mode === 'henoji') {
                showInstruction(mode);
            } else if (mode === 'all') {
                startAllMode();
            } else {
                alert("開発中: その他のモード");
            }
        };
    });
}

// 説明画面を表示
function showInstruction(mode) {
    currentMode = mode;

    const ui = MODE_UI[mode] ?? MODE_UI.rest;
    if (instructionTitle) instructionTitle.innerText = ui.instructionTitle;
    const stepCards = instructionView.querySelectorAll('.step-card p');
    ui.stepTexts?.forEach((text, idx) => {
        if (stepCards[idx]) stepCards[idx].innerHTML = text;
    });

    setInstructionButtonLabel(mode);

    menuView.classList.add('hidden');
    instructionView.classList.remove('hidden');
    updateAllProgress();
}

// 説明画面：「戻る」
btnInstBack.onclick = () => {
    instructionView.classList.add('hidden');
    menuView.classList.remove('hidden');
    currentMode = null;
    setGuideOverlayMode(null);
    resetWinkState();
    setResultViewMode('single');
    if (isAllModeActive()) {
        sequenceManager.cancel();
        updateAllProgress();
    }
};

// 説明画面：「カメラを起動する(次へ)」
btnStartCamera.onclick = () => {
    instructionView.classList.add('hidden');
    evalView.classList.remove('hidden');
    
    // 設定反映
    const ui = MODE_UI[currentMode] ?? MODE_UI.rest;
    currentTitle.innerText = ui.evalTitle;
    currentEvaluator = evaluators[currentMode];

    // ウィンクは2ステップなので状態を初期化
    if (currentMode === 'wink') {
        resetWinkState();
    }

    // 結果画面の表示モードを初期化
    setResultViewMode('single');

    // ガイド枠切り替え
    setGuideOverlayMode(currentMode);

    // 前の計測結果の残像を消す
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    updateAllProgress();
    
    // カメラは init() で既に動いているので、ここではステータス更新のみ
    btnAction.disabled = false;
    if (currentMode === 'wink') {
        btnAction.innerText = '撮影開始（右目）';
        status.innerText = '右目をつぶってください（左目は開けたまま）';
    } else {
        btnAction.innerText = '撮影・解析';
        status.innerText = 'ガイド枠に顔を合わせてください';
    }
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
    setGuideOverlayMode(null);
    resetWinkState();
    setResultViewMode('single');
    if (isAllModeActive()) {
        sequenceManager.cancel();
        updateAllProgress();
    }
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
        if (faceLandmarker && !isMeasuring) {
            const results = faceLandmarker.detectForVideo(video, startTimeMs);
            // 閉眼系/ウィンクは「目が認識されている」安心感のため常時点を描画
            if ((currentMode === 'blink-light' || currentMode === 'blink-heavy' || currentMode === 'wink') && !evalView.classList.contains('hidden')) {
                const landmarks = (results.faceLandmarks && results.faceLandmarks.length > 0)
                    ? results.faceLandmarks[0]
                    : null;
                const highlight = (currentMode === 'wink') ? (winkStep === 1 ? 'right' : 'left') : null;
                drawEyeTrackingDots(landmarks, highlight);
            } else if (currentMode === 'cheek' && !evalView.classList.contains('hidden')) {
                const landmarks = (results.faceLandmarks && results.faceLandmarks.length > 0)
                    ? results.faceLandmarks[0]
                    : null;

                // カウントダウン前から候補点を常時更新して表示
                if (landmarks) {
                    cheekCandidatePreview = pickCheekCandidateIndices(landmarks, canvas.width, canvas.height, 4);
                } else {
                    cheekCandidatePreview = null;
                }
                drawCheekTrackingDots(landmarks);
            }
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
        if (currentMode === 'eee') {
            performEeeCapture();
        } else if (currentMode === 'wrinkle') {
            performWrinkleCapture();
        } else if (currentMode === 'nose') {
            performNoseCapture();
        } else if (currentMode === 'henoji') {
            performHenojiCapture();
        } else if (currentMode === 'whistle') {
            performWhistleCapture();
        } else if (currentMode === 'cheek') {
            performCheekCapture();
        } else if (currentMode === 'blink-light' || currentMode === 'blink-heavy') {
            performLightCloseCapture();
        } else if (currentMode === 'wink') {
            performWinkCapture();
        } else {
            performCapture();
        }
    });
};

function cloneLandmarks(landmarks) {
    // MediaPipe landmarks are plain objects with numbers.
    if (typeof structuredClone === 'function') return structuredClone(landmarks);
    return JSON.parse(JSON.stringify(landmarks));
}

function drawTrackingDots(landmarks) {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (!landmarks) return;

    const pL = getCoord(landmarks, 61, w, h);
    const pR = getCoord(landmarks, 291, w, h);

    const drawOne = (p) => {
        // 目立つ点（赤+黄色縁）
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
        ctx.fill();

        ctx.strokeStyle = 'yellow';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
        ctx.stroke();
    };

    drawOne(pL);
    drawOne(pR);
}

function drawWhistleTrackingDots(landmarks) {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (!landmarks) return;

    const pL = getCoord(landmarks, CFG.ID.MOUTH_L, w, h);
    const pR = getCoord(landmarks, CFG.ID.MOUTH_R, w, h);
    const mouthMid = { x: (pL.x + pR.x) / 2, y: (pL.y + pR.y) / 2 };
    const nose = getCoord(landmarks, CFG.ID.NOSE_CENTER ?? 168, w, h);

    const drawOne = (p, fill, stroke) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
        ctx.fill();

        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
            ctx.stroke();
        }
    };

    // 口角（赤）
    drawOne(pL, 'red', 'yellow');
    drawOne(pR, 'red', 'yellow');

    // 口の中心（青）
    drawOne(mouthMid, 'dodgerblue', 'rgba(255,255,255,0.7)');

    // 鼻中心（白・小）
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(nose.x, nose.y, 4, 0, 2 * Math.PI);
    ctx.fill();
}

function drawWrinkleTrackingDots(landmarks) {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (!landmarks) return;

    const browL = getCoord(landmarks, CFG.ID.EYEBROW_L_CENTER, w, h);
    const browR = getCoord(landmarks, CFG.ID.EYEBROW_R_CENTER, w, h);
    const eyeL = getCoord(landmarks, CFG.ID.EYE_L_INNER, w, h);
    const eyeR = getCoord(landmarks, CFG.ID.EYE_R_INNER, w, h);

    const drawOne = (p, fill, stroke) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
        ctx.fill();

        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
            ctx.stroke();
        }
    };

    // 眉（赤）
    drawOne(browL, 'red', 'yellow');
    drawOne(browR, 'red', 'yellow');

    // 目頭（白）
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(eyeL.x, eyeL.y, 4, 0, 2 * Math.PI);
    ctx.arc(eyeR.x, eyeR.y, 4, 0, 2 * Math.PI);
    ctx.fill();
}

function drawNoseTrackingDots(landmarks) {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (!landmarks) return;

    const tip = getCoord(landmarks, CFG.ID.NOSE_TIP, w, h);
    const wingL = getCoord(landmarks, CFG.ID.NOSE_INNER_L, w, h);
    const wingR = getCoord(landmarks, CFG.ID.NOSE_INNER_R, w, h);

    const drawOne = (p, fill, stroke) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
        ctx.fill();

        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
            ctx.stroke();
        }
    };

    // 鼻翼（赤）
    drawOne(wingL, 'red', 'yellow');
    drawOne(wingR, 'red', 'yellow');

    // 鼻先（白）
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 4, 0, 2 * Math.PI);
    ctx.fill();
}

function drawHenojiTrackingDots(landmarks) {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (!landmarks) return;

    const mouthL = getCoord(landmarks, CFG.ID.MOUTH_L, w, h);
    const mouthR = getCoord(landmarks, CFG.ID.MOUTH_R, w, h);
    const eyeL = getCoord(landmarks, CFG.ID.EYE_R_INNER, w, h);
    const eyeR = getCoord(landmarks, CFG.ID.EYE_L_INNER, w, h);

    const drawOne = (p, fill, stroke) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
        ctx.fill();

        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
            ctx.stroke();
        }
    };

    drawOne(mouthL, 'red', 'yellow');
    drawOne(mouthR, 'red', 'yellow');

    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(eyeL.x, eyeL.y, 4, 0, 2 * Math.PI);
    ctx.arc(eyeR.x, eyeR.y, 4, 0, 2 * Math.PI);
    ctx.fill();
}

function drawCheekTrackingDots(landmarks) {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (!landmarks) return;

    const nose = getCoord(landmarks, CFG.ID.NOSE_CENTER ?? 168, w, h);
    const cheekL = getCoord(landmarks, CFG.ID.CHEEK_L, w, h);
    const cheekR = getCoord(landmarks, CFG.ID.CHEEK_R, w, h);

    // 黒目(虹彩)が追えていることを可視化
    const ilCenter = getCoord(landmarks, CFG.ID.IRIS_L_CENTER, w, h);
    const irCenter = getCoord(landmarks, CFG.ID.IRIS_R_CENTER, w, h);
    const drawIris = (center, borderIds) => {
        let totalDist = 0;
        borderIds.forEach(id => {
            const p = getCoord(landmarks, id, w, h);
            totalDist += Math.hypot(p.x - center.x, p.y - center.y);
        });
        const radius = totalDist / borderIds.length;
        ctx.strokeStyle = 'yellow';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(center.x, center.y, 3, 0, 2 * Math.PI);
        ctx.fill();
    };

    const drawOne = (p, fill, stroke) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
        ctx.fill();
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI);
            ctx.stroke();
        }
    };

    // 鼻（白）
    drawOne(nose, 'white');
    // 頬（デフォルト点）
    drawOne(cheekL, 'rgba(255,255,255,0.2)', 'rgba(255,255,255,0.6)');
    drawOne(cheekR, 'rgba(255,255,255,0.2)', 'rgba(255,255,255,0.6)');

    // 候補点（色違い）
    const colors = ['cyan', 'lime', 'magenta', 'orange', 'deepskyblue', 'gold'];
    if (cheekCandidatePreview && cheekCandidatePreview.left && cheekCandidatePreview.right) {
        const n = Math.min(cheekCandidatePreview.left.length, cheekCandidatePreview.right.length);
        for (let i = 0; i < n; i++) {
            const c = colors[i % colors.length];
            const pL = getCoord(landmarks, cheekCandidatePreview.left[i], w, h);
            const pR = getCoord(landmarks, cheekCandidatePreview.right[i], w, h);
            drawOne(pL, c, 'black');
            drawOne(pR, c, 'black');
        }
    }

    drawIris(ilCenter, CFG.ID.IRIS_L_BORDER);
    drawIris(irCenter, CFG.ID.IRIS_R_BORDER);
}

function drawEyeTrackingDots(landmarks, highlightEye = null) {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (!landmarks) return;

    const ids = {
        rInner: CFG.ID.EYE_R_INNER,
        rOuter: CFG.ID.EYE_R_OUTER,
        lInner: CFG.ID.EYE_L_INNER,
        lOuter: CFG.ID.EYE_L_OUTER,
        rUp: CFG.ID.EYE_R_UP,
        rLow: CFG.ID.EYE_R_LOW,
        lUp: CFG.ID.EYE_L_UP,
        lLow: CFG.ID.EYE_L_LOW
    };

    const pts = {
        rInner: getCoord(landmarks, ids.rInner, w, h),
        rOuter: getCoord(landmarks, ids.rOuter, w, h),
        lInner: getCoord(landmarks, ids.lInner, w, h),
        lOuter: getCoord(landmarks, ids.lOuter, w, h),
        rUp: getCoord(landmarks, ids.rUp, w, h),
        rLow: getCoord(landmarks, ids.rLow, w, h),
        lUp: getCoord(landmarks, ids.lUp, w, h),
        lLow: getCoord(landmarks, ids.lLow, w, h)
    };

    const drawOne = (p, fill, stroke) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
        ctx.fill();

        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, 2 * Math.PI);
        ctx.stroke();
    };

    // 目頭/目尻: 青
    drawOne(pts.rInner, 'dodgerblue', 'rgba(255,255,255,0.7)');
    drawOne(pts.rOuter, 'dodgerblue', 'rgba(255,255,255,0.7)');
    drawOne(pts.lInner, 'dodgerblue', 'rgba(255,255,255,0.7)');
    drawOne(pts.lOuter, 'dodgerblue', 'rgba(255,255,255,0.7)');

    // 上瞼/下瞼: 赤
    drawOne(pts.rUp, 'red', 'yellow');
    drawOne(pts.rLow, 'red', 'yellow');
    drawOne(pts.lUp, 'red', 'yellow');
    drawOne(pts.lLow, 'red', 'yellow');

    // どちらの目をつぶすか分かりやすく（対象目に緑の枠）
    if (highlightEye === 'right' || highlightEye === 'left') {
        const target = (highlightEye === 'right')
            ? [pts.rInner, pts.rOuter, pts.rUp, pts.rLow]
            : [pts.lInner, pts.lOuter, pts.lUp, pts.lLow];

        const minX = Math.min(...target.map(p => p.x));
        const maxX = Math.max(...target.map(p => p.x));
        const minY = Math.min(...target.map(p => p.y));
        const maxY = Math.max(...target.map(p => p.y));

        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
        ctx.lineWidth = 3;
        ctx.strokeRect(minX - 15, minY - 15, (maxX - minX) + 30, (maxY - minY) + 30);
        ctx.restore();
    }
}

function captureVideoFrameBitmap(videoEl, width, height) {
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(videoEl, 0, 0, width, height);
    return createImageBitmap(off);
}

function calcBrowElevMetricPx(landmarks, width, height) {
    const il = landmarks[CFG.ID.IRIS_L_CENTER];
    const ir = landmarks[CFG.ID.IRIS_R_CENTER];
    if (!il || !ir) return null;

    const ix1 = il.x * width; const iy1 = il.y * height;
    const ix2 = ir.x * width; const iy2 = ir.y * height;
    const cx = (ix1 + ix2) / 2;
    const cy = (iy1 + iy2) / 2;
    const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);
    const origin = { x: cx, y: cy };

    const browL = rotatePoint(getCoord(landmarks, CFG.ID.EYEBROW_L_CENTER, width, height), origin, -angleRad);
    const browR = rotatePoint(getCoord(landmarks, CFG.ID.EYEBROW_R_CENTER, width, height), origin, -angleRad);
    const eyeL = rotatePoint(getCoord(landmarks, CFG.ID.EYE_L_INNER, width, height), origin, -angleRad);
    const eyeR = rotatePoint(getCoord(landmarks, CFG.ID.EYE_R_INNER, width, height), origin, -angleRad);

    const distL = eyeL.y - browL.y;
    const distR = eyeR.y - browR.y;
    return (distL + distR) / 2;
}

function calcHenojiMetricPx(landmarks, width, height) {
    const il = landmarks[CFG.ID.IRIS_L_CENTER];
    const ir = landmarks[CFG.ID.IRIS_R_CENTER];
    if (!il || !ir) return null;

    const ix1 = il.x * width; const iy1 = il.y * height;
    const ix2 = ir.x * width; const iy2 = ir.y * height;
    const cx = (ix1 + ix2) / 2;
    const cy = (iy1 + iy2) / 2;
    const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);
    const origin = { x: cx, y: cy };

    const mouthL = rotatePoint(getCoord(landmarks, CFG.ID.MOUTH_L, width, height), origin, -angleRad);
    const mouthR = rotatePoint(getCoord(landmarks, CFG.ID.MOUTH_R, width, height), origin, -angleRad);
    const eyeL = rotatePoint(getCoord(landmarks, CFG.ID.EYE_R_INNER, width, height), origin, -angleRad);
    const eyeR = rotatePoint(getCoord(landmarks, CFG.ID.EYE_L_INNER, width, height), origin, -angleRad);

    const distL = mouthL.y - eyeL.y;
    const distR = mouthR.y - eyeR.y;
    return (distL + distR) / 2;
}

async function performEeeCapture() {
    if (isMeasuring) return;
    isMeasuring = true;

    // UIロック
    btnBack.disabled = true;
    btnSwitchCamera.disabled = true;
    status.innerText = '録画・計測中...（3秒間）';

    const w = canvas.width;
    const h = canvas.height;

    const durationMs = 3000;
    const startMs = performance.now();

    let restLandmarks = null;
    let maxLandmarks = null;
    let maxWidthPx = -Infinity;
    let maxFrameBitmapPromise = null;

    const loop = (nowMs, resolve) => {
        const elapsed = nowMs - startMs;

        const results = faceLandmarker.detectForVideo(video, nowMs);
        let landmarks = null;
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            landmarks = results.faceLandmarks[0];

            if (!restLandmarks) {
                // 0.0〜0.5秒は基準。まずは最初のフレームをRestFrameとして採用。
                restLandmarks = cloneLandmarks(landmarks);
            }

            const pL = getCoord(landmarks, 61, w, h);
            const pR = getCoord(landmarks, 291, w, h);
            const widthPx = Math.hypot(pR.x - pL.x, pR.y - pL.y);

            if (widthPx > maxWidthPx) {
                maxWidthPx = widthPx;
                maxLandmarks = cloneLandmarks(landmarks);
                // ベストショット候補を更新
                maxFrameBitmapPromise = captureVideoFrameBitmap(video, w, h);
            }
        }

        // トラッキング点は録画中リアルタイム表示
        drawTrackingDots(landmarks);

        if (elapsed < durationMs) {
            window.requestAnimationFrame((t) => loop(t, resolve));
        } else {
            resolve({ restLandmarks, maxLandmarks, maxFrameBitmapPromise });
        }
    };

    try {
        const { restLandmarks: rest, maxLandmarks: max, maxFrameBitmapPromise: bmpPromise } =
            await new Promise((resolve) => window.requestAnimationFrame((t) => loop(t, resolve)));

        if (!rest || !max) {
            alert('顔が見つかりません。枠内に顔を入れてください。');
            return;
        }

        const bitmap = bmpPromise ? await bmpPromise : await captureVideoFrameBitmap(video, w, h);
        await renderEeeResult(bitmap, rest, max);

    } finally {
        // UIアンロック
        isMeasuring = false;
        btnBack.disabled = false;
        btnSwitchCamera.disabled = false;
        btnAction.disabled = false;
        // eval画面に戻った時に残像が出ないようクリア
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        status.innerText = 'ガイド枠に顔を合わせてください';
    }
}

async function performWrinkleCapture() {
    if (isMeasuring) return;
    isMeasuring = true;

    // UIロック
    btnBack.disabled = true;
    btnSwitchCamera.disabled = true;
    status.innerText = '録画・計測中...（3秒間）';

    const w = canvas.width;
    const h = canvas.height;

    const durationMs = 3000;
    const startMs = performance.now();

    let restLandmarks = null;
    let maxLandmarks = null;
    let maxMetric = -Infinity;
    let maxFrameBitmapPromise = null;

    const loop = (nowMs, resolve) => {
        const elapsed = nowMs - startMs;

        const results = faceLandmarker.detectForVideo(video, nowMs);
        let landmarks = null;
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            landmarks = results.faceLandmarks[0];

            if (!restLandmarks) {
                restLandmarks = cloneLandmarks(landmarks);
            }

            const metric = calcBrowElevMetricPx(landmarks, w, h);
            if (metric !== null && metric > maxMetric) {
                maxMetric = metric;
                maxLandmarks = cloneLandmarks(landmarks);
                maxFrameBitmapPromise = captureVideoFrameBitmap(video, w, h);
            }
        }

        drawWrinkleTrackingDots(landmarks);

        if (elapsed < durationMs) {
            window.requestAnimationFrame((t) => loop(t, resolve));
        } else {
            resolve({ restLandmarks, maxLandmarks, maxFrameBitmapPromise });
        }
    };

    try {
        const { restLandmarks: rest, maxLandmarks: max, maxFrameBitmapPromise: bmpPromise } =
            await new Promise((resolve) => window.requestAnimationFrame((t) => loop(t, resolve)));

        if (!rest || !max) {
            alert('顔が見つかりません。枠内に顔を入れてください。');
            return;
        }

        const bitmap = bmpPromise ? await bmpPromise : await captureVideoFrameBitmap(video, w, h);
        await renderWrinkleResult(bitmap, rest, max);

    } finally {
        isMeasuring = false;
        btnBack.disabled = false;
        btnSwitchCamera.disabled = false;
        btnAction.disabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        status.innerText = 'ガイド枠に顔を合わせてください';
    }
}

async function performNoseCapture() {
    if (isMeasuring) return;
    isMeasuring = true;

    // UIロック
    btnBack.disabled = true;
    btnSwitchCamera.disabled = true;
    status.innerText = '録画・計測中...（3秒間）';

    const w = canvas.width;
    const h = canvas.height;

    const durationMs = 3000;
    const startMs = performance.now();

    let restLandmarks = null;
    let maxLandmarks = null;
    let maxWidthPx = -Infinity;
    let maxFrameBitmapPromise = null;

    const loop = (nowMs, resolve) => {
        const elapsed = nowMs - startMs;

        const results = faceLandmarker.detectForVideo(video, nowMs);
        let landmarks = null;
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            landmarks = results.faceLandmarks[0];

            if (!restLandmarks) {
                restLandmarks = cloneLandmarks(landmarks);
            }

            const wingL = getCoord(landmarks, CFG.ID.NOSE_WING_L, w, h);
            const wingR = getCoord(landmarks, CFG.ID.NOSE_WING_R, w, h);
            const widthPx = Math.hypot(wingR.x - wingL.x, wingR.y - wingL.y);

            if (widthPx > maxWidthPx) {
                maxWidthPx = widthPx;
                maxLandmarks = cloneLandmarks(landmarks);
                maxFrameBitmapPromise = captureVideoFrameBitmap(video, w, h);
            }
        }

        drawNoseTrackingDots(landmarks);

        if (elapsed < durationMs) {
            window.requestAnimationFrame((t) => loop(t, resolve));
        } else {
            resolve({ restLandmarks, maxLandmarks, maxFrameBitmapPromise });
        }
    };

    try {
        const { restLandmarks: rest, maxLandmarks: max, maxFrameBitmapPromise: bmpPromise } =
            await new Promise((resolve) => window.requestAnimationFrame((t) => loop(t, resolve)));

        if (!rest || !max) {
            alert('顔が見つかりません。枠内に顔を入れてください。');
            return;
        }

        const bitmap = bmpPromise ? await bmpPromise : await captureVideoFrameBitmap(video, w, h);
        await renderNoseResult(bitmap, rest, max);

    } finally {
        isMeasuring = false;
        btnBack.disabled = false;
        btnSwitchCamera.disabled = false;
        btnAction.disabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        status.innerText = 'ガイド枠に顔を合わせてください';
    }
}

async function performHenojiCapture() {
    if (isMeasuring) return;
    isMeasuring = true;

    // UIロック
    btnBack.disabled = true;
    btnSwitchCamera.disabled = true;
    status.innerText = '録画・計測中...（3秒間）';

    const w = canvas.width;
    const h = canvas.height;

    const durationMs = 3000;
    const startMs = performance.now();

    let restLandmarks = null;
    let maxLandmarks = null;
    let maxMetric = -Infinity;
    let maxFrameBitmapPromise = null;

    const loop = (nowMs, resolve) => {
        const elapsed = nowMs - startMs;

        const results = faceLandmarker.detectForVideo(video, nowMs);
        let landmarks = null;
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            landmarks = results.faceLandmarks[0];

            if (!restLandmarks) {
                restLandmarks = cloneLandmarks(landmarks);
            }

            const metric = calcHenojiMetricPx(landmarks, w, h);
            if (metric !== null && metric > maxMetric) {
                maxMetric = metric;
                maxLandmarks = cloneLandmarks(landmarks);
                maxFrameBitmapPromise = captureVideoFrameBitmap(video, w, h);
            }
        }

        drawHenojiTrackingDots(landmarks);

        if (elapsed < durationMs) {
            window.requestAnimationFrame((t) => loop(t, resolve));
        } else {
            resolve({ restLandmarks, maxLandmarks, maxFrameBitmapPromise });
        }
    };

    try {
        const { restLandmarks: rest, maxLandmarks: max, maxFrameBitmapPromise: bmpPromise } =
            await new Promise((resolve) => window.requestAnimationFrame((t) => loop(t, resolve)));

        if (!rest || !max) {
            alert('顔が見つかりません。枠内に顔を入れてください。');
            return;
        }

        const bitmap = bmpPromise ? await bmpPromise : await captureVideoFrameBitmap(video, w, h);
        await renderHenojiResult(bitmap, rest, max);

    } finally {
        isMeasuring = false;
        btnBack.disabled = false;
        btnSwitchCamera.disabled = false;
        btnAction.disabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        status.innerText = 'ガイド枠に顔を合わせてください';
    }
}

async function performWhistleCapture() {
    if (isMeasuring) return;
    isMeasuring = true;

    // UIロック
    btnBack.disabled = true;
    btnSwitchCamera.disabled = true;
    status.innerText = '録画・計測中...（3秒間）';

    const w = canvas.width;
    const h = canvas.height;

    const durationMs = 3000;
    const startMs = performance.now();

    let restLandmarks = null;
    let actLandmarks = null;
    let minWidthPx = Infinity;
    let minFrameBitmapPromise = null;

    const loop = (nowMs, resolve) => {
        const elapsed = nowMs - startMs;

        const results = faceLandmarker.detectForVideo(video, nowMs);
        let landmarks = null;
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            landmarks = results.faceLandmarks[0];

            if (!restLandmarks) {
                restLandmarks = cloneLandmarks(landmarks);
            }

            const pL = getCoord(landmarks, CFG.ID.MOUTH_L, w, h);
            const pR = getCoord(landmarks, CFG.ID.MOUTH_R, w, h);
            const widthPx = Math.hypot(pR.x - pL.x, pR.y - pL.y);

            if (widthPx < minWidthPx) {
                minWidthPx = widthPx;
                actLandmarks = cloneLandmarks(landmarks);
                minFrameBitmapPromise = captureVideoFrameBitmap(video, w, h);
            }
        }

        drawWhistleTrackingDots(landmarks);

        if (elapsed < durationMs) {
            window.requestAnimationFrame((t) => loop(t, resolve));
        } else {
            resolve({ restLandmarks, actLandmarks, minFrameBitmapPromise });
        }
    };

    try {
        const { restLandmarks: rest, actLandmarks: act, minFrameBitmapPromise: bmpPromise } =
            await new Promise((resolve) => window.requestAnimationFrame((t) => loop(t, resolve)));

        if (!rest || !act) {
            alert('顔が見つかりません。枠内に顔を入れてください。');
            return;
        }

        const bitmap = bmpPromise ? await bmpPromise : await captureVideoFrameBitmap(video, w, h);
        await renderWhistleResult(bitmap, rest, act);

    } finally {
        isMeasuring = false;
        btnBack.disabled = false;
        btnSwitchCamera.disabled = false;
        btnAction.disabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        status.innerText = 'ガイド枠に顔を合わせてください';
    }
}

async function performCheekCapture() {
    if (isMeasuring) return;
    isMeasuring = true;

    // UIロック
    btnBack.disabled = true;
    btnSwitchCamera.disabled = true;
    status.innerText = '録画・計測中...（3秒間）';

    const w = canvas.width;
    const h = canvas.height;

    const durationMs = 3000;
    const startMs = performance.now();

    const restWindowEndMs = 300;
    const maxWindowStartMs = 300;

    let restLandmarks = null;
    let maxLandmarks = null;
    let bestRestMetric = Infinity;
    let bestMaxMetric = -Infinity;
    let maxFrameBitmapPromise = null;
    let restBaseline = null; // { dL, dR } in px
    let candidates = null;   // { left:number[], right:number[] }
    let candidateBaseline = null; // { baseL:number[], baseR:number[] } in px

    const loop = (nowMs, resolve) => {
        const elapsed = nowMs - startMs;

        const results = faceLandmarker.detectForVideo(video, nowMs);
        let landmarks = null;
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            landmarks = results.faceLandmarks[0];

            const nose = getCoord(landmarks, CFG.ID.NOSE_CENTER ?? 168, w, h);
            const cheekL = getCoord(landmarks, CFG.ID.CHEEK_L, w, h);
            const cheekR = getCoord(landmarks, CFG.ID.CHEEK_R, w, h);
            const dL = Math.abs(cheekL.x - nose.x);
            const dR = Math.abs(cheekR.x - nose.x);
            const metric = dL + dR;

            if (elapsed >= 0 && elapsed <= restWindowEndMs) {
                // Restは「最も膨らんでいない」フレーム（距離が最小）を採用
                if (metric < bestRestMetric) {
                    bestRestMetric = metric;
                    restLandmarks = cloneLandmarks(landmarks);
                    restBaseline = { dL, dR };

                    // Restが更新されたタイミングで候補点を抽出
                    candidates = pickCheekCandidateIndices(landmarks, w, h, 4);
                    cheekCandidatePreview = candidates;
                    if (candidates) {
                        const baseL = candidates.left.map(idx => {
                            const p = getCoord(landmarks, idx, w, h);
                            return Math.abs(p.x - nose.x);
                        });
                        const baseR = candidates.right.map(idx => {
                            const p = getCoord(landmarks, idx, w, h);
                            return Math.abs(p.x - nose.x);
                        });
                        candidateBaseline = { baseL, baseR };
                    }
                }
            }

            if (elapsed >= maxWindowStartMs) {
                // Maxは「安静からの増加量」が最大のフレーム
                // restBaseline が取れていない場合だけ、従来の絶対距離で代用
                let delta = restBaseline ? ((dL - restBaseline.dL) + (dR - restBaseline.dR)) : metric;

                // 候補点がある場合は「候補点の差分」ベースでMax判定する（頬の動きに寄せる）
                if (candidateBaseline && candidates) {
                    const n = Math.min(candidateBaseline.baseL.length, candidateBaseline.baseR.length);
                    let best = -Infinity;
                    for (let i = 0; i < n; i++) {
                        const pL = getCoord(landmarks, candidates.left[i], w, h);
                        const pR = getCoord(landmarks, candidates.right[i], w, h);
                        const dLc = Math.abs(pL.x - nose.x);
                        const dRc = Math.abs(pR.x - nose.x);
                        const dc = (dLc - candidateBaseline.baseL[i]) + (dRc - candidateBaseline.baseR[i]);
                        if (dc > best) best = dc;
                    }
                    delta = best;
                }
                if (delta > bestMaxMetric) {
                    bestMaxMetric = delta;
                    maxLandmarks = cloneLandmarks(landmarks);
                    maxFrameBitmapPromise = captureVideoFrameBitmap(video, w, h);
                }
            }
        }

        drawCheekTrackingDots(landmarks);

        if (elapsed < durationMs) {
            window.requestAnimationFrame((t) => loop(t, resolve));
        } else {
            resolve({ restLandmarks, maxLandmarks, maxFrameBitmapPromise, candidates });
        }
    };

    try {
        const { restLandmarks: rest, maxLandmarks: max, maxFrameBitmapPromise: bmpPromise, candidates: pickedCandidates } =
            await new Promise((resolve) => window.requestAnimationFrame((t) => loop(t, resolve)));

        if (!rest || !max) {
            alert('顔が安定して検出できませんでした。枠内で正面を向いてください。');
            return;
        }

        const bitmap = bmpPromise ? await bmpPromise : await captureVideoFrameBitmap(video, w, h);
        await renderCheekResult(bitmap, rest, max, pickedCandidates ?? candidates);

    } finally {
        isMeasuring = false;
        btnBack.disabled = false;
        btnSwitchCamera.disabled = false;
        btnAction.disabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        status.innerText = 'ガイド枠に顔を合わせてください';
        cheekCandidatePreview = null;
    }
}

async function renderCheekResult(frameBitmap, restLandmarks, maxLandmarks, candidates) {
    setResultViewMode('single');
    const w = canvas.width;
    const h = canvas.height;

    const mmPerPx = calcMmPerPx(restLandmarks, w, h);

    // 顔の傾き補正（虹彩中心を利用）
    const il = maxLandmarks[CFG.ID.IRIS_L_CENTER];
    const ir = maxLandmarks[CFG.ID.IRIS_R_CENTER];

    const ix1 = il.x * w; const iy1 = il.y * h;
    const ix2 = ir.x * w; const iy2 = ir.y * h;
    const cx = (ix1 + ix2) / 2;
    const cy = (iy1 + iy2) / 2;
    const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);

    ctx.save();

    if (isFrontCamera) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    } else {
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    }

    ctx.drawImage(frameBitmap, 0, 0, w, h);

    if (currentEvaluator && typeof currentEvaluator.setCandidates === 'function') {
        currentEvaluator.setCandidates(candidates);
    }

    const resultData = currentEvaluator.evaluateAndDraw(restLandmarks, maxLandmarks, ctx, w, h, mmPerPx);

    ctx.restore();

    resultImg.src = canvas.toDataURL('image/png');
    const avgScore = Math.round(resultData.total / resultData.count);
    resultScore.innerText = avgScore;

    resultDetails.innerHTML = '';
    resultData.details.forEach(item => {
        const row = document.createElement('tr');
        const scoreCell = (item.score === undefined || item.score === null) ? '' : item.score;
        row.innerHTML = `<td>${item.name}</td><td>${item.value}</td><td>${scoreCell}</td>`;
        resultDetails.appendChild(row);
    });

    evalView.classList.add('hidden');
    resultView.classList.remove('hidden');
    updateResultButtons();
    updateAllProgress();
}

async function renderWhistleResult(frameBitmap, restLandmarks, actLandmarks) {
    setResultViewMode('single');
    const w = canvas.width;
    const h = canvas.height;

    const mmPerPx = calcMmPerPx(restLandmarks, w, h);

    // 顔の傾き補正（虹彩中心を利用）
    const il = actLandmarks[CFG.ID.IRIS_L_CENTER];
    const ir = actLandmarks[CFG.ID.IRIS_R_CENTER];

    const ix1 = il.x * w; const iy1 = il.y * h;
    const ix2 = ir.x * w; const iy2 = ir.y * h;
    const cx = (ix1 + ix2) / 2;
    const cy = (iy1 + iy2) / 2;
    const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);

    ctx.save();

    if (isFrontCamera) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    } else {
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    }

    ctx.drawImage(frameBitmap, 0, 0, w, h);

    const resultData = currentEvaluator.evaluateAndDraw(restLandmarks, actLandmarks, ctx, w, h, mmPerPx);

    ctx.restore();

    resultImg.src = canvas.toDataURL('image/png');
    const avgScore = Math.round(resultData.total / resultData.count);
    resultScore.innerText = avgScore;

    resultDetails.innerHTML = '';
    resultData.details.forEach(item => {
        const row = document.createElement('tr');
        const scoreCell = (item.score === undefined || item.score === null) ? '' : item.score;
        row.innerHTML = `<td>${item.name}</td><td>${item.value}</td><td>${scoreCell}</td>`;
        resultDetails.appendChild(row);
    });

    evalView.classList.add('hidden');
    resultView.classList.remove('hidden');
    updateResultButtons();
    updateAllProgress();
}

async function renderWrinkleResult(frameBitmap, restLandmarks, maxLandmarks) {
    setResultViewMode('single');
    const w = canvas.width;
    const h = canvas.height;

    const mmPerPx = calcMmPerPx(restLandmarks, w, h);

    // 顔の傾き補正（虹彩中心を利用）
    const il = maxLandmarks[CFG.ID.IRIS_L_CENTER];
    const ir = maxLandmarks[CFG.ID.IRIS_R_CENTER];

    const ix1 = il.x * w; const iy1 = il.y * h;
    const ix2 = ir.x * w; const iy2 = ir.y * h;
    const cx = (ix1 + ix2) / 2;
    const cy = (iy1 + iy2) / 2;
    const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);

    ctx.save();

    if (isFrontCamera) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    } else {
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    }

    ctx.drawImage(frameBitmap, 0, 0, w, h);

    const resultData = currentEvaluator.evaluateAndDraw(restLandmarks, maxLandmarks, ctx, w, h, mmPerPx);

    ctx.restore();

    resultImg.src = canvas.toDataURL('image/png');
    const avgScore = Math.round(resultData.total / resultData.count);
    resultScore.innerText = avgScore;

    resultDetails.innerHTML = '';
    resultData.details.forEach(item => {
        const row = document.createElement('tr');
        const scoreCell = (item.score === undefined || item.score === null) ? '' : item.score;
        row.innerHTML = `<td>${item.name}</td><td>${item.value}</td><td>${scoreCell}</td>`;
        resultDetails.appendChild(row);
    });

    evalView.classList.add('hidden');
    resultView.classList.remove('hidden');
    updateResultButtons();
    updateAllProgress();
}

async function renderNoseResult(frameBitmap, restLandmarks, maxLandmarks) {
    setResultViewMode('single');
    const w = canvas.width;
    const h = canvas.height;

    const mmPerPx = calcMmPerPx(restLandmarks, w, h);

    // 顔の傾き補正（虹彩中心を利用）
    const il = maxLandmarks[CFG.ID.IRIS_L_CENTER];
    const ir = maxLandmarks[CFG.ID.IRIS_R_CENTER];

    const ix1 = il.x * w; const iy1 = il.y * h;
    const ix2 = ir.x * w; const iy2 = ir.y * h;
    const cx = (ix1 + ix2) / 2;
    const cy = (iy1 + iy2) / 2;
    const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);

    ctx.save();

    if (isFrontCamera) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    } else {
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    }

    ctx.drawImage(frameBitmap, 0, 0, w, h);

    const resultData = currentEvaluator.evaluateAndDraw(restLandmarks, maxLandmarks, ctx, w, h, mmPerPx);

    ctx.restore();

    resultImg.src = canvas.toDataURL('image/png');
    const avgScore = Math.round(resultData.total / resultData.count);
    resultScore.innerText = avgScore;

    resultDetails.innerHTML = '';
    resultData.details.forEach(item => {
        const row = document.createElement('tr');
        const scoreCell = (item.score === undefined || item.score === null) ? '' : item.score;
        row.innerHTML = `<td>${item.name}</td><td>${item.value}</td><td>${scoreCell}</td>`;
        resultDetails.appendChild(row);
    });

    evalView.classList.add('hidden');
    resultView.classList.remove('hidden');
    updateResultButtons();
    updateAllProgress();
}

async function renderHenojiResult(frameBitmap, restLandmarks, maxLandmarks) {
    setResultViewMode('single');
    const w = canvas.width;
    const h = canvas.height;

    const mmPerPx = calcMmPerPx(restLandmarks, w, h);

    // 顔の傾き補正（虹彩中心を利用）
    const il = maxLandmarks[CFG.ID.IRIS_L_CENTER];
    const ir = maxLandmarks[CFG.ID.IRIS_R_CENTER];

    const ix1 = il.x * w; const iy1 = il.y * h;
    const ix2 = ir.x * w; const iy2 = ir.y * h;
    const cx = (ix1 + ix2) / 2;
    const cy = (iy1 + iy2) / 2;
    const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);

    ctx.save();

    if (isFrontCamera) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    } else {
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    }

    ctx.drawImage(frameBitmap, 0, 0, w, h);

    const resultData = currentEvaluator.evaluateAndDraw(restLandmarks, maxLandmarks, ctx, w, h, mmPerPx);

    ctx.restore();

    resultImg.src = canvas.toDataURL('image/png');
    const avgScore = Math.round(resultData.total / resultData.count);
    resultScore.innerText = avgScore;

    resultDetails.innerHTML = '';
    resultData.details.forEach(item => {
        const row = document.createElement('tr');
        const scoreCell = (item.score === undefined || item.score === null) ? '' : item.score;
        row.innerHTML = `<td>${item.name}</td><td>${item.value}</td><td>${scoreCell}</td>`;
        resultDetails.appendChild(row);
    });

    evalView.classList.add('hidden');
    resultView.classList.remove('hidden');
    updateResultButtons();
    updateAllProgress();
}

function rotatePoint(p, origin, rad) {
    const tx = p.x - origin.x;
    const ty = p.y - origin.y;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return {
        x: tx * c - ty * s + origin.x,
        y: tx * s + ty * c + origin.y
    };
}

function calcEyeHeightPx(landmarks, width, height, innerId, outerId, upId, lowId) {
    const inner = getCoord(landmarks, innerId, width, height);
    const outer = getCoord(landmarks, outerId, width, height);
    const up = getCoord(landmarks, upId, width, height);
    const low = getCoord(landmarks, lowId, width, height);

    const mid = { x: (inner.x + outer.x) / 2, y: (inner.y + outer.y) / 2 };
    let angle = Math.atan2(outer.y - inner.y, outer.x - inner.x);
    // 線分の向き(±π)で上下が反転しないよう、角度を [-π/2, π/2] に正規化
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;

    const innerR = rotatePoint(inner, mid, -angle);
    const outerR = rotatePoint(outer, mid, -angle);
    const upR = rotatePoint(up, mid, -angle);
    const lowR = rotatePoint(low, mid, -angle);

    // 隙間(H)は「回転後の上下瞼Y差分」。上瞼が下瞼より下に入り込んだ場合は0扱い。
    let hPx = lowR.y - upR.y;
    if (hPx < 0) hPx = 0;
    return hPx;
}

async function performLightCloseCapture() {
    if (isMeasuring) return;
    isMeasuring = true;

    // UIロック
    btnBack.disabled = true;
    btnSwitchCamera.disabled = true;
    status.innerText = '録画・計測中...（3秒間）';

    const w = canvas.width;
    const h = canvas.height;

    const durationMs = 3000;
    const startMs = performance.now();

    const openWindowEndMs = 300;
    const closeWindowStartMs = 300;
    const closeWindowEndMs = 2000;

    let openLandmarks = null;
    let closedLandmarks = null;
    let bestOpenH = -Infinity;
    let bestClosedH = Infinity;
    let closedFrameBitmapPromise = null;

    const loop = (nowMs, resolve) => {
        const elapsed = nowMs - startMs;

        const results = faceLandmarker.detectForVideo(video, nowMs);
        let landmarks = null;
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            landmarks = results.faceLandmarks[0];

            const hR = calcEyeHeightPx(
                landmarks,
                w,
                h,
                CFG.ID.EYE_R_INNER,
                CFG.ID.EYE_R_OUTER,
                CFG.ID.EYE_R_UP,
                CFG.ID.EYE_R_LOW
            );
            const hL = calcEyeHeightPx(
                landmarks,
                w,
                h,
                CFG.ID.EYE_L_INNER,
                CFG.ID.EYE_L_OUTER,
                CFG.ID.EYE_L_UP,
                CFG.ID.EYE_L_LOW
            );
            // Open/Closed の判定軸を「両目が揃っている」方向に寄せる
            // - Open: 両目が開いているフレームを選びたい → min(hR, hL) を最大化
            // - Closed: 両目が閉じているフレームを選びたい → max(hR, hL) を最小化
            const openMetric = Math.min(hR, hL);
            const closedMetric = Math.max(hR, hL);

            if (elapsed >= 0 && elapsed <= openWindowEndMs) {
                if (openMetric > bestOpenH) {
                    bestOpenH = openMetric;
                    openLandmarks = cloneLandmarks(landmarks);
                }
            }

            if (elapsed >= closeWindowStartMs && elapsed <= closeWindowEndMs) {
                if (closedMetric < bestClosedH) {
                    bestClosedH = closedMetric;
                    closedLandmarks = cloneLandmarks(landmarks);
                    closedFrameBitmapPromise = captureVideoFrameBitmap(video, w, h);
                }
            }
        }

        // トラッキング点は録画中リアルタイム表示
        drawEyeTrackingDots(landmarks);

        if (elapsed < durationMs) {
            window.requestAnimationFrame((t) => loop(t, resolve));
        } else {
            resolve({ openLandmarks, closedLandmarks, closedFrameBitmapPromise });
        }
    };

    try {
        const { openLandmarks: open, closedLandmarks: closed, closedFrameBitmapPromise: bmpPromise } =
            await new Promise((resolve) => window.requestAnimationFrame((t) => loop(t, resolve)));

        if (!open || !closed) {
            alert('顔（目）が安定して検出できませんでした。枠内で正面を向いてください。');
            return;
        }

        const bitmap = bmpPromise ? await bmpPromise : await captureVideoFrameBitmap(video, w, h);
        await renderLightCloseResult(bitmap, open, closed);

    } finally {
        // UIアンロック
        isMeasuring = false;
        btnBack.disabled = false;
        btnSwitchCamera.disabled = false;
        btnAction.disabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        status.innerText = 'ガイド枠に顔を合わせてください';
    }
}

async function renderLightCloseResult(frameBitmap, openLandmarks, closedLandmarks) {
    setResultViewMode('single');
    const w = canvas.width;
    const h = canvas.height;

    const mmPerPx = calcMmPerPx(openLandmarks, w, h);

    // 顔の傾き補正（EEEと同様に虹彩中心を利用）
    const il = closedLandmarks[CFG.ID.IRIS_L_CENTER];
    const ir = closedLandmarks[CFG.ID.IRIS_R_CENTER];

    const ix1 = il.x * w; const iy1 = il.y * h;
    const ix2 = ir.x * w; const iy2 = ir.y * h;
    const cx = (ix1 + ix2) / 2;
    const cy = (iy1 + iy2) / 2;
    const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);

    ctx.save();

    if (isFrontCamera) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    } else {
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    }

    // 画像描画（ClosedFrame）
    ctx.drawImage(frameBitmap, 0, 0, w, h);

    // 評価 + オーバーレイ
    const resultData = currentEvaluator.evaluateAndDraw(openLandmarks, closedLandmarks, ctx, w, h, mmPerPx);

    ctx.restore();

    // 結果画面へ反映
    resultImg.src = canvas.toDataURL('image/png');
    const avgScore = Math.round(resultData.total / resultData.count);
    resultScore.innerText = avgScore;

    resultDetails.innerHTML = '';
    resultData.details.forEach(item => {
        const row = document.createElement('tr');
        const scoreCell = (item.score === undefined || item.score === null) ? '' : item.score;
        row.innerHTML = `<td>${item.name}</td><td>${item.value}</td><td>${scoreCell}</td>`;
        resultDetails.appendChild(row);
    });

    evalView.classList.add('hidden');
    resultView.classList.remove('hidden');
    updateResultButtons();
    updateAllProgress();
}

async function renderEeeResult(frameBitmap, restLandmarks, maxLandmarks) {
    setResultViewMode('single');
    const w = canvas.width;
    const h = canvas.height;

    const mmPerPx = calcMmPerPx(restLandmarks, w, h);

    // 顔の傾き補正（restの撮影ロジックと同様）
    const il = maxLandmarks[468];
    const ir = maxLandmarks[473];

    const ix1 = il.x * w; const iy1 = il.y * h;
    const ix2 = ir.x * w; const iy2 = ir.y * h;
    const cx = (ix1 + ix2) / 2;
    const cy = (iy1 + iy2) / 2;
    const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);

    ctx.save();

    if (isFrontCamera) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    } else {
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    }

    // 画像描画（MaxFrame）
    ctx.drawImage(frameBitmap, 0, 0, w, h);

    // 評価 + オーバーレイ
    const resultData = currentEvaluator.evaluateAndDraw(restLandmarks, maxLandmarks, ctx, w, h, mmPerPx);

    ctx.restore();

    // 結果画面へ反映
    resultImg.src = canvas.toDataURL('image/png');
    const avgScore = Math.round(resultData.total / resultData.count);
    resultScore.innerText = avgScore;

    resultDetails.innerHTML = '';
    resultData.details.forEach(item => {
        const row = document.createElement('tr');
        const scoreCell = (item.score === undefined || item.score === null) ? '' : item.score;
        row.innerHTML = `<td>${item.name}</td><td>${item.value}</td><td>${scoreCell}</td>`;
        resultDetails.appendChild(row);
    });

    evalView.classList.add('hidden');
    resultView.classList.remove('hidden');
    updateResultButtons();
    updateAllProgress();
}

async function performWinkCapture() {
    if (isMeasuring) return;
    isMeasuring = true;

    // UIロック
    btnBack.disabled = true;
    btnSwitchCamera.disabled = true;
    status.innerText = '録画・計測中...（3秒間）';

    const targetSide = (winkStep === 1) ? 'right' : 'left';
    const w = canvas.width;
    const h = canvas.height;

    const durationMs = 3000;
    const startMs = performance.now();

    const openWindowEndMs = 300;
    const closeWindowStartMs = 300;
    const closeWindowEndMs = 2000;

    const ids = (targetSide === 'right')
        ? { inner: CFG.ID.EYE_R_INNER, outer: CFG.ID.EYE_R_OUTER, up: CFG.ID.EYE_R_UP, low: CFG.ID.EYE_R_LOW }
        : { inner: CFG.ID.EYE_L_INNER, outer: CFG.ID.EYE_L_OUTER, up: CFG.ID.EYE_L_UP, low: CFG.ID.EYE_L_LOW };

    let openLandmarks = null;
    let closedLandmarks = null;
    let bestOpenH = -Infinity;
    let bestClosedH = Infinity;
    let closedFrameBitmapPromise = null;

    const loop = (nowMs, resolve) => {
        const elapsed = nowMs - startMs;

        const results = faceLandmarker.detectForVideo(video, nowMs);
        let landmarks = null;
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            landmarks = results.faceLandmarks[0];
            const hPx = calcEyeHeightPx(landmarks, w, h, ids.inner, ids.outer, ids.up, ids.low);

            if (elapsed >= 0 && elapsed <= openWindowEndMs) {
                if (hPx > bestOpenH) {
                    bestOpenH = hPx;
                    openLandmarks = cloneLandmarks(landmarks);
                }
            }

            if (elapsed >= closeWindowStartMs && elapsed <= closeWindowEndMs) {
                if (hPx < bestClosedH) {
                    bestClosedH = hPx;
                    closedLandmarks = cloneLandmarks(landmarks);
                    closedFrameBitmapPromise = captureVideoFrameBitmap(video, w, h);
                }
            }
        }

        drawEyeTrackingDots(landmarks, targetSide);

        if (elapsed < durationMs) {
            window.requestAnimationFrame((t) => loop(t, resolve));
        } else {
            resolve({ openLandmarks, closedLandmarks, closedFrameBitmapPromise });
        }
    };

    try {
        const { openLandmarks: open, closedLandmarks: closed, closedFrameBitmapPromise: bmpPromise } =
            await new Promise((resolve) => window.requestAnimationFrame((t) => loop(t, resolve)));

        if (!open || !closed) {
            alert('顔（目）が安定して検出できませんでした。枠内で正面を向いてください。');
            return;
        }

        const bitmap = bmpPromise ? await bmpPromise : await captureVideoFrameBitmap(video, w, h);
        const { imgUrl, metrics } = await renderWinkStepResult(bitmap, open, closed, targetSide);

        if (targetSide === 'right') {
            winkRight = metrics;
            winkRightImgUrl = imgUrl;
            winkStep = 2;

            // 次のステップ案内
            btnAction.disabled = false;
            btnAction.innerText = '撮影開始（左目）';
            status.innerText = 'OK! 次は左目です。左目をつぶってください（右目は開けたまま）';
        } else {
            winkLeft = metrics;
            winkLeftImgUrl = imgUrl;
            await renderWinkFinalResult();
        }

    } finally {
        isMeasuring = false;
        btnBack.disabled = false;
        btnSwitchCamera.disabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

async function renderWinkStepResult(frameBitmap, openLandmarks, closedLandmarks, targetSide) {
    const w = canvas.width;
    const h = canvas.height;

    const mmPerPx = calcMmPerPx(openLandmarks, w, h);

    // 顔の傾き補正（虹彩中心を利用）
    const il = closedLandmarks[CFG.ID.IRIS_L_CENTER];
    const ir = closedLandmarks[CFG.ID.IRIS_R_CENTER];

    const ix1 = il.x * w; const iy1 = il.y * h;
    const ix2 = ir.x * w; const iy2 = ir.y * h;
    const cx = (ix1 + ix2) / 2;
    const cy = (iy1 + iy2) / 2;
    const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);

    ctx.save();

    if (isFrontCamera) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    } else {
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.translate(-cx, -cy);
    }

    ctx.drawImage(frameBitmap, 0, 0, w, h);

    const metrics = currentEvaluator.evaluateAndDraw(openLandmarks, closedLandmarks, targetSide, ctx, w, h, mmPerPx);

    ctx.restore();

    const imgUrl = canvas.toDataURL('image/png');
    return { imgUrl, metrics };
}

async function renderWinkFinalResult() {
    if (!winkRight || !winkLeft) return;

    setResultViewMode('wink');

    if (resultImgRight) resultImgRight.src = winkRightImgUrl;
    if (resultImgLeft) resultImgLeft.src = winkLeftImgUrl;

    const avgScore = Math.round((winkRight.score + winkLeft.score) / 2);
    resultScore.innerText = avgScore;

    resultDetails.innerHTML = '';
    const rows = [
        { name: '隙間 (Gap)', r: `${winkRight.gapMm.toFixed(1)} mm`, l: `${winkLeft.gapMm.toFixed(1)} mm` },
        { name: '閉じ度', r: `${winkRight.ratio.toFixed(0)} %`, l: `${winkLeft.ratio.toFixed(0)} %` },
        { name: '判定スコア', r: `${winkRight.score} 点`, l: `${winkLeft.score} 点` }
    ];
    rows.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${item.name}</td><td>${item.r}</td><td>${item.l}</td>`;
        resultDetails.appendChild(tr);
    });

    evalView.classList.add('hidden');
    resultView.classList.remove('hidden');
    updateResultButtons();
    updateAllProgress();
}

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
    setResultViewMode('single');
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
        updateResultButtons();
        updateAllProgress();

    } else {
        alert("顔が見つかりません。枠内に顔を入れてください。");
    }
    btnAction.disabled = false;
}

// === 7. 結果画面のボタン ===

// 「再撮影」
btnRetry.onclick = () => {
    if (isAllModeActive()) {
        resultView.classList.add('hidden');
        showInstruction(currentMode);
        updateAllProgress();
        if (currentMode === 'wink') {
            resetWinkState();
        }
        return;
    }

    resultView.classList.add('hidden');
    evalView.classList.remove('hidden');

    // キャンバスをクリアしてカメラ映像のみにする
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (currentMode === 'wink') {
        resetWinkState();
        btnAction.disabled = false;
        btnAction.innerText = '撮影開始（右目）';
        status.innerText = '右目をつぶってください（左目は開けたまま）';
    }
};

// 「次の項目へ」(通し評価)
if (btnNext) {
    btnNext.onclick = () => {
        if (!isAllModeActive()) return;

        const score = Number.parseInt(resultScore.innerText, 10) || 0;
        sequenceManager.record(score);

        const nextStep = sequenceManager.next();
        if (nextStep) {
            resultView.classList.add('hidden');
            showInstruction(nextStep.id);
            updateAllProgress();
        } else {
            showFinalResults();
        }
    };
}

// 「評価選択画面に戻る」
btnHome.onclick = () => {
    if (isAllModeActive()) {
        sequenceManager.cancel();
    }
    resultView.classList.add('hidden');
    menuView.classList.remove('hidden');
    
    // リセット
    currentMode = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    status.innerText = "Select mode";
    setGuideOverlayMode(null);
    resetWinkState();
    setResultViewMode('single');
    updateAllProgress();
};

if (btnFinalHome) {
    btnFinalHome.onclick = () => {
        if (isAllModeActive()) {
            sequenceManager.cancel();
        }
        finalView.classList.add('hidden');
        menuView.classList.remove('hidden');
        currentMode = null;
        setGuideOverlayMode(null);
        resetWinkState();
        setResultViewMode('single');
        updateAllProgress();
    };
}

// アプリ起動
init();