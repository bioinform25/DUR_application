# DUR 도우미

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

## 실제 병용금기 데이터(DUR API) 연동하기

지금은 `scripts/mock_dur_rules_seed.json`에 담긴 8건의 예시 규칙(와파린-클래리스로마이신 등
실제 성분코드를 기준으로 만든 데모 데이터)으로 동작합니다. 실제 서비스로 쓰려면:

1. [공공데이터포털](https://www.data.go.kr/data/15059486/openapi.do)에서
   "식품의약품안전처_의약품안전사용서비스(DUR)품목정보" Open API 활용신청 후 서비스키 발급
2. 승인 후 마이페이지의 Swagger 문서에서 `getUsjntTabooInfoList` 오퍼레이션의
   정확한 엔드포인트(버전 접미사 등)를 확인하고, 다르다면 `scripts/fetch_dur_rules.py`의
   `BASE_URL` 상수만 수정
   - ⚠️ 이 스크립트의 엔드포인트/필드명은 공개된 예제 코드를 근거로 작성했고, 이 프로젝트를
     만드는 시점에는 Swagger 문서를 직접 열람하지 못해 최종 확인이 필요합니다.
3. GitHub 저장소 Settings → Secrets and variables → Actions에서
   `DUR_API_KEY`라는 이름으로 발급받은 서비스키를 등록 (자동 갱신 워크플로가 사용)
4. 로컬 테스트 시에는 환경변수로 지정: `DUR_API_KEY=발급받은키 python scripts/fetch_dur_rules.py`

같은 서비스 그룹에는 병용금기 외에도 연령금기·임부금기·노인주의·효능군중복주의 등의
오퍼레이션이 더 있습니다. `fetch_dur_rules.py`의 `fetch_all`/`normalize_items` 패턴을
그대로 복제해 추가하면 됩니다.

## 매달 자동 갱신

`.github/workflows/monthly-update.yml`이 매달 1~5일 새벽(KST)에 자동 실행되어:

1. HIRA 게시판에서 `다음글` 링크를 따라가며 최신 급여목록표를 자동으로 찾아 다운로드
2. `data/drugs.json` 재생성
3. `DUR_API_KEY` 시크릿이 등록되어 있으면 실제 API로, 없으면 목업으로 `data/dur_rules.json` 갱신
4. 변경사항이 있으면 자동 커밋·푸시

이미 최신 상태면 다운로드를 건너뛰므로 매일 재시도해도 안전합니다.

## GitHub Pages로 배포하기

1. GitHub 저장소 Settings → Pages
2. Source: `Deploy from a branch` → Branch: `main` / `/(root)` 선택
3. 몇 분 뒤 `https://bioinform25.github.io/DUR_application/` 에서 접속 가능

## 알려진 제한사항 (다음 단계 로드맵)

- **알약 사진 식별 기능은 포함하지 않았습니다.** 대신 검색창 아래에 약학정보원 알약 식별
  서비스로 이동하는 링크를 두었습니다. 실제 식별 기능을 넣으려면 알약 이미지 DB와 이미지
  인식 모델이 필요한 별도 프로젝트가 됩니다.
- **킴스온라인·드럭인포 링크는 정확한 딥링크를 확인하지 못해** 네이버 사이트 지정 검색
  (`site:druginfo.co.kr`, `site:kimsonline.co.kr`)으로 대체했습니다. 약학정보원(health.kr)은
  검색어를 넘기는 딥링크를 확인했습니다.
- **DUR API 연동은 위에 설명한 대로 최종 검증이 필요합니다.**
- **복합제(2성분 이상) 매칭**은 성분명을 쉼표 기준으로 분리해 처리하지만, 3성분 이상 복합제나
  일부 표기 변형은 놓칠 수 있습니다.
- 향후 모바일 앱화는 지금의 순수 HTML/CSS/JS 구조를 그대로 [Capacitor](https://capacitorjs.com/)로
  감싸는 방식이 가장 적은 재작업으로 가능합니다.

## 의료 자문 관련 고지

이 앱은 참고용 프로토타입이며 의료진·약사의 처방과 상담을 대체하지 않습니다.
