#!/usr/bin/env python3
"""厚生労働省の公開資料から基礎的医薬品検索データを生成する。"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

import pandas as pd
import pdfplumber
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TMP = ROOT / ".tmp"
DATA.mkdir(exist_ok=True)
TMP.mkdir(exist_ok=True)
JST = timezone(timedelta(hours=9))
USER_AGENT = "kiso-medicine-search/1.0 (public data updater)"


@dataclass
class Sources:
    page_url: str
    page_title: str
    target_url: str
    change_url: str
    dataset_title: str
    applicable_date: str


def clean(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return re.sub(r"\s+", " ", str(value).replace("\u3000", " ")).strip()


def normalize(value: object) -> str:
    return re.sub(
        r"[\s・･―ー‐\-（）()「」『』【】\[\]]",
        "",
        unicodedata.normalize("NFKC", clean(value)).lower(),
    )


def split_lines(value: object) -> list[str]:
    text = clean(value)
    return [] if not text else [clean(item) for item in str(value).split("\n")]


def get(url: str) -> requests.Response:
    response = requests.get(url, timeout=45, headers={"User-Agent": USER_AGENT})
    response.raise_for_status()
    return response


def discover_sources() -> Sources:
    now = datetime.now(JST)
    candidates = [now.year, now.year - 1]
    errors: list[str] = []

    for year in candidates:
        page_url = f"https://www.mhlw.go.jp/topics/{year}/04/tp{year}0401-01.html"

        try:
            response = get(page_url)

            # requests側の文字コード判定がずれても日本語を正しく読む
            if response.apparent_encoding:
                response.encoding = response.apparent_encoding

            soup = BeautifulSoup(response.text, "html.parser")

            h1 = soup.find("h1")
            if h1:
                title = clean(h1.get_text(" ", strip=True))
            elif soup.title:
                title = clean(soup.title.get_text(" ", strip=True))
            else:
                title = ""

            links: list[tuple[str, str]] = []

            for a in soup.find_all("a", href=True):
                text = clean(a.get_text(" ", strip=True))
                href = urljoin(page_url, a["href"])
                links.append((text, href))

            # デバッグ用：Actionsログで何を取得できたか確認可能
            print(f"Checking source page: {page_url}")
            print(f"Page title: {title}")
            print(f"Found links: {len(links)}")

            # -----------------------------
            # 基礎的リスト Excel版
            # -----------------------------
            change_candidates = []

            for text, url in links:
                normalized_text = normalize(text)
                lower_url = url.lower()

                if "基礎的リスト" in normalized_text:
                    score = 0

                    if "excel" in normalized_text:
                        score += 10

                    if lower_url.endswith((".xlsx", ".xls")):
                        score += 20

                    # PDFを誤取得しない
                    if lower_url.endswith(".pdf"):
                        score -= 100

                    change_candidates.append((score, text, url))

            change_candidates.sort(reverse=True, key=lambda x: x[0])

            change_url = (
                change_candidates[0][2]
                if change_candidates and change_candidates[0][0] >= 0
                else ""
            )

            # -----------------------------
            # 基礎的医薬品対象品目リスト
            # -----------------------------
            target_candidates = []

            for text, url in links:
                normalized_text = normalize(text)
                lower_url = url.lower()

                if (
                    "基礎的医薬品対象品目リスト" in normalized_text
                    or "基礎的医薬品対象品一覧" in normalized_text
                ):
                    score = 0

                    if lower_url.endswith(".pdf"):
                        score += 20

                    if "pdf" in normalized_text:
                        score += 10

                    # ExcelよりPDFを優先
                    if lower_url.endswith((".xlsx", ".xls")):
                        score -= 10

                    target_candidates.append((score, text, url))

            target_candidates.sort(reverse=True, key=lambda x: x[0])

            target_url = (
                target_candidates[0][2]
                if target_candidates
                else ""
            )

            print(f"Detected change list: {change_url or 'NOT FOUND'}")
            print(f"Detected target list: {target_url or 'NOT FOUND'}")

            if not change_url or not target_url:
                raise RuntimeError(
                    "必要な資料リンクを検出できませんでした "
                    f"(change={bool(change_url)}, target={bool(target_url)})"
                )

            # ページタイトルから適用日を取得
            match = re.search(
                r"令和\s*([0-9０-９]+)年\s*"
                r"([0-9０-９]+)月\s*"
                r"([0-9０-９]+)日",
                title,
            )

            applicable_date = ""

            if match:
                era_year, month, day = [
                    int(unicodedata.normalize("NFKC", x))
                    for x in match.groups()
                ]

                applicable_date = (
                    f"{era_year + 2018:04d}-"
                    f"{month:02d}-"
                    f"{day:02d}"
                )

            return Sources(
                page_url=page_url,
                page_title=title,
                target_url=target_url,
                change_url=change_url,
                dataset_title=(
                    f"基礎的医薬品対象品目リスト"
                    f"（令和{year - 2018}年4月1日～）"
                ),
                applicable_date=applicable_date or f"{year}-04-01",
            )

        except Exception as exc:  # noqa: BLE001
            errors.append(f"{page_url}: {exc}")

    raise RuntimeError(
        "最新資料ページを特定できませんでした: "
        + " | ".join(errors)
    )

def download(url: str, path: Path) -> None:
    response = get(url)
    path.write_bytes(response.content)


def parse_target_pdf(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            table = page.extract_table()
            if not table:
                continue
            for raw in table[1:]:
                columns = [split_lines(value) for value in (raw + [None] * 7)[:7]]
                width = max([len(column) for column in columns[1:]] or [1])
                for index in range(width):
                    values = [
                        "" if not column else column[0] if len(column) == 1 else column[index] if index < len(column) else ""
                        for column in columns
                    ]
                    number, category, route, name, ingredient, spec, company = values
                    if name and name not in {"品名", "基礎的医薬品対象品一覧"}:
                        rows.append({
                            "no": number,
                            "category": category,
                            "route": route,
                            "name": name,
                            "ingredient": ingredient,
                            "spec": spec,
                            "company": company,
                        })
    unique: list[dict[str, object]] = []
    seen: set[tuple[str, ...]] = set()
    for row in rows:
        key = tuple(clean(row[field]) for field in ("category", "route", "name", "ingredient", "spec", "company"))
        if key not in seen:
            seen.add(key)
            unique.append(row)
    return unique


def parse_change_excel(path: Path) -> list[dict[str, object]]:
    frame = pd.read_excel(path)
    if frame.shape[1] < 6:
        raise RuntimeError(f"基礎的リストの列数が不足しています: {frame.shape[1]}")
    frame = frame.iloc[:, :6]
    frame.columns = ["route", "name", "ingredient", "spec", "company", "price"]
    output: list[dict[str, object]] = []
    for _, row in frame.iterrows():
        name = clean(row["name"])
        if not name or name == "品名":
            continue
        output.append({
            "route": clean(row["route"]),
            "name": name,
            "ingredient": clean(row["ingredient"]),
            "spec": clean(row["spec"]),
            "company": clean(row["company"]),
            "price": None if pd.isna(row["price"]) else float(row["price"]),
        })
    return output


def enrich(targets: list[dict[str, object]], changes: list[dict[str, object]]) -> None:
    exact = {(normalize(x["name"]), normalize(x["spec"]), normalize(x["company"])): x for x in changes}
    fallback = {(normalize(x["name"]), normalize(x["spec"])): x for x in changes}
    for row in targets:
        match = exact.get((normalize(row["name"]), normalize(row["spec"]), normalize(row["company"])))
        if match is None:
            match = fallback.get((normalize(row["name"]), normalize(row["spec"])))
        row["change_listed"] = match is not None
        row["price"] = match["price"] if match else None


def validate(targets: list[dict[str, object]], changes: list[dict[str, object]], old_meta: dict[str, object]) -> None:
    problems: list[str] = []
    if len(targets) < 1000:
        problems.append(f"対象品目が少なすぎます: {len(targets)}")
    if len(changes) < 300:
        problems.append(f"基礎的リストが少なすぎます: {len(changes)}")
    old_count = int(old_meta.get("target_count") or len(targets))
    ratio = len(targets) / old_count if old_count else 1.0
    if not 0.75 <= ratio <= 1.25:
        problems.append(f"前回件数からの変動が大きすぎます: {old_count} → {len(targets)}")
    required = ("name", "route", "spec", "company")
    missing_ratio = sum(any(not clean(row.get(field)) for field in required) for row in targets) / max(len(targets), 1)
    if missing_ratio > 0.08:
        problems.append(f"必須項目の欠損率が高すぎます: {missing_ratio:.1%}")
    if problems:
        raise RuntimeError(" / ".join(problems))


def main() -> int:
    old_meta_path = DATA / "meta.json"
    old_meta = json.loads(old_meta_path.read_text(encoding="utf-8")) if old_meta_path.exists() else {}
    sources = discover_sources()
    target_path = TMP / "target.pdf"
    change_path = TMP / "change.xlsx"
    download(sources.target_url, target_path)
    download(sources.change_url, change_path)
    targets = parse_target_pdf(target_path)
    changes = parse_change_excel(change_path)
    enrich(targets, changes)
    validate(targets, changes, old_meta)

    meta = {
        "dataset_title": sources.dataset_title,
        "change_list_title": "基礎的リスト",
        "applicable_date": sources.applicable_date,
        "source_page_title": sources.page_title,
        "source_page_url": sources.page_url,
        "source_target_url": sources.target_url,
        "source_change_url": sources.change_url,
        "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "target_count": len(targets),
        "change_count": len(changes),
        "change_matched_count": sum(bool(row["change_listed"]) for row in targets),
        "status": "normal",
    }
    (DATA / "medicines.json").write_text(json.dumps(targets, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    old_meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Updated: targets={len(targets)}, change_list={len(changes)}, matched={meta['change_matched_count']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"UPDATE_FAILED: {exc}", file=sys.stderr)
        raise
