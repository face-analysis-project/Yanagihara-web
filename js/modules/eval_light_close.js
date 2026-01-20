import { CFG } from '../config.js';
import { getCoord } from '../utils.js';

function clamp01(n) {
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
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

        // 十字線 (簡易)
        ctx.strokeStyle = 'yellow';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(center.x - radius, center.y);
        ctx.lineTo(center.x + radius, center.y);
        ctx.moveTo(center.x, center.y - radius);
        ctx.lineTo(center.x, center.y + radius);
        ctx.stroke();

        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(center.x, center.y, 3, 0, 2 * Math.PI);
        ctx.fill();
    };

    drawOne(ilCenter, CFG.ID.IRIS_L_BORDER);
    drawOne(irCenter, CFG.ID.IRIS_R_BORDER);
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

function calcEyeMetrics(landmarks, width, height, mmPerPx, eye) {
    // eye: { innerId, outerId, upId, lowId }
    const inner = getCoord(landmarks, eye.innerId, width, height);
    const outer = getCoord(landmarks, eye.outerId, width, height);
    const up = getCoord(landmarks, eye.upId, width, height);
    const low = getCoord(landmarks, eye.lowId, width, height);

    const mid = { x: (inner.x + outer.x) / 2, y: (inner.y + outer.y) / 2 };
    let angle = Math.atan2(outer.y - inner.y, outer.x - inner.x);
    // 線分の向き(±π)で上下が反転しないよう、角度を [-π/2, π/2] に正規化
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;

    // 基準線が水平になるように逆回転
    const innerR = rotatePoint(inner, mid, -angle);
    const outerR = rotatePoint(outer, mid, -angle);
    const upR = rotatePoint(up, mid, -angle);
    const lowR = rotatePoint(low, mid, -angle);

    const baseY = (innerR.y + outerR.y) / 2;

    // UI表示・移動量用: 中心線からの距離（絶対値）
    const dUpPx = Math.abs(baseY - upR.y);
    const dLowPx = Math.abs(lowR.y - baseY);

    // 隙間(H)は「回転後の上下瞼Y差分」。上瞼が下瞼より下に入り込んだ場合は0扱い。
    let hPx = lowR.y - upR.y;
    if (hPx < 0) hPx = 0;

    return {
        pts: { inner, outer, up, low },
        angle,
        mid,
        dUpPx,
        dLowPx,
        hPx,
        dUpMm: dUpPx * mmPerPx,
        dLowMm: dLowPx * mmPerPx,
        hMm: hPx * mmPerPx
    };
}

function scoreByRatioPercent(ratioPercent) {
    const t4 = CFG.THRESH_LIGHT_CLOSE_RATIO?.[0] ?? 95;
    const t2 = CFG.THRESH_LIGHT_CLOSE_RATIO?.[1] ?? 80;
    if (ratioPercent >= t4) return 4;
    if (ratioPercent >= t2) return 2;
    return 0;
}

function ratioPercent(hOpen, hClosed) {
    // hOpen が極小（トラッキング不安定等）だと比率が破綻する。
    // ただし hClosed も同程度に小さい場合は「完全閉眼」とみなし 100% に寄せる。
    const eps = 1e-3; // mm
    if (hOpen <= eps) {
        return (hClosed <= eps) ? 100 : 0;
    }
    return clamp01(1 - (hClosed / hOpen)) * 100;
}

export class LightCloseEvaluator {
    constructor() {}

