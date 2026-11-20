# GitHub Pages, SEO & Google Search Console Operational Guide

This guide documents the manual steps required in the GitHub repository settings and in **Google Search Console** to publish and index the official **WebPullBook** website ([website/](../website/index.html)).

---

## 1. Enabling GitHub Pages (GitHub Actions Source)

The static site lives in [website/](../website/index.html) and is deployed automatically by [.github/workflows/pages.yml](../.github/workflows/pages.yml) whenever `main` is updated (or triggered manually). It never creates commits on a `gh-pages` branch and is never bundled into the browser extension release `.zip`.

### Manual Steps on GitHub

1. Open the repository on GitHub: `https://github.com/WiltonGabriel/WebPullBook`.
2. Go to **Settings &rarr; Pages** (under *Code and automation* in the left sidebar).
3. Under **Build and deployment &rarr; Source**, select **GitHub Actions** (instead of *Deploy from a branch*).
4. Once enabled, open the **Actions** tab, select **Deploy Official Website to GitHub Pages**, and click **Run workflow** on branch `main` (or push the commit to `main`).
5. Confirm that the live site loads at:
   - English (Default): `https://wiltongabriel.github.io/WebPullBook/`
   - Portuguese (PT-BR): `https://wiltongabriel.github.io/WebPullBook/pt/`
   - Sitemap XML: `https://wiltongabriel.github.io/WebPullBook/sitemap.xml`
   - Robots.txt: `https://wiltongabriel.github.io/WebPullBook/robots.txt`

---

## 2. Updating Repository Homepage, Description, Topics & Social Preview

After confirming that `https://wiltongabriel.github.io/WebPullBook/` is live:

### A. Repository About Box (Description, Homepage & Topics)

1. On the main repository page (`https://github.com/WiltonGabriel/WebPullBook`), click the gear icon (**⚙️ Edit repository details**) in the top-right **About** section.
2. **Description:**
   ```text
   Manifest V3 browser extension (Chrome & Firefox 128+) to extract web novels, light novels, serialized fiction, articles, and open tabs into volume-organized EPUB 2/3, HTML, Markdown, and TXT files.
   ```
3. **Website (Homepage):**
   - Check **Use your GitHub Pages website** (or enter `https://wiltongabriel.github.io/WebPullBook/`).
4. **Topics (up to 20 tags):**
   ```text
   epub epub2 epub3 web-to-epub html-to-epub ebook-converter web-novel light-novel novel-downloader web-fiction offline-reading browser-extension chrome-extension firefox-extension manifest-v3 kindle kobo calibre readability javascript
   ```
5. Click **Save changes**.

### B. GitHub Social Preview Image (`1280 × 640`)

A dedicated `1280 × 640` social card has been generated at [website/assets/images/social-preview.png](../website/assets/images/social-preview.png).

1. Go to **Settings &rarr; General** in the GitHub repository.
2. Scroll down to **Social preview**.
3. Click **Edit &rarr; Upload an image...** and upload `website/assets/images/social-preview.png`.

---

## 3. Google Search Console Setup & Indexing

Once the GitHub Pages site is live at `https://wiltongabriel.github.io/WebPullBook/`, register it in **Google Search Console** so Google can crawl the bilingual pages and sitemap.

### Step 1: Add the URL-Prefix Property

Because this is a GitHub Pages project site under a path (`/WebPullBook/`), use the **URL prefix** property type:

1. Open [Google Search Console](https://search.google.com/search-console/).
2. Click the property selector in the top-left corner and choose **+ Add property**.
3. Under **URL prefix** (right card), enter the exact canonical root URL with the trailing slash:
   ```text
   https://wiltongabriel.github.io/WebPullBook/
   ```
4. Click **Continue**.

### Step 2: Verify Property Ownership

Google Search Console will present several verification methods:

- **Method A — HTML file upload (Recommended for static GitHub Pages):**
  1. Download the `googleXXXXXXXXXXXX.html` verification file provided by Google Search Console.
  2. Place that file directly inside the `website/` directory (`website/googleXXXXXXXXXXXX.html`), commit, and push to `main`.
  3. Wait ~1 minute for the **Deploy Official Website to GitHub Pages** workflow to finish, verify that `https://wiltongabriel.github.io/WebPullBook/googleXXXXXXXXXXXX.html` opens in your browser, and click **Verify** in Google Search Console.
- **Method B — HTML `<meta>` tag:**
  1. Copy the `<meta name="google-site-verification" content="...">` tag provided by Google Search Console.
  2. Paste it inside the `<head>` of `website/index.html`, push to `main`, wait for deployment, and click **Verify**.

> **Security note:** Keep verification files or meta tags accurate to your own Search Console account; never share account credentials.

### Step 3: Submit the XML Sitemap

1. In Google Search Console, select your verified `https://wiltongabriel.github.io/WebPullBook/` property.
2. In the left sidebar, click **Sitemaps** (under *Indexing*).
3. In the **Add a new sitemap** field, enter:
   ```text
   sitemap.xml
   ```
   (so the full URL reads `https://wiltongabriel.github.io/WebPullBook/sitemap.xml`).
4. Click **Submit**.
5. Confirm that the status shows **Success** and discovers all 14 bilingual URLs (7 English + 7 Portuguese).

### Step 4: Inspect Key Pages & Request Indexing

To accelerate initial discovery of the most important entry points:

1. Paste each primary URL into the top **Inspect any URL in "https://wiltongabriel.github.io/WebPullBook/"** search bar in Google Search Console:
   - `https://wiltongabriel.github.io/WebPullBook/`
   - `https://wiltongabriel.github.io/WebPullBook/features.html`
   - `https://wiltongabriel.github.io/WebPullBook/installation.html`
   - `https://wiltongabriel.github.io/WebPullBook/compatibility.html`
   - `https://wiltongabriel.github.io/WebPullBook/pt/`
   - `https://wiltongabriel.github.io/WebPullBook/pt/installation.html`
2. Click **Test Live URL** to verify that Googlebot can fetch the page, validate its mobile friendliness, and parse its `SoftwareApplication` / `FAQPage` structured data with zero errors.
3. Click **Request Indexing** on those primary pages.

### Step 5: Monitor Impressions, Clicks & Queries

1. Open **Performance &rarr; Search results** in Google Search Console after a few days.
2. Monitor **Total impressions**, **Total clicks**, **Average CTR**, and **Queries** (such as *web novel to epub*, *web to epub extension*, *baixar web novel epub*, *light novel downloader extension*).
3. Check **Indexing &rarr; Pages** periodically to ensure no canonical or 404 issues appear.

---

## 4. Local Validation Command

Whenever editing any file under `website/`, run the zero-dependency validator before committing:

```bash
node scripts/verify-website.mjs
```

This script is also executed automatically by `npm run lint` and by the GitHub Actions deployment workflow.
