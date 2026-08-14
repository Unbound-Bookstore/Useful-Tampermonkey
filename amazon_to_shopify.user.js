// ==UserScript==
// @name         Amazon Book → Shopify (Unbound)
// @namespace    https://unbound-backend.azurewebsites.net/
// @version      1.0
// @description  Parse Amazon book page and create/update Shopify product via Unbound backend
// @author       Unbound
// @match        https://www.amazon.com/dp/*
// @match        https://www.amazon.com/gp/product/*
// @match        https://www.amazon.com/*/dp/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      unbound-backend.azurewebsites.net
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'https://unbound-backend.azurewebsites.net/api';

    // ── Styles ──────────────────────────────────────────────────────────────
    GM_addStyle(`
        #ub-shopify-panel {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 99999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 13px;
        }
        #ub-shopify-btn {
            background: #008060;
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 10px 16px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            display: block;
            width: 100%;
        }
        #ub-shopify-btn:hover { background: #006e52; }
        #ub-shopify-btn:disabled { background: #888; cursor: default; }
        #ub-shopify-card {
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 14px 16px;
            margin-bottom: 8px;
            width: 280px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        }
        #ub-shopify-card h4 {
            margin: 0 0 8px 0;
            font-size: 13px;
            color: #333;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        #ub-shopify-card .ub-field {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            color: #555;
        }
        #ub-shopify-card .ub-field label { font-weight: 600; margin-right: 6px; }
        #ub-shopify-card .ub-field span { text-align: right; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #ub-shopify-card .ub-inputs { margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; }
        #ub-shopify-card .ub-inputs label { display: block; margin-bottom: 3px; font-weight: 600; color: #555; }
        #ub-shopify-card .ub-inputs select {
            width: 100%; box-sizing: border-box; padding: 5px 8px;
            border: 1px solid #ccc; border-radius: 4px; margin-bottom: 8px; font-size: 13px;
            background: #fff;
        }
        #ub-shopify-card .ub-inputs input[type=number], #ub-shopify-card .ub-inputs input[type=text] {
            width: 100%; box-sizing: border-box; padding: 5px 8px;
            border: 1px solid #ccc; border-radius: 4px; margin-bottom: 8px; font-size: 13px;
        }
        #ub-shopify-card .ub-inputs .ub-row { display: flex; gap: 8px; }
        #ub-shopify-card .ub-inputs .ub-row > div { flex: 1; }
        #ub-shopify-card .ub-checkbox { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
        #ub-status {
            margin-top: 8px;
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 12px;
            display: none;
        }
        #ub-status.ok  { background: #d4edda; color: #155724; display: block; }
        #ub-status.err { background: #f8d7da; color: #721c24; display: block; }
        #ub-status.inf { background: #d1ecf1; color: #0c5460; display: block; }
        .ub-shopify-link { color: #008060; font-weight: 600; text-decoration: none; }
        .ub-shopify-link:hover { text-decoration: underline; }
    `);

    // ── Helpers ──────────────────────────────────────────────────────────────

    function getText(selector) {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
    }

    /** Parse the detail-bullet-list to extract label → value pairs */
    function parseDetailBullets() {
        const result = {};
        document.querySelectorAll('.detail-bullet-list li .a-list-item').forEach(li => {
            const bold = li.querySelector('.a-text-bold');
            if (!bold) return;
            const label = bold.textContent.replace(/[\u200e\u200f\u202a-\u202e:]/g, '').trim();
            // Text after removing the bold span
            const full = li.textContent;
            const boldText = bold.textContent;
            const value = full.slice(full.indexOf(boldText) + boldText.length)
                             .replace(/[\u200e\u200f\u202a-\u202e:]/g, '')
                             .trim();
            result[label] = value;
        });
        return result;
    }

    /** Convert ISBN-10 to ISBN-13 */
    function isbn10to13(isbn10) {
        const base = '978' + isbn10.slice(0, 9);
        let sum = 0;
        for (let i = 0; i < 12; i++) {
            sum += parseInt(base[i]) * (i % 2 === 0 ? 1 : 3);
        }
        const check = (10 - (sum % 10)) % 10;
        return base + check;
    }

    /** Normalize ISBN-13: remove hyphens/spaces */
    function normalizeISBN(s) {
        return s ? s.replace(/[-\s]/g, '') : null;
    }

    /** Extract price from spans like "$18.95" */
    function extractPrice() {
        // Try the main buy-box price
        const selectors = [
            '#tmmSwatches .selected .a-color-price',
            '#price_inside_buybox',
            '#kindle-price',
            '.a-price .a-offscreen',
            '#listPrice',
            '#priceblock_ourprice',
            '#priceblock_dealprice',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const m = el.textContent.match(/[\d,]+\.?\d*/);
                if (m) return parseFloat(m[0].replace(',', ''));
            }
        }
        return null;
    }

    // ── Parse Amazon page ─────────────────────────────────────────────────

    function parsePage() {
        // ASIN from the media block
        const asinEl = document.querySelector('[data-csa-c-asin]');
        const asin = asinEl ? asinEl.getAttribute('data-csa-c-asin') : null;

        // Title
        const title = getText('#productTitle') || getText('#title #productTitle');

        // Authors — collect all author links
        const authorEls = document.querySelectorAll('#bylineInfo .author a, #bylineInfo .contributorNameID');
        const authors = Array.from(authorEls).map(a => a.textContent.trim()).filter(Boolean);

        // Bullets
        const bullets = parseDetailBullets();
        const publisher = bullets['Publisher'] || bullets['出版社'] || null;
        const pubDate = bullets['Publication date'] || bullets['出版日期'] || null;
        const pages = bullets['Print length'] ? parseInt(bullets['Print length']) : null;

        // Language → internal code
        const langRaw = (bullets['Language'] || bullets['语言'] || '').toLowerCase();
        let language = null;
        if (langRaw.includes('chinese') || langRaw.includes('中文')) {
            // Simplified vs Traditional heuristic: Amazon just says "Chinese"
            // Leave null to let backend auto-detect from ISBN, unless caller knows better
            language = 'chs';
        } else if (langRaw.includes('english')) {
            language = 'eng';
        } else if (langRaw && langRaw !== '') {
            language = 'multi';
        }

        // Item weight → grams
        const weightRaw = bullets['Item Weight'] || bullets['重量'] || null;
        let weight_g = null;
        if (weightRaw) {
            const wm = weightRaw.match(/([\d.]+)\s*(ounce|oz|pound|lb|gram|g|kg)/i);
            if (wm) {
                const val = parseFloat(wm[1]);
                const unit = wm[2].toLowerCase();
                if (unit.startsWith('oz') || unit.startsWith('ounce')) weight_g = Math.round(val * 28.3495);
                else if (unit.startsWith('lb') || unit.startsWith('pound')) weight_g = Math.round(val * 453.592);
                else if (unit === 'kg') weight_g = Math.round(val * 1000);
                else weight_g = Math.round(val); // already grams
            }
        }

        // ISBN
        let isbn13 = normalizeISBN(bullets['ISBN-13']);
        const isbn10 = normalizeISBN(bullets['ISBN-10'] || asin);
        if (!isbn13 && isbn10 && isbn10.length === 10) {
            isbn13 = isbn10to13(isbn10);
        }

        // Binding — from selected format swatch
        let binding = null;
        const selectedSwatch = document.querySelector('#tmmSwatches .selected .slot-title span[aria-label], #tmmSwatches .a-button-selected .slot-title span');
        if (selectedSwatch) {
            const raw = selectedSwatch.textContent.trim().toLowerCase();
            if (raw.includes('hardcover') || raw.includes('hard cover')) binding = 'hardcover';
            else if (raw.includes('paperback')) binding = 'paperback';
            else if (raw.includes('softcover') || raw.includes('soft cover')) binding = 'softcover';
            else binding = 'paperback'; // fallback for physical books
        } else {
            // Fallback: check detail bullets
            const bindingRaw = (bullets['Paperback'] || bullets['Hardcover'] || bullets['Binding'] || '').toLowerCase();
            if (bindingRaw.includes('hardcover')) binding = 'hardcover';
            else if (bindingRaw.includes('paperback')) binding = 'paperback';
            else binding = 'paperback';
        }

        // Price
        const price = extractPrice();

        // Cover image
        const imgEl = document.querySelector('#imgBlkFront, #main-image, #landingImage, #ebooksImgBlkFront');
        const coverUrl = imgEl ? (imgEl.getAttribute('data-a-dynamic-image')
            ? Object.keys(JSON.parse(imgEl.getAttribute('data-a-dynamic-image')))[0]
            : imgEl.src) : null;

        // Description — preserve paragraph structure, strip Amazon chrome
        const descEl = document.querySelector(
            '#bookDescription_feature_div .a-expander-content, ' +
            '#bookDescription_feature_div .a-expander-partial-collapse-content, ' +
            '#productDescription .a-section'
        );
        let description = null;
        if (descEl) {
            const clone = descEl.cloneNode(true);
            // Remove expander controls and noscript tags
            clone.querySelectorAll('.a-expander-header, .a-expander-prompt, noscript, script').forEach(el => el.remove());
            // Unwrap bare <span> wrappers inside <p> tags (Amazon wraps every paragraph in a <p><span>)
            clone.querySelectorAll('p > span:only-child').forEach(span => {
                const p = span.parentNode;
                p.innerHTML = span.innerHTML;
            });
            description = clone.innerHTML.trim();
        }

        return { asin, isbn13, isbn10, title, authors, publisher, pubDate, pages, price, coverUrl, description, language, weight_g, binding };
    }

    // ── UI ────────────────────────────────────────────────────────────────

    function buildPanel(info) {
        const panel = document.createElement('div');
        panel.id = 'ub-shopify-panel';

        const card = document.createElement('div');
        card.id = 'ub-shopify-card';

        const staticRow = (label, value) => value
            ? `<div class="ub-field"><label>${label}</label><span title="${value}">${value}</span></div>`
            : '';

        card.innerHTML = `
            <div class="ub-inputs">
                <label>Title</label>
                <input type="text" id="ub-title" value="${(info.title || '').replace(/"/g, '&quot;')}">
                <label>Author(s)</label>
                <input type="text" id="ub-authors" value="${(info.authors || []).join(', ').replace(/"/g, '&quot;')}">
                <label>Publisher</label>
                <input type="text" id="ub-publisher" value="${(info.publisher || '').replace(/"/g, '&quot;')}">
                <div class="ub-row">
                    <div>
                        <label>Language</label>
                        <select id="ub-language">
                            <option value="chs" ${info.language === 'chs' ? 'selected' : ''}>chs (简体)</option>
                            <option value="cht" ${info.language === 'cht' ? 'selected' : ''}>cht (繁體)</option>
                            <option value="eng" ${info.language === 'eng' ? 'selected' : ''}>eng</option>
                            <option value="multi" ${info.language === 'multi' ? 'selected' : ''}>multi</option>
                        </select>
                    </div>
                    <div>
                        <label>Binding</label>
                        <select id="ub-binding">
                            <option value="paperback" ${info.binding === 'paperback' ? 'selected' : ''}>Paperback</option>
                            <option value="hardcover" ${info.binding === 'hardcover' ? 'selected' : ''}>Hardcover</option>
                            <option value="softcover" ${info.binding === 'softcover' ? 'selected' : ''}>Softcover</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                </div>
            </div>
            ${staticRow('ISBN-13', info.isbn13)}
            ${staticRow('Pub. date', info.pubDate)}
            ${staticRow('Pages', info.pages)}
            ${staticRow('Weight', info.weight_g ? info.weight_g + ' g' : null)}
            <div class="ub-inputs">
                <div class="ub-row">
                    <div>
                        <label>Cost ($)</label>
                        <input type="number" id="ub-cost" min="0" step="0.01" placeholder="e.g. 12.00">
                    </div>
                    <div>
                        <label>Price ($)</label>
                        <input type="number" id="ub-price" min="0" step="0.01" value="${info.price || ''}">
                    </div>
                </div>
                <div class="ub-row">
                    <div>
                        <label>Qty</label>
                        <input type="number" id="ub-qty" min="0" step="1" placeholder="0">
                    </div>
                    <div style="display:flex;align-items:flex-end;padding-bottom:8px;">
                        <div class="ub-checkbox">
                            <input type="checkbox" id="ub-active">
                            <label for="ub-active">Active</label>
                        </div>
                    </div>
                </div>
            </div>
            <div id="ub-status"></div>
        `;

        const btn = document.createElement('button');
        btn.id = 'ub-shopify-btn';
        btn.textContent = 'Send to Shopify';

        panel.appendChild(card);
        panel.appendChild(btn);
        document.body.appendChild(panel);

        // Wire button
        btn.addEventListener('click', () => sendToShopify(info, btn));
    }

    function setStatus(msg, type) {
        const el = document.getElementById('ub-status');
        if (!el) return;
        el.textContent = msg;
        el.className = type;
    }

    // ── API call ─────────────────────────────────────────────────────────

    function sendToShopify(info, btn) {
        const isbn = info.isbn13;
        if (!isbn) {
            setStatus('Could not determine ISBN-13 for this page.', 'err');
            return;
        }

        const costVal = document.getElementById('ub-cost').value;
        const priceVal = document.getElementById('ub-price').value;
        const qtyVal = document.getElementById('ub-qty').value;
        const active = document.getElementById('ub-active').checked;

        const titleVal = document.getElementById('ub-title').value.trim();
        const authorsVal = document.getElementById('ub-authors').value.trim();
        const publisherVal = document.getElementById('ub-publisher').value.trim();
        const languageVal = document.getElementById('ub-language').value;
        const bindingVal = document.getElementById('ub-binding').value;

        const body = {
            isbn,
            title: titleVal || info.title,
            authors: authorsVal ? authorsVal.split(',').map(s => s.trim()).filter(Boolean) : info.authors,
            publisher: publisherVal || undefined,
            pub_date: info.pubDate,
            pages: info.pages || undefined,
            description: info.description || undefined,
            cover_image_url: info.coverUrl || undefined,
            binding: bindingVal || undefined,
            language: languageVal || undefined,
            weight_g: info.weight_g || undefined,
            active,
        };
        if (costVal) body.cost = parseFloat(costVal);
        if (priceVal) body.price = parseFloat(priceVal);
        if (qtyVal && parseInt(qtyVal) > 0) body.quantity = parseInt(qtyVal);

        btn.disabled = true;
        btn.textContent = 'Sending…';
        setStatus('Contacting backend…', 'inf');

        GM_xmlhttpRequest({
            method: 'POST',
            url: `${API_BASE}/ShopifyCreateFromData`,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify(body),
            onload(res) {
                btn.disabled = false;
                btn.textContent = 'Send to Shopify';
                let data;
                try { data = JSON.parse(res.responseText); } catch (e) { data = {}; }

                if (res.status === 200 && !data.error) {
                    const url = data.shopify_url || '';
                    const label = data.created ? 'Created!' : 'Updated existing product';
                    if (url) {
                        setStatus('', 'ok');
                        document.getElementById('ub-status').innerHTML =
                            `${label} <a class="ub-shopify-link" href="${url}" target="_blank">View in Shopify</a>`;
                        document.getElementById('ub-status').className = 'ok';
                    } else {
                        setStatus(label, 'ok');
                    }
                } else {
                    const msg = data.error || `HTTP ${res.status}`;
                    setStatus(`Error: ${msg}`, 'err');
                }
            },
            onerror() {
                btn.disabled = false;
                btn.textContent = 'Send to Shopify';
                setStatus('Network error. Check console.', 'err');
            }
        });
    }

    // ── Init ──────────────────────────────────────────────────────────────

    function init() {
        // Only run on book product pages (skip search results, etc.)
        const isBookPage = !!document.querySelector('#productTitle, #title');
        if (!isBookPage) return;

        const info = parsePage();
        buildPanel(info);
    }

    // Amazon loads some content dynamically; give it a moment
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
