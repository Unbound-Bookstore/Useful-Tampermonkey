// ==UserScript==
// @name         Dangdang & Taobao Order to PO Table
// @namespace    http://tampermonkey.net/dd-taobao-po-v2
// @version      2.3
// @description  Convert Dangdang and Taobao order pages to PO table format
// @connect      *
// @run-at       document-start
// @author       You
// @match        https://orderb.dangdang.com/myorder/order_detail_module.php*
// @match        https://orderb.dangdang.com/orderDetail*
// @match        https://main.dangdang.com/orderDetail*
// @match        https://*.dangdang.com/orderDetail*
// @match        https://*.taobao.com/*
// @match        *://*.tmall.com/*
// @match        https://buyertrade.taobao.com/*
// @match        https://trade.taobao.com/*
// @match        https://*.1688.com/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      unbound-backend.azurewebsites.net
// @run-at document-start
// ==/UserScript==

(function() {
    'use strict';

    // Detect platform
    const PLATFORM = {
        DANGDANG: 'dangdang',
        TAOBAO: 'taobao',
        ALI1688: '1688'
    };
// ========== SEMI-AUTOMATIC EXTRACTION VARIABLES ==========
let isbnExtractionQueue = [];
let currentQueueIndex = 0;
let extractedISBNs = {};
let openedWindows = [];

    function getCurrentPlatform() {
        const hostname = window.location.hostname;
        if (hostname.includes('dangdang.com')) {
            return PLATFORM.DANGDANG;
        } else if (hostname.includes('taobao.com')) {
            return PLATFORM.TAOBAO;
        } else if (hostname.includes('1688.com')) {
            return PLATFORM.ALI1688;
        }
        return null;
    }

    // Add custom styles for the export button
    GM_addStyle(`
        #dd-export-btn {
            position: fixed;
            top: 150px;
            right: 20px;
            z-index: 9999;
            padding: 12px 24px;
            background-color: #ff2832;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        #dd-export-btn:hover {
            background-color: #e02028;
        }
        #dd-export-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            min-width: 500px;
            max-width: 90vw;
            max-height: 90vh;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }
        #dd-export-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 9999;
        }
        .modal-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 20px;
            color: #333;
        }
        .modal-content {
            margin-bottom: 20px;
        }
        .modal-textarea {
            width: 100%;
            height: 150px;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-family: monospace;
            font-size: 12px;
            resize: vertical;
        }
        .modal-buttons {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }
        .modal-btn {
            padding: 8px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .modal-btn-primary {
            background-color: #ff2832;
            color: white;
        }
        .modal-btn-secondary {
            background-color: #f0f0f0;
            color: #333;
        }
        .modal-btn:hover {
            opacity: 0.9;
        }
        .order-info-display {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 15px;
            font-size: 13px;
        }
        .order-info-display div {
            margin-bottom: 5px;
        }
        .platform-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: bold;
            margin-left: 8px;
        }
        .platform-dangdang {
            background-color: #ff2832;
            color: white;
        }
        .platform-taobao {
            background-color: #ff6600;
            color: white;
        }
    `);

    // ========== DANGDANG EXTRACTION ==========
    function extractDangdangOrderData() {
        const orderData = {
            platform: PLATFORM.DANGDANG,
            orderNumber: '',
            packageNumber: '',
            packages: [],
            items: []
        };

        // Extract order number
        const orderIdElement = document.querySelector('.order-id span:last-child');
        if (orderIdElement) {
            orderData.orderNumber = orderIdElement.textContent.trim();
        }

        // Try to extract package number from visible tab
        const packageTabs = document.querySelectorAll('.package-tabs .tab');
        const hasMultiplePackages = packageTabs.length > 0;

        if (hasMultiplePackages) {
            const allPackageNumbers = [];
            document.querySelectorAll('.receiver-info .item').forEach(item => {
                const labelSpan = item.querySelector('.item__label');
                if (labelSpan && labelSpan.textContent.includes('包裹号')) {
                    const valueSpan = item.querySelector('.item__text');
                    if (valueSpan) {
                        allPackageNumbers.push(valueSpan.textContent.trim());
                    }
                }
            });
            orderData.packageNumber = allPackageNumbers.join(', ');
        } else {
            const packageNumberItems = document.querySelectorAll('.receiver-info .item');
            packageNumberItems.forEach(item => {
                const labelSpan = item.querySelector('.item__label');
                if (labelSpan && labelSpan.textContent.includes('包裹号')) {
                    const valueSpan = item.querySelector('.item__text');
                    if (valueSpan) {
                        orderData.packageNumber = valueSpan.textContent.trim();
                    }
                }
            });
        }

        // Extract product information from the table
        const productRows = document.querySelectorAll('.ant-table-tbody tr.ant-table-row');
// FINAL CORRECT FIX - Handles both table structures
// Table WITHOUT 包件: 商品名称 | 当当价 | 数量 | 银铃铛 | 优惠 | 小计 | 操作
// Table WITH 包件:    包件 | 商品名称 | 当当价 | 数量 | 银铃铛 | 优惠 | 小计 | 操作

// Replace the productRows.forEach section in extractDangdangOrderData():

productRows.forEach(row => {
    // Skip gift items (赠品)
    const isGift = row.querySelector('.pro-tag');
    if (isGift && isGift.textContent.includes('赠品')) return;

    const productNameLink = row.querySelector('.pro-name');
    const cells = row.querySelectorAll('td');

    if (!productNameLink || cells.length < 6) return;

    // Detect if this row has a package column (包件)
    // Check if first cell has colspan="1" rowspan="1" and contains "包件"
    const hasPackageColumn = cells[0].hasAttribute('colspan') &&
                             cells[0].hasAttribute('rowspan') &&
                             cells[0].textContent.includes('包件');

    // Determine cell indices based on table structure
    let nameIndex, priceIndex, quantityIndex, pointIndex, discountIndex, subtotalIndex;

    if (hasPackageColumn) {
        // Table with 包件 column: [包件, 商品名称, 当当价, 数量, 银铃铛, 优惠, 小计, 操作]
        nameIndex = 1;
        priceIndex = 2;
        quantityIndex = 3;
        pointIndex = 4;
        discountIndex = 5;
        subtotalIndex = 6;
    } else {
        // Table without 包件 column: [商品名称, 当当价, 数量, 银铃铛, 优惠, 小计, 操作]
        nameIndex = 0;
        priceIndex = 1;
        quantityIndex = 2;
        pointIndex = 3;
        discountIndex = 4;
        subtotalIndex = 5;
    }

    const productName = productNameLink.textContent.trim();
    const productUrl = productNameLink.href;

    // Extract package name if present
    const packageName = hasPackageColumn ? cells[0].textContent.trim() : '';

    // Extract 当当价 (Dangdang listed price)
    const dangdangPriceText = cells[priceIndex].textContent.trim();
    const dangdangPriceMatch = dangdangPriceText.match(/￥([\d.]+)/);
    const dangdangPrice = dangdangPriceMatch ? parseFloat(dangdangPriceMatch[1]) : 0;

    // Extract 数量 (Quantity)
    const quantity = parseInt(cells[quantityIndex].textContent.trim());

    // Extract 优惠 (Per-unit discount)
    const discountText = cells[discountIndex].textContent.trim();
    let perUnitDiscount = 0;
    if (discountText !== '-') {
        const discountMatch = discountText.match(/([\d.]+)/);
        perUnitDiscount = discountMatch ? parseFloat(discountMatch[1]) : 0;
    }

    // Extract 小计 (Subtotal)
    const subtotalText = cells[subtotalIndex].textContent.trim();
    const subtotalMatch = subtotalText.match(/￥([\d.]+)/);
    const subtotal = subtotalMatch ? parseFloat(subtotalMatch[1]) : 0;

    // Calculate actual unit price = 当当价 - 优惠
    const actualUnitPrice = dangdangPrice - perUnitDiscount;

    // Verify calculation
    const calculatedTotal = (actualUnitPrice * quantity).toFixed(2);
    const actualTotal = subtotal.toFixed(2);
    const matches = calculatedTotal === actualTotal;

    // Debug logging
    console.log(`${matches ? '✓' : '⚠️'} ${productName.substring(0, 40)}...`);
    if (packageName) console.log(`  包件: ${packageName}`);
    console.log(`  当当价: ¥${dangdangPrice.toFixed(2)}`);
    console.log(`  优惠: ¥${perUnitDiscount.toFixed(2)}/本`);
    console.log(`  实付单价: ¥${actualUnitPrice.toFixed(2)}`);
    console.log(`  数量: ${quantity}`);
    console.log(`  小计: ¥${actualTotal} ${matches ? '✓' : `(计算值: ¥${calculatedTotal})`}`);

    orderData.items.push({
        name: productName,
        url: productUrl,
        quantity: quantity.toString(),
        dangdangPrice: dangdangPrice.toFixed(2),
        discount: perUnitDiscount.toFixed(2),
        unitPrice: actualUnitPrice.toFixed(2),  // Real unit price: 当当价 - 优惠
        subtotal: subtotal.toFixed(2),
        packageName: packageName,
        isbn: ''
    });
});
        return orderData;
    }

// ========== TAOBAO EXTRACTION ==========
    // UPDATED TAOBAO EXTRACTION for new page structure (2024+)
// New structure shows: actual price, original price (strikethrough), quantity

function extractTaobaoOrderData() {
    const orderData = {
        platform: PLATFORM.TAOBAO,
        orderNumber: '',
        packageNumber: '',
        sellerName: '',
        items: []
    };

    // The page may list multiple orders — iterate each order container separately
    // so each item gets the correct orderNumber and sellerName.
    const orderContainers = document.querySelectorAll('[id^="shopOrderContainer_"]');

    if (orderContainers.length > 0) {
        console.log(`Found ${orderContainers.length} order containers (NEW structure)`);

        orderContainers.forEach(container => {
            // Extract order number from this container
            let orderNumber = '';
            const orderIdElem = container.querySelector('[class*="shopInfoOrderId--"]');
            if (orderIdElem) {
                const m = orderIdElem.textContent.match(/订单号[:：]?\s*(\d{10,})/);
                if (m) orderNumber = m[1];
            }

            // Extract seller name from this container
            let sellerName = '';
            const sellerLink = container.querySelector('[data-spm="order_shopname"] a') ||
                               container.querySelector('[class*="shopInfoName--"]');
            if (sellerLink) sellerName = sellerLink.textContent.trim();

            console.log(`Order ${orderNumber} | Seller: ${sellerName}`);

            // Set on orderData for single-order pages (last one wins, but items carry their own)
            if (orderNumber) orderData.orderNumber = orderNumber;
            if (sellerName) orderData.sellerName = sellerName;

            // Scope to the orderDetailCol_ sub-container to exclude recommendation sections
            // (which also live inside shopOrderContainer_ but contain unrelated products)
            const orderDetailCol = container.querySelector('[id^="orderDetailCol_"]');
            const searchRoot = orderDetailCol || container;

            // Match only the top-level item row (class starts with "itemInfo--" but NOT "itemInfoCol")
            const allInfoElems = searchRoot.querySelectorAll('[class*="itemInfo--"]');
            const itemRows = Array.from(allInfoElems).filter(el =>
                Array.from(el.classList).some(c => /^itemInfo--/.test(c) && !/^itemInfoCol/.test(c))
            );
            itemRows.forEach(row => {
                const productLink = row.querySelector('[class*="title--"]');
                if (!productLink) return;
                const productNameElem = productLink.querySelector('[class*="titleText--"]');
                if (!productNameElem) return;

                const productName = productNameElem.textContent.trim();
                const productUrl = productLink.href;

                // Thumbnail
                let thumbnail = '';
                const imgAnchor = row.querySelector('a[style*="background-image"]');
                if (imgAnchor) {
                    const bgMatch = (imgAnchor.style.backgroundImage || '').match(/url\(["']?(\/\/[^"')]+)["']?\)/);
                    if (bgMatch) thumbnail = 'https:' + bgMatch[1];
                }

                // Variant: first infoContent only when 2+ exist
                const infoElems = row.querySelectorAll('[class*="infoContent--"]');
                const variant = infoElems.length >= 2 ? infoElems[0].textContent.trim() : '';

                console.log("FOUND PRODUCT:", productName, productUrl, variant ? `[variant: ${variant}]` : '');

                // Price
                const priceContainer = row.querySelector('[class*="itemInfoColPrice--"]');
                if (!priceContainer) { console.log("SKIP ROW — no price container"); return; }

                const priceWraps = priceContainer.querySelectorAll('[class*="priceWrap--"]');
                let unitPrice = 0;
                if (priceWraps[0]) {
                    const int_ = priceWraps[0].querySelector('.trade-price-integer');
                    const dec_ = priceWraps[0].querySelector('.trade-price-decimal');
                    unitPrice = parseFloat(`${int_ ? int_.textContent.trim() : '0'}.${dec_ ? dec_.textContent.trim() : '00'}`);
                }

                const quantityElem = priceContainer.querySelector('[class*="quantity--"]');
                let quantity = 1;
                if (quantityElem) {
                    const qm = quantityElem.textContent.match(/x(\d+)/);
                    if (qm) quantity = parseInt(qm[1]);
                }

                const subtotal = unitPrice * quantity;

                let isbnFromTitle = extractISBNFromText(productName) ||
                                    extractISBNFromText(row.innerText || row.textContent);

                console.log(`  单价: ¥${unitPrice.toFixed(2)}, 数量: ${quantity}, 小计: ¥${subtotal.toFixed(2)}`);

                orderData.items.push({
                    name: productName,
                    variant: variant,
                    url: productUrl,
                    quantity: quantity.toString(),
                    unitPrice: unitPrice.toFixed(2),
                    subtotal: subtotal.toFixed(2),
                    packageName: '',
                    isbn: isbnFromTitle || '',
                    thumbnail: thumbnail,
                    orderNumber: orderNumber,
                    sellerName: sellerName,
                });
            });
        });
    } else {
        // Fallback to OLD structure
        console.log("Using OLD Taobao structure");
        itemRows = document.querySelectorAll('.bought-wrapper-mod__trade-order___2lrzV tbody tr');

        itemRows.forEach(row => {
            const links = Array.from(row.querySelectorAll("a"));

            // Step 1: find any item.taobao.com link
            let productLink = links.find(a => a.href.includes("item.taobao.com"));

            // Step 2: find the one with actual product name (non-empty innerText)
            let productNameLink = links.find(a =>
                a.href.includes("item.taobao.com") &&
                a.innerText.trim().length > 0
            );

            // Prefer productNameLink if it exists
            if (productNameLink) {
                productLink = productNameLink;
            }

            // === IMPORTANT: skip invalid rows ===
            if (!productLink) {
                console.log("SKIP ROW — no product link found");
                return;
            }
            const productName = productLink?.innerText.trim().replace(/\s+/g, " ");
            const productUrl = productLink?.href;

            console.log("FOUND PRODUCT:", productName, productUrl);

            // Extract price - look for the price cell
            const priceCell = row.querySelector('.price-mod__price___3Un7c p');
            let unitPrice = '';
            if (priceCell) {
                const priceText = priceCell.textContent.trim();
                const priceMatch = priceText.match(/￥([\d.]+)/);
                unitPrice = priceMatch ? priceMatch[1] : '';
            }

            // Extract quantity - usually in the third column
            const quantityCell = row.querySelector('td:nth-child(3) p');
            const quantity = quantityCell ? quantityCell.textContent.trim() : '1';

            // Extract subtotal - look for the strong price in actual payment column
            const subtotalCell = row.querySelector('td:nth-child(5) .price-mod__price___3Un7c strong');
            let subtotal = '';
            if (subtotalCell) {
                const subtotalText = subtotalCell.textContent.trim();
                const subtotalMatch = subtotalText.match(/￥([\d.]+)/);
                subtotal = subtotalMatch ? subtotalMatch[1] : '';
            }

            // If no subtotal found, calculate it
            if (!subtotal && unitPrice && quantity) {
                subtotal = (parseFloat(unitPrice) * parseInt(quantity)).toFixed(2);
            }

            // ========== PRESERVE ISBN LOGIC ==========
            let isbnFromTitle = null;

            // 1. Try product name first
            isbnFromTitle = extractISBNFromText(productName);

            // 2. If not found, try the entire row text
            if (!isbnFromTitle) {
                const rowText = row.innerText || row.textContent;
                isbnFromTitle = extractISBNFromText(rowText);
            }

            // DEBUG: Log what we're setting
            console.log(`  ISBN extracted: "${isbnFromTitle}"`);

            orderData.items.push({
                name: productName,
                url: productUrl,
                quantity: quantity,
                unitPrice: unitPrice,
                subtotal: subtotal,
                packageName: '',
                isbn: isbnFromTitle || '' // Pre-fill ISBN if found in title
            });
        });
    }

    return orderData;
}

// ========== NEW FUNCTION: Extract ISBN from text ==========
// ========== IMPROVED ISBN EXTRACTION FROM TEXT ==========
function extractISBNFromText(text) {
    if (!text) return null;

    // Clean the text first - remove extra spaces
    text = text.replace(/\s+/g, ' ');

    // ISBN patterns - order matters, try most specific first
    const patterns = [
        // Pattern 1: ISBN: followed by 13 digits (with optional spaces/dashes)
        /ISBN[:\s]*(\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d)/gi,

        // Pattern 2: ISBN: followed by 10 digits (with optional spaces/dashes)
        /ISBN[:\s]*(\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d)/gi,

        // Pattern 3: 书号 followed by 13 digits
        /书号[:\s]*(\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d)/g,

        // Pattern 4: Standalone 13-digit number starting with 978 or 979
        /(?:^|[^\d])(97[89]\d{10})(?:[^\d]|$)/g,

        // Pattern 5: Just look for ISBN followed by any digits
        /ISBN[:\s\-–—]*(\d+)/gi,
    ];

    for (const pattern of patterns) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
            // Get the captured group (the ISBN digits)
            let isbn = match[1];
            if (!isbn) continue;

            // Remove all non-digit characters
            isbn = isbn.replace(/\D/g, '');

            // Check if it's valid length
            if (isbn.length === 13 || isbn.length === 10) {
                console.log(`✓ Found ISBN in text: "${isbn}" from "${text.substring(0, 100)}..."`);
                return isbn;
            }
        }
    }

    console.log(`✗ No ISBN found in text: "${text.substring(0, 100)}..."`);
    return null;
}

