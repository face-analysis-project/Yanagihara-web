export class PdfGenerator {
    constructor(pdfRoot) {
        this.pdfRoot = pdfRoot;
    }

    generateReport(results, totalScore) {
        if (!this.pdfRoot) return;
        this.pdfRoot.innerHTML = '';

        const now = new Date();
        const dateStr = now.toLocaleString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        const rowsHtml = results.map((r, idx) => {
            const imgHtml = (r.images && r.images.length > 0)
                ? r.images.map(src => `<img src="${src}" height="40" style="border:1px solid #ddd; border-radius:4px; margin-right:4px;" />`).join('')
                : '';

            const detailText = (r.details && r.details.length > 0)
                ? r.details.join(' / ')
                : '';

            return `
                <tr style="page-break-inside: avoid;">
                    <td width="30%">${idx + 1}. ${r.name}</td>
                    <td width="15%"><strong>${r.score} 点</strong></td>
                    <td width="20%" valign="middle">${imgHtml}</td>
                    <td width="35%">${detailText}</td>
                </tr>
            `;
        }).join('');

        const container = document.createElement('div');
        container.style.padding = '28px 32px';
        container.innerHTML = `
            <style>
                .report-table { width: 100%; border-collapse: collapse; font-family: sans-serif; font-size: 12px; }
                .report-table th { background: #f0f0f0; border-bottom: 2px solid #333; padding: 8px; text-align: left; }
                .report-table td { border-bottom: 1px solid #ddd; padding: 8px; vertical-align: middle; }
                .score-box { border: 2px solid #2a6fbe; padding: 10px; width: 100%; }
            </style>

            <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                    <td align="left" style="font-size:18px; font-weight:700;">柳原法（40点法） 顔面神経麻痺 評価報告書</td>
                    <td align="right" style="font-size:12px;">測定日時: ${dateStr}</td>
                </tr>
                <tr>
                    <td colspan="2" style="padding-top:6px;">ID: ____________________　氏名: ____________________</td>
                </tr>
            </table>

            <hr style="margin:10px 0; border:none; border-top:1px solid #ccc;" />

            <table width="100%" cellpadding="0" cellspacing="0" class="score-box">
                <tr>
                    <td style="font-size:12px; color:#2a6fbe; font-weight:700;">総合評価</td>
                </tr>
                <tr>
                    <td style="font-size:28px; font-weight:700; padding-top:4px;">${totalScore} / 40 点</td>
                </tr>
                <tr>
                    <td style="padding-top:6px;">麻痺側: ____________　判定: ____________</td>
                </tr>
            </table>

            <table class="report-table" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                <thead>
                    <tr>
                        <th width="30%">項目</th>
                        <th width="15%">スコア</th>
                        <th width="20%">画像</th>
                        <th width="35%">詳細</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>

            <hr style="margin:8px 0; border:none; border-top:1px solid #ccc;" />
            <div style="font-size:10px; color:#666;">本レポートはAIによる自動解析結果であり、医師の確定診断を代替するものではありません。</div>
            <div style="font-size:10px; color:#666;">Yanagihara Automated Evaluator System</div>
        `;

        this.pdfRoot.appendChild(container);

        const opt = {
            margin: [8, 8, 8, 8],
            filename: `Yanagihara_Report_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.pdf`,
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        window.html2pdf().set(opt).from(container).save();
    }
}
