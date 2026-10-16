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

### 4. `eslite_to_shopify.user.js` — Eslite Book → Shopify (Unbound)

Adds a sidebar panel to eslite.com book product pages. Parses the page for book metadata and sends it to the Unbound backend to create or update a Shopify product. Mirrors `bookstw_to_shopify.user.js` for books.com.tw.

**Matches:** `www.eslite.com/product/*`

**Features:**
- Extracts: title, author(s), translator(s), illustrator/painter(s), publisher, publication date, ISBN-13, pages, binding, language, dimensions, weight, list/discounted price, cover image, description, category tags (from breadcrumb)
- Editable fields before submission: title, authors, publisher, language, binding, cost, price, quantity, active status
- POSTs to `https://unbound-backend.azurewebsites.net/api/ShopifyCreateFromData`
- Shows a success link to the created/updated Shopify product, or an error message

**Usage:**
1. Open any eslite.com book product page (e.g. `eslite.com/product/<id>`)
2. A panel appears at the bottom-right
3. Review/edit the pre-filled fields
4. Optionally enter cost, price, quantity; check "Active" to publish immediately
5. Click **"Send to Shopify"**

---

### 4b. `apriori_to_shopify.user.js` — Apriori Distribution Chocolate → Shopify (Unbound)

Adds a panel to aprioridistribution.com (WooCommerce) product pages and creates a non-book Shopify product from it.

**Matches:** `aprioridistribution.com/product/*`

**Features:**
- Extracts: title, brand (used as vendor), barcode, wholesale price, suggested retail, unit/case size, description, all gallery images (full size)
- Barcode is used as both SKU and barcode; wholesale price as cost; default price is `floor(wholesale × 2) + 0.99` (recalculated when cost is edited, unless price was edited by hand); product type defaults to `Chocolate`
- Description drops empty lines, the price/info rows and the distributor's "Check out our sampler" cross-sell line; it's editable before sending
- POSTs to `https://unbound-backend.azurewebsites.net/api/products/createNonBook` with a single plain variant
- Won't create a duplicate: if a product with the same barcode exists, it links to that product instead

**Usage:**
1. Open a product page on aprioridistribution.com
2. Review/edit the pre-filled fields; optionally enter quantity and check "Active"
3. Click **"Send to Shopify"**

---

### 5. `amazon_price_comp.user.js` — Distributor vs Amazon Price Checker (Ingram, PubEasy)

Adds an **"Amazon Compare"** column to Ingram and PubEasy title tables with the Amazon print price, your distributor cost and the margin, and flags titles that are cheaper on Amazon. Replaces the separate `ingram_amazon_price_comp.user.js`.

**Matches:** `*.ingramcontent.com/*`, `*.ingramipage.com/*`, `pubeasy.com/*`, `*.pubeasy.com/*`

**Cost per site:**
- **Ingram:** columns are found by header (EAN, Disc %, SRP, Disc. Price), so both search results and the IPS cart work. Cost = the **Disc. Price** when the page shows one (cart), otherwise `SRP × (1 − discount)`, with named codes `REG`=40%, `SHORT`=20%, `NET`=0% (or an explicit `%`)
- **PubEasy:** reads the ISBN and the "List Price / Personal Price" cell; cost = personal price when shown, otherwise `list price × (1 − discount)`. A floating **Publisher discount** box (bottom-right), default **50%** (Penguin), recalculates every row instantly and is remembered in this browser

**Amazon price:**
- Print only — Kindle, Audible/audiobook and audio CD prices are ignored, as are sponsored results
- Prefers the exact edition (the format whose Amazon ASIN is the ISBN-10); otherwise shows the first print format, labeled "other edition"
- Each ISBN is fetched once per page load; the column is re-added automatically when the site re-renders its table

**Display:**
- Margin `(Amazon − cost) / Amazon`, color-coded green ≥ 30%, orange ≥ 15%, red < 15%
- Rows cheaper on Amazon are highlighted red with a **"BUY FROM AMAZON"** link to that format's listing

**Usage:**
1. Open an Ingram order/catalog page with an EAN column, or a PubEasy cart
2. On PubEasy, adjust the discount if this publisher's terms aren't 50%
3. Red-highlighted rows are cheaper on Amazon

---

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click on each `.user.js` file in this repo and choose "Install" when Tampermonkey prompts you
3. Or open Tampermonkey Dashboard → "+" → paste the script content

## Notes

- `dd-taobao-po-v2.user.js` and `Taobao-ISBN-Extractor.user.js` work together — install both for full semi-automatic ISBN extraction on Taobao orders
- `amazon_to_shopify.user.js` requires access to the Unbound backend (`unbound-backend.azurewebsites.net`)
- `amazon_price_comp.user.js` requires Tampermonkey's `GM_xmlhttpRequest` permission to cross-origin fetch Amazon prices
