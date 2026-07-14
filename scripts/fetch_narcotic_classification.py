"""
식품의약품안전처 '마약류 약물 및 오남용 정보' Open API에서 마약류 법적 분류
(향정신성의약품/마약/환각성유해화학물/대마/원료물질)를 가져와
data/narcotic_classification.json으로 저장한다.

엔드포인트: 1471000/NrcdGnrlzInfoService01/getNrcdGnrlzList
(DUR/낱알식별과 같은 data.go.kr 계정 서비스키를 그대로 쓸 수 있다 - 이 API에
대한 활용신청만 별도로 승인받으면 됨)

이 API는 성분의 영문명(DRFSTF_ENG)만 주고 용량·염(salt) 표기가 없는 "기초
성분명" 형태라(예: "Nalbuphine"), HIRA 급여목록표에서 뽑은 ingredient_keys
(예: "nalbuphine hydrochloride")와 완전히 똑같지 않다. 그래서 정확히 같거나,
"기초 성분명 + 공백"으로 시작하는 것만 매칭한다(단어 경계 기준 - 그냥
문자열 포함으로 매칭하면 "3,4,5-트리메톡시암페타민" 같은 숫자로 시작하는
이름이 엉뚱한 성분과 잘못 매칭되는 문제가 실제로 있었다).

법적 분류가 없는 "기타"는 특별히 알릴 게 없어 저장하지 않는다.
"""
import json
import sys
import time
from datetime import date
from pathlib import Path
from urllib.parse import unquote
import os

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from normalize import normalize_ingredient_name  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUT_FILE = DATA_DIR / "narcotic_classification.json"

API_URL = "https://apis.data.go.kr/1471000/NrcdGnrlzInfoService01/getNrcdGnrlzList"
NUM_OF_ROWS = 500  # 전체 약 316건, 한 페이지로 충분함(실제 호출로 확인)
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


def write_output(substances: list) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps(
            {"updated": date.today().isoformat(), "count": len(substances), "substances": substances},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def main():
    service_key = get_api_key()
    if not service_key:
        print("[fetch_narcotic_classification] DUR_API_KEY가 설정되지 않아 빈 결과를 저장합니다.")
        write_output([])
        return

    substances = []
    try:
        first = fetch_page(service_key, 1)
        body = get_body(first)
        total_count = body.get("totalCount", 0)
        print(f"[fetch_narcotic_classification] 총 {total_count}건")

        items = extract_items(body)
        # 전체가 한 페이지(NUM_OF_ROWS)를 넘으면 나머지 페이지도 순서대로 받는다.
        page_no = 2
        while len(items) < total_count and page_no <= 20:
            more = extract_items(get_body(fetch_page(service_key, page_no)))
            if not more:
                break
            items.extend(more)
            page_no += 1

        for item in items:
            type_code = (item.get("TYPE_CODE") or "").strip()
            if not type_code or type_code == "기타":
                continue
            name_en = (item.get("DRFSTF_ENG") or "").strip()
            normalized = normalize_ingredient_name(name_en).rstrip(".")
            if not normalized or len(normalized) < 4:
                continue
            substances.append(
                {
                    "name_kr": item.get("DRFSTF"),
                    "name_en": name_en,
                    "name_en_normalized": normalized,
                    "type_code": type_code,
                }
            )
    except Exception as exc:  # noqa: BLE001
        print(f"[fetch_narcotic_classification] 호출 중 오류, 지금까지 모은 {len(substances)}건만 저장합니다: {exc}")

    write_output(substances)
    print(f"[fetch_narcotic_classification] {len(substances)}건 저장 완료 -> {OUT_FILE}")


if __name__ == "__main__":
    main()
