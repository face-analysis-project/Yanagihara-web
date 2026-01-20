import { CFG } from '../config.js';
import { getCoord } from '../utils.js';

function clamp01(n) {
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

function drawDot(ctx, p, color, r = 6) {
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

function scoreByMouthRatioPercent(ratioPercent) {
    // ratioPercent = (W_act/W_rest)*100
    const t4 = CFG.THRESH_WHISTLE_MOUTH_RATIO_PERCENT?.[0] ?? 50;
    const t2 = CFG.THRESH_WHISTLE_MOUTH_RATIO_PERCENT?.[1] ?? 30;
    if (ratioPercent >= t4) return 4;
    if (ratioPercent >= t2) return 2;
    return 0;
}

export class WhistleEvaluator {
    constructor() {}

    /**
     * restLandmarks/actLandmarks: MediaPipe faceLandmarks[0]
     * ctx: 結果描画用。画像は既にctxに描画済みを想定
     */
    evaluateAndDraw(restLandmarks, actLandmarks, ctx, width, height, mmPerPx) {
        const restL = getCoord(restLandmarks, CFG.ID.MOUTH_L, width, height);
        const restR = getCoord(restLandmarks, CFG.ID.MOUTH_R, width, height);
        const actL = getCoord(actLandmarks, CFG.ID.MOUTH_L, width, height);
        const actR = getCoord(actLandmarks, CFG.ID.MOUTH_R, width, height);

        const restWidthMm = Math.hypot(restR.x - restL.x, restR.y - restL.y) * mmPerPx;
        const actWidthMm = Math.hypot(actR.x - actL.x, actR.y - actL.y) * mmPerPx;

        const ratio = (restWidthMm > 1e-6) ? (actWidthMm / restWidthMm) : 0;
        const ratioPercent = ratio * 100;

        // 左右の変化量（mm）は出すが、点数には反映しない
        // 左口角: すぼめると内側(右方向)に動く → dx = act.x - rest.x
        // 右口角: すぼめると内側(左方向)に動く → dx = rest.x - act.x
        const moveLmm = Math.max(0, (actL.x - restL.x) * mmPerPx);
        const moveRmm = Math.max(0, (restR.x - actR.x) * mmPerPx);

        const score = scoreByMouthRatioPercent(ratioPercent);

        // --- 描画 ---
        drawIris(ctx, actLandmarks, width, height);

        const mouthMid = { x: (actL.x + actR.x) / 2, y: (actL.y + actR.y) / 2 };

        // Rest口角（薄い点線） + 口角移動矢印（Rest→Act）
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(restL.x, restL.y, 7, 0, 2 * Math.PI);
        ctx.arc(restR.x, restR.y, 7, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.restore();

        drawArrow(ctx, restL, actL, 'cyan');
        drawArrow(ctx, restR, actR, 'cyan');

        // 点（口角=赤、口の中心=青、鼻=白）
        drawDot(ctx, actL, 'red', 7);
        drawDot(ctx, actR, 'red', 7);
        drawDot(ctx, mouthMid, 'dodgerblue', 7);

        const details = [
            { name: '安静時口幅', value: `${restWidthMm.toFixed(1)} mm`, score: '-' },
            { name: 'すぼめ時口幅', value: `${actWidthMm.toFixed(1)} mm`, score: '-' },
            { name: '口幅比 (Wact/Wrest)', value: `${clamp01(ratio).toFixed(2)} (${ratioPercent.toFixed(0)}%)`, score: '-' },
            { name: '口幅比 (すぼめ時/安静時)', value: `${ratioPercent.toFixed(0)}%`, score },
            { name: '左の変化量', value: `${moveLmm.toFixed(1)} mm`, score: '-' },
            { name: '右の変化量', value: `${moveRmm.toFixed(1)} mm`, score: '-' },
        ];

        return {
            total: score,
            count: 1,
            details,
            extras: {
                restWidthMm,
                actWidthMm,
                ratio,
                ratioPercent,
                moveLmm,
                moveRmm,
                score
            }
        };
    }
}
