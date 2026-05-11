(function () {
    if (!/settle\.html$/.test(window.location.pathname)) return;

    let currentDebtContext = null;
    let patchInFlight = null;

    function rupiahToNumber(text) {
        const cleaned = String(text || '').replace(/[^0-9]/g, '');
        return cleaned ? parseInt(cleaned, 10) : 0;
    }

    function formatRupiah(amount) {
        return 'Rp ' + Math.max(0, Math.round(Number(amount) || 0)).toLocaleString('id-ID');
    }

    function safeText(value) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(value);
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function displayDate(value) {
        if (typeof window.formatDate === 'function') return window.formatDate(value);
        return value || '';
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
            currentDebtContext = { creditorId: data.userId, creditorName: data.name, amount: data.amount };
            window.showDebtDetail(data.userId, data.name, data.amount);
            scheduleDebtDetailPatch();
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

    function installDebtDetailWrapper() {
        if (typeof window.showDebtDetail !== 'function' || window.showDebtDetail.__offsetWrapped) return;

        const original = window.showDebtDetail;
        window.showDebtDetail = function (creditorId, creditorName, amount) {
            currentDebtContext = {
                creditorId: parseInt(creditorId, 10),
                creditorName: creditorName,
                amount: Number(amount) || 0
            };
            const result = original.apply(this, arguments);
            scheduleDebtDetailPatch();
            return result;
        };
        window.showDebtDetail.__offsetWrapped = true;
    }

    function scheduleDebtDetailPatch() {
        [120, 350, 700, 1200].forEach(function (delay) {
            setTimeout(patchDebtDetailWithOffsets, delay);
        });
    }

    async function fetchDebtDetails() {
        if (!currentDebtContext || !currentDebtContext.creditorId || !window.state || !state.user) return null;
        const endpoint = `debt_details?creditor_id=${currentDebtContext.creditorId}&debtor_id=${state.user.id}`;
        if (typeof window.apiGetFresh === 'function') return window.apiGetFresh(endpoint);

        const res = await fetch(`${window.API_BASE || '/api'}/${endpoint}&_=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat detail hutang');
        return data;
    }

    function findHeader(text) {
        return Array.from(document.querySelectorAll('#debtDetailContent div')).find(function (el) {
            return (el.textContent || '').trim() === text;
        });
    }

    function findSummaryBlock(content) {
        return Array.from(content.querySelectorAll('div')).find(function (el) {
            const text = el.textContent || '';
            return text.includes('Total Pengeluaran') && text.includes('Sudah Dibayar') && text.includes('Sisa Hutang');
        });
    }

    function setSummaryAmount(summary, label, amount, colorVar) {
        if (!summary) return;
        const rows = Array.from(summary.children).filter(function (el) {
            return (el.textContent || '').includes(label);
        });
        const row = rows[0];
        if (!row) return;
        const spans = row.querySelectorAll('span');
        const target = spans[spans.length - 1];
        if (!target) return;
        target.textContent = formatRupiah(amount);
        if (colorVar) target.style.color = colorVar;
    }

    function getFirstExpenseBlock(content) {
        const header = findHeader('YANG HARUS DIBAYAR:') || findHeader('DETAIL:');
        if (!header) return null;
        return header.parentElement;
    }

    function ensureOffsetSection(content, data) {
        const reverseExpenses = Array.isArray(data.reverse_expenses) ? data.reverse_expenses : [];
        let section = content.querySelector('#reverseExpenseOffsetSection');

        if (!reverseExpenses.length) {
            if (section) section.remove();
            return;
        }

        const items = reverseExpenses.slice(0, 10).map(function (e) {
            const amount = parseFloat(e.offset_amount || e.split_amount || 0);
            return `
                <div class="expense-item">
                    <div style="display: flex; justify-content: space-between;">
                        <span>${safeText(e.description)}</span>
                        <span style="color: var(--green);">+${formatRupiah(amount)}</span>
                    </div>
                    <div class="text-muted" style="font-size: 0.6875rem;">${safeText(e.category)} · ${safeText(displayDate(e.created_at))}</div>
                </div>
            `;
        }).join('');

        const html = `
            <div id="reverseExpenseOffsetSection" style="margin-bottom: var(--space-md);">
                <div class="text-muted" style="font-size: 0.75rem; margin-bottom: var(--space-sm);">TRANSAKSI PENGURANG:</div>
                ${items}
                ${reverseExpenses.length > 10 ? `<div class="text-muted" style="font-size: 0.75rem; text-align: center;">+${reverseExpenses.length - 10} lainnya</div>` : ''}
            </div>
        `;

        if (section) {
            section.outerHTML = html;
            return;
        }

        const firstBlock = getFirstExpenseBlock(content);
        if (firstBlock) {
            firstBlock.insertAdjacentHTML('afterend', html);
        }
    }

    function ensureOffsetSummaryRow(summary, data) {
        if (!summary) return;
        const offset = Number(data.total_offset || 0);
        let row = summary.querySelector('#totalOffsetRow');

        if (offset <= 0) {
            if (row) row.remove();
            return;
        }

        const html = `
            <div id="totalOffsetRow" style="display: flex; justify-content: space-between; font-size: 0.8125rem;">
                <span>Transaksi Pengurang</span>
                <span style="color: var(--green);">${formatRupiah(offset)}</span>
            </div>
        `;

        if (row) {
            row.outerHTML = html;
            return;
        }

        const paidRow = Array.from(summary.children).find(function (el) {
            return (el.textContent || '').includes('Sudah Dibayar');
        });
        if (paidRow) paidRow.insertAdjacentHTML('afterend', html);
    }

    async function patchDebtDetailWithOffsets() {
        const content = document.getElementById('debtDetailContent');
        if (!content || !currentDebtContext) return;
        if (!content.textContent.includes('Total Pengeluaran') || content.querySelector('.spinner')) return;
        if (patchInFlight) return patchInFlight;

        patchInFlight = (async function () {
            try {
                const data = await fetchDebtDetails();
                if (!data) return;

                const detailHeader = findHeader('YANG HARUS DIBAYAR:');
                if (detailHeader) detailHeader.textContent = 'DETAIL:';

                ensureOffsetSection(content, data);

                const summary = findSummaryBlock(content);
                setSummaryAmount(summary, 'Total Pengeluaran', data.total_expenses || 0, 'var(--red)');
                setSummaryAmount(summary, 'Sudah Dibayar', data.total_settled || 0, 'var(--green)');
                ensureOffsetSummaryRow(summary, data);
                setSummaryAmount(summary, 'Sisa Hutang', data.remaining || 0, 'var(--red)');

                const amountHeader = content.querySelector('.amount-value');
                if (amountHeader) amountHeader.textContent = formatRupiah(data.remaining || 0);

                const confirmAmount = document.getElementById('confirmAmount');
                if (confirmAmount) confirmAmount.max = data.remaining || 0;

                content.querySelectorAll('[onclick]').forEach(function (el) {
                    const raw = el.getAttribute('onclick') || '';
                    if (raw.includes('openSettleFromDebt(') || raw.includes('confirmFullPayment(')) {
                        el.setAttribute('onclick', raw.replace(/,\s*\d+(?:\.\d+)?\s*\)/, ', ' + (data.remaining || 0) + ')'));
                    }
                });
            } catch (err) {
                console.warn('Gagal menampilkan transaksi pengurang:', err);
            } finally {
                patchInFlight = null;
            }
        })();

        return patchInFlight;
    }

    function runFix() {
        installDebtDetailWrapper();
        enhanceList('myDebtsList', 'Bayar');
        enhanceList('myCreditsList', 'Tagih');
        patchDebtDetailWithOffsets();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runFix);
    } else {
        runFix();
    }

    const observer = new MutationObserver(runFix);
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