function extractISBNFromTaobaoHTML(html) {
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  if (!scripts) return '';

  for (const script of scripts) {
    // Common ISBN patterns
    const m = script.match(/97[89][-\s]?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?\d/);
    if (m) return m[0].replace(/[\s-]/g, '');
  }
  return '';
}

    // ========== TAOBAO ISBN EXTRACTION ==========

// ========== 1688 EXTRACTION ==========

// Recursively query all shadow roots to pierce shadow DOM
function shadowQueryAll(root, selector) {
    const results = [];
    try {
        results.push(...Array.from(root.querySelectorAll(selector)));
        root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) results.push(...shadowQueryAll(el.shadowRoot, selector));
        });
    } catch(e) {}
    return results;
}

function extract1688OrderData() {
    const orderData = {
        platform: PLATFORM.ALI1688,
        orderNumber: '',
        packageNumber: '',
        sellerName: '',
        items: []
    };

    // Clean lit-html comment artifacts from element text
    function cleanText(el) {
        if (!el) return '';
        return el.textContent.replace(/<!--\?lit\$[^>]*-->/g, '').replace(/<!--[^>]*-->/g, '').trim();
    }

    // All content lives in shadow DOM — use shadowQueryAll to pierce it
    // order-item-entry-product is the custom element; its content is in its own shadow root
    const productWCs = shadowQueryAll(document, 'order-item-entry-product');
    console.log(`1688 extract: found ${productWCs.length} product entries (shadow DOM)`);

    productWCs.forEach(wc => {
        // Content lives inside this custom element's shadow root
        const entry = wc.shadowRoot ? wc.shadowRoot.querySelector('.order-item-entry-product') || wc.shadowRoot : wc;

        // Product name: .product-name anchor inside shadow root
        const nameEl = entry.querySelector('.product-name');
        if (!nameEl) return;
        const productName = cleanText(nameEl);
        if (!productName) return;
        const productUrl = nameEl.href || '';

        // Thumbnail: img inside .product-img anchor
        let thumbnail = '';
        const imgEl = entry.querySelector('.product-img img') || entry.querySelector('img');
        if (imgEl) {
            thumbnail = imgEl.src || imgEl.dataset.src || '';
            // Strip alicdn size suffix (e.g. _160x160.jpg_.webp) to get the base image URL
            thumbnail = thumbnail.replace(/_\d+x\d+.*$/i, '');
        }

        // Variant from .sku-info-item spans inside shadow root
        const skuItems = entry.querySelectorAll('.sku-info-item');
        const variant = Array.from(skuItems).map(s => cleanText(s)).filter(Boolean).join(' ').trim();

        // Price and quantity are in sibling custom elements with their own shadow roots
        // wc is the light-DOM <order-item-entry-product> element — use it to find siblings
        const entryRow = wc.closest('.order-item-entry') || wc.parentElement;
        let unitPrice = '';
        let quantity = '1';

        if (entryRow) {
            const priceWC = entryRow.querySelector('order-item-entry-unit-price');
            if (priceWC && priceWC.shadowRoot) {
                const priceEl = priceWC.shadowRoot.querySelector('.actual-unit-price');
                if (priceEl) {
                    const pm = cleanText(priceEl).match(/([\d.]+)/);
                    if (pm) unitPrice = pm[1];
                }
            }

            const qtyWC = entryRow.querySelector('order-item-entry-quantity-service-status');
            if (qtyWC && qtyWC.shadowRoot) {
                const qtyEl = qtyWC.shadowRoot.querySelector('.quantity-amount');
                if (qtyEl) {
                    const qm = cleanText(qtyEl).match(/(\d+)/);
                    if (qm) quantity = qm[1];
                }
            }
        }

        const subtotal = (unitPrice && quantity)
            ? (parseFloat(unitPrice) * parseInt(quantity)).toFixed(2)
            : '';

        // Order number and seller from sibling .order-item-header
        // wc is in light DOM so .closest() works up the real DOM tree
        let sellerName = '';
        let orderNumber = '';
        const itemContent = wc.closest('.order-item-content');
        const container = itemContent ? itemContent.parentElement : wc.closest('.order-list-item');
        if (container) {
            const header = container.querySelector('.order-item-header');
            if (header) {
                const copyEl = header.querySelector('copy-to-clipboard');
                if (copyEl) {
                    const attr = copyEl.getAttribute('text') || cleanText(copyEl);
                    const m = attr.match(/(\d{15,})/);
                    if (m) orderNumber = m[1];
                }
                const sellerEl = header.querySelector('.supplier-name') ||
                                 header.querySelector('[class*="shop-name"]') ||
                                 header.querySelector('[class*="company"]');
                if (sellerEl) sellerName = cleanText(sellerEl);
            }
        }

        if (!orderData.orderNumber && orderNumber) orderData.orderNumber = orderNumber;
        if (!orderData.sellerName && sellerName) orderData.sellerName = sellerName;

        const isbnFromTitle = extractISBNFromText(productName);
        console.log(`1688 item: "${productName}" | qty:${quantity} price:${unitPrice} | img:${thumbnail ? '✓' : '✗'}`);

        orderData.items.push({
            name: productName,
            variant: variant,
            url: productUrl,
            quantity: quantity,
            unitPrice: unitPrice,
            subtotal: subtotal,
            packageName: '',
            isbn: isbnFromTitle || '',
            thumbnail: thumbnail,
            orderNumber: orderNumber,
            sellerName: sellerName,
        });
    });

    return orderData;
}

    // ========== MAIN EXTRACTION ROUTER ==========
    function extractOrderData() {
        const platform = getCurrentPlatform();
        if (platform === PLATFORM.DANGDANG) {
            return extractDangdangOrderData();
        } else if (platform === PLATFORM.TAOBAO) {
            return extractTaobaoOrderData();
        } else if (platform === PLATFORM.ALI1688) {
            return extract1688OrderData();
        }
        return null;
    }

    // ========== ISBN FETCHING ==========
