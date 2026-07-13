# 알리약 (Ali-Yak)

여러 약을 함께 검색해서 바구니에 담으면, 건강보험심사평가원 약제급여목록표와 공공 DUR 데이터를 기준으로
병용금기·주의사항을 한 번에 보여주는 프로토타입 웹앱입니다. 빌드 도구 없이 순수 HTML/CSS/JS로 만들어져
GitHub Pages에 바로 배포할 수 있고, 추후 Capacitor 등으로 모바일 앱화하기도 쉽습니다.

## 폴더 구조

```
index.html            메인 페이지
css/style.css          스타일 (밝고 큰 글씨, 40~50대 이상 사용자 고려)
js/app.js              검색·자동완성·바구니·DUR 분석 로직
js/normalize.js         성분명 정규화(파이썬 scripts/normalize.py와 동일 로직 유지 필요)
data/drugs.json         HIRA 급여목록표에서 생성한 상품명/성분명 검색 데이터
data/dur_rules.json     병용금기 등 DUR 규칙 데이터
data/state.json         마지막으로 처리한 HIRA 게시물 번호(자동 갱신용 상태)
scripts/fetch_price_list.py   HIRA 게시판에서 최신 급여목록표 xlsx 자동 탐색·다운로드
scripts/parse_price_list.py   xlsx -> data/drugs.json 변환
scripts/fetch_dur_rules.py    data.go.kr DUR API -> data/dur_rules.json 변환 (키 없으면 목업 사용)
scripts/normalize.py          성분명 정규화 공용 함수
scripts/mock_dur_rules_seed.json  API 키가 없을 때 사용하는 데모용 병용금기 데이터
.github/workflows/monthly-update.yml  매달 자동 갱신 워크플로
```

## 로컬에서 실행하기

Node.js 없이 정적 파일만으로 동작합니다. 아무 정적 서버로 열면 됩니다.

```bash
python -m http.server 8420
# 브라우저에서 http://localhost:8420 접속
```

데이터를 새로 만들고 싶다면:

```bash
pip install -r scripts/requirements.txt
python scripts/fetch_price_list.py     # data/raw/latest.xlsx 다운로드
python scripts/parse_price_list.py     # data/drugs.json 생성
python scripts/fetch_dur_rules.py      # data/dur_rules.json 생성 (DUR_API_KEY 없으면 목업)
```

## 실제 병용금기 데이터(DUR API) 연동

data.go.kr의 "식품의약품안전처_의약품안전사용서비스(DUR)품목정보" API(`getUsjntTabooInfoList03`)로
실제 병용금기 데이터(성분 조합 661건, 2026-07-13 기준)를 받아오도록 연동 및 검증을 마쳤습니다.
`DUR_API_KEY` 환경변수(GitHub Secrets에도 동일한 이름으로 등록)가 없으면
`scripts/mock_dur_rules_seed.json`의 데모 데이터로 자동 대체됩니다.

