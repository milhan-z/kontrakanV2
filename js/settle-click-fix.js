(function () {
    if (!/settle\.html$/.test(window.location.pathname)) return;

    function rupiahToNumber(text) {
        const cleaned = String(text || '').replace(/[^0-9]/g, '');
        return cleaned ? parseInt(cleaned, 10) : 0;
    }

    function formatRupiah(amount) {
        return 'Rp ' + Math.max(0, Math.round(Number(amount) || 0)).toLocaleString('id-ID');
    }

    function getItemData(item) {
        const raw = item && item.getAttribute ? (item.getAttribute('onclick') || '') : '';
        const match = raw.match(/show(Debt|Credit)Detail\((\d+)/);
        if (!match) return null;

        const titleEl = item.querySelector('.transaction-title');
        const amountEl = item.querySelector('.transaction-amount');
        const name = titleEl ? titleEl.textContent.trim() : '';
        const amount = rupiahToNumber(amountEl ? amountEl.textContent : '0');

        return {
            type: match[1].toLowerCase(),
            userId: parseInt(match[2], 10),
            name: name,
            amount: amount
        };
    }

    function activateItem(item) {
        const data = getItemData(item);
        if (!data || !data.userId || !data.amount) return;

        if (data.type === 'debt' && typeof window.showDebtDetail === 'function') {
            window.showDebtDetail(data.userId, data.name, data.amount);
        } else if (data.type === 'credit' && typeof window.showCreditDetail === 'function') {
            window.showCreditDetail(data.userId, data.name, data.amount);
        }
    }

    function enhanceList(listId, label) {
        const list = document.getElementById(listId);
        if (!list) return;

        if (list.dataset.clickFixReady !== '1') {
            list.dataset.clickFixReady = '1';
            list.addEventListener('click', function (event) {
                const item = event.target.closest('.transaction-item');
                if (!item || !list.contains(item)) return;
                const data = getItemData(item);
                if (!data) return;

                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
                activateItem(item);
            }, true);
        }

        list.querySelectorAll('.transaction-item').forEach(function (item) {
            if (item.dataset.settleEnhanced === '1') return;
            item.dataset.settleEnhanced = '1';
            item.style.cursor = 'pointer';
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');

            const subtitle = item.querySelector('.text-muted');
            if (subtitle && !subtitle.dataset.originalText) {
                subtitle.dataset.originalText = subtitle.textContent;
                subtitle.textContent = label === 'Bayar'
                    ? 'Tap untuk lihat detail & bayar'
                    : 'Tap untuk lihat detail & tagih';
            }

            const amountEl = item.querySelector('.transaction-amount');
            if (amountEl && !amountEl.querySelector('.settle-inline-action')) {
                const action = document.createElement('div');
                action.className = 'settle-inline-action';
                action.textContent = label;
                action.style.cssText = 'margin-top:6px;font-size:.7rem;font-weight:700;text-align:right;opacity:.95;';
                amountEl.appendChild(action);
            }

            item.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activateItem(item);
                }
            });
        });
    }

    function findAmountAfterLabel(root, labelText) {
        const rows = Array.from(root.querySelectorAll('div'));
        for (const row of rows) {
            const text = row.textContent || '';
            if (!text.includes(labelText)) continue;
            const spans = row.querySelectorAll('span');
            if (spans.length >= 2) return rupiahToNumber(spans[spans.length - 1].textContent);
        }
        return 0;
    }

    function setAmountAfterLabel(root, labelText, amount, colorVar) {
        const rows = Array.from(root.querySelectorAll('div'));
        for (const row of rows) {
            const text = row.textContent || '';
            if (!text.includes(labelText)) continue;
            const spans = row.querySelectorAll('span');
            if (spans.length >= 2) {
                const target = spans[spans.length - 1];
                target.textContent = formatRupiah(amount);
                if (colorVar) target.style.color = colorVar;
            }
        }
    }

    function fixDebtModalCalculation() {
        const content = document.getElementById('debtDetailContent');
        if (!content || !content.textContent.includes('Total Pengeluaran')) return;

        const totalExpenses = findAmountAfterLabel(content, 'Total Pengeluaran');
        const totalSettled = findAmountAfterLabel(content, 'Sudah Dibayar');
        if (!totalExpenses) return;

        const remaining = Math.max(0, totalExpenses - totalSettled);
        setAmountAfterLabel(content, 'Sisa Hutang', remaining, 'var(--red)');

        const amountHeader = content.querySelector('.amount-value');
        if (amountHeader) amountHeader.textContent = formatRupiah(remaining);

        const confirmAmount = document.getElementById('confirmAmount');
        if (confirmAmount) confirmAmount.max = remaining;

        // Update inline button handlers that still carry the stale amount from balance API.
        content.querySelectorAll('[onclick]').forEach(function (el) {
            const raw = el.getAttribute('onclick') || '';
            if (raw.includes('openSettleFromDebt(') || raw.includes('confirmFullPayment(')) {
                el.setAttribute('onclick', raw.replace(/,\s*\d+(?:\.\d+)?\s*\)/, ', ' + remaining + ')'));
            }
        });
    }

    function runFix() {
        enhanceList('myDebtsList', 'Bayar');
        enhanceList('myCreditsList', 'Tagih');
        fixDebtModalCalculation();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runFix);
    } else {
        runFix();
    }

    const observer = new MutationObserver(runFix);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
