(function () {
    if (!/settle\.html$/.test(window.location.pathname)) return;
    if (window.__settleClickFixV15Loaded) return;
    window.__settleClickFixV15Loaded = true;

    let currentDebtContext = null;
    let currentCreditContext = null;
    let debtPatchInFlight = null;
    let creditPatchInFlight = null;

    function getAppState() {
        try {
            if (typeof state !== 'undefined') return state;
        } catch (_) {}
        return window.state || null;
    }

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

    function findUserByDisplayName(name) {
        const appState = getAppState();
        if (!name || !appState || !Array.isArray(appState.users)) return null;
        return appState.users.find(function (u) {
            return String(u.display_name || '').trim() === String(name || '').trim();
        }) || null;
    }

    function inferDebtContextFromOpenModal() {
        if (currentDebtContext && currentDebtContext.creditorId) return currentDebtContext;

        const content = document.getElementById('debtDetailContent');
        if (!content || !content.textContent.includes('Total Pengeluaran')) return null;

        const label = content.querySelector('.amount-label');
        const labelText = label ? label.textContent.trim() : '';
        const name = labelText.replace(/^ke\s+/i, '').trim();
        const user = findUserByDisplayName(name);
        if (!user) return null;

        const amountHeader = content.querySelector('.amount-value');
        const amount = rupiahToNumber(amountHeader ? amountHeader.textContent : '0');
        currentDebtContext = {
            creditorId: parseInt(user.id, 10),
            creditorName: name,
            amount: amount
        };
        return currentDebtContext;
    }

    function inferCreditContextFromOpenModal() {
        if (currentCreditContext && currentCreditContext.debtorId) return currentCreditContext;

        const content = document.getElementById('creditDetailContent');
        if (!content || !content.textContent.includes('Total Ditalangin')) return null;

        const label = content.querySelector('.amount-label');
        const labelText = label ? label.textContent.trim() : '';
        const name = labelText.replace(/^dari\s+/i, '').trim();
        const user = findUserByDisplayName(name);
        if (!user) return null;

        const amountHeader = content.querySelector('.amount-value');
        const amount = rupiahToNumber(amountHeader ? amountHeader.textContent : '0');
        currentCreditContext = {
            debtorId: parseInt(user.id, 10),
            debtorName: name,
            amount: amount
        };
        return currentCreditContext;
    }

    function activateItem(item) {
        const data = getItemData(item);
        if (!data || !data.userId || !data.amount) return;

        if (data.type === 'debt' && typeof window.showDebtDetail === 'function') {
            currentDebtContext = { creditorId: data.userId, creditorName: data.name, amount: data.amount };
            window.showDebtDetail(data.userId, data.name, data.amount);
            scheduleDebtDetailPatch();
        } else if (data.type === 'credit' && typeof window.showCreditDetail === 'function') {
            currentCreditContext = { debtorId: data.userId, debtorName: data.name, amount: data.amount };
            window.showCreditDetail(data.userId, data.name, data.amount);
            scheduleCreditDetailPatch();
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

    function installWrappers() {
        if (typeof window.showDebtDetail === 'function' && !window.showDebtDetail.__offsetWrapped) {
            const originalDebt = window.showDebtDetail;
            window.showDebtDetail = function (creditorId, creditorName, amount) {
                currentDebtContext = { creditorId: parseInt(creditorId, 10), creditorName, amount: Number(amount) || 0 };
                const result = originalDebt.apply(this, arguments);
                scheduleDebtDetailPatch();
                return result;
            };
            window.showDebtDetail.__offsetWrapped = true;
        }

        if (typeof window.showCreditDetail === 'function' && !window.showCreditDetail.__offsetWrapped) {
            const originalCredit = window.showCreditDetail;
            window.showCreditDetail = function (debtorId, debtorName, amount) {
                currentCreditContext = { debtorId: parseInt(debtorId, 10), debtorName, amount: Number(amount) || 0 };
                const result = originalCredit.apply(this, arguments);
                scheduleCreditDetailPatch();
                return result;
            };
            window.showCreditDetail.__offsetWrapped = true;
        }
    }

    function scheduleDebtDetailPatch() {
        [80, 180, 350, 700, 1200, 2000].forEach(function (delay) {
            setTimeout(patchDebtDetailWithOffsets, delay);
        });
    }

    function scheduleCreditDetailPatch() {
        [80, 180, 350, 700, 1200, 2000].forEach(function (delay) {
            setTimeout(patchCreditDetailWithOffsets, delay);
        });
    }

    async function fetchDebtDetails() {
        const ctx = inferDebtContextFromOpenModal();
        const appState = getAppState();
        if (!ctx || !ctx.creditorId || !appState || !appState.user) return null;
        const endpoint = `debt_details?creditor_id=${ctx.creditorId}&debtor_id=${appState.user.id}`;
        if (typeof window.apiGetFresh === 'function') return window.apiGetFresh(endpoint);

        const apiBase = (typeof API_BASE !== 'undefined') ? API_BASE : (window.API_BASE || '/api');
        const res = await fetch(`${apiBase}/${endpoint}&_=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat detail hutang');
        return data;
    }

    async function fetchCreditDetails() {
        const ctx = inferCreditContextFromOpenModal();
        const appState = getAppState();
        if (!ctx || !ctx.debtorId || !appState || !appState.user) return null;
        const endpoint = `debt_details?creditor_id=${appState.user.id}&debtor_id=${ctx.debtorId}`;
        if (typeof window.apiGetFresh === 'function') return window.apiGetFresh(endpoint);

        const apiBase = (typeof API_BASE !== 'undefined') ? API_BASE : (window.API_BASE || '/api');
        const res = await fetch(`${apiBase}/${endpoint}&_=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat detail piutang');
        return data;
    }

    function findHeaderIn(rootId, text) {
        return Array.from(document.querySelectorAll(`#${rootId} div`)).find(function (el) {
            return (el.textContent || '').trim() === text;
        });
    }

    function findSummaryBlock(content, requiredLabels) {
        return Array.from(content.querySelectorAll('div')).find(function (el) {
            const text = el.textContent || '';
            return requiredLabels.every(function (label) { return text.includes(label); });
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

    function getFirstExpenseBlock(content, rootId, labels) {
        let header = null;
        for (const label of labels) {
            header = findHeaderIn(rootId, label);
            if (header) break;
        }
        if (!header) return null;
        return header.parentElement;
    }

    function buildOffsetItems(expenses, amountField, sign, colorVar) {
        return expenses.slice(0, 10).map(function (e) {
            const amount = parseFloat(e[amountField] || e.split_amount || 0);
            return `
                <div class="expense-item">
                    <div style="display: flex; justify-content: space-between;">
                        <span>${safeText(e.description)}</span>
                        <span style="color: ${colorVar};">${sign}${formatRupiah(amount)}</span>
                    </div>
                    <div class="text-muted" style="font-size: 0.6875rem;">${safeText(e.category)} · ${safeText(displayDate(e.created_at))}</div>
                </div>
            `;
        }).join('');
    }

    function ensureDebtOffsetSection(content, data) {
        const reverseExpenses = Array.isArray(data.reverse_expenses) ? data.reverse_expenses : [];
        let section = content.querySelector('#reverseExpenseOffsetSection');
        if (!reverseExpenses.length) { if (section) section.remove(); return; }

        const html = `
            <div id="reverseExpenseOffsetSection" style="margin-bottom: var(--space-md);">
                <div class="text-muted" style="font-size: 0.75rem; margin-bottom: var(--space-sm);">TRANSAKSI PENGURANG:</div>
                ${buildOffsetItems(reverseExpenses, 'offset_amount', '+', 'var(--green)')}
                ${reverseExpenses.length > 10 ? `<div class="text-muted" style="font-size: 0.75rem; text-align: center;">+${reverseExpenses.length - 10} lainnya</div>` : ''}
            </div>
        `;
        if (section) { section.outerHTML = html; return; }
        const firstBlock = getFirstExpenseBlock(content, 'debtDetailContent', ['YANG HARUS DIBAYAR:', 'DETAIL:']);
        if (firstBlock) firstBlock.insertAdjacentHTML('afterend', html);
    }

    function ensureCreditOffsetSection(content, data) {
        const reverseExpenses = Array.isArray(data.reverse_expenses) ? data.reverse_expenses : [];
        let section = content.querySelector('#creditReverseExpenseOffsetSection');
        if (!reverseExpenses.length) { if (section) section.remove(); return; }

        const html = `
            <div id="creditReverseExpenseOffsetSection" style="margin-bottom: var(--space-md);">
                <div class="text-muted" style="font-size: 0.75rem; margin-bottom: var(--space-sm);">TRANSAKSI PENGURANG:</div>
                ${buildOffsetItems(reverseExpenses, 'offset_amount', '- ', 'var(--red)')}
                ${reverseExpenses.length > 10 ? `<div class="text-muted" style="font-size: 0.75rem; text-align: center;">+${reverseExpenses.length - 10} lainnya</div>` : ''}
            </div>
        `;
        if (section) { section.outerHTML = html; return; }
        const firstBlock = getFirstExpenseBlock(content, 'creditDetailContent', ['YANG KAMU TALANGIN:', 'DETAIL:']);
        if (firstBlock) firstBlock.insertAdjacentHTML('afterend', html);
    }

    function ensureSummaryRow(summary, id, label, amount, colorVar, afterLabel) {
        if (!summary) return;
        let row = summary.querySelector(`#${id}`);
        if ((Number(amount) || 0) <= 0) { if (row) row.remove(); return; }
        const html = `
            <div id="${id}" style="display: flex; justify-content: space-between; font-size: 0.8125rem;">
                <span>${label}</span>
                <span style="color: ${colorVar};">${formatRupiah(amount)}</span>
            </div>
        `;
        if (row) { row.outerHTML = html; return; }
        const afterRow = Array.from(summary.children).find(function (el) {
            return (el.textContent || '').includes(afterLabel);
        });
        if (afterRow) afterRow.insertAdjacentHTML('afterend', html);
    }

    async function patchDebtDetailWithOffsets() {
        const content = document.getElementById('debtDetailContent');
        if (!content) return;
        inferDebtContextFromOpenModal();
        if (!currentDebtContext) return;
        if (!content.textContent.includes('Total Pengeluaran') || content.querySelector('.spinner')) return;
        if (debtPatchInFlight) return debtPatchInFlight;

        debtPatchInFlight = (async function () {
            try {
                const data = await fetchDebtDetails();
                if (!data) return;
                const detailHeader = findHeaderIn('debtDetailContent', 'YANG HARUS DIBAYAR:');
                if (detailHeader) detailHeader.textContent = 'DETAIL:';
                ensureDebtOffsetSection(content, data);
                const summary = findSummaryBlock(content, ['Total Pengeluaran', 'Sudah Dibayar', 'Sisa Hutang']);
                setSummaryAmount(summary, 'Total Pengeluaran', data.total_expenses || 0, 'var(--red)');
                setSummaryAmount(summary, 'Sudah Dibayar', data.total_settled || 0, 'var(--green)');
                ensureSummaryRow(summary, 'totalOffsetRow', 'Transaksi Pengurang', data.total_offset || 0, 'var(--green)', 'Sudah Dibayar');
                setSummaryAmount(summary, 'Sisa Hutang', data.remaining || 0, 'var(--red)');
                const amountHeader = content.querySelector('.amount-value');
                if (amountHeader) amountHeader.textContent = formatRupiah(data.remaining || 0);
            } catch (err) {
                console.warn('Gagal menampilkan transaksi pengurang hutang:', err);
            } finally {
                debtPatchInFlight = null;
            }
        })();
        return debtPatchInFlight;
    }

    async function patchCreditDetailWithOffsets() {
        const content = document.getElementById('creditDetailContent');
        if (!content) return;
        inferCreditContextFromOpenModal();
        if (!currentCreditContext) return;
        if (!content.textContent.includes('Total Ditalangin') || content.querySelector('.spinner')) return;
        if (creditPatchInFlight) return creditPatchInFlight;

        creditPatchInFlight = (async function () {
            try {
                const data = await fetchCreditDetails();
                if (!data) return;
                const detailHeader = findHeaderIn('creditDetailContent', 'YANG KAMU TALANGIN:');
                if (detailHeader) detailHeader.textContent = 'DETAIL:';
                ensureCreditOffsetSection(content, data);
                const summary = findSummaryBlock(content, ['Total Ditalangin', 'Sudah Diterima', 'Sisa Piutang']);
                setSummaryAmount(summary, 'Total Ditalangin', data.total_expenses || 0, 'var(--green)');
                setSummaryAmount(summary, 'Sudah Diterima', data.total_settled || 0, 'var(--red)');
                ensureSummaryRow(summary, 'creditTotalOffsetRow', 'Transaksi Pengurang', data.total_offset || 0, 'var(--red)', 'Sudah Diterima');
                setSummaryAmount(summary, 'Sisa Piutang', data.remaining || 0, 'var(--green)');
                const amountHeader = content.querySelector('.amount-value');
                if (amountHeader) amountHeader.textContent = formatRupiah(data.remaining || 0);
            } catch (err) {
                console.warn('Gagal menampilkan transaksi pengurang piutang:', err);
            } finally {
                creditPatchInFlight = null;
            }
        })();
        return creditPatchInFlight;
    }

    function runFix() {
        installWrappers();
        enhanceList('myDebtsList', 'Bayar');
        enhanceList('myCreditsList', 'Tagih');
        patchDebtDetailWithOffsets();
        patchCreditDetailWithOffsets();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runFix);
    } else {
        runFix();
    }

    window.addEventListener('focus', function () { scheduleDebtDetailPatch(); scheduleCreditDetailPatch(); });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') { scheduleDebtDetailPatch(); scheduleCreditDetailPatch(); }
    });

    const observer = new MutationObserver(runFix);
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
