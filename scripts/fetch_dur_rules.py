"""
식품의약품안전처 '의약품안전사용서비스(DUR)품목정보' Open API에서
병용금기 정보를 가져와 data/dur_rules.json으로 정규화한다.

API 키가 없으면(로컬 최초 실행, PR 미리보기 등) scripts/mock_dur_rules_seed.json을
그대로 사용해 프론트엔드가 항상 동작하도록 한다.

⚠️ 엔드포인트 검증 상태
-----------------------
구버전 엔드포인트(1470000/DURPrdlstInfoService)는 실제로 호출해보니 HTTP 500을
반환해 더 이상 서비스되지 않는 것으로 보인다. 실제 서비스키로 테스트한 결과
아래의 1471000/DURPrdlstInfoService03 (버전 접미사 03) 엔드포인트가 정상적으로
요청을 받아 처리한다(키 인증 문제 시 401을 반환 - 즉 엔드포인트 자체는 살아있는
것으로 확인됨). 응답 필드 매핑(ITEM_NAME, INGR_KOR_NAME, MIXTURE_INGR_KOR_NAME,
PROHBT_CONTENT 등)은 공개 예제(GitHub: jjscan/data.go.kr-1) 기준으로 작성했으며,
버전이 03으로 바뀌면서 필드명이 달라졌을 수 있어 최초 실행 로그를 확인해
필요하면 normalize_items()의 필드명을 조정해야 한다.

이 API는 '병용금기'만 제공하는 것이 아니라 동일 서비스 그룹 안에
연령금기(getSpcifyAgrdeTabooInfoList), 임부금기(getPwomanTabooInfoList),
노인주의(getOdsnAtentInfoList), 효능군중복주의(getEfcyDplctInfoList) 등의
오퍼레이션도 함께 제공된다. 지금은 핵심인 병용금기만 구현했고, 동일한
fetch_operation() 패턴으로 나머지도 손쉽게 추가할 수 있다.
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from normalize import normalize_ingredient_name  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUT_FILE = DATA_DIR / "dur_rules.json"
MOCK_SEED = Path(__file__).resolve().parent / "mock_dur_rules_seed.json"

BASE_URL = "https://apis.data.go.kr/1471000/DURPrdlstInfoService03/getUsjntTabooInfoList03"
NUM_OF_ROWS = 500  # 이 오퍼레이션이 허용하는 페이지당 최대 건수
MAX_REFERENCE_ITEMS = 3  # 성분 조합당 예시로 보여줄 실제 제품명 개수
MAX_RETRIES = 4
RETRY_BACKOFF_BASE = 1.5  # 초 단위, 지수 백오프
CONCURRENT_WORKERS = 6  # 공공기관 API라 과도하게 몰아치지 않도록 동시 요청 수를 제한


def get_api_key() -> str:
    # data.go.kr에서 발급하는 서비스키는 이미 URL 인코딩되어 있는 경우가 많다.
    # requests가 다시 인코딩하면서 이중 인코딩되는 문제를 피하려고 한 번 디코드해 둔다.
    raw = os.environ.get("DUR_API_KEY", "").strip()
    return unquote(raw) if raw else ""


def fetch_page(service_key: str, page_no: int) -> dict:
    """일시적인 502/타임아웃 등은 흔하므로 지수 백오프로 재시도한다."""
    params = {
        "serviceKey": service_key,
        "pageNo": page_no,
        "numOfRows": NUM_OF_ROWS,
        "type": "json",
    }
    last_exc = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(BASE_URL, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_BASE * (2 ** attempt))
    raise last_exc


def merge_items(items: list, rules_by_pair: dict) -> None:
    """API는 '성분 조합'이 아니라 '제품 조합' 단위로 행을 준다(동일 성분쌍이 제조사
    수만큼 중복). 프론트에서 실제로 쓰는 매칭 키(정규화된 성분명 쌍) 기준으로
    합쳐서 rules_by_pair에 누적한다."""
    for item in items:
        ingr_a_kor = (item.get("INGR_KOR_NAME") or "").strip()
        ingr_a_eng = (item.get("INGR_ENG_NAME") or "").strip()
        ingr_b_kor = (item.get("MIXTURE_INGR_KOR_NAME") or "").strip()
        ingr_b_eng = (item.get("MIXTURE_INGR_ENG_NAME") or "").strip()

        # data/drugs.json의 ingredient_keys는 영문 성분명 기준으로 정규화되어 있으므로
        # 영문명을 우선 사용해야 두 데이터가 같은 키로 매칭된다.
        key_a = normalize_ingredient_name(ingr_a_eng) or normalize_ingredient_name(ingr_a_kor)
        key_b = normalize_ingredient_name(ingr_b_eng) or normalize_ingredient_name(ingr_b_kor)
        if not key_a or not key_b or key_a == key_b:
            continue

        pair_key = tuple(sorted([key_a, key_b]))
        entry = rules_by_pair.get(pair_key)
        if entry is None:
            entry = {
                "id": f"DUR-{item.get('DUR_SEQ', '')}",
                "category": item.get("TYPE_NAME") or "병용금기",
                "severity": "contraindicated",
                "ingredient_keys": list(pair_key),
                "title": f"{ingr_a_kor or ingr_a_eng} - {ingr_b_kor or ingr_b_eng}",
                "description": item.get("PROHBT_CONTENT") or "",
                "management": item.get("REMARK") or "",
                "reference_items": [],
                "product_pair_count": 0,
            }
            rules_by_pair[pair_key] = entry

        entry["product_pair_count"] += 1
        for name in (item.get("ITEM_NAME"), item.get("MIXTURE_ITEM_NAME")):
            if name and name not in entry["reference_items"] and len(entry["reference_items"]) < MAX_REFERENCE_ITEMS:
                entry["reference_items"].append(name)


def extract_items(body: dict) -> list:
    items = body.get("items")
    if items in (None, "", []):
        return []
    # 단일 결과일 때 dict로, 복수일 때 list로 오는 흔한 data.go.kr 응답 패턴 처리
    item_list = items.get("item") if isinstance(items, dict) else items
    if isinstance(item_list, dict):
        item_list = [item_list]
    return item_list or []


def get_body(payload: dict) -> dict:
    # 이 오퍼레이션의 실제 응답은 {"header":..., "body":...} 형태로, 흔한
    # data.go.kr의 {"response":{"header":...,"body":...}} 포맷과 다르다.
    return payload.get("body") or payload.get("response", {}).get("body", {})


def fetch_all(service_key: str) -> list:
    # 1페이지로 총 건수를 파악한다. 여기서 실패하면(키/엔드포인트 문제) 그대로 예외를
    # 던져 main()이 전체를 목업으로 폴백하도록 한다.
    first_payload = fetch_page(service_key, 1)
    body = get_body(first_payload)
    total_count = int(body.get("totalCount", 0))
    if total_count == 0:
        return []

    total_pages = math.ceil(total_count / NUM_OF_ROWS)
    rules_by_pair: dict = {}
    merge_items(extract_items(body), rules_by_pair)

    completed = 1
    failed_pages = []

    def fetch_one(page_no: int):
        try:
            payload = fetch_page(service_key, page_no)
            return page_no, extract_items(get_body(payload))
        except Exception:  # noqa: BLE001
            return page_no, None

    remaining_pages = list(range(2, total_pages + 1))
    # concurrent.futures의 Future는 완료된 결과를 계속 들고 있어서, 158만 페이지치
    # 응답을 전부 한 번에 submit하면 다 처리한 뒤에도 메모리에서 안 빠져 수 GB까지
    # 불어난다. 배치 단위로 나눠 제출/소비하면서 매 배치가 끝날 때 futures 리스트를
    # 새로 만들어 이전 배치 결과가 GC될 수 있게 한다.
    batch_size = CONCURRENT_WORKERS * 10

    with ThreadPoolExecutor(max_workers=CONCURRENT_WORKERS) as executor:
        for start in range(0, len(remaining_pages), batch_size):
            batch = remaining_pages[start:start + batch_size]
            futures = [executor.submit(fetch_one, p) for p in batch]
            for future in as_completed(futures):
                page_no, items = future.result()
                completed += 1
                if items is None:
                    # 재시도까지 다 실패한 페이지는 건너뛴다(전체 500건 중 극히 일부 손실).
                    failed_pages.append(page_no)
                else:
                    merge_items(items, rules_by_pair)
            futures = None  # 배치 결과 GC 유도

            print(
                f"[fetch_dur_rules] {completed}/{total_pages}페이지 처리 "
                f"-> 성분조합 {len(rules_by_pair)}건 (실패 {len(failed_pages)}건)"
            )

    if failed_pages:
        preview = failed_pages[:20]
        more = "..." if len(failed_pages) > 20 else ""
        print(f"[fetch_dur_rules] 재시도 후에도 실패한 페이지 {len(failed_pages)}개: {preview}{more}")

    return list(rules_by_pair.values())


def load_mock() -> dict:
    seed = json.loads(MOCK_SEED.read_text(encoding="utf-8"))
    return seed


def main() -> int:
    service_key = get_api_key()

    if not service_key:
        print("[fetch_dur_rules] DUR_API_KEY가 설정되지 않아 목업(mock) 데이터를 사용합니다.")
        seed = load_mock()
        out = {
            "updated": date.today().isoformat(),
            "source": seed.get("source", "mock"),
            "rule_count": len(seed.get("rules", [])),
            "rules": seed.get("rules", []),
        }
    else:
        try:
            rules = fetch_all(service_key)
        except Exception as exc:  # noqa: BLE001
            print(f"[fetch_dur_rules] API 호출 실패, 목업으로 대체합니다: {exc}")
            seed = load_mock()
            rules = seed.get("rules", [])
            source = f"mock-fallback (API 오류: {exc})"
        else:
            source = "data.go.kr DUR품목정보 API (getUsjntTabooInfoList03, 병용금기)"

        out = {
            "updated": date.today().isoformat(),
            "source": source,
            "rule_count": len(rules),
            "rules": rules,
        }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps(out, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[fetch_dur_rules] 저장 완료: {OUT_FILE} (규칙 {out['rule_count']}건, source={out['source']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