async function fetchISBNs(orderData, updateCallback) {
    const platform = orderData.platform;

    for (let i = 0; i < orderData.items.length; i++) {
        const item = orderData.items[i];

        try {  // <-- ADD THIS
            if (updateCallback) {
                updateCallback(i + 1, orderData.items.length, item.name);
            }

            if (platform === PLATFORM.DANGDANG) {
                // Dangdang API
                const apiEndpoint = 'https://unbound-backend.azurewebsites.net/api/ScrapeDangdang';
                const data = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: `${apiEndpoint}?url=${encodeURIComponent(item.url)}`,
                        onload: function(response) {
                            if (response.status === 200) {
                                try {
                                    const jsonData = JSON.parse(response.responseText);
                                    resolve(jsonData);
                                } catch (e) {
                                    reject(new Error('Failed to parse JSON'));
                                }
                            } else {
                                reject(new Error(`HTTP ${response.status}`));  // <-- FIX: Changed Error` to Error(`
                            }
                        },
                        onerror: function(error) {
                            reject(new Error('Network error'));
                        },
                        ontimeout: function() {
                            reject(new Error('Timeout'));
                        },
                        timeout: 10000
                    });
                });

                item.isbn = data.isbn || '';
                if (data.title && data.title !== item.name) {
                    item.apiTitle = data.title;
                }
            } else if (platform === PLATFORM.TAOBAO) {
                // Skip automatic fetching - use semi-automatic extraction instead
                if (!item.isbn) {
                    console.log(`⚠️  ${item.name.substring(0, 40)}... - needs semi-automatic extraction`);  // <-- FIX: Changed console.log` to console.log(`
                }
                // Don't try to fetch - will be handled by semi-automatic extraction
            }
        } catch (error) {  // <-- ADD THIS
            console.error(`Failed to fetch ISBN for ${item.url}:`, error);
            item.isbn = 'ERROR';
        }  // <-- ADD THIS
    }

    return orderData;
}    function formatForGoogleSheets(orderData) {
        // Header row
        let output = `ISBN\t变体\t标题\t数量\t单价\t小计\t缩图\t标签\t语言\tURL\t包裹号\t订单号\t卖家\n`;

        orderData.items.forEach(item => {
            const thumbCell = item.thumbnail ? `=IMAGE("${item.thumbnail}")` : '';
            // Per-item orderNumber/sellerName (multi-order page); fall back to orderData-level for Dangdang
            const itemOrderNumber = item.orderNumber || orderData.orderNumber || '';
            const itemSellerName = item.sellerName || orderData.sellerName || '';
            output += `${item.isbn}\t${item.variant || ''}\t${item.name}\t${item.quantity}\t${item.unitPrice}\t${item.subtotal}\t${thumbCell}\t\t\t${item.url}\t${orderData.packageNumber || ''}\t${itemOrderNumber}\t${itemSellerName}\n`;
        });

        return output;
    }

    function createDataForAPI(orderData) {
        const apiData = orderData.items.map(item => {
            return {
                isbn: item.isbn,
                url: item.url,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                subtotal: item.subtotal,
                variant: item.variant || '',
                thumbnail: item.thumbnail || '',
                productName: item.name,
                packageNumber: orderData.packageNumber || '',
                orderNumber: item.orderNumber || orderData.orderNumber || '',
                sellerName: item.sellerName || orderData.sellerName || '',
                platform: orderData.platform
            };
        });

        return apiData;
    }

    async function showModal(orderData, isRefresh = false) {
        showLoadingModal(orderData);
        await fetchISBNs(orderData, updateLoadingProgress);
        hideLoadingModal();
        showResultsModal(orderData);
    }

    function updateLoadingProgress(current, total, itemName) {
        const progressText = document.getElementById('loading-progress-text');
        const progressBar = document.getElementById('loading-progress-bar');
        const progressItem = document.getElementById('loading-current-item');

        if (progressText) {
            progressText.textContent = `正在处理: ${current} / ${total}`;
        }
        if (progressBar) {
            const percentage = (current / total) * 100;
            progressBar.style.width = percentage + '%';
        }
        if (progressItem) {
            progressItem.textContent = itemName.length > 50 ? itemName.substring(0, 50) + '...' : itemName;
        }
    }

    function showLoadingModal(orderData) {
        const overlay = document.createElement('div');
        overlay.id = 'dd-export-overlay';

        const modal = document.createElement('div');
        modal.id = 'dd-export-modal';

        const platformBadge = orderData.platform === PLATFORM.DANGDANG
            ? '<span class="platform-badge platform-dangdang">当当</span>'
            : orderData.platform === PLATFORM.ALI1688
            ? '<span class="platform-badge platform-taobao" style="background:#e8491d">1688</span>'
            : '<span class="platform-badge platform-taobao">淘宝</span>';

        modal.innerHTML = `
            <div class="modal-title">正在获取ISBN信息...${platformBadge}</div>
            <div class="order-info-display">
                <div><strong>订单号:</strong> ${orderData.orderNumber}</div>
                ${orderData.packageNumber ? `<div><strong>包裹号:</strong> ${orderData.packageNumber}</div>` : ''}
                ${orderData.sellerName ? `<div><strong>卖家:</strong> ${orderData.sellerName}</div>` : ''}
                <div><strong>商品数量:</strong> ${orderData.items.length}</div>
            </div>
            <div style="text-align: center; padding: 30px;">
                <div style="font-size: 14px; color: #666; margin-bottom: 10px;" id="loading-progress-text">正在准备...</div>
                <div style="width: 100%; height: 20px; background: #f0f0f0; border-radius: 10px; overflow: hidden; margin-bottom: 15px;">
                    <div id="loading-progress-bar" style="height: 100%; background: linear-gradient(90deg, #ff2832, #ff5842); width: 0%; transition: width 0.3s;"></div>
                </div>
                <div style="font-size: 12px; color: #999;" id="loading-current-item">
                    ${(orderData.platform === PLATFORM.TAOBAO || orderData.platform === PLATFORM.ALI1688) ? '淘宝/1688 ISBN获取功能不稳定，小心使用' : '正在从API获取ISBN信息，请稍候...'}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(modal);
    }

    function hideLoadingModal() {
        const modal = document.getElementById('dd-export-modal');
        const overlay = document.getElementById('dd-export-overlay');
        if (modal) document.body.removeChild(modal);
        if (overlay) document.body.removeChild(overlay);
    }

    function showResultsModal(orderData) {
        const overlay = document.createElement('div');
        overlay.id = 'dd-export-overlay';

        const modal = document.createElement('div');
        modal.id = 'dd-export-modal';

        const tsvData = formatForGoogleSheets(orderData);
        const jsonData = JSON.stringify(createDataForAPI(orderData), null, 2);

        const errorCount = orderData.items.filter(item => item.isbn === 'ERROR').length;
        const missingCount = orderData.items.filter(item => !item.isbn || item.isbn === '').length;
        const successCount = orderData.items.filter(item => item.isbn && item.isbn !== 'ERROR').length;

        let itemsList = '';
        orderData.items.forEach((item, index) => {
            const isbnStatus = item.isbn === 'ERROR' ? '❌ 获取失败' : (item.isbn ? `✅ ${item.isbn}` : '⚠️ 未找到');
            const statusColor = item.isbn === 'ERROR' ? '#f5222d' : (item.isbn ? '#52c41a' : '#faad14');
            const packageInfo = item.packageName ? `<span style="color: #999; font-size: 11px;">[${item.packageName}]</span> ` : '';
            const variantTag = item.variant ? `<span style="color: #1890ff; font-size: 11px; margin-right: 4px;">[${item.variant}]</span>` : '';
            const thumbHtml = item.thumbnail ? `<img src="${item.thumbnail}" style="width:44px;height:44px;object-fit:cover;border-radius:3px;flex-shrink:0;margin-right:8px;" onerror="this.style.display='none'">` : '';
            itemsList += `<div style="padding: 8px; border-bottom: 1px solid #eee; background: ${index % 2 === 0 ? '#fff' : '#fafafa'};">
                <div style="display: flex; align-items: center;">
                    ${thumbHtml}
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: bold; font-size: 13px;">${packageInfo}${index + 1}. ${variantTag}${item.name}</div>
                        <div style="font-size: 11px; color: #999; margin-top: 2px;">数量: ${item.quantity} | 单价: ¥${item.unitPrice} | 小计: ¥${item.subtotal}</div>
                    </div>
                    <div style="font-size: 12px; color: ${statusColor}; white-space: nowrap; margin-left: 10px;">
                        ${isbnStatus}
                    </div>
                </div>
            </div>`;
        });

        let summaryHtml = '';
        if (errorCount > 0 || missingCount > 0) {
            summaryHtml = `<div style="background: #fff7e6; border: 1px solid #ffd591; border-radius: 4px; padding: 10px; margin-bottom: 15px;">
                <div style="font-weight: bold; color: #fa8c16; margin-bottom: 5px;">📊 获取结果统计</div>
                <div style="font-size: 12px; color: #666;">
                    成功: ${successCount} | 失败: ${errorCount} | 未找到: ${missingCount}
                </div>
                ${errorCount > 0 && orderData.platform === PLATFORM.DANGDANG ? '<div style="font-size: 11px; color: #f5222d; margin-top: 5px;">⚠️ 有失败项目，可以点击"🔄 重新获取失败项"按钮重试</div>' : ''}
                ${orderData.platform === PLATFORM.TAOBAO ? '<div style="font-size: 11px; color: #1890ff; margin-top: 5px;">ℹ️ 淘宝ISBN获取功能不稳定，小心使用</div>' : ''}
            </div>`;
        }

        const platformBadge = orderData.platform === PLATFORM.DANGDANG
            ? '<span class="platform-badge platform-dangdang">当当</span>'
            : '<span class="platform-badge platform-taobao">淘宝</span>';

        modal.innerHTML = `
            <div class="modal-title">导出订单数据${platformBadge}</div>
            <div class="order-info-display">
                <div><strong>订单号:</strong> ${orderData.orderNumber}</div>
                ${orderData.packageNumber ? `<div><strong>包裹号:</strong> ${orderData.packageNumber}</div>` : ''}
                ${orderData.sellerName ? `<div><strong>卖家:</strong> ${orderData.sellerName}</div>` : ''}
                <div><strong>商品数量:</strong> ${orderData.items.length}</div>
                <div><strong>总金额:</strong> ￥${orderData.items.reduce((sum, item) => sum + parseFloat(item.subtotal || 0), 0).toFixed(2)}</div>
            </div>
            ${summaryHtml}
            <div style="max-height: 200px; overflow-y: auto; margin-bottom: 15px; border: 1px solid #e8e8e8; border-radius: 4px;">
                ${itemsList}
            </div>
            <div class="modal-content">
                <div style="margin-bottom: 10px; font-weight: bold;">方式1: 复制到Google Sheets (TSV格式)</div>
                <textarea class="modal-textarea" id="tsv-output" readonly>${tsvData}</textarea>
            </div>
            <div class="modal-content">
                <div style="margin-bottom: 10px; font-weight: bold;">方式2: JSON格式 (用于API)</div>
                <textarea class="modal-textarea" id="json-output" readonly>${jsonData}</textarea>
            </div>

          <div class="modal-buttons">
    ${orderData.platform === PLATFORM.TAOBAO && missingCount > 0 ? '<button class="modal-btn modal-btn-secondary" id="semi-auto-btn">🤖 半自动提取ISBN</button>' : ''}
    ${errorCount > 0 && orderData.platform === PLATFORM.DANGDANG ? '<button class="modal-btn modal-btn-secondary" id="retry-failed-btn">🔄 重新获取失败项</button>' : ''}
    ${orderData.platform === PLATFORM.DANGDANG ? '<button class="modal-btn modal-btn-secondary" id="retry-all-btn">🔄 全部重新获取</button>' : ''}
    <button class="modal-btn modal-btn-secondary" id="copy-tsv-btn">复制TSV格式</button>
    <button class="modal-btn modal-btn-secondary" id="copy-json-btn">复制JSON格式</button>
                <button class="modal-btn modal-btn-primary" id="close-modal-btn">关闭</button>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        document.getElementById('close-modal-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
            document.body.removeChild(overlay);
        });

        document.getElementById('copy-tsv-btn').addEventListener('click', () => {
            GM_setClipboard(tsvData);
            alert('TSV格式已复制到剪贴板！\n\n可以直接粘贴到Google Sheets的"书单"工作表中。\n格式包含: ISBN, 商品名称, 数量, 单价, 小计, 标签, 语言, URL, 包裹号');
        });

        document.getElementById('copy-json-btn').addEventListener('click', () => {
            GM_setClipboard(jsonData);
            alert('JSON格式已复制到剪贴板！');
        });

        if (errorCount > 0 && orderData.platform === PLATFORM.DANGDANG) {
            document.getElementById('retry-failed-btn').addEventListener('click', async () => {
                document.body.removeChild(modal);
                document.body.removeChild(overlay);

                const failedOrderData = {
                    orderNumber: orderData.orderNumber,
                    packageNumber: orderData.packageNumber,
                    platform: orderData.platform,
                    items: orderData.items.filter(item => item.isbn === 'ERROR')
                };

                showLoadingModal(orderData);
                await fetchISBNs(failedOrderData, updateLoadingProgress);

                failedOrderData.items.forEach(retriedItem => {
                    const originalItem = orderData.items.find(item => item.url === retriedItem.url);
                    if (originalItem) {
                        originalItem.isbn = retriedItem.isbn;
                    }
                });

                hideLoadingModal();
                showResultsModal(orderData);
            });
        }

        if (orderData.platform === PLATFORM.DANGDANG) {
            document.getElementById('retry-all-btn').addEventListener('click', async () => {
                document.body.removeChild(modal);
                document.body.removeChild(overlay);

                orderData.items.forEach(item => {
                    item.isbn = '';
                });

                await showModal(orderData, true);
            });
        }
