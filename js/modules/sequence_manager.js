export class SequenceManager {
    constructor(steps) {
        this.steps = steps;
        this.currentStepIndex = 0;
        this.results = [];
        this.active = false;
    }

    start() {
        this.active = true;
        this.currentStepIndex = 0;
        this.results = [];
        return this.currentStep();
    }

    currentStep() {
        return this.steps[this.currentStepIndex] ?? null;
    }

    record(result) {
        const step = this.currentStep();
        if (!step) return;
        this.results[this.currentStepIndex] = {
            id: step.id,
            name: step.name,
            score: result?.score ?? 0,
            details: result?.details ?? [],
            images: result?.images ?? []
        };
    }

    next() {
        if (this.currentStepIndex >= this.steps.length - 1) {
            this.active = false;
            return null;
        }
        this.currentStepIndex += 1;
        return this.currentStep();
    }

    retry() {
        return this.currentStep();
    }

    cancel() {
        this.active = false;
        this.currentStepIndex = 0;
        this.results = [];
    }

    // 2026/03/30 ishida修正
    // js/modules/sequence_manager.js の既存のコードの末尾（totalScoreメソッドの下）に追加

    totalScore() {
        return this.results.reduce((sum, r) => sum + (Number(r?.score) || 0), 0);
    }

    // ここから追加: Wide FormatでのCSVエクスポート機能
    exportToCSV() {
        if (!this.results || this.results.length === 0) {
            alert("エクスポートするデータがありません。");
            return;
        }

        // 1. ヘッダー（1行目）とデータ（2行目）の初期化
        const headers = ['日時', '合計スコア'];
        const dataRow = [
            new Date().toLocaleString('ja-JP').replace(/,/g, ''), // 日時 (カンマが含まれるとCSVが壊れるため削除)
            this.totalScore()                                     // 総合点
        ];

        // 2. 各テスト項目のスコアと生データ（details）を横に展開 (Wide format)
        this.results.forEach(result => {
            if (!result) return;
            
            const prefix = result.name; // 例: "安静時"

            // 該当項目のスコアカラム
            headers.push(`${prefix}_スコア`);
            dataRow.push(result.score);

            // 該当項目の生データカラム (MediaPipeのmmや%などの計測値)
            if (result.details && result.details.length > 0) {
                result.details.forEach(detail => {
                    // label(例: "左右差(mm)") と value を取得して列を追加
                    headers.push(`${prefix}_${detail.label}`);
                    dataRow.push(detail.value);
                });
            }
        });

        // 3. CSV文字列の結合
        const csvContent = headers.join(',') + '\n' + dataRow.join(',');

        // 4. Blobを用いたダウンロード処理 (※BOMを付与してExcelの文字化けを防ぐ)
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        // ファイル名を日付入りにする
        a.download = `yanagihara_result_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a);
        a.click();
        
        // メモリ解放
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
} // <-- クラスの閉じカッコ