키가 없다면:
1. [공공데이터포털](https://www.data.go.kr/data/15059486/openapi.do)에서 활용신청 후 서비스키 발급(자동승인)
2. GitHub 저장소 Settings → Secrets and variables → Actions에 `DUR_API_KEY`로 등록
3. 로컬 테스트: `DUR_API_KEY=발급받은키 python scripts/fetch_dur_rules.py`

전체 데이터가 약 80만 행(제품 조합 단위)이라 페이지당 500건씩 동시 6개 요청으로 받아오며,
보통 10~15분 정도 걸립니다(재시도/배치 처리로 메모리 사용량과 일시적 오류에 안전하게 처리).

같은 서비스 그룹에는 병용금기 외에도 연령금기·임부금기·노인주의·효능군중복주의 등의
오퍼레이션이 더 있습니다. `fetch_dur_rules.py`의 `fetch_all`/`merge_items` 패턴을
그대로 복제해 추가할 수 있습니다.

## 매달 자동 갱신

`.github/workflows/monthly-update.yml`이 매달 1~5일 새벽(KST)에 자동 실행되어:

1. HIRA 게시판에서 `다음글` 링크를 따라가며 최신 급여목록표를 자동으로 찾아 다운로드
2. `data/drugs.json` 재생성
3. `DUR_API_KEY` 시크릿이 등록되어 있으면 실제 API로, 없으면 목업으로 `data/dur_rules.json` 갱신
4. 변경사항이 있으면 자동 커밋·푸시

이미 최신 상태면 다운로드를 건너뛰므로 매일 재시도해도 안전합니다.

### ⚠️ self-hosted 러너가 필요한 이유

HIRA 게시판이 GitHub 호스트 러너(클라우드 IP 대역)의 요청을 `400 Bad Request`로 차단합니다.
그래서 이 워크플로는 `runs-on: self-hosted`로 설정되어 있고, PC 한 대를 러너로 등록해둬야
매달 자동 갱신이 동작합니다.

등록 방법: GitHub 저장소 **Settings → Actions → Runners → New self-hosted runner**에서
Windows용 다운로드/등록 명령을 그대로 실행하면 되는데, 관리자 권한 PowerShell에서
`--runasservice` 옵션을 붙여 Windows 서비스로 설치해야 로그아웃/재부팅 후에도 계속 동작합니다.

```powershell
.\config.cmd --unattended --url "https://github.com/bioinform25/DUR_application" --token "<발급받은 토큰>" --runasservice --name "원하는-이름"
```

주의할 점: 이 서비스는 `NT AUTHORITY\NETWORK SERVICE` 같은 시스템 계정으로 실행되어
**사용자 계정 PATH가 아니라 시스템 전체(Machine) PATH만 봅니다.** Python이나 Git Bash가
사용자 프로필 아래(`%LOCALAPPDATA%` 등)에만 설치되어 있다면, 관리자 권한으로
시스템 PATH에도 추가해줘야 `python`/`bash` 명령을 찾을 수 있습니다:

```powershell
$machinePath = [Environment]::GetEnvironmentVariable('Path','Machine')
$newPath = $machinePath + ';C:\Program Files\Git\bin;<python.exe가 있는 폴더>'
[Environment]::SetEnvironmentVariable('Path', $newPath, 'Machine')
Restart-Service "<러너 서비스 이름>"
```

## GitHub Pages로 배포하기

1. GitHub 저장소 Settings → Pages
2. Source: `Deploy from a branch` → Branch: `main` / `/(root)` 선택
3. 몇 분 뒤 `https://bioinform25.github.io/DUR_application/` 에서 접속 가능

## 알려진 제한사항 (다음 단계 로드맵)

- **알약 사진 식별 기능은 포함하지 않았습니다.** 대신 검색창 아래에 약학정보원 알약 식별
  서비스로 이동하는 링크를 두었습니다. 실제 식별 기능을 넣으려면 알약 이미지 DB와 이미지
  인식 모델이 필요한 별도 프로젝트가 됩니다.
- **외부 링크는 약학정보원(health.kr)만 사용합니다.** 킴스온라인·드럭인포는 안정적인 딥링크를
  확인하지 못해 제외했습니다. health.kr 검색은 급여목록표의 전체 상품명(용량+괄호 성분명 포함)
  그대로 넘기면 실패하는 경우가 많아(예: "프라닥사캡슐150밀리그램(다비가트란...)" 검색 실패),
  `parse_price_list.py`의 `make_search_name()`이 괄호와 용량 표기를 제거한 핵심 상품명
  (예: "프라닥사캡슐")만 뽑아 검색어로 사용합니다.
- **복합제(2성분 이상) 매칭**은 성분명을 쉼표 기준으로 분리해 처리하지만, 3성분 이상 복합제나
  일부 표기 변형은 놓칠 수 있습니다.
- 향후 모바일 앱화는 지금의 순수 HTML/CSS/JS 구조를 그대로 [Capacitor](https://capacitorjs.com/)로
  감싸는 방식이 가장 적은 재작업으로 가능합니다.

## 의료 자문 관련 고지

이 앱은 참고용 프로토타입이며 의료진·약사의 처방과 상담을 대체하지 않습니다.