// Add semi-automatic extraction button handler for Taobao
if (orderData.platform === PLATFORM.TAOBAO) {
    const semiAutoBtn = document.getElementById('semi-auto-btn');
    if (semiAutoBtn) {
        semiAutoBtn.addEventListener('click', () => {
            // Store orderData globally so we can access it after extraction
            window.currentOrderData = orderData;

            document.body.removeChild(modal);
            document.body.removeChild(overlay);
            startSemiAutomaticExtraction(orderData);
        });
    }
}
        overlay.addEventListener('click', () => {
            document.body.removeChild(modal);
            document.body.removeChild(overlay);
        });
    }
// ========== SEMI-AUTOMATIC TAOBAO ISBN EXTRACTION (SINGLE WINDOW) ==========

function startSemiAutomaticExtraction(orderData) {
    // Only queue items WITHOUT ISBN
    isbnExtractionQueue = orderData.items
        .map((item, index) => ({
            index: index,
            url: item.url,
            name: item.name,
            hasISBN: !!item.isbn
        }))
        .filter(item => !item.hasISBN);

    currentQueueIndex = 0;
    extractedISBNs = {};

    const alreadyHasISBN = orderData.items.filter(item => item.isbn).length;

    if (isbnExtractionQueue.length === 0) {
        alert(`✓ 所有商品都已从标题中提取到ISBN！\n\n已找到 ${alreadyHasISBN} 个ISBN，无需打开商品页面。`);
        return;
    }

    // Show extraction modal
    showExtractionProgressModal(orderData, alreadyHasISBN);

    // Open first product in a SINGLE new window
    openNextInSingleWindow();
}

