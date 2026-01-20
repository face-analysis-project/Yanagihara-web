import { CFG } from '../config.js';
import { getCoord } from '../utils.js';

function clamp01(n) {
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
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

function normalizeBaselineAngle(angle) {
    // 線分の向き(±π)で上下が反転しないよう、角度を [-π/2, π/2] に正規化
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    return angle;
}

function ratioPercent(hOpen, hClosed) {
    const eps = 1e-3; // mm
    if (hOpen <= eps) {
        return (hClosed <= eps) ? 100 : 0;
    }
    return clamp01(1 - (hClosed / hOpen)) * 100;
}

function scoreByRatioPercent(ratio) {
    // light-close と同じ採点ロジックに合わせる（閉じ度%で判定）
    const t4 = CFG.THRESH_LIGHT_CLOSE_RATIO?.[0] ?? 95;
    const t2 = CFG.THRESH_LIGHT_CLOSE_RATIO?.[1] ?? 80;
    if (ratio >= t4) return 4;
    if (ratio >= t2) return 2;
    return 0;
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

function calcEyeMetrics(landmarks, width, height, mmPerPx, eye) {
    const inner = getCoord(landmarks, eye.innerId, width, height);
    const outer = getCoord(landmarks, eye.outerId, width, height);
    const up = getCoord(landmarks, eye.upId, width, height);
    const low = getCoord(landmarks, eye.lowId, width, height);

    const mid = { x: (inner.x + outer.x) / 2, y: (inner.y + outer.y) / 2 };
    let angle = Math.atan2(outer.y - inner.y, outer.x - inner.x);
    angle = normalizeBaselineAngle(angle);

    const innerR = rotatePoint(inner, mid, -angle);
    const outerR = rotatePoint(outer, mid, -angle);
    const upR = rotatePoint(up, mid, -angle);
    const lowR = rotatePoint(low, mid, -angle);

    // 隙間(H): 回転後の上下瞼Y差分。マイナスは0（完全閉眼）
    let hPx = lowR.y - upR.y;
    if (hPx < 0) hPx = 0;

    return {
        pts: { inner, outer, up, low },
        angle,
        mid,
        hPx,
        hMm: hPx * mmPerPx
    };
}

function getEyeIds(side) {
    if (side === 'right') {
        return {
            innerId: CFG.ID.EYE_R_INNER,
            outerId: CFG.ID.EYE_R_OUTER,
            upId: CFG.ID.EYE_R_UP,
            lowId: CFG.ID.EYE_R_LOW
        };
    }
    return {
        innerId: CFG.ID.EYE_L_INNER,
        outerId: CFG.ID.EYE_L_OUTER,
        upId: CFG.ID.EYE_L_UP,
        lowId: CFG.ID.EYE_L_LOW
    };
}

export class WinkEvaluator {
    constructor() {}

    /**
     * openLandmarks/closedLandmarks: MediaPipe faceLandmarks[0]
     * side: 'right' | 'left'
     */
    evaluateAndDraw(openLandmarks, closedLandmarks, side, ctx, width, height, mmPerPx) {
        const eye = getEyeIds(side);
        const openE = calcEyeMetrics(openLandmarks, width, height, mmPerPx, eye);
        const closedE = calcEyeMetrics(closedLandmarks, width, height, mmPerPx, eye);

        const gapMm = closedE.hMm;
        const ratio = ratioPercent(openE.hMm, closedE.hMm);
        const score = scoreByRatioPercent(ratio);

        // --- 描画 ---
        drawIris(ctx, closedLandmarks, width, height);

        // 上瞼-下瞼を線で結ぶ（対象目のみ）
        const up = closedE.pts.up;
        const low = closedE.pts.low;
        const mid = { x: (up.x + low.x) / 2, y: (up.y + low.y) / 2 };

        ctx.strokeStyle = 'cyan';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(up.x, up.y);
        ctx.lineTo(low.x, low.y);
        ctx.stroke();

        // gap表示
        ctx.fillStyle = 'white';
        ctx.font = '24px sans-serif';
        ctx.fillText(`${gapMm.toFixed(1)} mm`, mid.x + 10, mid.y - 10);

        return {
            gapMm,
            ratio,
            score
        };
    }
}
