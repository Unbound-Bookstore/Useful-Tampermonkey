// ==UserScript==
// @name         Taobao ISBN Auto-Extractor
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Auto-extract ISBN and send to parent window
// @match        https://item.taobao.com/item.htm*
// @match        https://detail.tmall.com/item.htm*
// @match        https://*.tmall.com/item.htm*
// @match        https://book.douban.com/subject/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // Check if this is an auto-extraction request
    const urlParams = new URLSearchParams(window.location.search);
    const isAutoExtract = urlParams.has('_isbn_extract');

    GM_addStyle(`
        #isbn-box {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 999999;
            padding: 15px 20px;
            border-radius: 10px;
            font-size: 14px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            min-width: 200px;
        }
        .isbn-found {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .isbn-notfound {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
        }
        .auto-extract-mode {
            border: 3px solid #52c41a;
        }
    `);

    function extractISBN() {
        // Strategy 0: Douban book page — <span class="pl">ISBN:</span> followed by text node
        const infoDiv = document.getElementById('info');
        if (infoDiv) {
            const plSpans = infoDiv.querySelectorAll('span.pl');
            for (const span of plSpans) {
                if (span.textContent.includes('ISBN')) {
                    // ISBN value is the next text node after the span
                    let node = span.nextSibling;
                    while (node) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            const isbn = node.textContent.trim().replace(/[\s\-–—]/g, '');
                            if (/^\d{10}$|^\d{13}$/.test(isbn)) {
                                return isbn;
                            }
                        }
                        node = node.nextSibling;
                    }
                }
            }
        }

        // Strategy 1: emphasis params section (新版 — label is subtitle, value is title)
        // <emphasisParamsInfoItemTitle> = value, <emphasisParamsInfoItemSubTitle> = label
        const emphasisItems = document.querySelectorAll('[class*="emphasisParamsInfoItem--"]');
        for (const item of emphasisItems) {
            const valueElem = item.querySelector('[class*="emphasisParamsInfoItemTitle--"]');
            const labelElem = item.querySelector('[class*="emphasisParamsInfoItemSubTitle--"]');
            if (valueElem && labelElem) {
                const label = labelElem.textContent.trim();
                if (label.includes('ISBN') || label.includes('书号')) {
                    const isbn = (valueElem.getAttribute('title') || valueElem.textContent).trim().replace(/[\s\-–—]/g, '');
                    if (/^\d{10}$|^\d{13}$/.test(isbn)) {
                        return isbn;
                    }
                }
            }
        }

        // Strategy 2: general params section (旧版 — label is title, value is subtitle)
        const items = document.querySelectorAll('[class*="generalParamsInfoItem--"]');
        for (const item of items) {
            const labelElem = item.querySelector('[class*="generalParamsInfoItemTitle--"]');
            const valueElem = item.querySelector('[class*="generalParamsInfoItemSubTitle--"]');
            if (labelElem && valueElem) {
                const label = labelElem.textContent.trim();
                if (label.includes('ISBN') || label.includes('书号')) {
                    const isbn = valueElem.textContent.trim().replace(/[\s\-–—]/g, '');
                    if (/^\d{10}$|^\d{13}$/.test(isbn)) {
                        return isbn;
                    }
                }
            }
        }

        return null;
    }

    function showBox(isbn, isAuto) {
        const box = document.createElement('div');
        box.id = 'isbn-box';
        box.className = isbn ? 'isbn-found' : 'isbn-notfound';

        if (isAuto) {
            box.classList.add('auto-extract-mode');
        }

        if (isbn) {
            box.innerHTML = `
                <div style="text-align: center;">
                    ${isAuto ? '<div style="font-size: 11px; opacity: 0.9; margin-bottom: 5px;">🤖 自动提取模式</div>' : ''}
                    <div style="font-size: 12px; opacity: 0.85;">📚 ISBN</div>
                    <div style="font-size: 20px; font-weight: bold; margin: 8px 0; font-family: monospace;">${isbn}</div>
                    ${isAuto ? '<div style="font-size: 11px; opacity: 0.8;">已发送到主窗口 · 3秒后关闭</div>' : '<div style="font-size: 11px; opacity: 0.8;">点击复制</div>'}
                </div>
            `;

            if (!isAuto) {
                box.style.cursor = 'pointer';
                box.onclick = () => {
                    GM_setClipboard(isbn);
                    const orig = box.innerHTML;
                    box.innerHTML = '<div style="text-align: center;">✓ 已复制!</div>';
                    setTimeout(() => box.innerHTML = orig, 1500);
                };
            } else {
                // Auto-close after 3 seconds in auto mode
                setTimeout(() => {
                    window.close();
                }, 3000);
            }
        } else {
            box.innerHTML = `
                <div style="text-align: center;">
                    <div style="font-size: 24px;">❌</div>
                    <div style="font-size: 13px; margin-top: 5px;">未找到ISBN</div>
                    ${isAuto ? '<div style="font-size: 11px; opacity: 0.8; margin-top: 5px;">3秒后自动关闭</div>' : ''}
                </div>
            `;

            if (isAuto) {
                setTimeout(() => {
                    window.close();
                }, 3000);
            }
        }

        document.body.appendChild(box);
    }

    // Wait for page load
    setTimeout(() => {
        const isbn = extractISBN();

        // If auto-extract mode, send ISBN to opener
        if (isAutoExtract && window.opener) {
            if (isbn) {
                window.opener.postMessage({
                    type: 'TAOBAO_ISBN_FOUND',
                    url: window.location.href.split('&_isbn_extract')[0],
                    isbn: isbn
                }, '*');
            }
            showBox(isbn, true);
        } else {
            showBox(isbn, false);
        }

        console.log(isbn ? '✓ ISBN: ' + isbn : '✗ No ISBN found');
    }, 3000);

})();
