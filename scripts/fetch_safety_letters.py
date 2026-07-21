"""
식품의약품안전처 '의약품안전성서한 정보' Open API에서 안전성서한(안전성속보 포함) 목록을
가져와 data/safety_letters.json으로 저장한다.

엔드포인트: 1471000/DrugSafeLetterService02/getDrugSafeLetterList02
(DUR/낱알식별과 같은 data.go.kr 계정 서비스키를 그대로 쓸 수 있다 - 실제 호출로
확인함, 2026-07 기준 321건)

이 API는 성분명/품목명을 별도 구조화된 필드로 주지 않고 TITLE/PBANC_CONT
(제목/본문) 자유 텍스트 안에만 언급한다. 그래서 프론트에서 바구니 약의 정확한
상품명이 제목이나 본문에 문자열로 포함되는지로 "추정 매칭"만 할 수 있고, 이는
완벽하지 않다(표현이 다르면 놓칠 수 있음) - 그래서 매칭과 별개로 전체 목록도
항상 함께 제공해 전문가가 직접 훑어볼 수 있게 한다.
"""
import json
import os
import sys
import time
from datetime import date
from pathlib import Path
from urllib.parse import unquote

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUT_FILE = DATA_DIR / "safety_letters.json"

API_URL = "https://apis.data.go.kr/1471000/DrugSafeLetterService02/getDrugSafeLetterList02"
NUM_OF_ROWS = 500  # 전체 300여 건, 한 페이지로 충분함(실제 호출로 확인)
MAX_RETRIES = 4
RETRY_BACKOFF_BASE = 1.5


def get_api_key() -> str:
    raw = os.environ.get("DUR_API_KEY", "").strip()
    return unquote(raw) if raw else ""


def fetch_page(service_key: str, page_no: int) -> dict:
    params = {
        "serviceKey": service_key,
        "pageNo": page_no,
        "numOfRows": NUM_OF_ROWS,
        "type": "json",
    }
    last_exc = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(API_URL, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_BASE * (2 ** attempt))
    raise last_exc


def get_body(payload: dict) -> dict:
    return payload.get("body") or payload.get("response", {}).get("body", {})


def extract_items(body: dict) -> list:
    items = body.get("items")
    if items in (None, "", []):
        return []
    item_list = items.get("item") if isinstance(items, dict) else items
    if isinstance(item_list, dict):
        item_list = [item_list]
    return item_list or []


def write_output(letters: list) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps(
            {"updated": date.today().isoformat(), "count": len(letters), "letters": letters},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def main():
    service_key = get_api_key()
    if not service_key:
        print("[fetch_safety_letters] DUR_API_KEY가 설정되지 않아 빈 결과를 저장합니다.")
        write_output([])
        return

    letters = []
    try:
        first = fetch_page(service_key, 1)
        body = get_body(first)
        total_count = body.get("totalCount", 0)
        print(f"[fetch_safety_letters] 총 {total_count}건")

        items = extract_items(body)
        page_no = 2
        while len(items) < total_count and page_no <= 20:
            more = extract_items(get_body(fetch_page(service_key, page_no)))
            if not more:
                break
            items.extend(more)
            page_no += 1

        for item in items:
            letter_no = (item.get("SAFT_LETT_NO") or "").strip()
            title = (item.get("TITLE") or "").strip()
            if not letter_no or not title:
                continue
            letters.append(
                {
                    "id": letter_no,
                    "title": title,
                    "category": item.get("PBANC_DIVS_NM") or "",
                    "date": (item.get("PBANC_YMD") or "").strip(),
                    "summary": item.get("SUMRY_CONT") or "",
                    "content": item.get("PBANC_CONT") or "",
                    "action": item.get("ACTN_MTTR_CONT") or "",
                    "department": item.get("CHRG_DEP") or "",
                    "attach_url": item.get("ATTACH_FILE_URL") or "",
                }
            )
        # 최신순으로 정렬해두면 프론트에서 "최근 N건"을 그대로 앞에서부터 자르면 된다.
        letters.sort(key=lambda x: x["date"], reverse=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[fetch_safety_letters] 호출 중 오류, 지금까지 모은 {len(letters)}건만 저장합니다: {exc}")

    write_output(letters)
    print(f"[fetch_safety_letters] {len(letters)}건 저장 완료 -> {OUT_FILE}")


if __name__ == "__main__":
    main()
