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
    exportToCSV(patientId) {
        const now = new Date();
        const timestamp = now.toLocaleString();
        
        // ヘッダーの先頭に「患者ID」を追加
        const headers = ["患者ID", "日時", "合計スコア"];
        // データ行の先頭に実際の ID を追加
        const dataRow = [patientId, timestamp, this.totalScore()];

        this.results.forEach(result => {
            if (result) {
                const prefix = result.name;
                headers.push(`${prefix}_スコア`);
                dataRow.push(result.score);

                result.details.forEach(detail => {
                    headers.push(`${prefix}_${detail.label}`);
                    dataRow.push(detail.value);
                });
            }
        });

        const csvContent = [
            headers.join(","),
            dataRow.join(",")
        ].join("\n");

        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        
        // ファイル名にIDを組み込む（お医者さんが管理しやすくなる！）
        const fileNameId = patientId.replace(/[/\\?%*:|"<>]/g, '-'); // 記号を安全な文字に置換
        const dateStr = now.toISOString().split('T')[0];
        link.setAttribute("href", url);
        link.setAttribute("download", `yanagihara_${fileNameId}_${dateStr}.csv`);
        
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
} // <-- クラスの閉じカッコ