let singleExtractionWindow = null;
let extractionTimeout = null;

function openNextInSingleWindow() {
    if (currentQueueIndex >= isbnExtractionQueue.length) {
        // All done!
        if (singleExtractionWindow && !singleExtractionWindow.closed) {
            singleExtractionWindow.close();
        }
        completeExtraction();
        return;
    }

    const current = isbnExtractionQueue[currentQueueIndex];

    // Update progress
    updateExtractionProgress(currentQueueIndex + 1, isbnExtractionQueue.length, current.name);

    const extractUrl = current.url + '&_isbn_extract=1';

    // First time: open new window
    if (!singleExtractionWindow || singleExtractionWindow.closed) {
        singleExtractionWindow = window.open(extractUrl, 'isbn_extractor');

        if (!singleExtractionWindow) {
            alert('⚠️ 浏览器阻止了弹出窗口！\n\n请在浏览器地址栏右侧点击"允许弹出窗口"，然后重新点击"半自动提取ISBN"按钮。');
            const modal = document.getElementById('extraction-modal');
            const overlay = document.getElementById('extraction-overlay');
            if (modal) document.body.removeChild(modal);
            if (overlay) document.body.removeChild(overlay);
            return;
        }
    } else {
        // Reuse existing window
        singleExtractionWindow.location.href = extractUrl;
    }

    // Set a flag to track if we received the ISBN
    window.waitingForISBN = true;
    window.currentExtractionUrl = current.url;

    // Safety timeout - move to next after 10 seconds even if no response
    extractionTimeout = setTimeout(() => {
        if (window.waitingForISBN) {
            console.log('⚠️ Timeout waiting for ISBN from:', current.url);
            window.waitingForISBN = false;
            currentQueueIndex++;
            openNextInSingleWindow();
        }
    }, 10000); // 10 second timeout
}

