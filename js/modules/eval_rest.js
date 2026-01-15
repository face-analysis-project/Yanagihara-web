import { CFG } from '../config.js';
import { getCoord, calcScoreDiff } from '../utils.js';

export class RestEvaluator {
    constructor() {}

    evaluate(landmarks, ctx, width, height, mmPerPx) {
        let totalScore = 0;
        let count = 0;
        let details = [];

        // ---------------------------------------------------------
        // 1. 基準軸の計算 (黒目基準)
        // ---------------------------------------------------------
        
        // 黒目の中心座標を取得
        const ilCenter = getCoord(landmarks, CFG.ID.IRIS_L_CENTER, width, height);
        const irCenter = getCoord(landmarks, CFG.ID.IRIS_R_CENTER, width, height);

        // 中心点 (Midpoint)
        const midX = (ilCenter.x + irCenter.x) / 2;
        const midY = (ilCenter.y + irCenter.y) / 2;

        // 顔の傾き (左目から右目への角度)
        const dx = irCenter.x - ilCenter.x;
        const dy = irCenter.y - ilCenter.y;
        const baseRad = Math.atan2(dy, dx); // ラジアン

        // ★ 補正用関数: ある点を「顔の傾き」に合わせて回転させた時の Y座標(高さ) を返す
        // これにより、顔が傾いていても「目線に対する垂直距離」で左右差を測れる
        const getRelativeY = (p) => {
            // 中心点からの相対座標
            const tx = p.x - midX;
            const ty = p.y - midY;
            // 回転行列の公式 (逆回転 -baseRad) を使用
            // Y' = x * sin(-θ) + y * cos(-θ)
            // sin(-θ) = -sin(θ), cos(-θ) = cos(θ)
            return -tx * Math.sin(baseRad) + ty * Math.cos(baseRad);
        };

        // ---------------------------------------------------------
        // 2. 基準線の描画 (Canvasを回転させて描く)
        // ---------------------------------------------------------
        ctx.save();
        ctx.translate(midX, midY); // 原点を両目の中心に移動
        ctx.rotate(baseRad);       // 顔の傾きに合わせてキャンバスを回転

        ctx.lineWidth = 1;

        // A. 水平線 (青): 黒目を結んだ線 (回転後のX軸)
        ctx.strokeStyle = 'blue';
        ctx.beginPath();
        ctx.moveTo(-width, 0); // 画面端まで伸ばす
        ctx.lineTo(width, 0);
        ctx.stroke();

        // B. 垂直線 (赤): 垂直二等分線 (回転後のY軸)
        ctx.strokeStyle = 'red';
        ctx.beginPath();
        ctx.moveTo(0, -height);
        ctx.lineTo(0, height);
        ctx.stroke();

        ctx.restore(); // 回転をリセット

        // ---------------------------------------------------------
        // 3. 黒目の描画 (ここは元の座標系で描画)
        // ---------------------------------------------------------
        const drawIris = (center, borderIds) => {
            let totalDist = 0;
            borderIds.forEach(id => {
                const p = getCoord(landmarks, id, width, height);
                const dist = Math.hypot(p.x - center.x, p.y - center.y);
                totalDist += dist;
            });
            const radius = totalDist / borderIds.length;

            // 輪郭 (黄色)
            ctx.strokeStyle = 'yellow';
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
            ctx.stroke();

            // 中心点 (赤)
            ctx.fillStyle = 'red';
            ctx.beginPath();
            ctx.arc(center.x, center.y, 2, 0, 2 * Math.PI);
            ctx.fill();
        };

        drawIris(ilCenter, CFG.ID.IRIS_L_BORDER);
        drawIris(irCenter, CFG.ID.IRIS_R_BORDER);

        // ---------------------------------------------------------
        // 4. 評価ロジック (傾き補正後の座標を使用)
        // ---------------------------------------------------------
        
        // ■ 目と口の左右差
        const pairs = [
            { label: '目尻の高さ', l: CFG.ID.EYE_L, r: CFG.ID.EYE_R, code: 'Eye' },
            { label: '口角の高さ', l: CFG.ID.MOUTH_L, r: CFG.ID.MOUTH_R, code: 'Mouth' }
        ];

        pairs.forEach(pair => {
            const pL = getCoord(landmarks, pair.l, width, height);
            const pR = getCoord(landmarks, pair.r, width, height);
            
            // ★変更点: 単純な pL.y ではなく、補正後の getRelativeY を使う
            const relY_L = getRelativeY(pL);
            const relY_R = getRelativeY(pR);

            const diffMm = Math.abs(relY_L - relY_R) * mmPerPx;
            const score = calcScoreDiff(diffMm, CFG.THRESH_REST[pair.code]);
            
            totalScore += score;
            count++;

            details.push({
                name: pair.label,
                value: `${diffMm.toFixed(1)} mm`,
                score: score
            });

            // 描画 (計測線は元の座標同士を結ぶシアンの線)
            ctx.strokeStyle = 'cyan';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(pL.x, pL.y); ctx.lineTo(pR.x, pR.y); ctx.stroke();
        });

        // ■ 人中の傾き
        const pTop = getCoord(landmarks, CFG.ID.PHILTRUM_TOP, width, height);
        const pBtm = getCoord(landmarks, CFG.ID.PHILTRUM_BTM, width, height);
        
        const philDx = pBtm.x - pTop.x;
        const philDy = pBtm.y - pTop.y;
        
        // 人中自体の角度 (絶対角度)
        const philAngle = Math.atan2(philDy, philDx); 
        
        // 顔の軸(baseRad + 90度) と 人中の角度 の差分を計算
        // 顔の垂直軸 = baseRad + Math.PI/2
        let angleDiffRad = Math.abs((baseRad + Math.PI / 2) - philAngle);
        
        // 補正 (-PI ~ PI の範囲に収めるなど、単純な度数変換で処理)
        let degreeDiff = angleDiffRad * (180 / Math.PI);
        if (degreeDiff > 180) degreeDiff = 360 - degreeDiff; // 反対側から回った場合などの補正

        const scorePhil = calcScoreDiff(degreeDiff, CFG.THRESH_PHILTRUM_DEG);
        
        totalScore += scorePhil;
        count++;

        details.push({
            name: '人中の傾き',
            value: `${degreeDiff.toFixed(1)}°`,
            score: scorePhil
        });

        // 描画
        ctx.strokeStyle = 'yellow';
        ctx.beginPath(); ctx.moveTo(pTop.x, pTop.y); ctx.lineTo(pBtm.x, pBtm.y); ctx.stroke();

        return {
            total: totalScore,
            count: count,
            details: details
        };
    }
}