    /**
     * openLandmarks/closedLandmarks: MediaPipe faceLandmarks[0]
     * ctx: 結果描画用。画像は既にctxに描画済みを想定
     */
    evaluateAndDraw(openLandmarks, closedLandmarks, ctx, width, height, mmPerPx) {
        const eyeR = {
            innerId: CFG.ID.EYE_R_INNER,
            outerId: CFG.ID.EYE_R_OUTER,
            upId: CFG.ID.EYE_R_UP,
            lowId: CFG.ID.EYE_R_LOW
        };
        const eyeL = {
            innerId: CFG.ID.EYE_L_INNER,
            outerId: CFG.ID.EYE_L_OUTER,
            upId: CFG.ID.EYE_L_UP,
            lowId: CFG.ID.EYE_L_LOW
        };

        const openR = calcEyeMetrics(openLandmarks, width, height, mmPerPx, eyeR);
        const openL = calcEyeMetrics(openLandmarks, width, height, mmPerPx, eyeL);
        const closedR = calcEyeMetrics(closedLandmarks, width, height, mmPerPx, eyeR);
        const closedL = calcEyeMetrics(closedLandmarks, width, height, mmPerPx, eyeL);

        const moveUpR = Math.max(0, openR.dUpMm - closedR.dUpMm);
        const moveLowR = Math.max(0, openR.dLowMm - closedR.dLowMm);
        const moveUpL = Math.max(0, openL.dUpMm - closedL.dUpMm);
        const moveLowL = Math.max(0, openL.dLowMm - closedL.dLowMm);

        const ratioR = ratioPercent(openR.hMm, closedR.hMm);
        const ratioL = ratioPercent(openL.hMm, closedL.hMm);

        const scoreR = scoreByRatioPercent(ratioR);
        const scoreL = scoreByRatioPercent(ratioL);

        // --- 描画 ---
        // 黒目トラッキング（closed）
        drawIris(ctx, closedLandmarks, width, height);

        const drawEyeOverlay = (openEye, closedEye) => {
            // 基準線 (青)
            ctx.strokeStyle = 'blue';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(closedEye.pts.inner.x, closedEye.pts.inner.y);
            ctx.lineTo(closedEye.pts.outer.x, closedEye.pts.outer.y);
            ctx.stroke();

            // Open: 点線
            ctx.save();
            ctx.setLineDash([6, 6]);
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(openEye.pts.up.x, openEye.pts.up.y, 6, 0, 2 * Math.PI);
            ctx.arc(openEye.pts.low.x, openEye.pts.low.y, 6, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.restore();

            // Closed: 実線（目立つ点）
            drawDot(ctx, closedEye.pts.inner, 'dodgerblue', 5);
            drawDot(ctx, closedEye.pts.outer, 'dodgerblue', 5);
            drawDot(ctx, closedEye.pts.up, 'red', 6);
            drawDot(ctx, closedEye.pts.low, 'red', 6);

            // 矢印（open→closed）
            drawArrow(ctx, openEye.pts.up, closedEye.pts.up, 'cyan');
            drawArrow(ctx, openEye.pts.low, closedEye.pts.low, 'cyan');
        };

        drawEyeOverlay(openR, closedR);
        drawEyeOverlay(openL, closedL);

        const details = [
            { name: '【右目】上瞼移動量', value: `${moveUpR.toFixed(1)} mm`, score: '-' },
            { name: '【右目】下瞼移動量', value: `${moveLowR.toFixed(1)} mm`, score: '-' },
            { name: '【右目】閉じ度', value: `${ratioR.toFixed(0)} % (隙間 ${closedR.hMm.toFixed(1)}mm)`, score: scoreR },
            { name: '【左目】上瞼移動量', value: `${moveUpL.toFixed(1)} mm`, score: '-' },
            { name: '【左目】下瞼移動量', value: `${moveLowL.toFixed(1)} mm`, score: '-' },
            { name: '【左目】閉じ度', value: `${ratioL.toFixed(0)} % (隙間 ${closedL.hMm.toFixed(1)}mm)`, score: scoreL }
        ];

        return {
            total: scoreR + scoreL,
            count: 2,
            details,
            extras: {
                right: { moveUpR, moveLowR, ratioR, gapMm: closedR.hMm, score: scoreR },
                left: { moveUpL, moveLowL, ratioL, gapMm: closedL.hMm, score: scoreL }
            }
        };
    }
}
