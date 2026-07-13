"""
HIRA(건강보험심사평가원) 약제급여목록표 게시판에서 최신 xlsx를 자동으로 찾아 다운로드한다.

동작 원리
---------
게시판 상세페이지(HIRAA030014050000)는 각 게시물마다 '이전글/다음글' 링크를 제공한다.
직전 실행에서 저장해 둔 마지막 게시물 번호(brdBltNo)부터 시작해 '다음글'을 따라가며
"다음글이 없습니다"가 나올 때까지 전진하면, 별도의 목록 페이지 파싱 없이도
가장 최신 게시물을 안정적으로 찾을 수 있다.

state 파일(data/state.json)에 마지막으로 처리한 게시물 번호를 저장해두고,
다음 실행 때 그 지점부터 이어서 탐색한다.
"""
import json
import re
import sys
from pathlib import Path

import requests

# Windows 콘솔(cp949)에서도 한글 로그가 깨지지 않도록 stdout을 UTF-8로 강제한다.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://www.hira.or.kr"
PGMID = "HIRAA030014050000"
BRD_SCN_BLT_NO = "4"
DETAIL_URL = f"{BASE}/bbsDummyKR.do"
DOWNLOAD_URL = f"{BASE}/bbs/bbsCDownLoad.do"

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
STATE_FILE = DATA_DIR / "state.json"

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DUR_application-bot"}

# 최초 실행 시(state 파일이 없을 때) 탐색을 시작할 게시물 번호.
# 2026.07.01자 공지 기준값이며, 이후로는 state.json이 대신한다.
FALLBACK_BRD_BLT_NO = 1707

TITLE_RE = re.compile(r'<div class="title">\s*([^<]+?)\s*</div>')
DOWNLOAD_ONCLICK_RE = re.compile(
    r"downLoadBbs\('(\d+)','(\d+)','(\d+)','(\d+)'\)"
)
NEXT_POST_RE = re.compile(
    r'th_next">다음글</dt>\s*<dd[^>]*>\s*(?:<a href="\?pgmid=' + PGMID
    + r'&brdScnBltNo=' + BRD_SCN_BLT_NO + r'&brdBltNo=(\d+)"[^>]*>([^<]+)</a>)?'
)
CONTENT_DISPOSITION_FILENAME_RE = re.compile(r'filename="([^"]+)"')


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"brd_blt_no": FALLBACK_BRD_BLT_NO}


def save_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_detail(brd_blt_no: int) -> str:
    params = {
        "pgmid": PGMID,
        "brdScnBltNo": BRD_SCN_BLT_NO,
        "brdBltNo": brd_blt_no,
        "pageIndex": 1,
        "pageIndex2": 1,
    }
    resp = requests.get(DETAIL_URL, params=params, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return resp.text


def find_latest_brd_blt_no(start: int) -> int:
    """start 게시물부터 '다음글'을 따라가며 진짜 최신 게시물 번호를 찾는다."""
    current = start
    seen = set()
    while True:
        if current in seen:
            # 안전장치: 순환 참조 방지
            break
        seen.add(current)
        html = fetch_detail(current)
        m = NEXT_POST_RE.search(html)
        if not m or not m.group(1):
            return current
        current = int(m.group(1))
    return current


def parse_download_params(html: str):
    m = DOWNLOAD_ONCLICK_RE.search(html)
    if not m:
        raise RuntimeError("첨부파일 다운로드 링크(downLoadBbs)를 찾을 수 없습니다.")
    file_no, apnd_brd_blt_no, apnd_brd_ty_no, apnd_blt_no = m.groups()
    return {
        "apndNo": file_no,
        "apndBrdBltNo": apnd_brd_blt_no,
        "apndBrdTyNo": apnd_brd_ty_no,
        "apndBltNo": apnd_blt_no,
    }


def parse_title(html: str) -> str:
    m = TITLE_RE.search(html)
    return m.group(1).strip() if m else ""


def download_attachment(params: dict, referer_brd_blt_no: int) -> tuple[bytes, str]:
    headers = dict(HEADERS)
    headers["Referer"] = (
        f"{DETAIL_URL}?pgmid={PGMID}&brdScnBltNo={BRD_SCN_BLT_NO}"
        f"&brdBltNo={referer_brd_blt_no}"
    )
    resp = requests.get(DOWNLOAD_URL, params=params, headers=headers, timeout=60)
    resp.raise_for_status()
    filename = "약제급여목록표.xlsx"
    cd = resp.headers.get("Content-Disposition", "")
    m = CONTENT_DISPOSITION_FILENAME_RE.search(cd)
    if m:
        raw_name = m.group(1)
        try:
            # requests는 HTTP 헤더를 라틴-1로 디코드하므로, 서버가 실제로 보낸
            # UTF-8 파일명을 복원하려면 한 번 더 latin-1 -> utf-8 변환이 필요하다.
            filename = raw_name.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            filename = raw_name
    return resp.content, filename


def main() -> int:
    state = load_state()
    start = int(state.get("brd_blt_no", FALLBACK_BRD_BLT_NO))

    print(f"[fetch_price_list] {start}번 게시물부터 최신 게시물 탐색 시작")
    latest = find_latest_brd_blt_no(start)
    print(f"[fetch_price_list] 최신 게시물 번호: {latest}")

    html = fetch_detail(latest)
    title = parse_title(html)
    print(f"[fetch_price_list] 최신 게시물 제목: {title}")

    if latest == state.get("brd_blt_no") and RAW_DIR.exists() and any(RAW_DIR.iterdir()):
        print("[fetch_price_list] 이미 최신 상태입니다. 다운로드를 생략합니다.")
        return 0

    dl_params = parse_download_params(html)
    content, filename = download_attachment(dl_params, latest)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    # 매달 새 파일로 남기되, 파서가 항상 참조할 고정 파일명도 함께 저장한다.
    dest = RAW_DIR / filename
    dest.write_bytes(content)
    latest_path = RAW_DIR / "latest.xlsx"
    latest_path.write_bytes(content)

    print(f"[fetch_price_list] 저장 완료: {dest} ({len(content):,} bytes)")

    state.update({
        "brd_blt_no": latest,
        "title": title,
        "filename": filename,
    })
    save_state(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
