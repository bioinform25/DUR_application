"""
성분명 정규화 유틸리티.

HIRA 급여목록표의 '주성분명'은 같은 성분이라도 제품마다 용량 표기가 붙어
"warfarin sodium   2mg", "warfarin sodium   5mg" 처럼 서로 다른 문자열로
나타난다. 반면 병용금기 등 DUR 규칙은 '성분' 단위로 정의되므로, 용량이나
염(salt) 부가정보를 제거한 핵심 성분명을 공통 매칭 키로 사용해야 두 데이터를
연결할 수 있다.

이 모듈의 normalize_ingredient_name()이 그 매칭 키를 만든다.
프론트엔드 js/app.js에도 동일한 로직이 이식되어 있으니(js/normalize.js),
규칙을 바꿀 때는 두 파일을 함께 수정해야 한다.
"""
import re

_PAREN_RE = re.compile(r"\([^()]*\)")
_TRAILING_DOSE_RE = re.compile(
    r"\s+(?:as\s+[a-z0-9\- ]+\s*)?[\d.]+\s*(?:mg|g|mcg|ug|iu|%|ml)\b.*$",
    re.IGNORECASE,
)
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_ingredient_name(raw: str) -> str:
    if not raw:
        return ""
    name = raw.lower()
    name = _PAREN_RE.sub(" ", name)          # 괄호 부가설명 제거
    name = _TRAILING_DOSE_RE.sub("", name)   # 뒤에 붙는 용량 표기 제거
    name = _WHITESPACE_RE.sub(" ", name).strip()
    return name


def split_ingredient_keys(raw: str) -> list:
    """복합제(2성분 이상)는 '주성분명'이 쉼표로 나열된다.
    예: "aspirin   0.1g, clopidogrel bisulfate (as clopidogrel   75mg)"
    -> ["aspirin", "clopidogrel bisulfate"]
    각 성분을 분리해 정규화한 키 목록을 돌려준다(중복/공백 제거).
    """
    if not raw:
        return []
    keys = []
    for part in raw.split(","):
        key = normalize_ingredient_name(part)
        if key and key not in keys:
            keys.append(key)
    return keys
