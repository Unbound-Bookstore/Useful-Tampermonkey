// ==UserScript==
// @name         Ingram vs Amazon Price Checker (ISBN)
// @namespace    https://unboundsf.co/
// @version      0.5
// @description  Highlight titles cheaper on Amazon than Ingram
// @match        https://*.ingramcontent.com/*
// @match        https://*.ingramipage.com/*
// @grant        GM_xmlhttpRequest
// @connect      www.amazon.com
// ==/UserScript==

(function () {
    'use strict';

    const AMAZON_SEARCH = isbn =>
        `https://www.amazon.com/s?k=${isbn}&i=stripbooks`;

    function parseMoney(text) {
        if (!text) return null;
        return parseFloat(text.replace(/[^0-9.]/g, ''));
    }

    function parseDiscount(text) {
        if (!text) return 0;

        const numMatch = text.match(/(\d+(\.\d+)?)\s*%/);
        if (numMatch) {
            return parseFloat(numMatch[1]) / 100;
        }

        const DISCOUNT_MAP = {
            'REG': 0.40,
            'SHORT': 0.20,
            'NET': 0.00
        };

        return DISCOUNT_MAP[text.trim()] ?? 0;
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

    function getAmazonPrice(isbn, callback) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: AMAZON_SEARCH(isbn),
            onload: resp => {
                const doc = new DOMParser()
                    .parseFromString(resp.responseText, 'text/html');

                const priceEl =
                    doc.querySelector('.a-price .a-offscreen') ||
                    doc.querySelector('.a-price-whole');

                callback(priceEl ? parseMoney(priceEl.textContent) : null);
            },
            onerror: () => callback(null)
        });
    }

    function findTargetTable() {
        const headerCells = document.querySelectorAll('td.columnHeader');
        for (const cell of headerCells) {
            if (cell.innerText.includes('EAN')) {
                return cell.closest('table');
            }
        }
        return null;
    }

    function enhanceTable() {
        const table = findTargetTable();
        if (!table) return;

        const rows = table.querySelectorAll('tr');
        if (!rows.length) return;

        const headerRow = rows[0];
        if (!headerRow.innerText.includes('Amazon Compare')) {
            const th = document.createElement('td');
            th.className = 'columnHeader';
            th.innerText = 'Amazon Compare';
            headerRow.appendChild(th);
        }

        rows.forEach((row, idx) => {
            if (idx === 0) return;

            const cells = row.querySelectorAll('td');
            if (cells.length < 10) return;

            const isbnCell = cells[1];
            const discCell = cells[8];
            const srpCell = cells[9];

            if (!isbnCell || !discCell || !srpCell) return;

            const isbn13 = isbnCell.innerText.trim().split('\n')[0];
            if (!/^\d{13}$/.test(isbn13)) return;

            const srp = parseMoney(srpCell.innerText);
            if (!srp) return;

            const discount = parseDiscount(discCell.innerText.trim());
            const ingramCost = srp * (1 - discount);

            const isbn10 = isbn13to10(isbn13);
            const amazonUrl = isbn10
                ? `https://www.amazon.com/dp/${isbn10}`
                : AMAZON_SEARCH(isbn13);

            const resultCell = document.createElement('td');
            resultCell.innerHTML = '<span style="color:gray">Checking…</span>';
            row.appendChild(resultCell);

            getAmazonPrice(isbn13, amazonPrice => {
                if (!amazonPrice) {
                    resultCell.innerHTML =
                        '<span style="color:gray">No Amazon price</span>';
                    return;
                }

                const margin =
                    ((amazonPrice - ingramCost) / amazonPrice) * 100;

                const buyFromAmazon = amazonPrice < ingramCost;

                if (buyFromAmazon) {
                    row.style.backgroundColor = '#ffe6e6';
                    row.style.borderLeft = '5px solid #cc0000';
                }

                let color = 'red';
                if (margin >= 30) color = 'green';
                else if (margin >= 15) color = 'orange';

                resultCell.innerHTML = `
                    <div style="font-size:12px; color:${color}">
                        Amazon: $${amazonPrice.toFixed(2)}<br>
                        Ingram: $${ingramCost.toFixed(2)}<br>
                        Margin: ${margin.toFixed(1)}%<br>
                        ${
                            buyFromAmazon
                                ? `<a href="${amazonUrl}" target="_blank"
                                     style="color:#cc0000;font-weight:bold;text-decoration:underline">
                                     BUY FROM AMAZON
                                   </a>`
                                : ''
                        }
                    </div>
                `;
            });
        });
    }

    setTimeout(enhanceTable, 2000);
})();
