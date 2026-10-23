// ==UserScript==
// @name         Product Page → Shopify (Unbound)
// @namespace    https://unbound-backend.azurewebsites.net/
// @version      1.1
// @description  Parse a book (Amazon, books.com.tw, eslite) or chocolate (Apriori Distribution) product page and create/update the Shopify product via Unbound backend
// @author       Unbound
// @match        https://www.amazon.com/dp/*
// @match        https://www.amazon.com/gp/product/*
// @match        https://www.amazon.com/*/dp/*
// @match        https://www.books.com.tw/products/*
// @match        https://www.eslite.com/product/*
// @match        https://aprioridistribution.com/product/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @connect      unbound-backend.azurewebsites.net
// @connect      s2.eslite.com
// @connect      s.eslite.com
// @connect      aprioridistribution.com
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'https://unbound-backend.azurewebsites.net/api';
    const SHOPIFY_ADMIN = 'https://admin.shopify.com/store/ff058f-a3';

    // The backend only accepts requests carrying a service key (created by the owner in the admin's Service Keys page).
    // Asked for once and kept in Tampermonkey storage; a rejected key is forgotten so it's asked again.
    function serviceKey() {
        let key = GM_getValue('unboundServiceKey', '');
        if (!key) {
            key = (prompt('Unbound backend service key (ask the admin):') || '').trim();
            if (key) GM_setValue('unboundServiceKey', key);
        }
        return key;
    }

    function forgetServiceKeyIfRejected(status) {
        if (status === 401) GM_setValue('unboundServiceKey', '');
    }

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
            width: 300px;
            max-height: 75vh;
            overflow-y: auto;
            box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        }
        #ub-shopify-card .ub-field {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            color: #555;
        }
        #ub-shopify-card .ub-field label { font-weight: 600; margin-right: 6px; }
        #ub-shopify-card .ub-field span { text-align: right; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #ub-shopify-card .ub-inputs { margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; }
        #ub-shopify-card .ub-inputs:first-child { margin-top: 0; border-top: none; padding-top: 0; }
        #ub-shopify-card .ub-inputs label { display: block; margin-bottom: 3px; font-weight: 600; color: #555; }
        #ub-shopify-card .ub-inputs select {
            width: 100%; box-sizing: border-box; padding: 5px 8px;
            border: 1px solid #ccc; border-radius: 4px; margin-bottom: 8px; font-size: 13px;
            background: #fff;
        }
        #ub-shopify-card .ub-inputs input[type=number], #ub-shopify-card .ub-inputs input[type=text], #ub-shopify-card .ub-inputs textarea {
            width: 100%; box-sizing: border-box; padding: 5px 8px;
            border: 1px solid #ccc; border-radius: 4px; margin-bottom: 8px; font-size: 13px;
            font-family: inherit;
        }
        #ub-shopify-card .ub-inputs textarea { height: 90px; font-size: 12px; resize: vertical; }
        #ub-shopify-card .ub-inputs .ub-row { display: flex; gap: 8px; }
        #ub-shopify-card .ub-inputs .ub-row > div { flex: 1; }
        #ub-shopify-card .ub-checkbox { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
        #ub-shopify-card .ub-thumbs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
        #ub-shopify-card .ub-thumbs img { width: 52px; height: 52px; object-fit: cover; border: 1px solid #ddd; border-radius: 3px; }
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

    // ── Shared helpers ───────────────────────────────────────────────────────

    function getText(selector) {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
    }

    /** Parse a money string like "$8.99", "NT$270" or "270" to a number */
    function parseMoney(s) {
        if (!s) return null;
        const m = String(s).match(/[\d,]+\.?\d*/);
        return m ? parseFloat(m[0].replace(/,/g, '')) : null;
    }

    /** Normalize ISBN-13: remove hyphens/spaces */
    function normalizeISBN(s) {
        return s ? s.replace(/[-\s]/g, '') : null;
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

    const escAttr = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    function setStatus(msg, type) {
        const el = document.getElementById('ub-status');
        if (!el) return;
        el.textContent = msg;
        el.className = type;
    }

    function setStatusLink(label, href, type) {
        const el = document.getElementById('ub-status');
        if (!el) return;
        el.innerHTML = href
            ? `${escAttr(label)} <a class="ub-shopify-link" href="${escAttr(href)}" target="_blank">View in Shopify</a>`
            : escAttr(label);
        el.className = type;
    }

    const adminProductUrl = gid => {
        const id = String(gid || '').split('/').pop();
        return id ? `${SHOPIFY_ADMIN}/products/${id}` : '';
    };

    // Some image CDNs (eslite, aprioridistribution) sit behind Cloudflare and 403
    // any server-side fetch, so Shopify's own image download fails if we just hand
    // it the URL. GM_xmlhttpRequest runs as the real browser — fetch the bytes here
    // and send them as data URIs; the backend stages them into Shopify directly.
    function fetchImageAsDataUri(url) {
        return new Promise((resolve) => {
            if (!url) { resolve(null); return; }
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'blob',
                onload(res) {
                    if (res.status !== 200 || !res.response) { resolve(null); return; }
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(res.response);
                },
                onerror() { resolve(null); },
            });
        });
    }

    function postJson(path, body, onload, onerror) {
        GM_xmlhttpRequest({
            method: 'POST',
            url: `${API_BASE}${path}`,
            headers: { 'Content-Type': 'application/json', 'X-Service-Key': serviceKey() },
            data: JSON.stringify(body),
            onload(res) {
                forgetServiceKeyIfRejected(res.status);
                let data;
                try { data = JSON.parse(res.responseText); } catch (e) { data = {}; }
                onload(res, data);
            },
            onerror,
        });
    }

    function mountPanel(cardHtml) {
        const panel = document.createElement('div');
        panel.id = 'ub-shopify-panel';
        const card = document.createElement('div');
        card.id = 'ub-shopify-card';
        card.innerHTML = cardHtml;
        const btn = document.createElement('button');
        btn.id = 'ub-shopify-btn';
        btn.textContent = 'Send to Shopify';
        panel.appendChild(card);
        panel.appendChild(btn);
        document.body.appendChild(panel);
        return btn;
    }

    const staticRow = (label, value) => value
        ? `<div class="ub-field"><label>${label}</label><span title="${escAttr(value)}">${escAttr(value)}</span></div>`
        : '';

    // ══ Book sites → ShopifyCreateFromData ═════════════════════════════════
    // Each book adapter's parse() returns:
    //   { isbn, title, authors[], publisher, pubDate, pages, description,
    //     coverUrl, language, binding, weight_g, tags[], price, rows: [[label, value]] }
    // and may set coverViaBrowser to fetch the cover here instead of by URL.

    // ── Amazon ──────────────────────────────────────────────────────────────

    /** Parse the detail-bullet-list to extract label → value pairs */
    function parseAmazonDetailBullets() {
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

    /** Extract price from spans like "$18.95" */
    function extractAmazonPrice() {
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

    const amazon = {
        kind: 'book',
        match: () => location.hostname === 'www.amazon.com',
        // Only run on book product pages (skip search results, etc.)
        ready: () => !!document.querySelector('#productTitle, #title'),
        parse() {
            // ASIN from the media block
            const asinEl = document.querySelector('[data-csa-c-asin]');
            const asin = asinEl ? asinEl.getAttribute('data-csa-c-asin') : null;

            const title = getText('#productTitle') || getText('#title #productTitle');

            // Authors — collect all author links
            const authorEls = document.querySelectorAll('#bylineInfo .author a, #bylineInfo .contributorNameID');
            const authors = Array.from(authorEls).map(a => a.textContent.trim()).filter(Boolean);

            const bullets = parseAmazonDetailBullets();
            const publisher = bullets['Publisher'] || bullets['出版社'] || null;
            const pubDate = bullets['Publication date'] || bullets['出版日期'] || null;
            const pages = bullets['Print length'] ? parseInt(bullets['Print length']) : null;

            // Language → internal code
            const langRaw = (bullets['Language'] || bullets['语言'] || '').toLowerCase();
            let language = null;
            if (langRaw.includes('chinese') || langRaw.includes('中文')) {
                // Simplified vs Traditional heuristic: Amazon just says "Chinese"
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

            return {
                // The language menu defaulted to chs on Amazon when the page doesn't say
                isbn: isbn13, title, authors, publisher, pubDate, pages, description,
                coverUrl, language: language || 'chs', binding, weight_g, tags: [],
                price: extractAmazonPrice(),
                rows: [
                    ['ISBN-13', isbn13],
                    ['Pub. date', pubDate],
                    ['Pages', pages],
                    ['Weight', weight_g ? weight_g + ' g' : null],
                ],
            };
        },
    };

    // ── books.com.tw ────────────────────────────────────────────────────────
    // Mirrors the server-side parser in scraper/bookstw.py's parse_product_page,
    // so the selectors here should stay in sync with that file if the site changes.

    const bookstw = {
        kind: 'book',
        match: () => location.hostname === 'www.books.com.tw',
        ready: () => !!document.querySelector('.type02_p002 h1'),
        parse() {
            // Product id from the URL, e.g. https://www.books.com.tw/products/0010623415
            const idMatch = window.location.pathname.match(/\/products\/([^/?#]+)/);
            const productId = idMatch ? idMatch[1] : null;

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
            const priceUl = document.querySelector('.prod_cont_b ul.price, ul.price');
            if (priceUl) {
                const emEl = priceUl.querySelector('em');
                if (emEl) priceListed = parseMoney(emEl.textContent);
            }

            // Cover image
            const imgEl = document.querySelector('.cnt_prod_img001 img.cover');
            let coverUrl = imgEl ? imgEl.getAttribute('src') : null;
            if (!coverUrl && productId) {
                // Fallback: construct the standard getImage URL from the product id
                const p1 = productId.slice(0, 3), p2 = productId.slice(3, 6), p3 = productId.slice(6, 8);
                coverUrl = `https://im2.book.com.tw/image/getImage?i=https://www.books.com.tw/img/${p1}/${p2}/${p3}/${productId}.jpg&w=640`;
            }

            // ISBN / spec table (規格) / categories
            let isbn = null;
            let specRaw = null;
            const categories = [];

            const detailSection = Array.from(document.querySelectorAll('.mod_b'))
                .find(el => el.querySelector('h3') && el.querySelector('h3').textContent.trim() === '詳細資料');
            if (detailSection) {
                detailSection.querySelectorAll('.bd > ul:not(.sort) > li').forEach(li => {
                    const text = li.textContent.trim();
                    if (text.startsWith('ISBN：')) {
                        isbn = normalizeISBN(text.replace('ISBN：', '').trim());
                    } else if (text.startsWith('規格：')) {
                        specRaw = text.replace('規格：', '').trim();
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
                isbn, title, authors, publisher, pubDate, pages, description,
                coverUrl, language: languageCode, binding, weight_g: null, tags: categories,
                price: null,
                rows: [
                    ['ISBN-13', isbn],
                    ['Translator', translators.join(', ')],
                    ['Pub. date', pubDate],
                    ['Pages', pages],
                    ['Dimensions', dimensionsCm ? dimensionsCm.join(' x ') + ' cm' : null],
                    ['List price', priceListed ? 'NT$' + priceListed : null],
                ],
            };
        },
    };

    // ── eslite.com ──────────────────────────────────────────────────────────
    // The product page is a Vue SPA (scoped data-v-* attrs, stable class names).
    //  - Title:            h1
    //  - Author block:     .books-publication-link-row.author / .translator / .painter
    //  - Publisher:        .books-publication-link-row.publicDate (has an <a data-test-id="supplier-link">)
    //  - Pub date:         .books-publication-row.publicDate (plain text, no link)
    //  - Cover image:      .item-image-wrap img[src]
    //  - Description:      #product-page-introduction
    //  - Spec rows:        [data-type="規格"] spans of the form "Label / Value"
    //  - Price:            .item-price (discounted) / .pre-product-price (list)

    function getEsliteLinkRowText(root, cls) {
        const row = root.querySelector(`.books-publication-link-row.${cls} a`);
        return row ? row.textContent.trim() : null;
    }

    function getEsliteLinkRowList(root, cls) {
        const links = root.querySelectorAll(`.books-publication-link-row.${cls} a`);
        return Array.from(links).map(a => a.textContent.trim()).filter(Boolean);
    }

    function parseEsliteSpecs() {
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

    const eslite = {
        kind: 'book',
        // eslite's image CDN 403s server-side fetches (Cloudflare)
        coverViaBrowser: true,
        match: () => location.hostname === 'www.eslite.com',
        // Wait for the actual product content (spec block) to mount
        ready: () => /\/product\//.test(location.pathname) &&
            !!document.querySelector('h1') && !!document.querySelector('[data-type="規格"]'),
        parse() {
            const title = (document.querySelector('h1') || {}).textContent?.trim() || null;

            const pubBlock = document.querySelector('.books-publication');
            const authors = pubBlock ? getEsliteLinkRowList(pubBlock, 'author') : [];
            const translators = pubBlock ? getEsliteLinkRowList(pubBlock, 'translator') : [];
            const painters = pubBlock ? getEsliteLinkRowList(pubBlock, 'painter') : [];
            const publisher = pubBlock ? getEsliteLinkRowText(pubBlock, 'publicDate') : null;

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

            const imgEl = document.querySelector('.item-image-wrap img');
            const coverUrl = imgEl ? imgEl.getAttribute('src') : null;

            const descEl = document.querySelector('#product-page-introduction');
            const description = descEl ? descEl.cloneNode(true).innerHTML.trim() : null;

            // Specs table (規格): ISBN13, 頁數 (pages), 裝訂 (binding), 語言 (language), 尺寸 (dimensions), 重量(g) (weight)
            const specs = parseEsliteSpecs();

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
                if (listedEl) priceListed = parseMoney(listedEl.textContent);
                const discountedEl = priceArea.querySelector('.item-price');
                if (discountedEl) priceDiscounted = parseMoney(discountedEl.textContent);
            }
            if (priceListed === null && priceDiscounted !== null) priceListed = priceDiscounted;

            // Category tags — prefer the breadcrumb (skip the first "首頁"/Home crumb);
            // fall back to any .tags chips if present.
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
                isbn, title, authors: [...authors, ...painters], publisher, pubDate, pages, description,
                coverUrl, language: languageCode, binding, weight_g: weightG, tags: categories,
                price: null,
                rows: [
                    ['ISBN-13', isbn],
                    ['Translator', translators.join(', ')],
                    ['Pub. date', pubDate],
                    ['Pages', pages],
                    ['Dimensions', dimensionsCm ? dimensionsCm.join(' x ') + ' cm' : null],
                    ['Weight', weightG ? weightG + ' g' : null],
                    ['List price', priceListed ? 'NT$' + priceListed : null],
                ],
            };
        },
    };

    // ── Book panel + send ───────────────────────────────────────────────────

    function buildBookPanel(info, site) {
        const languageOption = (value, label) =>
            `<option value="${value}" ${info.language === value ? 'selected' : ''}>${label}</option>`;

        const btn = mountPanel(`
            <div class="ub-inputs">
                <label>Title</label>
                <input type="text" id="ub-title" value="${escAttr(info.title)}">
                <label>Author(s)</label>
                <input type="text" id="ub-authors" value="${escAttr((info.authors || []).join(', '))}">
                <label>Publisher</label>
                <input type="text" id="ub-publisher" value="${escAttr(info.publisher)}">
                <div class="ub-row">
                    <div>
                        <label>Language</label>
                        <select id="ub-language">
                            ${languageOption('cht', 'cht (繁體)')}
                            ${languageOption('chs', 'chs (简体)')}
                            ${languageOption('eng', 'eng')}
                            ${languageOption('multi', 'multi')}
                        </select>
                    </div>
                    <div>
                        <label>Binding</label>
                        <input type="text" id="ub-binding" list="ub-binding-options" value="${escAttr(info.binding)}">
                        <datalist id="ub-binding-options">
                            <option value="paperback"><option value="hardcover"><option value="softcover">
                        </datalist>
                    </div>
                </div>
            </div>
            ${info.rows.map(([label, value]) => staticRow(label, value)).join('')}
            <div class="ub-inputs">
                <div class="ub-row">
                    <div>
                        <label>Cost ($)</label>
                        <input type="number" id="ub-cost" min="0" step="0.01" placeholder="e.g. 12.00">
                    </div>
                    <div>
                        <label>Price ($)</label>
                        <input type="number" id="ub-price" min="0" step="0.01" placeholder="USD selling price" value="${info.price ?? ''}">
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
        `);
        btn.addEventListener('click', () => sendBook(info, site, btn));
    }

    async function sendBook(info, site, btn) {
        if (!info.isbn) {
            setStatus('Could not determine ISBN for this page.', 'err');
            return;
        }

        const costVal = document.getElementById('ub-cost').value;
        const priceVal = document.getElementById('ub-price').value;
        const qtyVal = document.getElementById('ub-qty').value;
        const authorsVal = document.getElementById('ub-authors').value.trim();

        const body = {
            isbn: info.isbn,
            title: document.getElementById('ub-title').value.trim() || info.title,
            authors: authorsVal ? authorsVal.split(',').map(s => s.trim()).filter(Boolean) : info.authors,
            publisher: document.getElementById('ub-publisher').value.trim() || undefined,
            pub_date: info.pubDate,
            pages: info.pages || undefined,
            description: info.description || undefined,
            binding: document.getElementById('ub-binding').value.trim() || undefined,
            language: document.getElementById('ub-language').value || undefined,
            weight_g: info.weight_g || undefined,
            tags: info.tags && info.tags.length ? info.tags : undefined,
            active: document.getElementById('ub-active').checked,
        };
        if (costVal) body.cost = parseFloat(costVal);
        if (priceVal) body.price = parseFloat(priceVal);
        if (qtyVal && parseInt(qtyVal, 10) > 0) body.quantity = parseInt(qtyVal, 10);

        btn.disabled = true;
        if (site.coverViaBrowser) {
            btn.textContent = 'Fetching cover…';
            setStatus('Fetching cover image…', 'inf');
            body.cover_image_base64 = (await fetchImageAsDataUri(info.coverUrl)) || undefined;
        }
        if (!body.cover_image_base64) body.cover_image_url = info.coverUrl || undefined;

        btn.textContent = 'Sending…';
        setStatus('Contacting backend…', 'inf');

        const done = () => { btn.disabled = false; btn.textContent = 'Send to Shopify'; };
        postJson('/ShopifyCreateFromData', body, (res, data) => {
            done();
            if (res.status === 200 && !data.error) {
                setStatusLink(data.created ? 'Created!' : 'Updated existing product', data.shopify_url || '', 'ok');
            } else {
                setStatus(`Error: ${data.error || `HTTP ${res.status}`}`, 'err');
            }
        }, () => {
            done();
            setStatus('Network error. Check console.', 'err');
        });
    }

    // ══ Apriori Distribution (chocolate) → products/createNonBook ══════════
    //  - Title:        h1.product_title
    //  - Wholesale:    .wholesale_price_container .amount (fallback: "Wholesale Price:" info row)
    //  - Info rows:    .summary p.additional-info — "<b>Barcode:</b> 888...", "SKU", "Unit Size", "Suggested Retail"
    //  - Description:  the <p>s in .summary other than price / info rows
    //  - Images:       .woocommerce-product-gallery__image > a[href] (full-size originals)
    //  - Vendor:       first word of the title (editable in the panel)
    // Barcode is SKU and barcode; wholesale is cost; price defaults to floor(wholesale × 2) + 0.99.

    const APRIORI_PRODUCT_TYPE = 'Chocolate';

    /** Our default retail price: floor(wholesale × 2) + 0.99 */
    function aprioriDefaultPrice(wholesale) {
        return wholesale ? Math.floor(wholesale * 2) + 0.99 : null;
    }

    function parseAprioriInfoRows(summary) {
        const rows = {};
        summary.querySelectorAll('p.additional-info').forEach(p => {
            const b = p.querySelector('b');
            if (!b) return;
            const label = b.textContent.replace(/:\s*$/, '').trim();
            rows[label] = p.textContent.slice(b.textContent.length).trim();
        });
        return rows;
    }

    function parseAprioriDescription(summary) {
        // Description <p>s sit directly in .summary on most pages but are wrapped
        // in a div on others, so take <p>s at any depth. Skip the price block,
        // add-to-cart form, info rows, stock line, empty spacers, and the
        // distributor's own cross-sell line ("Check out our sampler…").
        const keep = p => {
            if (p.matches('.additional-info, .stock') || p.closest('.price, form')) return false;
            const text = p.textContent.replace(/\s+/g, ' ').trim();
            return text && !/check out our/i.test(text);
        };
        const paras = Array.from(summary.querySelectorAll('p')).filter(keep)
            .map(p => `<p>${p.innerHTML.trim()}</p>`);
        if (paras.length) return paras.join('\n');

        // Fallback: WooCommerce's standard short / long description blocks
        const block = document.querySelector(
            '.woocommerce-product-details__short-description, #tab-description, .woocommerce-Tabs-panel--description');
        return block ? block.innerHTML.trim() : '';
    }

    const apriori = {
        kind: 'nonbook',
        match: () => location.hostname === 'aprioridistribution.com',
        ready: () => !!document.querySelector('h1.product_title'),
        parse() {
            const summary = document.querySelector('.summary.entry-summary');
            const title = (document.querySelector('h1.product_title') || {}).textContent?.trim() || '';
            const info = summary ? parseAprioriInfoRows(summary) : {};

            const wholesaleEl = document.querySelector('.wholesale_price_container .amount');
            const wholesale = parseMoney(wholesaleEl ? wholesaleEl.textContent : info['Wholesale Price']);

            const images = [];
            document.querySelectorAll('.woocommerce-product-gallery__image > a[href]').forEach(a => {
                const href = a.getAttribute('href');
                if (href && !images.includes(href)) images.push(href);
            });

            let weightG = null;
            const unitMatch = (info['Unit Size'] || '').match(/([\d.]+)\s*g\b/i);
            if (unitMatch) weightG = parseFloat(unitMatch[1]);

            return {
                title,
                vendor: title.split(/\s+/)[0] || '',
                wholesale,
                barcode: (info['Barcode'] || '').replace(/\s/g, ''),
                supplierSku: info['SKU'] || '',
                msrp: parseMoney(info['Suggested Retail']),
                unitSize: info['Unit Size'] || '',
                caseSize: info['Case Size'] || '',
                weightG,
                description: summary ? parseAprioriDescription(summary) : '',
                images,
            };
        },
    };

    function buildNonBookPanel(info) {
        const price = aprioriDefaultPrice(info.wholesale);

        const btn = mountPanel(`
            <div class="ub-inputs">
                <label>Title</label>
                <input type="text" id="ub-title" value="${escAttr(info.title)}">
                <div class="ub-row">
                    <div>
                        <label>Vendor</label>
                        <input type="text" id="ub-vendor" value="${escAttr(info.vendor)}">
                    </div>
                    <div>
                        <label>Type</label>
                        <input type="text" id="ub-type" value="${escAttr(APRIORI_PRODUCT_TYPE)}">
                    </div>
                </div>
                <label>Barcode (also SKU)</label>
                <input type="text" id="ub-barcode" value="${escAttr(info.barcode)}">
            </div>
            ${staticRow('Supplier SKU', info.supplierSku)}
            ${staticRow('Unit / case', [info.unitSize, info.caseSize && `case of ${info.caseSize}`].filter(Boolean).join(', '))}
            ${staticRow('Suggested retail', info.msrp ? '$' + info.msrp.toFixed(2) : null)}
            <div class="ub-inputs">
                <div class="ub-row">
                    <div>
                        <label>Cost ($)</label>
                        <input type="number" id="ub-cost" min="0" step="0.01" value="${info.wholesale ?? ''}">
                    </div>
                    <div>
                        <label>Price ($)</label>
                        <input type="number" id="ub-price" min="0" step="0.01" value="${price ?? ''}">
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
                <label>Description (HTML)</label>
                <textarea id="ub-description">${escAttr(info.description)}</textarea>
                <label>Images (${info.images.length})</label>
                <div class="ub-thumbs">
                    ${info.images.map(u => `<img src="${escAttr(u)}" alt="">`).join('')}
                </div>
            </div>
            <div id="ub-status"></div>
        `);

        // Keep price in step with cost unless it has been edited by hand
        const costInput = document.getElementById('ub-cost');
        const priceInput = document.getElementById('ub-price');
        let priceEdited = false;
        priceInput.addEventListener('input', () => { priceEdited = true; });
        costInput.addEventListener('input', () => {
            if (priceEdited) return;
            const p = aprioriDefaultPrice(parseFloat(costInput.value));
            priceInput.value = p ?? '';
        });

        // First click creates; if the barcode already exists the button switches to
        // "Update existing product", which only fills in what that product is missing.
        btn.addEventListener('click', () => sendNonBook(info, btn, btn.dataset.mode === 'update'));

        if (!info.description) {
            setStatus('No description found on this page — paste one into the Description box before sending.', 'inf');
        }
    }

    async function sendNonBook(info, btn, updateExisting) {
        const title = document.getElementById('ub-title').value.trim();
        const vendor = document.getElementById('ub-vendor').value.trim();
        const productType = document.getElementById('ub-type').value.trim();
        const barcode = document.getElementById('ub-barcode').value.trim();
        const cost = parseFloat(document.getElementById('ub-cost').value);
        const price = parseFloat(document.getElementById('ub-price').value);
        const qty = parseInt(document.getElementById('ub-qty').value, 10);
        const active = document.getElementById('ub-active').checked;
        const description = document.getElementById('ub-description').value.trim();

        if (!title || !vendor) { setStatus('Title and vendor are required.', 'err'); return; }
        if (!barcode) { setStatus('Barcode is required.', 'err'); return; }
        if (!(price > 0)) { setStatus('Enter a selling price.', 'err'); return; }

        const variant = { sku: barcode, barcode, price };
        if (cost > 0) variant.cost = cost;
        if (qty > 0) variant.quantity = qty;
        if (info.weightG) variant.weight_g = info.weightG;

        const body = {
            title,
            vendor,
            product_type: productType,
            active,
            variants: [variant],
            description_html: description || undefined,
            default_variant: true,
            skip_if_exists: true,
            update_existing: updateExisting,
        };

        btn.disabled = true;
        btn.textContent = 'Fetching images…';
        setStatus(`Fetching ${info.images.length} image(s)…`, 'inf');

        const dataUris = await Promise.all(info.images.map(fetchImageAsDataUri));
        const fetched = info.images.map((url, i) => [url, dataUris[i]]).filter(([, d]) => d);
        body.images_base64 = fetched.map(([, d]) => d);
        // Original file names let the backend skip images an existing product already has
        body.image_filenames = fetched.map(([url]) => decodeURIComponent(url.split('?')[0].split('/').pop()));
        const missedImages = dataUris.length - fetched.length;

        btn.textContent = 'Sending…';
        setStatus('Contacting backend…', 'inf');

        const buttonLabel = () => btn.dataset.mode === 'update' ? 'Update existing product' : 'Send to Shopify';
        postJson('/products/createNonBook', body, (res, data) => {
            btn.textContent = buttonLabel();
            if (res.status === 200 && data.success) {
                const link = adminProductUrl(data.product_id);
                if (data.updated) {
                    const warnings = [...(data.warnings || [])];
                    if (missedImages) warnings.unshift(`${missedImages} image(s) couldn't be downloaded from the page`);
                    const changes = data.changes && data.changes.length ? data.changes.join(', ') : 'nothing was missing';
                    setStatusLink(`Updated "${data.title}": ${changes}.${warnings.length ? ' Warnings: ' + warnings.join('; ') + '.' : ''}`,
                        link, warnings.length ? 'inf' : 'ok');
                } else if (data.exists) {
                    btn.disabled = false;
                    btn.dataset.mode = 'update';
                    btn.textContent = buttonLabel();
                    setStatusLink(`Barcode ${barcode} is already in Shopify ("${data.title}"). ` +
                        'Click "Update existing product" to add missing images, and cost/description if empty ' +
                        '(price, title and vendor are left as they are).', link, 'inf');
                } else {
                    // Leave the button disabled so a second click can't create a duplicate
                    const warnings = [...(data.warnings || [])];
                    if (missedImages) warnings.unshift(`${missedImages} image(s) couldn't be downloaded from the page`);
                    setStatusLink(warnings.length ? `Created, with warnings: ${warnings.join('; ')}.` : 'Created!',
                        link, warnings.length ? 'inf' : 'ok');
                }
            } else {
                btn.disabled = false;
                setStatus(`Error: ${data.error || `HTTP ${res.status}`}`, 'err');
            }
        }, () => {
            btn.disabled = false;
            btn.textContent = buttonLabel();
            setStatus('Network error. Check console.', 'err');
        });
    }

    // ══ Init ═══════════════════════════════════════════════════════════════
    // Some pages render client-side (eslite is a Vue SPA whose URL changes
    // without a full reload; Amazon fills parts in late), so wait until the
    // site's product content is present, and rebuild the panel when the URL
    // changes to another product.

    const site = [amazon, bookstw, eslite, apriori].find(s => s.match());
    if (!site) return;

    let currentPanelUrl = null;

    function tryInit() {
        if (currentPanelUrl === location.href) return;
        if (!site.ready()) return;

        const existing = document.getElementById('ub-shopify-panel');
        if (existing) existing.remove();

        currentPanelUrl = location.href;
        const info = site.parse();
        if (site.kind === 'book') buildBookPanel(info, site);
        else buildNonBookPanel(info);
    }

    const observer = new MutationObserver(() => tryInit());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Also poll as a fallback in case mutations are too granular/batched
    const pollId = setInterval(tryInit, 500);
    setTimeout(() => clearInterval(pollId), 30000);

    tryInit();

})();