function onISBNReceived() {
    // Clear the timeout
    if (extractionTimeout) {
        clearTimeout(extractionTimeout);
        extractionTimeout = null;
    }

    // Mark as received
    window.waitingForISBN = false;

    // Move to next item after a short delay
    currentQueueIndex++;
    setTimeout(() => {
        openNextInSingleWindow();
    }, 1000); // 1 second delay before moving to next
}

    function showExtractionProgressModal(orderData, alreadyExtracted = 0) {
    const overlay = document.createElement('div');
    overlay.id = 'extraction-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 999998;';

    const modal = document.createElement('div');
    modal.id = 'extraction-modal';
    modal.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 30px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 999999;
        min-width: 500px;
    `;

    const totalItems = orderData.items.length;
    const needsExtraction = isbnExtractionQueue.length;

    modal.innerHTML = `
        <div style="font-size: 18px; font-weight: bold; margin-bottom: 20px; color: #333;">
            🤖 正在批量提取ISBN
        </div>
        ${alreadyExtracted > 0 ? `
        <div style="background: #f6ffed; border: 1px solid #b7eb8f; border-radius: 6px; padding: 12px; margin-bottom: 15px;">
            <div style="font-size: 13px; color: #52c41a;">
                ✓ <strong>已从标题提取:</strong> ${alreadyExtracted} / ${totalItems}<br>
                <span style="font-size: 12px; opacity: 0.8;">这些商品无需打开页面</span>
            </div>
        </div>
        ` : ''}
        <div style="background: #f5f5f5; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
            <div style="margin-bottom: 10px;">
                <strong>需要访问页面:</strong> <span id="extraction-progress">0 / ${needsExtraction}</span>
            </div>
            <div style="width: 100%; height: 20px; background: #e8e8e8; border-radius: 10px; overflow: hidden;">
                <div id="extraction-bar" style="height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); width: 0%; transition: width 0.3s;"></div>
            </div>
            <div style="margin-top: 10px; font-size: 12px; color: #666;">
                当前: <span id="extraction-current">准备中...</span>
            </div>
        </div>
        <div style="background: #fff7e6; border: 1px solid #ffd591; border-radius: 6px; padding: 12px; margin-bottom: 15px;">
            <div style="font-size: 13px; color: #fa8c16;">
                ⚠️ <strong>说明:</strong><br>
                • 脚本会在一个窗口中依次打开商品页面<br>
                • 请不要关闭弹出的窗口<br>
                • ISBN会自动提取并填充<br>
                • 完成后窗口会自动关闭
            </div>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
            <button id="cancel-extraction-btn" style="padding: 8px 20px; background: #f0f0f0; border: none; border-radius: 4px; cursor: pointer;">取消</button>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    document.getElementById('cancel-extraction-btn').addEventListener('click', () => {
        isbnExtractionQueue = [];
        if (singleExtractionWindow && !singleExtractionWindow.closed) {
            singleExtractionWindow.close();
        }
        document.body.removeChild(modal);
        document.body.removeChild(overlay);
    });
}

