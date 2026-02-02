export const CFG = {
    // 基準値
    IRIS_DIAMETER_MM: 11.7,
    
    // しきい値 { 'Part': [Score4_thresh, Score2_thresh] }
    THRESH_REST: {
        'Eye': [2.0, 5.0], 
        'Mouth': [3.0, 6.0]
    },
    THRESH_PHILTRUM_DEG: [10.0, 20.0],

    // イー（歯を見せる）: 対称性 Ratio(%) の閾値 [4点, 2点]
    THRESH_EEE_RATIO: [70, 30],

    // 軽い閉眼: 閉眼時の隙間(mm) 閾値 [4点, 2点]
    // 4点: gap <= t4, 2点: gap <= t2, 0点: それ以上
    THRESH_LIGHT_CLOSE_GAP_MM: [0.0, 2.0],

    // 軽い閉眼: 閉じ度(%) 閾値 [4点, 2点]
    // 4点: ratio >= t4, 2点: ratio >= t2, 0点: それ未満
    THRESH_LIGHT_CLOSE_RATIO: [95, 60],

    // 片目つぶり(ウィンク): 隙間(mm) 閾値 [4点, 2点]
    THRESH_WINK_GAP_MM: [0.5, 2.0],

    // 口笛（口をすぼめる）: 口幅比(%) の閾値 [4点, 2点]
    // ratioPercent = (W_act / W_rest) * 100
    // 例: 33.4/50.7 ≒ 0.66 → 66%
    THRESH_WHISTLE_MOUTH_RATIO_PERCENT: [50, 30],

    // 頬をふくらます: 膨張率(%) の閾値 [4点, 2点]
    // 現状のランドマーク/計測では健常者でも(1-7%)程度になりやすいため低めに設定
    THRESH_CHEEK_PUFF_PERCENT: [2, 1],

    // 頬をふくらます: 左右比率(%) の閾値 [4点, 2点]
    THRESH_CHEEK_RATIO_PERCENT: [25, 15],

    // 額のしわ寄せ（Wrinkle）: 眉の挙上距離(mm) 閾値
    THRESH_WRINKLE_MM_4: 6.0,
    THRESH_WRINKLE_MM_2: 3.0,

    // 額のしわ寄せ（Wrinkle）: 左右比率(%) 閾値
    THRESH_WRINKLE_RATIO_4: 70,
    THRESH_WRINKLE_RATIO_2: 30,

    // 鼻翼を動かす（Nose）: 拡張距離(mm) 閾値
    THRESH_NOSE_MM_4: 0.5,
    THRESH_NOSE_MM_2: 0.1,

    // ランドマークID (MediaPipe Face Mesh)
    ID: {
        EYE_L: 33, EYE_R: 263,      // 目尻
        MOUTH_L: 61, MOUTH_R: 291,  // 口角
        PHILTRUM_TOP: 2, PHILTRUM_BTM: 0,
        // 口笛の正中線基準（鼻）
        // 仕様上は 1 または 168 を想定。デフォルトは 168。
        NOSE_CENTER: 168,
        NOSE_CENTER_ALT: 1,
        NOSE_TIP: 1,
        NOSE_WING_L: 49,
        NOSE_WING_R: 279,
        NOSE_INNER_L: 166,
        NOSE_INNER_R: 392,

        // 頬（ふくらみを見たい点）
        // 234/454 は目尻寄りに感じやすいので、頬中央寄りの点をデフォルトにする
        CHEEK_L: 93,
        CHEEK_R: 323,
        CHEEK_L_ALT: 234,
        CHEEK_R_ALT: 454,
        IRIS_L_CENTER: 468,
        IRIS_R_CENTER: 473,
        IRIS_L_BORDER: [469, 470, 471, 472],
        IRIS_R_BORDER: [474, 475, 476, 477],

        // 軽い閉眼 (まぶた距離)
        // 基準線: 目頭(内眼角) ⇔ 目尻(外眼角)
        EYE_R_INNER: 133,
        EYE_R_OUTER: 33,
        EYE_L_INNER: 362,
        EYE_L_OUTER: 263,
        // 計測点: 上瞼/下瞼の中心
        EYE_R_UP: 159,
        EYE_R_LOW: 145,
        EYE_L_UP: 386,
        EYE_L_LOW: 374,

        // 額のしわ寄せ（眉中央）
        EYEBROW_L_CENTER: 105,
        EYEBROW_R_CENTER: 334
    }
};