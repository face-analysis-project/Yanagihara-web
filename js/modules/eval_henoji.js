import { CFG } from '../config.js';
import { getCoord } from '../utils.js';

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

function getRotation(landmarks, width, height) {
    const il = landmarks[CFG.ID.IRIS_L_CENTER];
    const ir = landmarks[CFG.ID.IRIS_R_CENTER];
    if (!il || !ir) return null;

    const ix1 = il.x * width; const iy1 = il.y * height;
    const ix2 = ir.x * width; const iy2 = ir.y * height;
    const cx = (ix1 + ix2) / 2;
    const cy = (iy1 + iy2) / 2;
    const angleRad = Math.atan2(iy2 - iy1, ix2 - ix1);
    return { origin: { x: cx, y: cy }, angleRad };
}

function scoreByMoveMm(moveMm) {
    const t4 = CFG.THRESH_HENOJI_MM_4 ?? 3.0;
    const t2 = CFG.THRESH_HENOJI_MM_2 ?? 1.0;
    if (moveMm >= t4) return 4;
    if (moveMm >= t2) return 2;
    return 0;
}

export class HenojiEvaluator {
    constructor() {}

    /**
     * restLandmarks/maxLandmarks: MediaPipe faceLandmarks[0]
     * ctx: 結果描画用。画像は既にctxに描画済みを想定
     */
    evaluateAndDraw(restLandmarks, maxLandmarks, ctx, width, height, mmPerPx) {
        const rot = getRotation(maxLandmarks, width, height);
        if (!rot) {
            return { total: 0, count: 2, details: [] };
        }

        const toRot = (landmarks, id) => {
            const p = getCoord(landmarks, id, width, height);
            return rotatePoint(p, rot.origin, -rot.angleRad);
        };

        const restEyeL = toRot(restLandmarks, CFG.ID.EYE_R_INNER);
        const restEyeR = toRot(restLandmarks, CFG.ID.EYE_L_INNER);
        const maxEyeL = toRot(maxLandmarks, CFG.ID.EYE_R_INNER);
        const maxEyeR = toRot(maxLandmarks, CFG.ID.EYE_L_INNER);

        const restMouthL = toRot(restLandmarks, CFG.ID.MOUTH_L);
        const restMouthR = toRot(restLandmarks, CFG.ID.MOUTH_R);
        const maxMouthL = toRot(maxLandmarks, CFG.ID.MOUTH_L);
        const maxMouthR = toRot(maxLandmarks, CFG.ID.MOUTH_R);

        const restDL = restMouthL.y - restEyeL.y;
        const restDR = restMouthR.y - restEyeR.y;
        const maxDL = maxMouthL.y - maxEyeL.y;
        const maxDR = maxMouthR.y - maxEyeR.y;

        const moveLmm = Math.max(0, (maxDL - restDL) * mmPerPx);
        const moveRmm = Math.max(0, (maxDR - restDR) * mmPerPx);

        const scoreL = scoreByMoveMm(moveLmm);
        const scoreR = scoreByMoveMm(moveRmm);

        // --- 描画 ---
        drawIris(ctx, maxLandmarks, width, height);

        // Rest: 点線
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(restMouthL.x, restMouthL.y, 7, 0, 2 * Math.PI);
        ctx.arc(restMouthR.x, restMouthR.y, 7, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.restore();

        drawArrow(ctx, restMouthL, maxMouthL, 'cyan');
        drawArrow(ctx, restMouthR, maxMouthR, 'cyan');

        drawDot(ctx, maxMouthL, 'yellow', 6);
        drawDot(ctx, maxMouthR, 'yellow', 6);

        drawDot(ctx, maxEyeL, 'white', 4);
        drawDot(ctx, maxEyeR, 'white', 4);

        const details = [
            { name: '左口角', value: `${moveLmm.toFixed(1)} mm`, score: scoreL },
            { name: '右口角', value: `${moveRmm.toFixed(1)} mm`, score: scoreR }
        ];

        return {
            total: scoreL + scoreR,
            count: 2,
            details,
            extras: {
                moveLmm,
                moveRmm,
                scoreL,
                scoreR
            }
        };
    }
}
