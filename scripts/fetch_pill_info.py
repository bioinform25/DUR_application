"""
식약처 의약품안전나라 '의약품 낱알식별정보' Open API에서 알약의 모양/색깔/각인/사진
정보를 가져와 data/pill_info.json으로 저장한다.

엔드포인트: 1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03
(DUR 오퍼레이션들과 같은 data.go.kr 계정의 서비스키를 그대로 쓸 수 있다 - 활용신청만
이 API에 대해 별도로 승인받으면 DUR_API_KEY 값 그대로 재사용 가능함을 확인함)

응답의 EDI_CODE 필드가 건강보험심사평가원 약제급여목록표의 보험코드(약가코드)와
동일해서, 이 값을 그대로 data/drugs.json의 product_code와 매칭 키로 쓴다 - 이름
기반 fuzzy 매칭이 필요 없다("가스프렌정(모사프리드시트르산염이수화물)" 사례로 두
데이터 모두 코드 648102540임을 실제로 검증함).

API 키가 없거나 호출이 실패하면 빈 결과로 저장한다 - 사진/모양 정보 없이도 앱의
나머지 기능은 정상 동작해야 하기 때문에, 이 스크립트의 실패가 전체 파이프라인을
막지 않도록 한다. EDI_CODE가 비어 있는 품목(주로 오래된/유통중단 품목)은 건너뛴다.
"""
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from urllib.parse import unquote

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUT_FILE = DATA_DIR / "pill_info.json"

API_URL = "https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03"

NUM_OF_ROWS = 500  # 이 오퍼레이션이 허용하는 페이지당 최대 건수(실제 호출로 확인)
MAX_RETRIES = 4
RETRY_BACKOFF_BASE = 1.5  # 초 단위, 지수 백오프
CONCURRENT_WORKERS = 6  # 공공기관 API라 과도하게 몰아치지 않도록 동시 요청 수를 제한


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


def to_pill_record(item: dict) -> dict:
    return {
        "shape": item.get("DRUG_SHAPE") or None,
        "color1": item.get("COLOR_CLASS1") or None,
        "color2": item.get("COLOR_CLASS2") or None,
        "print_front": item.get("PRINT_FRONT") or None,
        "print_back": item.get("PRINT_BACK") or None,
        "chart": item.get("CHART") or None,
        "image_url": item.get("ITEM_IMAGE") or None,
        "form": item.get("FORM_CODE_NAME") or None,
    }


def write_output(pills: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps(
            {"updated": date.today().isoformat(), "pill_count": len(pills), "pills": pills},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def main():
    service_key = get_api_key()
    if not service_key:
        print("[fetch_pill_info] DUR_API_KEY가 설정되지 않아 낱알식별 정보 없이 빈 결과를 저장합니다.")
        write_output({})
        return

    pills = {}

    def handle_items(items):
        for item in items:
            edi_code = (item.get("EDI_CODE") or "").strip()
            if not edi_code:
                continue
            pills[edi_code] = to_pill_record(item)

    try:
        first = fetch_page(service_key, 1)
        body = get_body(first)
        total_count = body.get("totalCount", 0)
        total_pages = math.ceil(total_count / NUM_OF_ROWS) if total_count else 0
        print(f"[fetch_pill_info] 총 {total_count}건, {total_pages}페이지")
        handle_items(extract_items(body))

        batch_size = CONCURRENT_WORKERS * 10
        page_no = 2
        while page_no <= total_pages:
            batch_end = min(page_no + batch_size - 1, total_pages)
            with ThreadPoolExecutor(max_workers=CONCURRENT_WORKERS) as executor:
                futures = [executor.submit(fetch_page, service_key, p) for p in range(page_no, batch_end + 1)]
                for future in as_completed(futures):
                    handle_items(extract_items(get_body(future.result())))
            print(f"[fetch_pill_info] {batch_end}/{total_pages} 페이지 처리 완료")
            page_no = batch_end + 1
    except Exception as exc:  # noqa: BLE001
        # 이 데이터는 있으면 좋지만 없어도 앱의 핵심 기능(병용금기 확인 등)에는
        # 영향이 없으므로, 실패해도 전체 파이프라인을 막지 않고 지금까지 모은
        # 결과만이라도 저장한다.
        print(f"[fetch_pill_info] 호출 중 오류 발생, 지금까지 모은 {len(pills)}건만 저장합니다: {exc}")

    write_output(pills)
    print(f"[fetch_pill_info] {len(pills)}건 저장 완료 -> {OUT_FILE}")


if __name__ == "__main__":
    main()
