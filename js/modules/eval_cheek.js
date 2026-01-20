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

function scoreByPuffPercent(puffPercent) {
    const t4 = CFG.THRESH_CHEEK_PUFF_PERCENT?.[0] ?? 20;
    const t2 = CFG.THRESH_CHEEK_PUFF_PERCENT?.[1] ?? 10;
    if (puffPercent >= t4) return 4;
    if (puffPercent >= t2) return 2;
    return 0;
}

function scoreByRatioPercent(ratioPercent) {
    const t4 = CFG.THRESH_CHEEK_RATIO_PERCENT?.[0] ?? 80;
    const t2 = CFG.THRESH_CHEEK_RATIO_PERCENT?.[1] ?? 30;
    if (ratioPercent >= t4) return 4;
    if (ratioPercent >= t2) return 2;
    return 0;
}

function safePercent(delta, base) {
    const eps = 1e-6;
    if (base <= eps) return 0;
    return Math.max(0, (delta / base) * 100);
}

export class CheekEvaluator {
    constructor() {
        this.candidates = null; // { left:number[], right:number[] }
    }

    setCandidates(candidates) {
        this.candidates = candidates;
    }

    /**
     * restLandmarks/maxLandmarks: MediaPipe faceLandmarks[0]
     * ctx: 結果描画用。画像は既にctxに描画済みを想定
     */
    evaluateAndDraw(restLandmarks, maxLandmarks, ctx, width, height, mmPerPx) {
        const noseRest = getCoord(restLandmarks, CFG.ID.NOSE_CENTER ?? 168, width, height);
        const noseMax = getCoord(maxLandmarks, CFG.ID.NOSE_CENTER ?? 168, width, height);

        const colors = ['cyan', 'lime', 'magenta', 'orange', 'deepskyblue', 'gold'];
        const labels = ['A', 'B', 'C', 'D', 'E', 'F'];

        const candidateLeft = (this.candidates?.left && this.candidates.left.length > 0)
            ? this.candidates.left
            : [CFG.ID.CHEEK_L];
        const candidateRight = (this.candidates?.right && this.candidates.right.length > 0)
            ? this.candidates.right
            : [CFG.ID.CHEEK_R];
        const n = Math.min(candidateLeft.length, candidateRight.length);

        const perCandidate = [];
        for (let i = 0; i < n; i++) {
            const restCheekL = getCoord(restLandmarks, candidateLeft[i], width, height);
            const restCheekR = getCoord(restLandmarks, candidateRight[i], width, height);
            const maxCheekL = getCoord(maxLandmarks, candidateLeft[i], width, height);
            const maxCheekR = getCoord(maxLandmarks, candidateRight[i], width, height);

            const restDLmm = Math.abs(restCheekL.x - noseRest.x) * mmPerPx;
            const restDRmm = Math.abs(restCheekR.x - noseRest.x) * mmPerPx;
            const maxDLmm = Math.abs(maxCheekL.x - noseMax.x) * mmPerPx;
            const maxDRmm = Math.abs(maxCheekR.x - noseMax.x) * mmPerPx;

            const puffLmm = Math.max(0, maxDLmm - restDLmm);
            const puffRmm = Math.max(0, maxDRmm - restDRmm);

            const puffLPercent = safePercent(puffLmm, restDLmm);
            const puffRPercent = safePercent(puffRmm, restDRmm);

            const maxP = Math.max(puffLPercent, puffRPercent);
            const minP = Math.min(puffLPercent, puffRPercent);
            const ratioPercent = (maxP <= 1e-6) ? 100 : (minP / maxP) * 100;

            perCandidate.push({
                i,
                color: colors[i % colors.length],
                label: labels[i % labels.length],
                restCheekL,
                restCheekR,
                maxCheekL,
                maxCheekR,
                puffLmm,
                puffRmm,
                puffLPercent,
                puffRPercent,
                ratioPercent
            });
        }

        // 採点は暫定で候補A（先頭）を使用
        const primary = perCandidate[0];

        // 健常者で「満点」を狙うため、各指標は候補群の最大値を採用
        const pickMax = (key) => {
            let best = null;
            perCandidate.forEach(c => {
                if (!best || (c[key] ?? -Infinity) > (best[key] ?? -Infinity)) best = c;
            });
            return best;
        };

        const bestR = pickMax('puffRPercent');
        const bestL = pickMax('puffLPercent');
        const bestRatio = pickMax('ratioPercent');

        const puffRmm = bestR?.puffRmm ?? 0;
        const puffLmm = bestL?.puffLmm ?? 0;
        const puffRPercent = bestR?.puffRPercent ?? 0;
        const puffLPercent = bestL?.puffLPercent ?? 0;
        const ratioPercent = bestRatio?.ratioPercent ?? 100;

        const scoreR = scoreByPuffPercent(puffRPercent);
        const scoreL = scoreByPuffPercent(puffLPercent);
        const scoreRatio = scoreByRatioPercent(ratioPercent);

        // --- 描画 ---
        // 黒目(虹彩)マーカー（トラッキング確認用）
        drawIris(ctx, maxLandmarks, width, height);

        // 候補点ごとにマーカー（色違い）
        perCandidate.forEach(c => {
            // Rest: 点線の円
            ctx.save();
            ctx.setLineDash([6, 6]);
            ctx.strokeStyle = c.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(c.restCheekL.x, c.restCheekL.y, 7, 0, 2 * Math.PI);
            ctx.arc(c.restCheekR.x, c.restCheekR.y, 7, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.restore();

            // 矢印（Rest→Max）
            drawArrow(ctx, c.restCheekL, c.maxCheekL, c.color);
            drawArrow(ctx, c.restCheekR, c.maxCheekR, c.color);

            // Max: 色付きの点
            drawDot(ctx, c.maxCheekL, c.color, 7);
            drawDot(ctx, c.maxCheekR, c.color, 7);
        });
        // 参考: 鼻点（白）
        drawDot(ctx, noseMax, 'white', 4);

        const labelR = bestR ? `候補${bestR.label}(${bestR.color})` : (primary ? `候補${primary.label}(${primary.color})` : '候補A');
        const labelL = bestL ? `候補${bestL.label}(${bestL.color})` : (primary ? `候補${primary.label}(${primary.color})` : '候補A');
        const labelRatio = bestRatio ? `候補${bestRatio.label}(${bestRatio.color})` : (primary ? `候補${primary.label}(${primary.color})` : '候補A');
        const details = [
            { name: `右頬の膨らみ（${labelR}）`, value: `${puffRmm.toFixed(1)} mm (${puffRPercent.toFixed(0)}%)`, score: scoreR },
            { name: `左頬の膨らみ（${labelL}）`, value: `${puffLmm.toFixed(1)} mm (${puffLPercent.toFixed(0)}%)`, score: scoreL },
            { name: `左右比率（${labelRatio}）`, value: `${ratioPercent.toFixed(0)}%`, score: scoreRatio },
        ];

        // 比較用（候補B以降）はスコア欄を空にして数値だけ出す
        if (perCandidate.length > 1) {
            perCandidate.slice(1).forEach(c => {
                details.push({
                    name: `比較: 候補${c.label}(${c.color}) 右/左/比率`,
                    value: `${c.puffRmm.toFixed(1)}mm(${c.puffRPercent.toFixed(0)}%) / ${c.puffLmm.toFixed(1)}mm(${c.puffLPercent.toFixed(0)}%) / ${c.ratioPercent.toFixed(0)}%`,
                    score: null
                });
            });
        }

        return {
            total: scoreR + scoreL + scoreRatio,
            count: 3,
            details,
            extras: {
                puffRmm,
                puffLmm,
                puffRPercent,
                puffLPercent,
                ratioPercent,
                scoreR,
                scoreL,
                scoreRatio
            }
        };
    }
}
