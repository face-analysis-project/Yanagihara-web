import { CFG } from './config.js';

// 座標取得 (正規化座標 0.0-1.0 を Pixel に変換)
export function getCoord(landmarks, index, width, height) {
    return {
        x: landmarks[index].x * width,
        y: landmarks[index].y * height
    };
}

// mm/px の計算 (黒目基準)
export function calcMmPerPx(landmarks, width, height) {
    const getRadius = (indices) => {
        let pts = indices.map(i => getCoord(landmarks, i, width, height));
        let minX = Math.min(...pts.map(p=>p.x)), maxX = Math.max(...pts.map(p=>p.x));
        return (maxX - minX) / 2;
    };
    let rL = getRadius(CFG.ID.IRIS_L_BORDER);
    let rR = getRadius(CFG.ID.IRIS_R_BORDER);
    let avgRadiusPx = (rL + rR) / 2;
    // 直径 = 半径*2
    return CFG.IRIS_DIAMETER_MM / (avgRadiusPx * 2); 
}

// スコア計算 (差分が小さいほど良い)
export function calcScoreDiff(val, thresholds) {
    if (val < thresholds[0]) return 4;
    else if (val < thresholds[1]) return 2;
    return 0;
}