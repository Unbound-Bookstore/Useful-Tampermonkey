# Useful Tampermonkey Scripts

A collection of Tampermonkey userscripts for bookstore operations — purchasing, inventory, and Shopify management.

---

## Scripts

### 1. `dd-taobao-po-v2.user.js` — Dangdang & Taobao Order to PO Table

Adds an export button to Dangdang and Taobao order detail pages. Extracts all line items and formats them as a purchase order.

**Matches:** `orderb.dangdang.com`, `main.dangdang.com`, `*.taobao.com`, `*.tmall.com`

**Features:**
- Extracts product name, variant name, quantity, unit price, and subtotal from both Dangdang and Taobao order pages
- Supports both old and new Taobao page structures
- Auto-extracts ISBN-13 from product titles when present
- Semi-automatic ISBN extraction: opens product pages one by one in a single window and auto-sends ISBN back to the parent
- Outputs **TSV** (paste directly into Google Sheets) with header row: `ISBN | 变体 | 标题 | 数量 | 单价 | 小计 | 标签 | 语言 | URL | 包裹号`
- Outputs **JSON** for API use, with separate `variant` and `productName` fields

**Usage:**
1. Navigate to a Dangdang or Taobao order detail page
2. Click the red **"导出订单"** button (fixed, top-right)
3. Review the item list, then copy TSV or JSON
4. For Taobao orders without ISBN in the title, use the **"半自动提取ISBN"** button to open each product page automatically

---

### 2. `Taobao-ISBN-Extractor.user.js` — ISBN Auto-Extractor

Runs on Taobao, Tmall, and Douban book pages. Extracts the ISBN and displays it as an overlay badge. When opened in semi-automatic mode by the PO script, it sends the ISBN back to the parent window and closes automatically.

**Matches:** `item.taobao.com/item.htm*`, `*.tmall.com/item.htm*`, `book.douban.com/subject/*`

**Features:**
- Supports three page layouts:
  - **Douban** (`#info > span.pl`) — standard book detail page
  - **Tmall/Taobao new layout** (`emphasisParamsInfoItem`) — emphasis params block where label is the subtitle
  - **Taobao old layout** (`generalParamsInfoItem`) — general params block
- Uses `[class*="prefix--"]` selectors to survive CSS-module hash changes across deploys
- In **manual mode**: shows a floating badge with the ISBN; click to copy
- In **semi-auto mode** (opened with `?_isbn_extract=1`): sends ISBN via `postMessage` to the opener, then closes after 3 seconds

**Usage (manual):**
1. Open any Taobao, Tmall, or Douban book product page
2. Wait ~3 seconds for the badge to appear (top-right corner)
3. Click the badge to copy the ISBN

**Usage (automatic):**
- Triggered automatically by `dd-taobao-po-v2.user.js` during semi-automatic extraction — no manual steps needed

---

### 3. `amazon_to_shopify.user.js` — Amazon Book → Shopify (Unbound)

Adds a sidebar panel to Amazon book product pages. Parses the page for book metadata and sends it to the Unbound backend to create or update a Shopify product.

**Matches:** `www.amazon.com/dp/*`, `www.amazon.com/gp/product/*`, `www.amazon.com/*/dp/*`

**Features:**
- Extracts: title, authors, publisher, publication date, pages, language, binding, weight, ISBN-13, cover image, description
- Converts ISBN-10 → ISBN-13 automatically
- Editable fields before submission: title, authors, publisher, language, binding, cost, price, quantity, active status
- POSTs to `https://unbound-backend.azurewebsites.net/api/ShopifyCreateFromData`
- Shows a success link to the created/updated Shopify product, or an error message

**Usage:**
1. Open any Amazon book product page (e.g. `amazon.com/dp/ASIN`)
2. A panel appears at the bottom-right
3. Review/edit the pre-filled fields
4. Optionally enter cost, price, quantity; check "Active" to publish immediately
5. Click **"Send to Shopify"**

---

### 4. `ingram_amazon_price_comp.user.js` — Ingram vs Amazon Price Checker

Enhances Ingram Content Group order/catalog pages by adding an **"Amazon Compare"** column that fetches the live Amazon price for each ISBN and flags titles where buying from Amazon is cheaper.

**Matches:** `*.ingramcontent.com/*`, `*.ingramipage.com/*`

**Features:**
- Reads the EAN/ISBN, SRP, and discount code from each row in the Ingram table
- Calculates Ingram net cost: `SRP × (1 - discount%)`; handles named discount codes (`REG`=40%, `SHORT`=20%, `NET`=0%)
- Fetches the Amazon listing price via `GM_xmlhttpRequest`
- Calculates sell-through margin: `(Amazon price - Ingram cost) / Amazon price`
- Color-codes margin: green ≥ 30%, orange ≥ 15%, red < 15%
- Highlights the entire row red and shows a **"BUY FROM AMAZON"** link when Amazon is cheaper than Ingram

**Usage:**
1. Navigate to an Ingram order or catalog page that shows a table with an EAN column
2. Wait ~2 seconds for the "Amazon Compare" column to populate
3. Red-highlighted rows indicate titles cheaper on Amazon — click the link to go directly to the Amazon listing

---

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click on each `.user.js` file in this repo and choose "Install" when Tampermonkey prompts you
3. Or open Tampermonkey Dashboard → "+" → paste the script content

## Notes

- `dd-taobao-po-v2.user.js` and `Taobao-ISBN-Extractor.user.js` work together — install both for full semi-automatic ISBN extraction on Taobao orders
- `amazon_to_shopify.user.js` requires access to the Unbound backend (`unbound-backend.azurewebsites.net`)
- `ingram_amazon_price_comp.user.js` requires Tampermonkey's `GM_xmlhttpRequest` permission to cross-origin fetch Amazon prices
