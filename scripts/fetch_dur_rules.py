"""
식품의약품안전처 '의약품안전사용서비스(DUR)품목정보' Open API에서
병용금기 정보를 가져와 data/dur_rules.json으로 정규화한다.

API 키가 없으면(로컬 최초 실행, PR 미리보기 등) scripts/mock_dur_rules_seed.json을
그대로 사용해 프론트엔드가 항상 동작하도록 한다.

⚠️ 엔드포인트 검증 상태
-----------------------
data.go.kr의 Swagger 문서는 로그인 후 브라우저에서만 렌더링되어 이 스크립트를
작성하는 시점에는 자동으로 최종 확인하지 못했다. 아래 BASE_URL/OPERATION은
공개된 예제 코드(GitHub: jjscan/data.go.kr-1, DURPrdlstInfoService.R)를 근거로
작성했으며, 실제 서비스 키를 발급받은 뒤 마이페이지의 '활용신청 상세'에서
정확한 엔드포인트(버전 접미사 포함 여부 등)를 한 번 확인해 필요하면 아래
BASE_URL 상수만 수정하면 된다. 응답 필드 매핑(ITEM_NAME, INGR_KOR_NAME,
MIXTURE_INGR_KOR_NAME, PROHBT_CONTENT 등)은 동일 문서 기준으로 비교적 신뢰도가
높다.

이 API는 '병용금기'만 제공하는 것이 아니라 동일 서비스 그룹 안에
연령금기(getSpcifyAgrdeTabooInfoList), 임부금기(getPwomanTabooInfoList),
노인주의(getOdsnAtentInfoList), 효능군중복주의(getEfcyDplctInfoList) 등의
오퍼레이션도 함께 제공된다. 지금은 핵심인 병용금기만 구현했고, 동일한
fetch_operation() 패턴으로 나머지도 손쉽게 추가할 수 있다.
"""
import json
import os
import sys
from datetime import date
from pathlib import Path
from urllib.parse import unquote

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from normalize import normalize_ingredient_name  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUT_FILE = DATA_DIR / "dur_rules.json"
MOCK_SEED = Path(__file__).resolve().parent / "mock_dur_rules_seed.json"

BASE_URL = "http://apis.data.go.kr/1470000/DURPrdlstInfoService/getUsjntTabooInfoList"
NUM_OF_ROWS = 100


def get_api_key() -> str:
    # data.go.kr에서 발급하는 서비스키는 이미 URL 인코딩되어 있는 경우가 많다.
    # requests가 다시 인코딩하면서 이중 인코딩되는 문제를 피하려고 한 번 디코드해 둔다.
    raw = os.environ.get("DUR_API_KEY", "").strip()
    return unquote(raw) if raw else ""


def fetch_page(service_key: str, page_no: int) -> dict:
    params = {
        "serviceKey": service_key,
        "pageNo": page_no,
        "numOfRows": NUM_OF_ROWS,
        "type": "json",
    }
    resp = requests.get(BASE_URL, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def normalize_items(items: list) -> list:
    rules = []
    for item in items:
        ingr_a = item.get("INGR_KOR_NAME") or item.get("INGR_ENG_NAME") or ""
        ingr_b = (
            item.get("MIXTURE_INGR_KOR_NAME")
            or item.get("MIXTURE_INGR_ENG_NAME")
            or ""
        )
        key_a = normalize_ingredient_name(ingr_a)
        key_b = normalize_ingredient_name(ingr_b)
        if not key_a or not key_b:
            continue

        rules.append({
            "id": f"DUR-{item.get('DUR_SEQ', '')}",
            "category": item.get("TYPE_NAME") or "병용금기",
            "severity": "contraindicated",
            "ingredient_keys": [key_a, key_b],
            "title": f"{ingr_a.strip()} - {ingr_b.strip()}",
            "description": item.get("PROHBT_CONTENT") or "",
            "management": item.get("REMARK") or "",
            "reference_items": [
                item.get("ITEM_NAME") or "",
                item.get("MIXTURE_ITEM_NAME") or "",
            ],
        })
    return rules


def fetch_all(service_key: str) -> list:
    all_rules = []
    page_no = 1
    while True:
        payload = fetch_page(service_key, page_no)
        body = payload.get("response", {}).get("body", {})
        total_count = int(body.get("totalCount", 0))
        items = body.get("items")
        if items in (None, "", []):
            break
        # 단일 결과일 때 dict로, 복수일 때 list로 오는 흔한 data.go.kr 응답 패턴 처리
        item_list = items.get("item") if isinstance(items, dict) else items
        if isinstance(item_list, dict):
            item_list = [item_list]
        if not item_list:
            break

        all_rules.extend(normalize_items(item_list))
        print(f"[fetch_dur_rules] page {page_no} 수집 ({len(all_rules)}/{total_count})")

        if page_no * NUM_OF_ROWS >= total_count:
            break
        page_no += 1
    return all_rules


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
            source = "data.go.kr DUR품목정보 API (getUsjntTabooInfoList)"

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
