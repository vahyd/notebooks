import os
import time
import csv
from typing import List, Dict

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException


def extract_books_from_dom(driver) -> List[Dict[str, str]]:
    results: List[Dict[str, str]] = []
    item_selectors = [
        ".result",
        ".views-row",
        ".alap-result",
        ".search-result",
        ".node--type-book",
        ".node--view-mode-teaser",
    ]
    items = []
    for sel in item_selectors:
        try:
            elements = driver.find_elements(By.CSS_SELECTOR, sel)
            if elements:
                items.extend(elements)
        except Exception:
            pass

    def safe_text(el):
        try:
            return el.text.strip()
        except Exception:
            return ""

    seen = set()
    for el in items:
        title_el = None
        for css in [
            ".title a",
            "h2 a",
            "h3 a",
            ".node__title a",
            ".field--name-title a",
            ".title",
            "h2",
            "h3",
            ".node__title",
            ".field--name-title",
        ]:
            try:
                title_el = el.find_element(By.CSS_SELECTOR, css)
                if title_el:
                    break
            except Exception:
                continue

        author_el = None
        for css in [
            ".field--name-field-author",
            ".views-field-field-author",
            ".author",
            ".field-author",
            "[class*='author']",
        ]:
            try:
                author_el = el.find_element(By.CSS_SELECTOR, css)
                if author_el:
                    break
            except Exception:
                continue

        publisher_el = None
        for css in [
            ".field--name-field-publisher",
            ".views-field-field-publisher",
            ".publisher",
            "[class*='publisher']",
        ]:
            try:
                publisher_el = el.find_element(By.CSS_SELECTOR, css)
                if publisher_el:
                    break
            except Exception:
                continue

        year_el = None
        for css in [
            ".field--name-field-year",
            ".views-field-field-year",
            ".year",
            "[class*='year']",
        ]:
            try:
                year_el = el.find_element(By.CSS_SELECTOR, css)
                if year_el:
                    break
            except Exception:
                continue

        link_el = None
        try:
            if title_el and title_el.tag_name.lower() == "a":
                link_el = title_el
        except Exception:
            link_el = None
        if link_el is None:
            try:
                link_el = el.find_element(By.CSS_SELECTOR, "a[href*='/book']")
            except Exception:
                link_el = None

        title = safe_text(title_el) if title_el else ""
        author = safe_text(author_el).lstrip("by ") if author_el else ""
        publisher = safe_text(publisher_el) if publisher_el else ""
        year_text = safe_text(year_el) if year_el else ""
        year = ""
        for token in year_text.split():
            if token.isdigit() and len(token) == 4 and token.startswith(("19", "20")):
                year = token
                break

        url = ""
        try:
            url = link_el.get_attribute("href") if link_el else ""
        except Exception:
            url = ""

        if title:
            key = f"{title}|{year}"
            if key not in seen:
                seen.add(key)
                results.append({
                    "title": title,
                    "author": author,
                    "publisher": publisher,
                    "year": year,
                    "url": url,
                })
    return results


def click_next(driver) -> bool:
    selectors = [
        "a[rel='next']",
        ".pager__item--next a",
        ".pagination a[rel='next']",
        "a[aria-label='Next']",
        "a.pager-next, li.pager-next a",
    ]
    for sel in selectors:
        try:
            el = driver.find_element(By.CSS_SELECTOR, sel)
            if el:
                el.click()
                return True
        except Exception:
            continue
    # heuristic: active + 1
    try:
        pagers = driver.find_elements(By.CSS_SELECTOR, ".pager, .pagination, nav[role='navigation']")
        for pager in pagers:
            anchors = pager.find_elements(By.CSS_SELECTOR, "a, span")
            active_index = -1
            for i, n in enumerate(anchors):
                try:
                    if "is-active" in n.get_attribute("class" or "") or (n.get_attribute("aria-current") == "page"):
                        active_index = i
                        break
                except Exception:
                    pass
            if active_index >= 0 and active_index + 1 < len(anchors):
                if anchors[active_index + 1].tag_name.lower() == "a":
                    anchors[active_index + 1].click()
                    return True
    except Exception:
        pass
    return False


def main():
    base_url = os.environ.get("ALSC_URL", "https://alsc-awards-shelf.org/directory/results?booklist=14")
    out_json = os.environ.get("OUT_JSON", "alsc_books.json")
    out_csv = os.environ.get("OUT_CSV", "alsc_books.csv")
    max_pages = int(os.environ.get("MAX_PAGES", "200"))

    options = uc.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,1600")

    driver = uc.Chrome(options=options)
    driver.set_page_load_timeout(60)

    driver.get(base_url)
    time.sleep(3)

    all_rows: List[Dict[str, str]] = []
    for page_index in range(1, max_pages + 1):
        try:
            WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        except TimeoutException:
            pass

        if "Just a moment" in driver.page_source:
            time.sleep(5)

        rows = extract_books_from_dom(driver)
        if not rows and "Just a moment" in driver.page_source:
            driver.refresh()
            time.sleep(3)
            rows = extract_books_from_dom(driver)
        all_rows.extend(rows)

        moved = click_next(driver)
        if not moved:
            break
        time.sleep(1.2)

    # dedupe
    deduped = []
    seen = set()
    for r in all_rows:
        key = f"{r['title']}|{r['year']}"
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    # write JSON
    import json
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(deduped, f, ensure_ascii=False, indent=2)

    # write CSV
    headers = ["title", "author", "publisher", "year", "url"]
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for r in deduped:
            writer.writerow(r)

    print(f"Saved {len(deduped)} books to: {out_json}, {out_csv}")

    driver.quit()


if __name__ == "__main__":
    main()

