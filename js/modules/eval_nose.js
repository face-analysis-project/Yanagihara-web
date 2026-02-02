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

function drawLine(ctx, from, to, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
}

function scoreByMoveMm(moveMm) {
    const t4 = CFG.THRESH_NOSE_MM_4 ?? 1.5;
    const t2 = CFG.THRESH_NOSE_MM_2 ?? 0.5;
    if (moveMm >= t4) return 4;
    if (moveMm >= t2) return 2;
    return 0;
}

export class NoseEvaluator {
    constructor() {}

    /**
     * restLandmarks/maxLandmarks: MediaPipe faceLandmarks[0]
     * ctx: 結果描画用。画像は既にctxに描画済みを想定
     */
    evaluateAndDraw(restLandmarks, maxLandmarks, ctx, width, height, mmPerPx) {
        const restTip = getCoord(restLandmarks, CFG.ID.NOSE_TIP, width, height);
        const restL = getCoord(restLandmarks, CFG.ID.NOSE_WING_L, width, height);
        const restR = getCoord(restLandmarks, CFG.ID.NOSE_WING_R, width, height);

        const maxTip = getCoord(maxLandmarks, CFG.ID.NOSE_TIP, width, height);
        const maxL = getCoord(maxLandmarks, CFG.ID.NOSE_WING_L, width, height);
        const maxR = getCoord(maxLandmarks, CFG.ID.NOSE_WING_R, width, height);

        const restDL = Math.hypot(restL.x - restTip.x, restL.y - restTip.y);
        const restDR = Math.hypot(restR.x - restTip.x, restR.y - restTip.y);
        const maxDL = Math.hypot(maxL.x - maxTip.x, maxL.y - maxTip.y);
        const maxDR = Math.hypot(maxR.x - maxTip.x, maxR.y - maxTip.y);

        const moveLmm = Math.max(0, (maxDL - restDL) * mmPerPx);
        const moveRmm = Math.max(0, (maxDR - restDR) * mmPerPx);

        const scoreL = scoreByMoveMm(moveLmm);
        const scoreR = scoreByMoveMm(moveRmm);

        // --- 描画 ---
        // Rest: 点線
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(restL.x, restL.y, 6, 0, 2 * Math.PI);
        ctx.arc(restR.x, restR.y, 6, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.restore();

        // 矢印（Rest→Max）
        drawArrow(ctx, restL, maxL, 'cyan');
        drawArrow(ctx, restR, maxR, 'cyan');

        // Nose tip line (Max)
        drawLine(ctx, maxTip, maxL, 'rgba(255,255,255,0.6)');
        drawLine(ctx, maxTip, maxR, 'rgba(255,255,255,0.6)');

        // Max: 点
        drawDot(ctx, maxL, 'yellow', 6);
        drawDot(ctx, maxR, 'yellow', 6);
        drawDot(ctx, maxTip, 'white', 4);

        const details = [
            { name: '左鼻翼', value: `+ ${moveLmm.toFixed(1)} mm`, score: scoreL },
            { name: '右鼻翼', value: `+ ${moveRmm.toFixed(1)} mm`, score: scoreR }
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
