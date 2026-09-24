// ==UserScript==
// @name         BooksTW → Shopify (Unbound)
// @namespace    https://unbound-backend.azurewebsites.net/
// @version      1.0
// @description  Parse books.com.tw product page and create/update Shopify product via Unbound backend
// @author       Unbound
// @match        https://www.books.com.tw/products/*
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

    /** Normalize ISBN-13: remove hyphens/spaces */
    function normalizeISBN(s) {
        return s ? s.replace(/[-\s]/g, '') : null;
    }

    /** Convert a TWD price string like "$270" or "270" to a number */
    function parseTWD(s) {
        if (!s) return null;
        const m = String(s).match(/[\d,]+\.?\d*/);
        return m ? parseFloat(m[0].replace(/,/g, '')) : null;
    }

    // ── Parse books.com.tw page ─────────────────────────────────────────────
    // Mirrors the server-side parser in scraper/bookstw.py's parse_product_page,
    // so the selectors here should stay in sync with that file if the site changes.

    function parsePage() {
        // Product id from the URL, e.g. https://www.books.com.tw/products/0010623415
        const idMatch = window.location.pathname.match(/\/products\/([^/?#]+)/);
        const productId = idMatch ? idMatch[1] : null;

        // Title
        const title = getText('.type02_p002 h1');

        // Author / translator / publisher / pub date / language all live in
        // the same "type02_p003" block, one <li> per field.
        const authors = [];
        const translators = [];
        let publisher = null;
        let pubDate = null;
        let language = null;

        const infoSection = document.querySelector('.type02_p003');
        if (infoSection) {
            infoSection.querySelectorAll('li').forEach(li => {
                // Identify the field label from this <li>'s own text nodes, skipping
                // nested elements entirely (e.g. the hidden "trace_box" follow-author
                // popup, or "追蹤作者"/"新功能介紹" trailing buttons) so those don't get
                // mistaken for the label or counted as author/translator names.
                const clone = li.cloneNode(true);
                clone.querySelectorAll('.trace_box, #trace_box, [id^=trace_btn], .help').forEach(el => el.remove());

                let label = '';
                for (const node of clone.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        label += node.textContent;
                    } else {
                        break;
                    }
                }
                label = label.trim();

                if (label === '作者：') {
                    clone.querySelectorAll('a').forEach(a => {
                        const name = a.textContent.trim();
                        if (name) authors.push(name);
                    });
                } else if (label.startsWith('譯者：')) {
                    clone.querySelectorAll('a').forEach(a => {
                        const name = a.textContent.trim();
                        if (name) translators.push(name);
                    });
                } else if (label.startsWith('出版社：') || label.startsWith('原文出版社：')) {
                    const a = clone.querySelector('a span') || clone.querySelector('a') || clone.querySelector('span');
                    publisher = a ? a.textContent.trim() : null;
                } else if (label.startsWith('出版日期：')) {
                    pubDate = clone.textContent.replace('出版日期：', '').trim();
                } else if (label.startsWith('語言：')) {
                    language = clone.textContent.replace('語言：', '').trim();
                }
            });
        }

        // Price — list price (定價) and discounted price (優惠價)
        let priceListed = null;
        let priceDiscounted = null;
        const priceUl = document.querySelector('.prod_cont_b ul.price, ul.price');
        if (priceUl) {
            const emEl = priceUl.querySelector('em');
            if (emEl) priceListed = parseTWD(emEl.textContent);
            const discountedEl = priceUl.querySelector('strong.price01 b');
            if (discountedEl) priceDiscounted = parseTWD(discountedEl.textContent);
        }

        // Cover image
        const imgEl = document.querySelector('.cnt_prod_img001 img.cover');
        let coverUrl = imgEl ? imgEl.getAttribute('src') : null;
        if (!coverUrl && productId) {
            // Fallback: construct the standard getImage URL from the product id
            const p1 = productId.slice(0, 3), p2 = productId.slice(3, 6), p3 = productId.slice(6, 8);
            coverUrl = `https://im2.book.com.tw/image/getImage?i=https://www.books.com.tw/img/${p1}/${p2}/${p3}/${productId}.jpg&w=640`;
        }

        // ISBN / series / spec table (規格) / publish location / categories
        let isbn = null;
        let series = null;
        let specRaw = null;
        let publishLocation = null;
        const categories = [];

        const detailSection = Array.from(document.querySelectorAll('.mod_b'))
            .find(el => el.querySelector('h3') && el.querySelector('h3').textContent.trim() === '詳細資料');
        if (detailSection) {
            detailSection.querySelectorAll('.bd > ul:not(.sort) > li').forEach(li => {
                const text = li.textContent.trim();
                if (text.startsWith('ISBN：')) {
                    isbn = normalizeISBN(text.replace('ISBN：', '').trim());
                } else if (text.startsWith('叢書系列：')) {
                    const a = li.querySelector('a');
                    series = a ? a.textContent.trim() : null;
                } else if (text.startsWith('規格：')) {
                    specRaw = text.replace('規格：', '').trim();
                } else if (text.startsWith('出版地：')) {
                    publishLocation = text.replace('出版地：', '').trim();
                }
            });
            detailSection.querySelectorAll('.bd ul.sort a').forEach(a => {
                const name = a.textContent.trim();
                if (name) categories.push(name);
            });
        }

        // Parse the slash-separated spec line, e.g.
        // "平裝 / 180頁 / 14.6 x 20.2 x 0.9 cm / 普通級 / 全彩印刷 / 初版"
        let binding = null, pages = null, dimensionsCm = null;
        if (specRaw) {
            const parts = specRaw.split('/').map(s => s.trim()).filter(Boolean);
            binding = parts.find(p => p.endsWith('裝')) || null;
            const pagesPart = parts.find(p => p.includes('頁'));
            if (pagesPart) {
                const m = pagesPart.match(/\d+/);
                if (m) pages = parseInt(m[0], 10);
            }
            const dimsPart = parts.find(p => p.includes('x') && p.toLowerCase().includes('cm'));
            if (dimsPart) {
                const nums = dimsPart.match(/[\d.]+/g);
                if (nums && nums.length === 3) dimensionsCm = nums.map(Number);
            }
        }

        // Description
        const descSection = Array.from(document.querySelectorAll('.mod_b'))
            .find(el => el.querySelector('h3') && el.querySelector('h3').textContent.trim() === '內容簡介');
        let description = null;
        if (descSection) {
            const contentEl = descSection.querySelector('.bd .content');
            if (contentEl) {
                const clone = contentEl.cloneNode(true);
                clone.querySelectorAll('script, .type02_gradient').forEach(el => el.remove());
                description = clone.innerHTML.trim();
            }
        }

        // Language → internal code (mirrors scraper/bookstw.py's convert_language)
        let languageCode = null;
        if (language) {
            if (language.includes('繁')) languageCode = 'cht';
            else if (language.includes('简') || language.includes('簡體')) languageCode = 'chs';
            else if (language.includes('英文')) languageCode = 'eng';
            else languageCode = 'multi';
        }

        return {
            productId, isbn, title, authors, translators, publisher, series,
            pubDate, language: languageCode, priceListed, priceDiscounted,
            coverUrl, description, binding, pages, dimensionsCm,
            publishLocation, categories,
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
            ${staticRow('Pub. date', info.pubDate)}
            ${staticRow('Pages', info.pages)}
            ${staticRow('Dimensions', info.dimensionsCm ? info.dimensionsCm.join(' x ') + ' cm' : null)}
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

    // ── API call ─────────────────────────────────────────────────────────

    function sendToShopify(info, btn) {
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
            tags: info.categories && info.categories.length ? info.categories : undefined,
            active,
        };
        if (costVal) body.cost = parseFloat(costVal);
        if (priceVal) body.price = parseFloat(priceVal);
        if (qtyVal && parseInt(qtyVal, 10) > 0) body.quantity = parseInt(qtyVal, 10);

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
        // Only run on actual book product pages
        const isProductPage = !!document.querySelector('.type02_p002 h1');
        if (!isProductPage) return;

        const info = parsePage();
        buildPanel(info);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
