#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
function toCsvValue(value) {
  if (value == null) return "";
  const str = String(value).replace(/\r?\n/g, " ");
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function objectsToCsv(rows, headers) {
  const headerLine = headers.map(toCsvValue).join(",");
  const lines = rows.map((row) => headers.map((h) => toCsvValue(row[h])).join(","));
  return [headerLine, ...lines].join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractBooksFromPage(page) {
  return await page.evaluate(() => {
    const results = [];
    // Each result item appears under an element with class 'result' (based on ALSC directory structure)
    // We defensively search cards that look like search results.
    const items = Array.from(
      document.querySelectorAll(
        ".result, .views-row, .alap-result, .search-result, .node--type-book, .node--view-mode-teaser"
      )
    );

    for (const el of items) {
      const titleEl =
        el.querySelector(".title a, h2 a, h3 a, .node__title a, .field--name-title a") ||
        el.querySelector(".title, h2, h3, .node__title, .field--name-title");
      const authorEl = el.querySelector(
        ".field--name-field-author, .views-field-field-author, .author, .field-author, [class*='author']"
      );
      const publisherEl = el.querySelector(
        ".field--name-field-publisher, .views-field-field-publisher, .publisher, [class*='publisher']"
      );
      const yearEl = el.querySelector(
        ".field--name-field-year, .views-field-field-year, .year, [class*='year']"
      );
      const linkEl = titleEl && titleEl.tagName.toLowerCase() === "a" ? titleEl : el.querySelector("a[href*='/book']");

      const title = titleEl ? titleEl.textContent.trim() : "";
      const author = authorEl ? authorEl.textContent.replace(/^(by\s+)/i, "").trim() : "";
      const publisher = publisherEl ? publisherEl.textContent.trim() : "";
      const yearRaw = yearEl ? yearEl.textContent.trim() : "";
      const yearMatch = yearRaw.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? yearMatch[0] : "";
      const url = linkEl ? linkEl.href : "";

      if (title) {
        results.push({ title, author, publisher, year, url });
      }
    }
    return results;
  });
}

async function findAndClickNext(page) {
  // Try different pagination selectors
  const nextSelectors = [
    "a[rel='next']",
    ".pager__item--next a",
    ".pagination a[rel='next']",
    "a:has(span:matches(^Next$|^›$|^»$))",
    "a[aria-label='Next']",
    "a.pager-next, li.pager-next a",
  ];

  for (const sel of nextSelectors) {
    try {
      const has = await page.$(sel);
      if (has) {
        await Promise.all([
          page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}),
          page.click(sel, { timeout: 3000 }).catch(() => {}),
        ]);
        return true;
      }
    } catch (_) {}
  }
  // Heuristic: locate numbered pager and click the active+1 element
  try {
    const clicked = await page.evaluate(() => {
      const pagers = Array.from(document.querySelectorAll(".pager, .pagination, nav[role='navigation']"));
      for (const pager of pagers) {
        const items = Array.from(pager.querySelectorAll("a, span"));
        const activeIndex = items.findIndex((n) => n.classList.contains("is-active") || n.getAttribute("aria-current") === "page");
        if (activeIndex >= 0 && items[activeIndex + 1] && items[activeIndex + 1].tagName.toLowerCase() === "a") {
          (items[activeIndex + 1]).click();
          return true;
        }
      }
      return false;
    });
    if (clicked) {
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      return true;
    }
  } catch (_) {}
  return false;
}

async function run() {
  const baseUrl = process.env.ALSC_URL || "https://alsc-awards-shelf.org/directory/results?booklist=14";
  const outJson = path.resolve(process.env.OUT_JSON || "alsc_books.json");
  const outCsv = path.resolve(process.env.OUT_CSV || "alsc_books.csv");
  const maxPages = Number(process.env.MAX_PAGES || 200);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1600 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const all = [];

  // Bypass basic bot checks: wait random, scroll, click focus
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await sleep(500 + Math.floor(Math.random() * 1000));
  await page.mouse.move(100 + Math.random() * 600, 200 + Math.random() * 400).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)).catch(() => {});

  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex++) {
    // If behind Cloudflare challenge, wait for it to pass up to some time
    const isChallenge = await page.locator("text=Just a moment...").first().isVisible().catch(() => false);
    if (isChallenge) {
      await sleep(4000);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    }

    // Extract on this page
    const items = await extractBooksFromPage(page);
    if (items.length === 0 && isChallenge) {
      // try reload once
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      const retryItems = await extractBooksFromPage(page);
      all.push(...retryItems);
    } else {
      all.push(...items);
    }

    // Try to go next; stop if not found
    const moved = await findAndClickNext(page);
    if (!moved) break;
    await sleep(500 + Math.floor(Math.random() * 1200));
  }

  // Deduplicate by title+year
  const dedup = [];
  const seen = new Set();
  for (const r of all) {
    const key = `${r.title}|${r.year}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedup.push(r);
    }
  }

  fs.writeFileSync(outJson, JSON.stringify(dedup, null, 2));
  const csv = objectsToCsv(dedup, ["title", "author", "publisher", "year", "url"]);
  fs.writeFileSync(outCsv, csv);

  console.log(`Saved ${dedup.length} books to:\n- ${outJson}\n- ${outCsv}`);

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

