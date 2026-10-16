// ==UserScript==
// @name         Distributor vs Amazon Price Checker (Ingram, PubEasy)
// @namespace    https://unboundsf.co/
// @version      1.2
// @description  Add an Amazon print price / margin column to Ingram and PubEasy tables and flag titles cheaper on Amazon
// @match        https://*.ingramcontent.com/*
// @match        https://*.ingramipage.com/*
// @match        https://pubeasy.com/*
// @match        https://*.pubeasy.com/*
// @grant        GM_xmlhttpRequest
// @connect      www.amazon.com
// ==/UserScript==

(function () {
    'use strict';

    const COLUMN_TITLE = 'Amazon Compare';

    const AMAZON_SEARCH = isbn =>
        `https://www.amazon.com/s?k=${isbn}&i=stripbooks`;

    function parseMoney(text) {
        if (!text) return null;
        const m = text.replace(/,/g, '').match(/\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
    }

    function isbn13to10(isbn13) {
        if (!isbn13 || !isbn13.startsWith('978')) return null;

        const core = isbn13.substring(3, 12);
        let sum = 0;

        for (let i = 0; i < 9; i++) {
            sum += (10 - i) * parseInt(core[i], 10);
        }

        let check = 11 - (sum % 11);
        if (check === 10) check = 'X';
        else if (check === 11) check = '0';

        return core + check;
    }

    // ── Amazon lookup (one request per ISBN, shared across re-renders) ───
    // Each search result lists formats as a label link ("Paperback", "Kindle",
    // "Audiobook", …) followed by a price link to that format's /dp/<ASIN> page.
    // Print books' ASIN is their ISBN-10, so the exact edition is the price whose
    // link ends in our ISBN-10. Kindle / audiobook / audio CD prices are ignored,
    // as are sponsored results.

    const NON_PRINT = /kindle|audio|audible|ebook|e-book|mp3|cd\b/i;
    const amazonCache = new Map(); // isbn13 -> Promise<{price, format, url, exact}|null>

    function parseAmazonOffers(doc) {
        const offers = [];
        const results = doc.querySelectorAll('[data-component-type="s-search-result"]');
        results.forEach(result => {
            if (result.querySelector('.puis-sponsored-label-text, .s-sponsored-label-text') ||
                result.classList.contains('AdHolder')) return;
            let format = null;
            result.querySelectorAll('a').forEach(a => {
                const href = a.getAttribute('href') || '';
                if (href.includes('/sspa/')) return;
                const priceEl = a.querySelector('.a-price:not(.a-text-price) .a-offscreen');
                if (!priceEl) {
                    const label = a.textContent.replace(/\s+/g, ' ').replace(/,\s*$/, '').trim();
                    if (label && label.length < 40 && a.classList.contains('a-size-base')) format = label;
                    return;
                }
                const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/i);
                offers.push({
                    format: format || 'Unknown format',
                    price: parseMoney(priceEl.textContent),
                    asin: asinMatch ? asinMatch[1].toUpperCase() : null,
                    url: href.startsWith('http') ? href : `https://www.amazon.com${href}`,
                });
            });
        });
        return offers.filter(o => o.price != null && !NON_PRINT.test(o.format));
    }

    function getAmazonPrice(isbn) {
        if (!amazonCache.has(isbn)) {
            amazonCache.set(isbn, new Promise(resolve => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: AMAZON_SEARCH(isbn),
                    onload: resp => {
                        const doc = new DOMParser().parseFromString(resp.responseText, 'text/html');
                        const offers = parseAmazonOffers(doc);
                        const isbn10 = isbn13to10(isbn);
                        const exact = isbn10 && offers.find(o => o.asin === isbn10.toUpperCase());
                        const best = exact || offers[0];
                        resolve(best ? { ...best, exact: !!exact } : null);
                    },
                    onerror: () => resolve(null),
                });
            }));
        }
        return amazonCache.get(isbn);
    }

    // ── Site adapters ────────────────────────────────────────────────────
    // Each adapter finds its table, adds the header cell, and turns rows into
    // { row, isbn, cost() } where cost() returns { value, label } (re-evaluated on
    // every render so setting changes apply instantly).

    // Ingram: header row of td.columnHeader with an "EAN" column. Columns vary by
    // page (the IPS cart adds Image and Carton Qty), so they're located by header
    // text: "EAN", "Disc %" (or "Disc": "REG", "SHORT", "NET" or "40%"), "SRP", and
    // on carts "Disc. Price / Extended Disc. Price". Cost is the Disc. Price when
    // present, else SRP × (1 − discount). Falls back to the original fixed layout
    // (EAN 1, discount 8, SRP 9) if headers aren't recognised.
    const INGRAM_DISCOUNTS = { 'REG': 0.40, 'SHORT': 0.20, 'NET': 0.00 };

    function parseIngramDiscount(text) {
        if (!text) return 0;
        const numMatch = text.match(/(\d+(\.\d+)?)\s*%/);
        if (numMatch) return parseFloat(numMatch[1]) / 100;
        return INGRAM_DISCOUNTS[text.trim()] ?? 0;
    }

    const ingram = {
        name: 'Ingram',
        matches: () => /ingram(content|ipage)\.com$/.test(location.hostname),
        findTable() {
            for (const cell of document.querySelectorAll('td.columnHeader')) {
                if (cell.innerText.includes('EAN')) return cell.closest('table');
            }
            return null;
        },
        addHeader(table) {
            const headerRow = table.querySelector('tr');
            if (!headerRow || headerRow.querySelector('.ub-amazon-header')) return;
            const th = document.createElement('td');
            th.className = 'columnHeader ub-amazon-header';
            th.innerText = COLUMN_TITLE;
            headerRow.appendChild(th);
        },
        columns(table) {
            const headers = Array.from(table.querySelector('tr').querySelectorAll('td.columnHeader'))
                .map(td => td.textContent.replace(/\s+/g, ' ').trim());
            const find = test => headers.findIndex(test);
            const cols = {
                ean: find(h => /^EAN/.test(h)),
                discount: find(h => /^Disc\b/.test(h) && !/price/i.test(h)),
                srp: find(h => /^SRP/.test(h)),
                discPrice: find(h => /^Disc\.? Price/i.test(h)),
            };
            if (cols.ean < 0 || cols.srp < 0) return { ean: 1, discount: 8, srp: 9, discPrice: -1 };
            return cols;
        },
        rows(table) {
            const cols = this.columns(table);
            const minCells = Math.max(cols.ean, cols.discount, cols.srp, cols.discPrice) + 1;
            const out = [];
            table.querySelectorAll('tr').forEach((row, idx) => {
                if (idx === 0) return;
                const cells = row.querySelectorAll(':scope > td');
                if (cells.length < minCells) return;
                // EAN and product code are often both 13 digits separated only by <br>, so take the first ISBN-13
                const isbnMatch = cells[cols.ean].textContent.match(/97[89]\d{10}/);
                if (!isbnMatch) return;
                const srp = parseMoney(cells[cols.srp].textContent);
                const discountText = cols.discount >= 0 ? cells[cols.discount].textContent.replace(/\s+/g, ' ').trim() : '';
                const discount = parseIngramDiscount(discountText);
                // "16.50/ 330.00" — unit discounted price before the slash, extended after
                const discPrice = cols.discPrice >= 0 ? parseMoney(cells[cols.discPrice].textContent.split('/')[0]) : null;
                out.push({
                    row, isbn: isbnMatch[0],
                    cost: () => {
                        if (discPrice) return { value: discPrice, label: `Ingram (disc. price${discountText ? ', ' + discountText : ''})` };
                        return srp ? { value: srp * (1 - discount), label: `Ingram (${discountText || '0%'})` } : null;
                    },
                });
            });
            return out;
        },
    };

    // PubEasy (Ember): ISBN in .productIdValue inside the Title cell; the
    // "List Price / Personal Price" cell shows "$18.00 /" then the personal price,
    // or "-" when there isn't one. Columns are located by header text. Cost is the
    // personal price if shown, else list × (1 − discount from the floating box).
    const PUBEASY_DEFAULT_DISCOUNT = 46; // Penguin's standard trade discount, in %
    const PUBEASY_DISCOUNT_KEY = 'ub-pubeasy-discount';

    function loadPubeasyDiscount() {
        try {
            const v = parseFloat(localStorage.getItem(PUBEASY_DISCOUNT_KEY));
            if (v >= 0 && v < 100) return v;
        } catch (e) { /* storage blocked */ }
        return PUBEASY_DEFAULT_DISCOUNT;
    }

    let pubeasyDiscountPct = loadPubeasyDiscount();

    function buildPubeasyDiscountBox() {
        if (document.getElementById('ub-discount-box')) return;
        const box = document.createElement('div');
        box.id = 'ub-discount-box';
        box.style.cssText = [
            'position:fixed', 'bottom:16px', 'right:16px', 'z-index:99999',
            'background:#fff', 'border:1px solid #ccc', 'border-radius:6px',
            'padding:8px 10px', 'box-shadow:0 2px 8px rgba(0,0,0,0.2)',
            'font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        ].join(';');
        box.innerHTML = `
            <label style="font-weight:600">Publisher discount
                <input id="ub-discount" type="number" min="0" max="99" step="1"
                       value="${pubeasyDiscountPct}" style="width:56px;margin:0 4px;padding:2px 4px"> %
            </label>
            <div style="color:#777;font-size:11px;margin-top:2px">Cost = list × (1 − discount) unless a personal price is shown</div>
        `;
        document.body.appendChild(box);
        box.querySelector('#ub-discount').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            if (!(v >= 0 && v < 100)) return;
            pubeasyDiscountPct = v;
            try { localStorage.setItem(PUBEASY_DISCOUNT_KEY, String(v)); } catch (err) { /* storage blocked */ }
            document.querySelectorAll('td.ub-amazon-cell').forEach(renderCell);
        });
    }

    const pubeasy = {
        name: 'PubEasy',
        matches: () => /(^|\.)pubeasy\.com$/.test(location.hostname),
        findTable() {
            for (const table of document.querySelectorAll('table')) {
                const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
                if (headers.some(h => h.startsWith('List Price'))) return table;
            }
            return null;
        },
        addHeader(table) {
            buildPubeasyDiscountBox();
            const headerRow = table.querySelector('thead tr');
            if (!headerRow || headerRow.querySelector('.ub-amazon-header')) return;
            const th = document.createElement('th');
            th.className = 'ub-amazon-header width-small-medium';
            th.innerHTML = `<span>${COLUMN_TITLE}</span>`;
            headerRow.appendChild(th);
        },
        rows(table) {
            const priceIdx = Array.from(table.querySelectorAll('thead th'))
                .findIndex(th => th.textContent.trim().startsWith('List Price'));
            const out = [];
            table.querySelectorAll('tbody tr').forEach(row => {
                const isbnEl = row.querySelector('.productIdValue');
                const isbn = isbnEl ? isbnEl.textContent.trim() : '';
                if (!/^\d{13}$/.test(isbn)) return;
                const priceCell = priceIdx >= 0 ? row.querySelectorAll(':scope > td')[priceIdx] : null;
                // First "$" amount is list price; anything after the "/" is the personal price
                const [listPart, personalPart = ''] = priceCell ? priceCell.textContent.split('/') : [''];
                const list = parseMoney(listPart);
                const personal = parseMoney(personalPart);
                out.push({
                    row, isbn,
                    cost: () => {
                        if (personal != null) return { value: personal, label: 'PubEasy (personal)' };
                        if (list == null) return null;
                        return { value: list * (1 - pubeasyDiscountPct / 100), label: `PubEasy (${pubeasyDiscountPct}% off)` };
                    },
                });
            });
            return out;
        },
    };

    const site = [ingram, pubeasy].find(s => s.matches());
    if (!site) return;

    // ── Rendering ────────────────────────────────────────────────────────

    function renderCell(cell) {
        const { amazon, amazonUrl, cost: getCost } = cell.ub;
        const cost = getCost();
        const row = cell.closest('tr');

        row.style.backgroundColor = '';
        row.style.boxShadow = '';

        if (amazon === undefined) {
            cell.innerHTML = '<span style="color:gray">Checking…</span>';
            return;
        }
        if (amazon === null) {
            cell.innerHTML = `<span style="color:gray">No Amazon print price</span><br>
                <a href="${amazonUrl}" target="_blank" style="font-size:11px">search</a>`;
            return;
        }
        const amazonPrice = amazon.price;
        const offerUrl = amazon.url || amazonUrl;
        const formatLabel = amazon.exact ? amazon.format : `${amazon.format}, other edition`;
        if (!cost) {
            cell.innerHTML = `<span style="font-size:12px">Amazon (${formatLabel}): $${amazonPrice.toFixed(2)}<br>(no ${site.name} price)</span>`;
            return;
        }

        const margin = ((amazonPrice - cost.value) / amazonPrice) * 100;
        const buyFromAmazon = amazonPrice < cost.value;

        if (buyFromAmazon) {
            row.style.backgroundColor = '#ffe6e6';
            row.style.boxShadow = 'inset 5px 0 0 #cc0000';
        }

        let color = 'red';
        if (margin >= 30) color = 'green';
        else if (margin >= 15) color = 'orange';

        cell.innerHTML = `
            <div style="font-size:12px; color:${color}">
                Amazon (${formatLabel}): <a href="${offerUrl}" target="_blank" style="color:inherit">$${amazonPrice.toFixed(2)}</a><br>
                ${cost.label}: $${cost.value.toFixed(2)}<br>
                Margin: ${margin.toFixed(1)}%<br>
                ${buyFromAmazon
                    ? `<a href="${offerUrl}" target="_blank"
                          style="color:#cc0000;font-weight:bold;text-decoration:underline">BUY FROM AMAZON</a>`
                    : ''}
            </div>
        `;
    }

    function enhanceTable() {
        const table = site.findTable();
        if (!table) return;
        site.addHeader(table);

        site.rows(table).forEach(({ row, isbn, cost }) => {
            if (row.querySelector('td.ub-amazon-cell')) return;
            const isbn10 = isbn13to10(isbn);
            const cell = document.createElement('td');
            cell.className = 'ub-amazon-cell';
            cell.ub = {
                cost,
                amazon: undefined,
                amazonUrl: isbn10 ? `https://www.amazon.com/dp/${isbn10}` : AMAZON_SEARCH(isbn),
            };
            row.appendChild(cell);
            renderCell(cell);

            getAmazonPrice(isbn).then(price => {
                cell.ub.amazon = price;
                if (cell.isConnected) renderCell(cell);
            });
        });
    }

    // ── Init ─────────────────────────────────────────────────────────────
    // Both sites render (and PubEasy re-renders) tables client-side, which can
    // drop our cells — re-enhance on DOM changes instead of a one-off timer.
    let pending = false;
    const observer = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            enhanceTable();
        });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    enhanceTable();
})();
