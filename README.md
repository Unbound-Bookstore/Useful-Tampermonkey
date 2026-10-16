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

### 3. `to_shopify.user.js` — Product Page → Shopify (Unbound)

One script that adds a "Send to Shopify" panel to supplier and bookstore product pages, parses the page, and creates or updates the Shopify product via the Unbound backend. Replaces `amazon_to_shopify`, `bookstw_to_shopify`, `eslite_to_shopify` and `apriori_to_shopify`.

**Matches:** `www.amazon.com/dp/*` (and `/gp/product/*`, `/*/dp/*`), `www.books.com.tw/products/*`, `www.eslite.com/product/*`, `aprioridistribution.com/product/*`

**Books — Amazon, books.com.tw, eslite** → `POST /api/ShopifyCreateFromData`
- Extracts ISBN-13, title, author(s), publisher, publication date, pages, binding, language, description, cover image, plus per-site extras: weight (Amazon, eslite), dimensions / translator / list price in NT$ (books.com.tw, eslite), category tags (books.com.tw, eslite), USD price (Amazon, prefilled)
- Editable before sending: title, authors, publisher, language, binding, cost, price, quantity, active status
- eslite covers are fetched in the browser and sent as data (its image CDN blocks server-side downloads)
- Creates the product or updates the existing one with the same ISBN; shows a link to it in Shopify

**Chocolate — Apriori Distribution (WooCommerce)** → `POST /api/products/createNonBook`
- Extracts title, barcode, wholesale price, suggested retail, unit/case size, description, all gallery images (full size)
- Vendor defaults to the first word of the title; product type `Chocolate`; barcode is both SKU and barcode; wholesale is cost; price defaults to `floor(wholesale × 2) + 0.99` (recalculated when cost is edited, unless price was edited by hand)
- Description skips the price/info rows and the distributor's "Check out our sampler" line, and is editable; a warning shows if none is found
- Images are fetched in the browser (the site blocks server-side downloads) and uploaded to Shopify
- Creates a single-variant product. If the barcode already exists, the button becomes **"Update existing product"**, which adds images the product doesn't have yet and sets cost/description only where missing — price, title, vendor and status are left alone

**Usage:**
1. Open a product page on one of the sites above (eslite and Amazon content that renders late is picked up automatically)
2. Review/edit the pre-filled fields; optionally enter cost, price, quantity; check "Active" to publish immediately
3. Click **"Send to Shopify"**

---

### 4. `amazon_price_comp.user.js` — Distributor vs Amazon Price Checker (Ingram, PubEasy)

Adds an **"Amazon Compare"** column to Ingram and PubEasy title tables with the Amazon print price, your distributor cost and the margin, and flags titles that are cheaper on Amazon. Replaces the separate `ingram_amazon_price_comp.user.js`.

**Matches:** `*.ingramcontent.com/*`, `*.ingramipage.com/*`, `pubeasy.com/*`, `*.pubeasy.com/*`

**Cost per site:**
- **Ingram:** columns are found by header (EAN, Disc %, SRP, Disc. Price), so both search results and the IPS cart work. Cost = the **Disc. Price** when the page shows one (cart), otherwise `SRP × (1 − discount)`, with named codes `REG`=40%, `SHORT`=20%, `NET`=0% (or an explicit `%`)
- **PubEasy:** reads the ISBN and the "List Price / Personal Price" cell; cost = personal price when shown, otherwise `list price × (1 − discount)`. A floating **Publisher discount** box (bottom-right), default **46%** (Penguin), recalculates every row instantly and is remembered in this browser

**Amazon price:**
- Print only — Kindle, Audible/audiobook and audio CD prices are ignored, as are sponsored results
- Prefers the exact edition (the format whose Amazon ASIN is the ISBN-10); otherwise shows the first print format, labeled "other edition"
- Each ISBN is fetched once per page load; the column is re-added automatically when the site re-renders its table

**Display:**
- Margin `(Amazon − cost) / Amazon`, color-coded green ≥ 30%, orange ≥ 15%, red < 15%
- Rows cheaper on Amazon are highlighted red with a **"BUY FROM AMAZON"** link to that format's listing

**Usage:**
1. Open an Ingram order/catalog page with an EAN column, or a PubEasy cart
2. On PubEasy, adjust the discount if this publisher's terms aren't 46%
3. Red-highlighted rows are cheaper on Amazon

---

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click on each `.user.js` file in this repo and choose "Install" when Tampermonkey prompts you
3. Or open Tampermonkey Dashboard → "+" → paste the script content

## Notes

- `dd-taobao-po-v2.user.js` and `Taobao-ISBN-Extractor.user.js` work together — install both for full semi-automatic ISBN extraction on Taobao orders
- `to_shopify.user.js` requires access to the Unbound backend (`unbound-backend.azurewebsites.net`)
- `amazon_price_comp.user.js` requires Tampermonkey's `GM_xmlhttpRequest` permission to cross-origin fetch Amazon prices
