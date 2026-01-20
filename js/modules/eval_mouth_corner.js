import { CFG } from '../config.js';
import { getCoord } from '../utils.js';

function clamp01(n) {
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

function calcRatioPercent(a, b) {
    const max = Math.max(a, b);
    const min = Math.min(a, b);
    if (max <= 1e-6) return 0;
    return (min / max) * 100;
}

function calcScoreRatio(ratioPercent) {
    const t4 = CFG.THRESH_EEE_RATIO?.[0] ?? 70;
    const t2 = CFG.THRESH_EEE_RATIO?.[1] ?? 30;
    if (ratioPercent >= t4) return 4;
    if (ratioPercent >= t2) return 2;
    return 0;
}

function drawDot(ctx, p, color, r = 5) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.fill();
}

function drawArrow(ctx, from, to, color) {
    const headLen = 10;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dy, dx);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(
        to.x - headLen * Math.cos(angle - Math.PI / 6),
        to.y - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
        to.x - headLen * Math.cos(angle + Math.PI / 6),
        to.y - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
}

function drawIris(ctx, landmarks, width, height) {
    const ilCenter = getCoord(landmarks, CFG.ID.IRIS_L_CENTER, width, height);
    const irCenter = getCoord(landmarks, CFG.ID.IRIS_R_CENTER, width, height);

    const drawOne = (center, borderIds) => {
        let totalDist = 0;
        borderIds.forEach(id => {
            const p = getCoord(landmarks, id, width, height);
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

    drawOne(ilCenter, CFG.ID.IRIS_L_BORDER);
    drawOne(irCenter, CFG.ID.IRIS_R_BORDER);
}

export class EeeEvaluator {
    constructor() {}

    /**
     * restLandmarks/maxLandmarks: MediaPipe faceLandmarks[0]
     * ctx: 結果描画用。画像は既にctxに描画済みを想定
     */
    evaluateAndDraw(restLandmarks, maxLandmarks, ctx, width, height, mmPerPx) {
        const restL = getCoord(restLandmarks, CFG.ID.MOUTH_L, width, height);
        const restR = getCoord(restLandmarks, CFG.ID.MOUTH_R, width, height);
        const maxL = getCoord(maxLandmarks, CFG.ID.MOUTH_L, width, height);
        const maxR = getCoord(maxLandmarks, CFG.ID.MOUTH_R, width, height);

        // 外側方向の水平移動のみ（左は-方向、右は+方向）
        const dLpx = Math.max(0, restL.x - maxL.x);
        const dRpx = Math.max(0, maxR.x - restR.x);

        const dLmm = dLpx * mmPerPx;
        const dRmm = dRpx * mmPerPx;

        const ratio = calcRatioPercent(dLmm, dRmm);
        const score = calcScoreRatio(ratio);

        // --- 描画 ---
        // 黒目トラッキング表示（restの結果画面と同じ意図）
        drawIris(ctx, maxLandmarks, width, height);

        // Rest: 薄い点線
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(restL.x, restL.y, 7, 0, 2 * Math.PI);
        ctx.arc(restR.x, restR.y, 7, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.restore();

        // Max: 実線 + 目立つ点
        ctx.save();
        ctx.setLineDash([]);
        drawDot(ctx, maxL, 'yellow', 6);
        drawDot(ctx, maxR, 'yellow', 6);
        ctx.restore();

        // 矢印で移動量可視化
        drawArrow(ctx, restL, maxL, 'cyan');
        drawArrow(ctx, restR, maxR, 'cyan');

        const details = [
            { name: '左移動量', value: `${dLmm.toFixed(1)} mm`, score: '-' },
            { name: '右移動量', value: `${dRmm.toFixed(1)} mm`, score: '-' },
            { name: '対称性', value: `${clamp01(ratio / 100).toFixed(2)} (${ratio.toFixed(0)}%)`, score: score }
        ];

        return {
            total: score,
            count: 1,
            details,
            extras: { dLmm, dRmm, ratio, score }
        };
    }
}