function updateExtractionProgress(current, total, itemName) {
    const progressText = document.getElementById('extraction-progress');
    const progressBar = document.getElementById('extraction-bar');
    const currentItem = document.getElementById('extraction-current');

    if (progressText) {
        progressText.textContent = `${current} / ${total}`;
    }
    if (progressBar) {
        const percentage = (current / total) * 100;
        progressBar.style.width = percentage + '%';
    }
    if (currentItem) {
        currentItem.textContent = itemName.length > 60 ? itemName.substring(0, 60) + '...' : itemName;
    }
}

function completeExtraction() {
    // Merge extracted ISBNs back into orderData
    const globalOrderData = window.currentOrderData;
    if (globalOrderData) {
        globalOrderData.items.forEach(item => {
            // Extract item ID from URL (works for both taobao and tmall)
            const itemIdMatch = item.url.match(/[?&]id=(\d+)/);
            const itemId = itemIdMatch ? itemIdMatch[1] : null;

            if (itemId) {
                // Find matching extracted ISBN by item ID
                Object.keys(extractedISBNs).forEach(extractedUrl => {
                    if (extractedUrl.includes(`id=${itemId}`)) {
                        item.isbn = extractedISBNs[extractedUrl];
                        console.log(`✓ Matched ISBN ${item.isbn} for item ID ${itemId}`);
                    }
                });
            }
        });
    }

    const totalItems = globalOrderData ? globalOrderData.items.length : 0;
    const successCount = globalOrderData ? globalOrderData.items.filter(item => item.isbn && item.isbn !== 'ERROR').length : Object.keys(extractedISBNs).length;
    const missingCount = globalOrderData ? globalOrderData.items.filter(item => !item.isbn || item.isbn === '').length : 0;

    const modal = document.getElementById('extraction-modal');
    if (modal) {
        modal.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <div style="font-size: 48px; margin-bottom: 20px;">✓</div>
                <div style="font-size: 18px; font-weight: bold; color: #52c41a; margin-bottom: 20px;">
                    提取完成!
                </div>
                <div style="font-size: 14px; color: #666; margin-bottom: 20px;">
                    总计: ${totalItems} 个商品<br>
                    成功: ${successCount} 个<br>
                    ${missingCount > 0 ? `未找到: ${missingCount} 个` : ''}
                </div>
                <button id="close-extraction-btn" style="padding: 10px 30px; background: #52c41a; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    查看结果
                </button>
            </div>
        `;

        document.getElementById('close-extraction-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
            const overlay = document.getElementById('extraction-overlay');
            if (overlay) document.body.removeChild(overlay);

            // Show the results modal with updated data
            if (globalOrderData) {
                showResultsModal(globalOrderData);
            }
        });
    }
}

// Listen for ISBN data from product pages
window.addEventListener('message', function(event) {
    if (event.data.type === 'TAOBAO_ISBN_FOUND') {
        const { isbn } = event.data;
        // Store using the original URL we opened so completeExtraction() can match by id=
        const key = window.currentExtractionUrl || event.data.url;
        extractedISBNs[key] = isbn;
        console.log('✓ Received ISBN:', isbn, 'for', key);

        // Also write directly into the item now, before completeExtraction() runs,
        // in case URL matching fails later (e.g. Taobao rewrites the URL)
        if (window.currentOrderData && key) {
            const idMatch = key.match(/[?&]id=(\d+)/);
            if (idMatch) {
                const targetId = idMatch[1];
                window.currentOrderData.items.forEach(item => {
                    const itemIdMatch = item.url.match(/[?&]id=(\d+)/);
                    if (itemIdMatch && itemIdMatch[1] === targetId) {
                        item.isbn = isbn;
                        console.log('✓ Directly wrote ISBN', isbn, 'to item id=', targetId);
                    }
                });
            }
        }

        // Trigger next extraction
        if (window.waitingForISBN) {
            onISBNReceived();
        }
    }
});

    function addExportButton() {
        const platform = getCurrentPlatform();
        if (!platform) return;

        const button = document.createElement('button');
        button.id = 'dd-export-btn';
        button.textContent = platform === PLATFORM.DANGDANG ? '📋 导出订单 (当当)' : platform === PLATFORM.ALI1688 ? '📋 导出订单 (1688)' : '📋 导出订单 (淘宝)';
        button.addEventListener('click', async () => {
            let orderData = extractOrderData();
            // For 1688, shadow DOM components render lazily — retry until prices are populated too
            if (getCurrentPlatform() === PLATFORM.ALI1688) {
                const hasPrice = () => {
                    const priceWC = shadowQueryAll(document, 'order-item-entry-unit-price')[0];
                    return priceWC && priceWC.shadowRoot && priceWC.shadowRoot.querySelector('.actual-unit-price');
                };
                if (!orderData || orderData.items.length === 0 || !hasPrice()) {
                    button.textContent = '⏳ 加载中...';
                    for (let i = 0; i < 8; i++) {
                        await new Promise(r => setTimeout(r, 600));
                        if (hasPrice()) break;
                    }
                    orderData = extractOrderData();
                    button.textContent = '📋 导出订单 (1688)';
                }
            }
            if (!orderData || orderData.items.length === 0) {
                alert('未找到订单数据！请确保页面已完全加载。\n\n调试信息已输出到控制台，请按F12查看。');
                return;
            }
            await showModal(orderData);
        });
        document.body.appendChild(button);
    }

    // Wait for the page to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addExportButton);
    } else {
        addExportButton();
    }

    // Instructions in console
    const platform = getCurrentPlatform();
    if (platform === PLATFORM.DANGDANG) {
        console.log('%c当当订单导出脚本已加载', 'color: #ff2832; font-size: 16px; font-weight: bold;');
    } else if (platform === PLATFORM.TAOBAO) {
        console.log('%c淘宝订单导出脚本已加载', 'color: #ff6600; font-size: 16px; font-weight: bold;');
    }
    console.log('%c点击右侧的"📋 导出订单"按钮来导出订单数据', 'color: #333; font-size: 12px;');
    console.log('%c使用说明:', 'color: #333; font-size: 12px; font-weight: bold;');
    console.log('1. TSV格式: 可以直接粘贴到Google Sheets');
    console.log('2. JSON格式: 包含完整的URL和数据，可用于API调用');
    if (platform === PLATFORM.TAOBAO) {
        console.log('%c注意: 淘宝ISBN获取功能不稳定，小心使用', 'color: #ff6600; font-size: 12px;');
    }
})();
