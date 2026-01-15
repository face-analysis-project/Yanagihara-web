export const CFG = {
    // 基準値
    IRIS_DIAMETER_MM: 11.7,
    
    // しきい値 { 'Part': [Score4_thresh, Score2_thresh] }
    THRESH_REST: {
        'Eye': [2.0, 5.0], 
        'Mouth': [3.0, 6.0]
    },
    THRESH_PHILTRUM_DEG: [10.0, 20.0],

    // ランドマークID (MediaPipe Face Mesh)
    ID: {
        EYE_L: 33, EYE_R: 263,      // 目尻
        MOUTH_L: 61, MOUTH_R: 291,  // 口角
        PHILTRUM_TOP: 2, PHILTRUM_BTM: 0,
        IRIS_L_CENTER: 468,
        IRIS_R_CENTER: 473,
        IRIS_L_BORDER: [469, 470, 471, 472],
        IRIS_R_BORDER: [474, 475, 476, 477]
    }
};