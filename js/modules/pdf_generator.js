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

        const container = document.createElement('div');
        container.style.fontFamily = '"Helvetica Neue", Arial, sans-serif';
        container.style.padding = '28px 32px';
        container.style.fontSize = '12px';

        const header = document.createElement('div');
        header.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-end;">
                <div style="font-size:18px;font-weight:700;">柳原法（40点法） 顔面神経麻痺 評価報告書</div>
                <div style="font-size:12px;">測定日時: ${dateStr}</div>
            </div>
            <div style="margin-top:6px;">ID: ____________________　氏名: ____________________</div>
            <hr style="margin:10px 0; border:none; border-top:1px solid #ccc;"/>
        `;

        const summary = document.createElement('div');
        summary.innerHTML = `
            <div style="border:1px solid #2a6fbe; padding:12px; border-radius:6px;">
                <div style="font-size:12px; color:#2a6fbe; font-weight:700;">総合評価</div>
                <div style="font-size:28px; font-weight:700; margin-top:4px;">${totalScore} / 40 点</div>
                <div style="margin-top:6px;">麻痺側: ____________　判定: ____________</div>
            </div>
        `;

        const table = document.createElement('div');
        table.style.marginTop = '12px';
        table.innerHTML = `
            <div style="display:grid; grid-template-columns: 1fr 70px 120px 1fr; gap:6px; font-weight:700; border-bottom:1px solid #ddd; padding-bottom:6px;">
                <div>項目</div>
                <div>スコア</div>
                <div>画像</div>
                <div>定量データ</div>
            </div>
        `;

        results.forEach((r, idx) => {
            const row = document.createElement('div');
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '1fr 70px 120px 1fr';
            row.style.gap = '6px';
            row.style.alignItems = 'center';
            row.style.padding = '6px 0';
            row.style.borderBottom = '1px solid #eee';
            row.style.pageBreakInside = 'avoid';

            const imgHtml = (r.images && r.images.length > 0)
                ? r.images.map(src => `<img src="${src}" style="height:40px; border:1px solid #ddd; border-radius:4px; margin-right:4px;" />`).join('')
                : '';

            const detailText = (r.details && r.details.length > 0)
                ? r.details.join(' / ')
                : '';

            row.innerHTML = `
                <div>${idx + 1}. ${r.name}</div>
                <div>${r.score} 点</div>
                <div>${imgHtml}</div>
                <div>${detailText}</div>
            `;

            table.appendChild(row);
        });

        const footer = document.createElement('div');
        footer.style.marginTop = '12px';
        footer.style.fontSize = '10px';
        footer.style.color = '#666';
        footer.innerHTML = `
            <hr style="margin:8px 0; border:none; border-top:1px solid #ccc;"/>
            <div>本レポートはAIによる自動解析結果であり、医師の確定診断を代替するものではありません。</div>
            <div>Yanagihara Automated Evaluator System</div>
        `;

        container.appendChild(header);
        container.appendChild(summary);
        container.appendChild(table);
        container.appendChild(footer);
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
