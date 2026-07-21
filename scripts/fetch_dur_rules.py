"""
식품의약품안전처 '의약품안전사용서비스(DUR)품목정보' Open API에서
병용금기 / 노인주의 / 특정연령대금기 / 투여기간주의 / 용량주의 / 효능군중복주의
정보를 가져와 data/dur_rules.json으로 정규화한다.

API 키가 없으면(로컬 최초 실행, PR 미리보기 등) scripts/mock_dur_rules_seed.json을
그대로 사용해 프론트엔드가 항상 동작하도록 한다.

엔드포인트: 1471000/DURPrdlstInfoService03 (공식 문서가 없어 실제 서비스키로
직접 여러 오퍼레이션 이름을 시도해 확인함 - 아래 목록 외의 이름은 404였다).
- getUsjntTabooInfoList03      : 병용금기 (성분쌍 단위, MIXTURE_* 필드로 상대 성분 제공)
- getOdsnAtentInfoList03       : 노인주의 (성분 단일 단위)
- getSpcifyAgrdeTabooInfoList03: 특정연령대금기 (성분 단일, PROHBT_CONTENT에 연령 조건 텍스트)
- getMdctnPdAtentInfoList03    : 투여기간주의 (성분 단일)
- getCpctyAtentInfoList03      : 용량주의 (성분 단일)
- getEfcyDplctInfoList03       : 효능군중복주의 (성분 단일 + EFFECT_NAME 효능군.
  같은 효능군에 속한 서로 다른 성분 2개를 함께 먹으면 중복으로 본다 - 병용금기처럼
  미리 정해진 쌍이 아니라 '같은 그룹에 속하는지'로 런타임에 판정해야 해서, 다른
  오퍼레이션들과 달리 rules 배열이 아니라 duplicate_groups(효능군 -> 성분키 목록)
  형태로 별도 저장한다.
- getPwnmTabooInfoList03       : 임부금기 (성분 단일 단위, 다른 단일성분 카테고리와
  응답 구조 동일 - 실제 서비스키로 호출 확인함, 2026-07 기준 16,023건)

같은 서비스 그룹에 서방정분할주의도 있다고 알려져 있으나 정확한 오퍼레이션 이름을
확인하지 못했다(추정 이름들 모두 404). data.go.kr 마이페이지의 Swagger 문서에서
정확한 이름을 확인하면 동일한 fetch_single_ingredient_category() 패턴으로 손쉽게
추가할 수 있다.
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

API_BASE = "https://apis.data.go.kr/1471000/DURPrdlstInfoService03"
URL_USJNT_TABOO = f"{API_BASE}/getUsjntTabooInfoList03"
URL_ODSN_ATENT = f"{API_BASE}/getOdsnAtentInfoList03"
URL_SPCIFY_AGRDE = f"{API_BASE}/getSpcifyAgrdeTabooInfoList03"
URL_MDCTN_PD = f"{API_BASE}/getMdctnPdAtentInfoList03"
URL_CPCTY = f"{API_BASE}/getCpctyAtentInfoList03"
URL_EFCY_DPLCT = f"{API_BASE}/getEfcyDplctInfoList03"
URL_PWNM_TABOO = f"{API_BASE}/getPwnmTabooInfoList03"

NUM_OF_ROWS = 500  # 이 오퍼레이션들이 허용하는 페이지당 최대 건수
MAX_REFERENCE_ITEMS = 3  # 성분 조합당 예시로 보여줄 실제 제품명 개수
MAX_RETRIES = 4
RETRY_BACKOFF_BASE = 1.5  # 초 단위, 지수 백오프
CONCURRENT_WORKERS = 6  # 공공기관 API라 과도하게 몰아치지 않도록 동시 요청 수를 제한


def get_api_key() -> str:
    # data.go.kr에서 발급하는 서비스키는 이미 URL 인코딩되어 있는 경우가 많다.
    # requests가 다시 인코딩하면서 이중 인코딩되는 문제를 피하려고 한 번 디코드해 둔다.
    raw = os.environ.get("DUR_API_KEY", "").strip()
    return unquote(raw) if raw else ""


def fetch_page(service_key: str, page_no: int, base_url: str) -> dict:
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
            resp = requests.get(base_url, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_BASE * (2 ** attempt))
    raise last_exc


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
    # 이 오퍼레이션들의 실제 응답은 {"header":..., "body":...} 형태로, 흔한
    # data.go.kr의 {"response":{"header":...,"body":...}} 포맷과 다르다.
    return payload.get("body") or payload.get("response", {}).get("body", {})


def paginate(service_key: str, base_url: str, on_items, label: str) -> None:
    """1페이지로 총 건수를 파악한 뒤 나머지를 배치 동시요청으로 받아 on_items(items)에
    넘긴다. 실패 페이지는 건너뛰고(극히 일부 손실 감수), 첫 페이지 실패는 그대로
    예외를 던져 main()이 전체를 목업으로 폴백하도록 한다."""
    first_payload = fetch_page(service_key, 1, base_url)
    body = get_body(first_payload)
    total_count = int(body.get("totalCount", 0))
    if total_count == 0:
        return
    on_items(extract_items(body))

    total_pages = math.ceil(total_count / NUM_OF_ROWS)
    completed = 1
    failed_pages = []

    def fetch_one(page_no: int):
        try:
            payload = fetch_page(service_key, page_no, base_url)
            return page_no, extract_items(get_body(payload))
        except Exception:  # noqa: BLE001
            return page_no, None

    remaining_pages = list(range(2, total_pages + 1))
    # concurrent.futures의 Future는 완료된 결과를 계속 들고 있어서, 페이지 수가 많은
    # 오퍼레이션에서 전부 한 번에 submit하면 메모리가 계속 불어난다. 배치 단위로
    # 나눠 제출/소비하면서 매 배치가 끝날 때 futures를 새로 만들어 GC되게 한다.
    batch_size = CONCURRENT_WORKERS * 10

    with ThreadPoolExecutor(max_workers=CONCURRENT_WORKERS) as executor:
        for start in range(0, len(remaining_pages), batch_size):
            batch = remaining_pages[start:start + batch_size]
            futures = [executor.submit(fetch_one, p) for p in batch]
            for future in as_completed(futures):
                page_no, items = future.result()
                completed += 1
                if items is None:
                    failed_pages.append(page_no)
                else:
                    on_items(items)
            futures = None

            print(f"[fetch_dur_rules] [{label}] {completed}/{total_pages}페이지 처리 (실패 {len(failed_pages)}건)")

    if failed_pages:
        preview = failed_pages[:20]
        more = "..." if len(failed_pages) > 20 else ""
        print(f"[fetch_dur_rules] [{label}] 재시도 후에도 실패한 페이지 {len(failed_pages)}개: {preview}{more}")


def ingredient_key_from(item: dict, eng_field: str, kor_field: str) -> str:
    eng = (item.get(eng_field) or "").strip()
    kor = (item.get(kor_field) or "").strip()
    # drugs.json의 ingredient_keys는 영문 성분명 기준으로 정규화되어 있어, 영문명을
    # 우선 사용해야 두 데이터가 같은 키로 매칭된다.
    return normalize_ingredient_name(eng) or normalize_ingredient_name(kor)


def fetch_usjnt_taboo(service_key: str) -> list:
    """병용금기: API가 '성분 조합'이 아니라 '제품 조합' 단위로 행을 주므로(동일
    성분쌍이 제조사 수만큼 중복), 정규화된 성분명 쌍 기준으로 합쳐서 누적한다."""
    rules_by_pair: dict = {}

    def on_items(items):
        for item in items:
            key_a = ingredient_key_from(item, "INGR_ENG_NAME", "INGR_KOR_NAME")
            key_b = ingredient_key_from(item, "MIXTURE_INGR_ENG_NAME", "MIXTURE_INGR_KOR_NAME")
            if not key_a or not key_b or key_a == key_b:
                continue

            pair_key = tuple(sorted([key_a, key_b]))
            entry = rules_by_pair.get(pair_key)
            if entry is None:
                ingr_a_kor = item.get("INGR_KOR_NAME") or item.get("INGR_ENG_NAME") or ""
                ingr_b_kor = item.get("MIXTURE_INGR_KOR_NAME") or item.get("MIXTURE_INGR_ENG_NAME") or ""
                entry = {
                    "id": f"DUR-{item.get('DUR_SEQ', '')}",
                    "category": item.get("TYPE_NAME") or "병용금기",
                    "severity": "contraindicated",
                    "ingredient_keys": list(pair_key),
                    "title": f"{ingr_a_kor.strip()} - {ingr_b_kor.strip()}",
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

    paginate(service_key, URL_USJNT_TABOO, on_items, label="병용금기")
    return list(rules_by_pair.values())


def fetch_single_ingredient_category(
    service_key: str,
    base_url: str,
    id_prefix: str,
    severity: str,
    default_description: str,
    label: str,
) -> list:
    """성분 단일 기준 주의사항 오퍼레이션들의 공용 처리기
    (노인주의/특정연령대금기/투여기간주의/용량주의 - 전부 응답 구조가 동일하다)."""
    rules_by_ingr: dict = {}

    def on_items(items):
        for item in items:
            key = ingredient_key_from(item, "INGR_ENG_NAME", "INGR_NAME")
            if not key:
                continue
            entry = rules_by_ingr.get(key)
            if entry is None:
                ingr_kor = item.get("INGR_NAME") or item.get("INGR_ENG_NAME") or ""
                category = item.get("TYPE_NAME") or label
                entry = {
                    "id": f"{id_prefix}-{key}",
                    "category": category,
                    "severity": severity,
                    "ingredient_keys": [key],
                    "title": f"{ingr_kor.strip()} ({label})",
                    "description": item.get("PROHBT_CONTENT") or default_description,
                    "management": item.get("REMARK") or "",
                    "reference_items": [],
                    "product_pair_count": 0,
                }
                rules_by_ingr[key] = entry
            entry["product_pair_count"] += 1
            name = item.get("ITEM_NAME")
            if name and name not in entry["reference_items"] and len(entry["reference_items"]) < MAX_REFERENCE_ITEMS:
                entry["reference_items"].append(name)

    paginate(service_key, base_url, on_items, label=label)
    return list(rules_by_ingr.values())


def fetch_efcy_dplct(service_key: str) -> dict:
    """효능군중복주의: 병용금기처럼 미리 정해진 쌍이 아니라, 같은 EFFECT_NAME(효능군)에
    속한 서로 다른 성분을 함께 먹으면 중복으로 본다. 그래서 규칙 목록이 아니라
    '효능군 -> 소속 성분키 목록' 맵으로 반환하고, 실제 두 성분이 겹치는지는
    프론트에서 바구니 조합마다 판정한다."""
    groups: dict = {}

    def on_items(items):
        for item in items:
            effect_name = (item.get("EFFECT_NAME") or "").strip()
            key = ingredient_key_from(item, "INGR_ENG_NAME", "INGR_NAME")
            if not effect_name or not key:
                continue
            groups.setdefault(effect_name, set()).add(key)

    paginate(service_key, URL_EFCY_DPLCT, on_items, label="효능군중복")
    # 성분이 1개뿐인 효능군은 "중복"이 성립하지 않으니 제외
    return {name: sorted(keys) for name, keys in groups.items() if len(keys) > 1}


def load_mock() -> dict:
    return json.loads(MOCK_SEED.read_text(encoding="utf-8"))


def compute_changelog(old_out: dict, rules: list, duplicate_groups: dict) -> dict:
    """이전 실행 결과와 비교해 카테고리별 건수 변화를 사람이 읽을 수 있는 목록으로
    만든다. 처음 실행하거나(예: 새 카테고리를 막 추가한 경우) 이전 데이터가 없으면
    changes가 비어있을 수 있다 - 그 자체로 '이번이 첫 기준점'이라는 뜻이라 문제 없다."""
    old_rules = (old_out or {}).get("rules", [])

    def category_counts(rule_list):
        counts: dict = {}
        for r in rule_list:
            cat = r.get("category", "기타")
            counts[cat] = counts.get(cat, 0) + 1
        return counts

    old_counts = category_counts(old_rules)
    new_counts = category_counts(rules)

    changes = []
    for cat in sorted(set(old_counts) | set(new_counts)):
        old_c = old_counts.get(cat, 0)
        new_c = new_counts.get(cat, 0)
        if old_c != new_c:
            diff = new_c - old_c
            sign = "+" if diff > 0 else ""
            changes.append(f"{cat} {sign}{diff}건 ({old_c}→{new_c})")

    old_dup = (old_out or {}).get("duplicate_group_count", 0)
    new_dup = len(duplicate_groups)
    if old_dup != new_dup:
        diff = new_dup - old_dup
        sign = "+" if diff > 0 else ""
        changes.append(f"효능군중복 그룹 {sign}{diff}개 ({old_dup}→{new_dup})")

    return {
        "previous_updated": (old_out or {}).get("updated"),
        "changes": changes,
    }


def main() -> int:
    old_out = None
    if OUT_FILE.exists():
        try:
            old_out = json.loads(OUT_FILE.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            old_out = None

    service_key = get_api_key()

    if not service_key:
        print("[fetch_dur_rules] DUR_API_KEY가 설정되지 않아 목업(mock) 데이터를 사용합니다.")
        seed = load_mock()
        rules = seed.get("rules", [])
        duplicate_groups = seed.get("duplicate_groups", {})
        source = seed.get("source", "mock")
    else:
        try:
            taboo_rules = fetch_usjnt_taboo(service_key)
            elderly_rules = fetch_single_ingredient_category(
                service_key, URL_ODSN_ATENT, "ODSN", "elderly-caution",
                "고령 환자에서 이상반응 위험이 높아 신중한 투여가 필요한 성분입니다.", "노인주의",
            )
            age_rules = fetch_single_ingredient_category(
                service_key, URL_SPCIFY_AGRDE, "AGRDE", "age-restricted",
                "특정 연령대에서는 사용이 제한되는 성분입니다.", "특정연령대금기",
            )
            duration_rules = fetch_single_ingredient_category(
                service_key, URL_MDCTN_PD, "MDCTNPD", "duration-caution",
                "장기간 투여 시 주의가 필요한 성분입니다. 정해진 투여기간을 지켜야 합니다.", "투여기간주의",
            )
            dose_rules = fetch_single_ingredient_category(
                service_key, URL_CPCTY, "CPCTY", "dose-caution",
                "용량 조절이 특히 중요한 성분입니다. 정해진 용량을 초과하지 않도록 주의해야 합니다.", "용량주의",
            )
            pregnancy_rules = fetch_single_ingredient_category(
                service_key, URL_PWNM_TABOO, "PWNM", "pregnancy-caution",
                "임신 중 사용 시 태아에 위험할 수 있어 주의가 필요한 성분입니다.", "임부금기",
            )
            duplicate_groups = fetch_efcy_dplct(service_key)
        except Exception as exc:  # noqa: BLE001
            print(f"[fetch_dur_rules] API 호출 실패, 목업으로 대체합니다: {exc}")
            seed = load_mock()
            rules = seed.get("rules", [])
            duplicate_groups = seed.get("duplicate_groups", {})
            source = f"mock-fallback (API 오류: {exc})"
        else:
            rules = taboo_rules + elderly_rules + age_rules + duration_rules + dose_rules + pregnancy_rules
            source = "data.go.kr DUR품목정보 API (병용금기+노인주의+특정연령대금기+투여기간주의+용량주의+효능군중복주의+임부금기)"

    changelog = compute_changelog(old_out, rules, duplicate_groups)

    out = {
        "updated": date.today().isoformat(),
        "source": source,
        "rule_count": len(rules),
        "rules": rules,
        "duplicate_groups": duplicate_groups,
        "duplicate_group_count": len(duplicate_groups),
        "changelog": changelog,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"[fetch_dur_rules] 저장 완료: {OUT_FILE} "
        f"(규칙 {out['rule_count']}건, 효능군 {out['duplicate_group_count']}개, source={out['source']})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
