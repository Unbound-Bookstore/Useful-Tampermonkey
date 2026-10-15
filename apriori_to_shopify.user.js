// ==UserScript==
// @name         Apriori Distribution → Shopify (Unbound)
// @namespace    https://unbound-backend.azurewebsites.net/
// @version      1.3
// @description  Parse an aprioridistribution.com product page and create a Shopify chocolate product via Unbound backend
// @author       Unbound
// @match        https://aprioridistribution.com/product/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      unbound-backend.azurewebsites.net
// @connect      aprioridistribution.com
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'https://unbound-backend.azurewebsites.net/api';
    const SHOPIFY_ADMIN = 'https://admin.shopify.com/store/ff058f-a3';
    const PRODUCT_TYPE = 'Chocolate';

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

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Parse a price string like "$8.99" to a number */
    function parsePrice(s) {
        if (!s) return null;
        const m = String(s).match(/[\d,]+\.?\d*/);
        return m ? parseFloat(m[0].replace(/,/g, '')) : null;
    }

    /** Our default retail price: floor(wholesale × 2) + 0.99 */
    function defaultPrice(wholesale) {
        return wholesale ? Math.floor(wholesale * 2) + 0.99 : null;
    }

    const escAttr = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    // ── Parse aprioridistribution.com page (WooCommerce) ─────────────────────
    //  - Title:        h1.product_title
    //  - Wholesale:    .wholesale_price_container .amount (fallback: "Wholesale Price:" info row)
    //  - Info rows:    .summary p.additional-info — "<b>Barcode:</b> 888...", "SKU", "Unit Size", "Suggested Retail"
    //  - Description:  the plain <p>s in .summary between the price and the info rows
    //  - Images:       .woocommerce-product-gallery__image > a[href] (full-size originals)
    //  - Vendor:       first word of the title (editable in the panel)

    function parseInfoRows(summary) {
        const rows = {};
        summary.querySelectorAll('p.additional-info').forEach(p => {
            const b = p.querySelector('b');
            if (!b) return;
            const label = b.textContent.replace(/:\s*$/, '').trim();
            rows[label] = p.textContent.slice(b.textContent.length).trim();
        });
        return rows;
    }

    function parseDescription(summary) {
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

    function parsePage() {
        const summary = document.querySelector('.summary.entry-summary');
        const title = (document.querySelector('h1.product_title') || {}).textContent?.trim() || '';
        const info = summary ? parseInfoRows(summary) : {};

        const wholesaleEl = document.querySelector('.wholesale_price_container .amount');
        const wholesale = parsePrice(wholesaleEl ? wholesaleEl.textContent : info['Wholesale Price']);

        const barcode = (info['Barcode'] || '').replace(/\s/g, '');

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
            barcode,
            supplierSku: info['SKU'] || '',
            msrp: parsePrice(info['Suggested Retail']),
            unitSize: info['Unit Size'] || '',
            caseSize: info['Case Size'] || '',
            weightG,
            description: summary ? parseDescription(summary) : '',
            images,
        };
    }

    // ── UI ────────────────────────────────────────────────────────────────

    function buildPanel(info) {
        const panel = document.createElement('div');
        panel.id = 'ub-shopify-panel';

        const card = document.createElement('div');
        card.id = 'ub-shopify-card';

        const staticRow = (label, value) => value
            ? `<div class="ub-field"><label>${label}</label><span title="${escAttr(value)}">${escAttr(value)}</span></div>`
            : '';

        const price = defaultPrice(info.wholesale);

        card.innerHTML = `
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
                        <input type="text" id="ub-type" value="${escAttr(PRODUCT_TYPE)}">
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
        `;

        const btn = document.createElement('button');
        btn.id = 'ub-shopify-btn';
        btn.textContent = 'Send to Shopify';

        panel.appendChild(card);
        panel.appendChild(btn);
        document.body.appendChild(panel);

        // Keep price in step with cost unless it has been edited by hand
        const costInput = document.getElementById('ub-cost');
        const priceInput = document.getElementById('ub-price');
        let priceEdited = false;
        priceInput.addEventListener('input', () => { priceEdited = true; });
        costInput.addEventListener('input', () => {
            if (priceEdited) return;
            const p = defaultPrice(parseFloat(costInput.value));
            priceInput.value = p ?? '';
        });

        // First click creates; if the barcode already exists the button switches to
        // "Update existing product", which only fills in what that product is missing.
        btn.addEventListener('click', () => sendToShopify(info, btn, btn.dataset.mode === 'update'));

        if (!info.description) {
            setStatus('No description found on this page — paste one into the Description box before sending.', 'inf');
        }
    }

    function setStatus(msg, type) {
        const el = document.getElementById('ub-status');
        if (!el) return;
        el.textContent = msg;
        el.className = type;
    }

    function setStatusLink(label, productGid, type) {
        const el = document.getElementById('ub-status');
        if (!el) return;
        const id = String(productGid || '').split('/').pop();
        el.innerHTML = id
            ? `${label} <a class="ub-shopify-link" href="${SHOPIFY_ADMIN}/products/${id}" target="_blank">View in Shopify</a>`
            : label;
        el.className = type;
    }

    // ── Image fetch ──────────────────────────────────────────────────────
    // aprioridistribution.com sits behind Cloudflare, which 403s Shopify's own
    // server-side image download. GM_xmlhttpRequest runs as the real browser,
    // so fetch the bytes here and send them as data URIs; the backend
    // staged-uploads them into Shopify.
    function fetchImageAsDataUri(url) {
        return new Promise((resolve) => {
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

    // ── API call ─────────────────────────────────────────────────────────

    async function sendToShopify(info, btn, updateExisting) {
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

        GM_xmlhttpRequest({
            method: 'POST',
            url: `${API_BASE}/products/createNonBook`,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify(body),
            onload(res) {
                btn.textContent = btn.dataset.mode === 'update' ? 'Update existing product' : 'Send to Shopify';
                let data;
                try { data = JSON.parse(res.responseText); } catch (e) { data = {}; }

                if (res.status === 200 && data.success) {
                    if (data.updated) {
                        const warnings = [...(data.warnings || [])];
                        if (missedImages) warnings.unshift(`${missedImages} image(s) couldn't be downloaded from the page`);
                        const changes = data.changes && data.changes.length ? data.changes.join(', ') : 'nothing was missing';
                        setStatusLink(`Updated "${data.title}": ${changes}.${warnings.length ? ' Warnings: ' + warnings.join('; ') + '.' : ''}`,
                            data.product_id, warnings.length ? 'inf' : 'ok');
                    } else if (data.exists) {
                        btn.disabled = false;
                        btn.dataset.mode = 'update';
                        btn.textContent = 'Update existing product';
                        setStatusLink(`Barcode ${barcode} is already in Shopify ("${data.title}"). ` +
                            'Click "Update existing product" to add missing images, and cost/description if empty ' +
                            '(price, title and vendor are left as they are).', data.product_id, 'inf');
                    } else {
                        // Leave the button disabled so a second click can't create a duplicate
                        const warnings = [...(data.warnings || [])];
                        if (missedImages) warnings.unshift(`${missedImages} image(s) couldn't be downloaded from the page`);
                        setStatusLink(warnings.length ? `Created, with warnings: ${warnings.join('; ')}.` : 'Created!',
                            data.product_id, warnings.length ? 'inf' : 'ok');
                    }
                } else {
                    btn.disabled = false;
                    setStatus(`Error: ${data.error || `HTTP ${res.status}`}`, 'err');
                }
            },
            onerror() {
                btn.disabled = false;
                btn.textContent = btn.dataset.mode === 'update' ? 'Update existing product' : 'Send to Shopify';
                setStatus('Network error. Check console.', 'err');
            }
        });
    }

    // ── Init ─────────────────────────────────────────────────────────────
    // Plain server-rendered WooCommerce page — the product summary is in the
    // initial HTML, so build the panel once the DOM is ready.

    function init() {
        if (!document.querySelector('h1.product_title')) return;
        buildPanel(parsePage());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
