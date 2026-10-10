// ==UserScript==
// @name         Eslite → Shopify (Unbound)
// @namespace    https://unbound-backend.azurewebsites.net/
// @version      1.0
// @description  Parse eslite.com product page and create/update Shopify product via Unbound backend
// @author       Unbound
// @match        https://www.eslite.com/product/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      unbound-backend.azurewebsites.net
// @connect      s2.eslite.com
// @connect      s.eslite.com
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

    /** Convert a TWD price string like "$270" or "270" to a number */
    function parseTWD(s) {
        if (!s) return null;
        const m = String(s).match(/[\d,]+\.?\d*/);
        return m ? parseFloat(m[0].replace(/,/g, '')) : null;
    }

    /** Normalize ISBN-13: remove hyphens/spaces */
    function normalizeISBN(s) {
        return s ? s.replace(/[-\s]/g, '') : null;
    }

    // ── Parse eslite.com page ────────────────────────────────────────────────
    // The product page is a Vue SPA (scoped data-v-* attrs, stable class names).
    // Structure observed on https://www.eslite.com/product/<id>:
    //  - Title:            h1 inside .books-publication's ancestor row
    //  - Author block:     .books-publication-link-row.author / .translator / .painter
    //  - Publisher:        .books-publication-link-row.publicDate (has an <a data-test-id="supplier-link">)
    //  - Pub date:         .books-publication-row.publicDate (plain text, no link)
    //  - Cover image:      .item-image-wrap img[src]
    //  - Description:      #product-page-introduction
    //  - Spec rows:        #content-998 spans of the form "Label / Value"
    //  - Price:            .item-price (discounted) / .pre-product-price (list)
    //  - Tags:              .tags (category chips, may be empty)

    function getLinkRowText(root, cls) {
        const row = root.querySelector(`.books-publication-link-row.${cls} a`);
        return row ? row.textContent.trim() : null;
    }

    function getLinkRowList(root, cls) {
        const links = root.querySelectorAll(`.books-publication-link-row.${cls} a`);
        return Array.from(links).map(a => a.textContent.trim()).filter(Boolean);
    }

    function parseSpecs() {
        // Spec section is identified by data-type="規格" (id can vary, e.g. content-998)
        const specSection = document.querySelector('[data-type="規格"]');
        const specs = {};
        if (!specSection) return specs;
        specSection.querySelectorAll('.description-content span').forEach(span => {
            const text = span.textContent.trim();
            const idx = text.indexOf('/');
            if (idx === -1) return;
            const label = text.slice(0, idx).trim();
            const value = text.slice(idx + 1).trim();
            if (label) specs[label] = value;
        });
        return specs;
    }

    function parsePage() {
        // Product id from the URL, e.g. https://www.eslite.com/product/10012230192683189405002
        const idMatch = window.location.pathname.match(/\/product\/([^/?#]+)/);
        const productId = idMatch ? idMatch[1] : null;

        const title = (document.querySelector('h1') || {}).textContent?.trim() || null;

        const pubBlock = document.querySelector('.books-publication');
        const authors = pubBlock ? getLinkRowList(pubBlock, 'author') : [];
        const translators = pubBlock ? getLinkRowList(pubBlock, 'translator') : [];
        const painters = pubBlock ? getLinkRowList(pubBlock, 'painter') : [];
        const publisher = pubBlock ? getLinkRowText(pubBlock, 'publicDate') : null;

        // Pub date lives in a sibling row with class "books-publication-row publicDate"
        // (no "-link-", plain <span> text, not <a>). The row has TWO ".group" divs:
        // the first is the label ("出/版/日/期：", one char per <span>), the second
        // holds the actual date — so take the last ".group", not the first.
        let pubDate = null;
        const pubDateRow = document.querySelector('.books-publication-row.publicDate');
        if (pubDateRow) {
            const groups = pubDateRow.querySelectorAll('.group');
            const valueGroup = groups[groups.length - 1];
            if (valueGroup) pubDate = valueGroup.textContent.trim();
        }

        // Cover image
        const imgEl = document.querySelector('.item-image-wrap img');
        const coverUrl = imgEl ? imgEl.getAttribute('src') : null;

        // Description
        const descEl = document.querySelector('#product-page-introduction');
        let description = null;
        if (descEl) {
            const clone = descEl.cloneNode(true);
            description = clone.innerHTML.trim();
        }

        // Specs table (規格): ISBN13, 頁數 (pages), 裝訂 (binding), 語言 (language), 尺寸 (dimensions), 重量(g) (weight)
        const specs = parseSpecs();

        const isbn = normalizeISBN(specs['ISBN13'] || specs['EAN貨碼'] || null);

        let pages = null;
        if (specs['頁數']) {
            const m = specs['頁數'].match(/\d+/);
            if (m) pages = parseInt(m[0], 10);
        }

        // 裝訂 looks like "P:平裝" — strip the leading code prefix
        let binding = null;
        if (specs['裝訂']) {
            binding = specs['裝訂'].includes(':') ? specs['裝訂'].split(':').slice(1).join(':').trim() : specs['裝訂'].trim();
        }

        // 語言 looks like "2:中文/簡體"
        let languageRaw = null;
        if (specs['語言']) {
            languageRaw = specs['語言'].includes(':') ? specs['語言'].split(':').slice(1).join(':').trim() : specs['語言'].trim();
        }
        let languageCode = null;
        if (languageRaw) {
            if (languageRaw.includes('繁')) languageCode = 'cht';
            else if (languageRaw.includes('簡')) languageCode = 'chs';
            else if (languageRaw.includes('英文')) languageCode = 'eng';
            else languageCode = 'multi';
        }

        // 尺寸 looks like "17X23X0.9CM"
        let dimensionsCm = null;
        if (specs['尺寸']) {
            const nums = specs['尺寸'].match(/[\d.]+/g);
            if (nums && nums.length === 3) dimensionsCm = nums.map(Number);
        }

        let weightG = null;
        if (specs['重量(g)']) {
            const m = specs['重量(g)'].match(/\d+/);
            if (m) weightG = parseInt(m[0], 10);
        }

        // Price — list price (strikethrough) and discounted/selling price
        let priceListed = null;
        let priceDiscounted = null;
        const priceArea = document.querySelector('.product-price .price-area');
        if (priceArea) {
            const listedEl = priceArea.querySelector('.pre-product-price');
            if (listedEl) priceListed = parseTWD(listedEl.textContent);
            const discountedEl = priceArea.querySelector('.item-price');
            if (discountedEl) priceDiscounted = parseTWD(discountedEl.textContent);
        }
        if (priceListed === null && priceDiscounted !== null) priceListed = priceDiscounted;

        // Category tags — prefer the breadcrumb (skip the first "首頁"/Home crumb
        // and the last crumb, which is usually the current product/leaf category
        // that duplicates title info); fall back to any .tags chips if present.
        const categories = [];
        const breadcrumbLinks = document.querySelectorAll('.ec-breadcrumb-item a, [class*="breadcrumb"] a');
        if (breadcrumbLinks.length > 1) {
            Array.from(breadcrumbLinks).slice(1).forEach(a => {
                const name = a.textContent.trim();
                if (name) categories.push(name);
            });
        }
        document.querySelectorAll('.tags a, .tags .tag').forEach(el => {
            const name = el.textContent.trim();
            if (name && !categories.includes(name)) categories.push(name);
        });

        return {
            productId, isbn, title, authors, translators, painters, publisher, series: null,
            pubDate, language: languageCode, priceListed, priceDiscounted,
            coverUrl, description, binding, pages, dimensionsCm, weightG,
            categories,
        };
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

        const allAuthors = [...(info.authors || []), ...(info.painters || [])];

        card.innerHTML = `
            <div class="ub-inputs">
                <label>Title</label>
                <input type="text" id="ub-title" value="${(info.title || '').replace(/"/g, '&quot;')}">
                <label>Author(s)</label>
                <input type="text" id="ub-authors" value="${allAuthors.join(', ').replace(/"/g, '&quot;')}">
                <label>Publisher</label>
                <input type="text" id="ub-publisher" value="${(info.publisher || '').replace(/"/g, '&quot;')}">
                <div class="ub-row">
                    <div>
                        <label>Language</label>
                        <select id="ub-language">
                            <option value="cht" ${info.language === 'cht' ? 'selected' : ''}>cht (繁體)</option>
                            <option value="chs" ${info.language === 'chs' ? 'selected' : ''}>chs (简体)</option>
                            <option value="eng" ${info.language === 'eng' ? 'selected' : ''}>eng</option>
                            <option value="multi" ${info.language === 'multi' ? 'selected' : ''}>multi</option>
                        </select>
                    </div>
                    <div>
                        <label>Binding</label>
                        <input type="text" id="ub-binding" value="${(info.binding || '').replace(/"/g, '&quot;')}">
                    </div>
                </div>
            </div>
            ${staticRow('ISBN-13', info.isbn)}
            ${staticRow('Translator', (info.translators || []).join(', '))}
            ${staticRow('Pub. date', info.pubDate)}
            ${staticRow('Pages', info.pages)}
            ${staticRow('Dimensions', info.dimensionsCm ? info.dimensionsCm.join(' x ') + ' cm' : null)}
            ${staticRow('Weight', info.weightG ? info.weightG + ' g' : null)}
            ${staticRow('List price', info.priceListed ? 'NT$' + info.priceListed : null)}
            <div class="ub-inputs">
                <div class="ub-row">
                    <div>
                        <label>Cost ($)</label>
                        <input type="number" id="ub-cost" min="0" step="0.01" placeholder="e.g. 12.00">
                    </div>
                    <div>
                        <label>Price ($)</label>
                        <input type="number" id="ub-price" min="0" step="0.01" placeholder="USD selling price">
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

    // ── Image fetch ──────────────────────────────────────────────────────
    // eslite's image CDN (s2.eslite.com) sits behind Cloudflare and 403s any
    // server-side fetch, so Shopify's own image-download step always fails if
    // we just hand it the URL. GM_xmlhttpRequest runs as the real browser
    // (passes Cloudflare's checks) — fetch the bytes here and ship them as
    // base64; the backend stages them into Shopify directly instead of
    // asking Shopify to fetch the URL itself.
    function fetchImageAsBase64(url) {
        return new Promise((resolve) => {
            if (!url) { resolve(null); return; }
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'blob',
                onload(res) {
                    if (res.status !== 200 || !res.response) { resolve(null); return; }
                    const blob = res.response;
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result); // data: URI
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                },
                onerror() { resolve(null); },
            });
        });
    }

    // ── API call ─────────────────────────────────────────────────────────

    async function sendToShopify(info, btn) {
        const isbn = info.isbn;
        if (!isbn) {
            setStatus('Could not determine ISBN for this page.', 'err');
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
        const bindingVal = document.getElementById('ub-binding').value.trim();

        btn.disabled = true;
        btn.textContent = 'Fetching cover…';
        setStatus('Fetching cover image…', 'inf');

        const coverImageBase64 = await fetchImageAsBase64(info.coverUrl);

        const body = {
            isbn,
            title: titleVal || info.title,
            authors: authorsVal ? authorsVal.split(',').map(s => s.trim()).filter(Boolean) : info.authors,
            publisher: publisherVal || undefined,
            pub_date: info.pubDate,
            pages: info.pages || undefined,
            description: info.description || undefined,
            cover_image_base64: coverImageBase64 || undefined,
            cover_image_url: coverImageBase64 ? undefined : (info.coverUrl || undefined),
            binding: bindingVal || undefined,
            language: languageVal || undefined,
            tags: info.categories && info.categories.length ? info.categories : undefined,
            active,
        };
        if (costVal) body.cost = parseFloat(costVal);
        if (priceVal) body.price = parseFloat(priceVal);
        if (qtyVal && parseInt(qtyVal, 10) > 0) body.quantity = parseInt(qtyVal, 10);

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

    // ── Init ─────────────────────────────────────────────────────────────
    // eslite.com is a client-rendered Vue SPA: the DOM at DOMContentLoaded is
    // just an empty shell, and on navigation the URL can change without a full
    // reload. Wait for the actual product content (spec block with an ISBN13
    // row) to mount before building the panel, and re-run on SPA navigation.

    let currentPanelUrl = null;

    function productReady() {
        return !!document.querySelector('h1') && !!document.querySelector('[data-type="規格"]');
    }

    function tryInit() {
        if (!/\/product\//.test(location.pathname)) return;
        if (currentPanelUrl === location.href) return;
        if (!productReady()) return;

        const existing = document.getElementById('ub-shopify-panel');
        if (existing) existing.remove();

        currentPanelUrl = location.href;
        const info = parsePage();
        buildPanel(info);
    }

    const observer = new MutationObserver(() => tryInit());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Also poll as a fallback in case mutations are too granular/batched
    const pollId = setInterval(tryInit, 500);
    setTimeout(() => clearInterval(pollId), 30000);

    tryInit();

})();
