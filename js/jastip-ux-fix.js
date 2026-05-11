(function () {
    if (!/jastip\.html$/.test(window.location.pathname)) return;
    if (window.__jastipUxFixV1Loaded) return;
    window.__jastipUxFixV1Loaded = true;

    let creatingJastip = false;
    let addingItem = false;
    const hiddenCancelledIds = new Set(JSON.parse(localStorage.getItem('hiddenCancelledJastips') || '[]'));

    function getAppState() {
        try {
            if (typeof state !== 'undefined') return state;
        } catch (_) {}
        return window.state || null;
    }

    function saveHiddenCancelled() {
        localStorage.setItem('hiddenCancelledJastips', JSON.stringify(Array.from(hiddenCancelledIds)));
    }

    function simplifyStaticCopy() {
        const title = document.querySelector('.section-title');
        if (title && title.textContent.trim() === 'Jastip Kontrakan') title.textContent = 'Jastip Aktif';

        const notifLink = document.querySelector('.section-link[href="notifications.html"]');
        if (notifLink) notifLink.style.display = 'none';

        const qty = document.getElementById('itemQty');
        if (qty) {
            qty.placeholder = 'Jumlah';
            qty.setAttribute('aria-label', 'Jumlah barang');
        }

        const estimate = document.getElementById('itemEstimate');
        if (estimate) {
            estimate.placeholder = 'Harga perkiraan, boleh kosong';
            estimate.setAttribute('aria-label', 'Estimasi harga opsional');
        }

        const addTitle = document.querySelector('#addJastipItemModal .modal-title');
        if (addTitle) addTitle.textContent = 'Mau titip apa?';

        const openTitle = document.querySelector('#openJastipModal .modal-title');
        if (openTitle) openTitle.textContent = 'Buka Jastip';
    }

    function guardCreateJastip() {
        if (typeof window.createJastip !== 'function' || window.createJastip.__uxGuarded) return;
        const original = window.createJastip;
        window.createJastip = async function () {
            if (creatingJastip) return;
            creatingJastip = true;
            const btn = document.querySelector('#openJastipModal .btn-primary');
            const oldText = btn ? btn.textContent : '';
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Membuka...';
            }
            try {
                return await original.apply(this, arguments);
            } finally {
                setTimeout(function () {
                    creatingJastip = false;
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = oldText || 'Buka Jastip';
                    }
                }, 900);
            }
        };
        window.createJastip.__uxGuarded = true;
    }

    function guardAddItem() {
        if (typeof window.addJastipItem !== 'function' || window.addJastipItem.__uxGuarded) return;
        const original = window.addJastipItem;
        window.addJastipItem = async function () {
            if (addingItem) return;
            addingItem = true;
            const btn = document.querySelector('#addJastipItemModal .btn-primary');
            const oldText = btn ? btn.textContent : '';
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Mengirim...';
            }
            try {
                return await original.apply(this, arguments);
            } finally {
                setTimeout(function () {
                    addingItem = false;
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = oldText || 'Kirim Nitipan';
                    }
                }, 700);
            }
        };
        window.addJastipItem.__uxGuarded = true;
    }

    function guardOpenAddItem() {
        if (typeof window.openAddItem !== 'function' || window.openAddItem.__uxGuarded) return;
        const original = window.openAddItem;
        window.openAddItem = function (orderId) {
            const appState = getAppState();
            const orders = Array.isArray(window.jastipOrders) ? window.jastipOrders : (typeof jastipOrders !== 'undefined' ? jastipOrders : []);
            const order = orders.find(function (o) { return Number(o.id) === Number(orderId); });
            if (order && appState && appState.user && Number(order.opened_by) === Number(appState.user.id)) {
                if (typeof showToast === 'function') showToast('Pembuka jastip tidak perlu titip ke diri sendiri', 'error');
                return;
            }
            return original.apply(this, arguments);
        };
        window.openAddItem.__uxGuarded = true;
    }

    function hideCancelledCard(orderId) {
        hiddenCancelledIds.add(Number(orderId));
        saveHiddenCancelled();
        const cards = document.querySelectorAll('.jastip-card.cancelled');
        cards.forEach(function (card) {
            if (card.dataset.orderId === String(orderId)) card.remove();
        });
        if (typeof showToast === 'function') showToast('Jastip batal disembunyikan', 'success');
    }

    window.hideCancelledJastip = hideCancelledCard;

    function inferOrderIdFromCancelButton(btn) {
        const raw = btn.getAttribute('onclick') || '';
        const match = raw.match(/cancelJastip\((\d+)\)/);
        return match ? Number(match[1]) : null;
    }

    function polishCards() {
        const appState = getAppState();
        const orders = Array.isArray(window.jastipOrders) ? window.jastipOrders : (typeof jastipOrders !== 'undefined' ? jastipOrders : []);

        document.querySelectorAll('.jastip-card').forEach(function (card) {
            if (card.dataset.uxPolished === '1') return;

            const titleText = (card.querySelector('.jastip-title') || {}).textContent || '';
            const order = orders.find(function (o) { return titleText.includes(o.title); });
            if (order) card.dataset.orderId = String(order.id);

            if (order && order.status === 'cancelled' && hiddenCancelledIds.has(Number(order.id))) {
                card.remove();
                return;
            }

            // Kurangi teks ramai di card.
            card.querySelectorAll('.active-strip').forEach(function (el) { el.remove(); });
            card.querySelectorAll('.text-muted').forEach(function (el) {
                const text = (el.textContent || '').trim();
                if (/Selesaikan setelah|Ditutup, owner|Masih bisa titip/.test(text)) el.remove();
            });

            // Owner tidak boleh titip ke jastip sendiri.
            if (order && appState && appState.user && Number(order.opened_by) === Number(appState.user.id)) {
                card.querySelectorAll('button').forEach(function (btn) {
                    const text = (btn.textContent || '').trim();
                    const raw = btn.getAttribute('onclick') || '';
                    if (text === 'Titip' || raw.includes('openAddItem')) btn.remove();
                });
            }

            // Jastip batal bisa disembunyikan dari UI.
            if (order && order.status === 'cancelled') {
                const actions = card.querySelector('.jastip-actions') || card;
                if (!card.querySelector('.hide-cancelled-jastip-btn')) {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-danger hide-cancelled-jastip-btn';
                    btn.textContent = 'Hapus dari tampilan';
                    btn.onclick = function () { hideCancelledCard(order.id); };
                    actions.appendChild(btn);
                }
            }

            card.dataset.uxPolished = '1';
        });

        // Tambah keterangan kecil di modal titip, tapi ringkas.
        const qtyLabel = document.querySelector('label[for="itemQty"], #itemQty')?.closest('.form-group')?.querySelector('.form-label');
        if (qtyLabel) qtyLabel.textContent = 'Jumlah';
        const priceLabel = document.querySelector('label[for="itemEstimate"], #itemEstimate')?.closest('.form-group')?.querySelector('.form-label');
        if (priceLabel) priceLabel.textContent = 'Estimasi harga (opsional)';
    }

    function runFix() {
        simplifyStaticCopy();
        guardCreateJastip();
        guardAddItem();
        guardOpenAddItem();
        polishCards();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runFix);
    } else {
        runFix();
    }

    const observer = new MutationObserver(runFix);
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
