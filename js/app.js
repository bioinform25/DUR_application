(function () {
  "use strict";

  const state = {
    drugsData: null,
    rulesData: null,
    productsByCode: {}, // product_code -> 제품 상세 (저렴한 대체약 비교용)
    pillInfoByCode: {}, // product_code(=EDI_CODE) -> 알약 모양/색깔/사진 (식약처 낱알식별정보)
    narcoticSubstances: [], // 식약처 마약류 약물 및 오남용 정보(향정신성의약품/마약 등 법적 분류)
    ingredientToGroups: {}, // ingredient_key -> 효능군 이름 목록 (효능군중복 판정용)
    suggestions: [], // 검색 대상 통합 인덱스
    basket: [],       // 담은 약 목록
    mode: "lay",      // 'lay' | 'expert'
    highlightIndex: -1,
    currentMatches: [],
    familyReadOnly: false, // 활성 가족 그룹에서 내 역할이 viewer면 바구니/알림 편집 차단
  };

  // 가족 그룹에서 "보기 전용(viewer)" 역할일 때 바구니/알림 편집을 막는다.
  // family-sync.js가 없거나 그룹에 속하지 않은 사용자에게는 항상 false라 영향 없음.
  function assertEditable() {
    if (state.familyReadOnly) {
      alert("이 그룹은 보기 전용으로 참여 중입니다. 바구니/알림 수정은 편집자만 할 수 있습니다.");
      return false;
    }
    return true;
  }

  const el = {
    searchInput: document.getElementById("search-input"),
    suggestions: document.getElementById("suggestions"),
    basketList: document.getElementById("basket-list"),
    basketReadonlyNote: document.getElementById("basket-readonly-note"),
    basketEmptyMsg: document.getElementById("basket-empty-msg"),
    basketCount: document.getElementById("basket-count"),
    clearBasketBtn: document.getElementById("clear-basket-btn"),
    basketSortSelect: document.getElementById("basket-sort-select"),
    results: document.getElementById("results"),
    modeLayBtn: document.getElementById("mode-lay-btn"),
    modeExpertBtn: document.getElementById("mode-expert-btn"),
    dataUpdated: document.getElementById("data-updated"),
    changelogText: document.getElementById("changelog-text"),
    themeToggleBtn: document.getElementById("theme-toggle-btn"),
    themeToggleLabel: document.getElementById("theme-toggle-label"),
    fontDecreaseBtn: document.getElementById("font-decrease-btn"),
    fontIncreaseBtn: document.getElementById("font-increase-btn"),
    voiceSearchBtn: document.getElementById("voice-search-btn"),
    voiceSearchHint: document.getElementById("voice-search-hint"),
    voiceSearchStatus: document.getElementById("voice-search-status"),
    printBtn: document.getElementById("print-btn"),
    emergencyCardBtn: document.getElementById("emergency-card-btn"),
    emergencyCardOverlay: document.getElementById("emergency-card-overlay"),
    emergencyCardCloseBtn: document.getElementById("emergency-card-close-btn"),
    emergencyCardTime: document.getElementById("emergency-card-time"),
    emergencyCardBody: document.getElementById("emergency-card-body"),
    emergencyCardPrintBtn: document.getElementById("emergency-card-print-btn"),
    ttsBtn: document.getElementById("tts-btn"),
    emergencyTtsBtn: document.getElementById("emergency-tts-btn"),
    printDate: document.getElementById("print-date"),
    reminderList: document.getElementById("reminder-list"),
    reminderEmptyMsg: document.getElementById("reminder-empty-msg"),
    todayScheduleWrap: document.getElementById("today-schedule-wrap"),
    todayScheduleList: document.getElementById("today-schedule-list"),
    calendarPrevBtn: document.getElementById("calendar-prev-btn"),
    calendarNextBtn: document.getElementById("calendar-next-btn"),
    calendarMonthLabel: document.getElementById("calendar-month-label"),
    calendarGrid: document.getElementById("calendar-grid"),
    ocrBtn: document.getElementById("ocr-btn"),
    ocrFileInput: document.getElementById("ocr-file-input"),
    ocrPanel: document.getElementById("ocr-panel"),
    ocrStatus: document.getElementById("ocr-status"),
    ocrResults: document.getElementById("ocr-results"),
    ocrAddBtn: document.getElementById("ocr-add-btn"),
    ocrCancelBtn: document.getElementById("ocr-cancel-btn"),
    profileAgeRange: document.getElementById("profile-age-range"),
    profileSex: document.getElementById("profile-sex"),
    profileClearBtn: document.getElementById("profile-clear-btn"),
    noteDateInput: document.getElementById("note-date-input"),
    noteTextInput: document.getElementById("note-text-input"),
    noteAddBtn: document.getElementById("note-add-btn"),
    noteList: document.getElementById("note-list"),
    noteEmptyMsg: document.getElementById("note-empty-msg"),
    medicineNameInput: document.getElementById("medicine-name-input"),
    medicineExpiryInput: document.getElementById("medicine-expiry-input"),
    medicineAddBtn: document.getElementById("medicine-add-btn"),
    medicineList: document.getElementById("medicine-list"),
    medicineEmptyMsg: document.getElementById("medicine-empty-msg"),
    allergyMemoInput: document.getElementById("allergy-memo-input"),
    allergySearchInput: document.getElementById("allergy-search-input"),
    allergySuggestions: document.getElementById("allergy-suggestions"),
    allergyList: document.getElementById("allergy-list"),
    allergyEmptyMsg: document.getElementById("allergy-empty-msg"),
    safetyLetterList: document.getElementById("safety-letter-list"),
    pillFinderBtn: document.getElementById("pill-finder-btn"),
    pillFinderPanel: document.getElementById("pill-finder-panel"),
    pillFinderShape: document.getElementById("pill-finder-shape"),
    pillFinderColor: document.getElementById("pill-finder-color"),
    pillFinderSearchBtn: document.getElementById("pill-finder-search-btn"),
    pillFinderHint: document.getElementById("pill-finder-hint"),
    pillFinderResults: document.getElementById("pill-finder-results"),
    pillPhotoBtn: document.getElementById("pill-photo-btn"),
    pillPhotoInput: document.getElementById("pill-photo-input"),
    pillPhotoStatus: document.getElementById("pill-photo-status"),
  };

  // ---------- 데이터 로딩 ----------
  async function loadData() {
    el.results.innerHTML = '<p class="loading">데이터를 불러오는 중입니다...</p>';
    const [drugsRes, rulesRes] = await Promise.all([
      fetch("data/drugs.json"),
      fetch("data/dur_rules.json"),
    ]);
    state.drugsData = await drugsRes.json();
    state.rulesData = await rulesRes.json();
    state.productsByCode = {};
    for (const p of state.drugsData.products) {
      state.productsByCode[p.product_code] = p;
    }

    // 알약 모양·색깔·사진 정보(선택 데이터) - 식약처 낱알식별정보 API 활용신청이
    // 안 된 환경이거나 파일이 없어도 앱의 핵심 기능에는 영향이 없어야 하므로 조용히 넘어간다.
    state.pillInfoByCode = {};
    try {
      const pillRes = await fetch("data/pill_info.json");
      if (pillRes.ok) {
        const pillData = await pillRes.json();
        state.pillInfoByCode = pillData.pills || {};
      }
    } catch {
      state.pillInfoByCode = {};
    }

    // 마약류 법적 분류(선택 데이터) - 마찬가지로 없어도 핵심 기능엔 영향 없음.
    state.narcoticSubstances = [];
    try {
      const narcRes = await fetch("data/narcotic_classification.json");
      if (narcRes.ok) {
        const narcData = await narcRes.json();
        state.narcoticSubstances = narcData.substances || [];
      }
    } catch {
      state.narcoticSubstances = [];
    }

    // 의약품 안전성서한(선택 데이터, 전문가모드 전용) - 없어도 핵심 기능엔 영향 없음.
    state.safetyLetters = [];
    try {
      const safRes = await fetch("data/safety_letters.json");
      if (safRes.ok) {
        const safData = await safRes.json();
        state.safetyLetters = safData.letters || [];
      }
    } catch {
      state.safetyLetters = [];
    }

    buildPillFinderOptions();

    // 효능군중복: "효능군 -> 소속 성분키 목록"을 "성분키 -> 소속 효능군 목록"으로
    // 뒤집어둬야, 바구니 두 약의 성분키가 같은 효능군을 공유하는지 빠르게 확인 가능
    state.ingredientToGroups = {};
    const duplicateGroups = state.rulesData.duplicate_groups || {};
    for (const effectName in duplicateGroups) {
      for (const key of duplicateGroups[effectName]) {
        if (!state.ingredientToGroups[key]) state.ingredientToGroups[key] = [];
        state.ingredientToGroups[key].push(effectName);
      }
    }

    buildSuggestionIndex();
    renderDataMeta();
    renderBasket();
    renderResults();
    renderSafetyLetterList();
  }

  function renderDataMeta() {
    const d = state.drugsData;
    if (!d) return;
    el.dataUpdated.textContent =
      ` (약제급여목록표 기준일: ${d.updated}, 수록 제품 ${d.product_count.toLocaleString()}건)`;

    const changelog = state.rulesData && state.rulesData.changelog;
    if (changelog && changelog.changes && changelog.changes.length) {
      el.changelogText.hidden = false;
      el.changelogText.textContent =
        `📋 지난 갱신(${changelog.previous_updated || "이전"}) 대비 변경: ${changelog.changes.join(", ")}`;
    } else {
      el.changelogText.hidden = true;
    }
  }

  function buildSuggestionIndex() {
    const list = [];
    const { products, ingredient_key_index } = state.drugsData;

    for (const key in ingredient_key_index) {
      const productCodes = ingredient_key_index[key];
      const prettyKey = prettifyKey(key);
      list.push({
        kind: "ingredient",
        key,
        label: prettyKey,
        sub: `성분명 · 관련 제품 ${productCodes.length}개`,
        searchText: key,
        ingredientKeys: [key],
        healthSearchName: prettyKey,
      });
    }

    for (const p of products) {
      list.push(productSuggestionEntry(p));
    }
    state.suggestions = list;
  }

  function productSuggestionEntry(p) {
    return {
      kind: "product",
      code: p.product_code,
      label: p.product_name_display,
      sub: `${p.company} · ${p.ingredient_name_display}`,
      searchText: (p.product_name_display + " " + p.ingredient_name_display).toLowerCase(),
      ingredientKeys: p.ingredient_keys,
      healthSearchName: p.search_name || p.product_name_display,
    };
  }

  function prettifyKey(key) {
    if (!key) return key;
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  // ---------- 모양·색깔로 찾기 (식약처 낱알식별정보) ----------
  // 모양/색깔 값 목록을 하드코딩하지 않고, 실제 로드된 데이터에서 등장하는 값만 뽑아
  // 드롭다운을 채운다 - 원본 API의 표기가 바뀌어도 항상 실제 데이터와 일치한다.
  function buildPillFinderOptions() {
    const shapes = new Set();
    const colors = new Set();
    for (const code in state.pillInfoByCode) {
      const pill = state.pillInfoByCode[code];
      if (pill.shape) shapes.add(pill.shape);
      if (pill.color1) colors.add(pill.color1);
      if (pill.color2) colors.add(pill.color2);
    }
    const fillSelect = (select, values) => {
      const sorted = [...values].sort((a, b) => a.localeCompare(b, "ko"));
      select.innerHTML = '<option value="">전체</option>' + sorted.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    };
    fillSelect(el.pillFinderShape, shapes);
    fillSelect(el.pillFinderColor, colors);
  }

  const MAX_PILL_FINDER_RESULTS = 30;

  function findProductsByAppearance(shape, color) {
    if (!shape && !color) return [];
    const results = [];
    for (const p of state.drugsData.products) {
      const pill = state.pillInfoByCode[p.product_code];
      if (!pill) continue;
      if (shape && pill.shape !== shape) continue;
      if (color && pill.color1 !== color && pill.color2 !== color) continue;
      results.push({ product: p, pill });
    }
    return results;
  }

  function renderPillFinderResults() {
    const shape = el.pillFinderShape.value;
    const color = el.pillFinderColor.value;
    const matches = findProductsByAppearance(shape, color);

    if (!shape && !color) {
      el.pillFinderHint.textContent = "모양이나 색깔을 하나 이상 골라주세요.";
      el.pillFinderResults.innerHTML = "";
      return;
    }
    if (matches.length === 0) {
      el.pillFinderHint.textContent = "해당하는 약을 찾지 못했습니다. 다른 조건으로 시도해보세요.";
      el.pillFinderResults.innerHTML = "";
      return;
    }

    const shown = matches.slice(0, MAX_PILL_FINDER_RESULTS);
    el.pillFinderHint.textContent =
      matches.length > shown.length
        ? `${matches.length.toLocaleString()}건 중 ${shown.length}건만 표시합니다. 색깔도 함께 선택하면 더 좁혀집니다.`
        : `${matches.length.toLocaleString()}건을 찾았습니다.`;

    el.pillFinderResults.innerHTML = shown
      .map(({ product, pill }, idx) => {
        const img = pill.image_url
          ? `<img src="${escapeHtml(pill.image_url)}" alt="" class="pill-thumb" loading="lazy" onerror="this.style.display='none'" />`
          : `<span class="pill-thumb pill-thumb-empty" aria-hidden="true">💊</span>`;
        return `
        <li class="pill-finder-item" data-idx="${idx}">
          ${img}
          <div class="pill-finder-item-info">
            <div class="name">${escapeHtml(product.product_name_display)}</div>
            <div class="meta">${escapeHtml(product.company)} · ${escapeHtml(pill.chart || "")}</div>
          </div>
          <button type="button" class="link-btn pill-finder-add-btn" data-idx="${idx}">담기</button>
        </li>`;
      })
      .join("");

    el.pillFinderResults.querySelectorAll(".pill-finder-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-idx"));
        addToBasket(productSuggestionEntry(shown[idx].product));
      });
    });
  }

  el.pillFinderBtn.addEventListener("click", () => {
    el.pillFinderPanel.hidden = !el.pillFinderPanel.hidden;
  });
  el.pillFinderSearchBtn.addEventListener("click", renderPillFinderResults);

  // ---------- 사진으로 색깔 자동 감지 ----------
  // 진짜 이미지 인식(어떤 약인지 자동 판별)은 하지 않는다 - 조명·각도가 제각각인
  // 사용자 사진만으로는 신뢰할 만한 정확도를 낼 수 없고, 잘못 인식하면 실제
  // 위험으로 이어질 수 있는 영역이라 섣불리 자동판정하지 않는 게 안전하다. 대신
  // 사진에서 "주요 색상"만 뽑아 색깔 필터를 자동으로 채워주는 보조 기능만 제공하고,
  // 최종 확인은 반드시 사용자가 후보 사진과 눈으로 비교하도록 안내한다(HTML의 경고 문구).
  const PILL_COLOR_REFERENCE = [
    ["하양", [248, 248, 244]],
    ["노랑", [255, 221, 89]],
    ["주황", [255, 152, 61]],
    ["분홍", [255, 178, 194]],
    ["빨강", [206, 52, 55]],
    ["갈색", [122, 82, 55]],
    ["연두", [176, 209, 106]],
    ["초록", [66, 143, 86]],
    ["청록", [45, 150, 150]],
    ["파랑", [66, 116, 191]],
    ["남색", [36, 56, 112]],
    ["보라", [141, 96, 171]],
    ["자주", [156, 58, 112]],
    ["회색", [151, 151, 151]],
    ["검정", [35, 35, 35]],
  ];

  function detectDominantColorName(img) {
    const canvas = document.createElement("canvas");
    const maxDim = 100; // 색상 판별엔 고해상도가 필요 없어 축소해서 빠르게 처리
    const scale = maxDim / Math.max(img.naturalWidth, img.naturalHeight);
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const votes = new Map(PILL_COLOR_REFERENCE.map(([name]) => [name, 0]));
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // 흰 배경(테이블/손바닥 등)과 그림자는 알약 자체의 색이 아닐 가능성이 높아 투표에서 제외
      const isNearWhiteBg = r > 235 && g > 235 && b > 230;
      const isNearBlackShadow = r < 15 && g < 15 && b < 15;
      if (isNearWhiteBg || isNearBlackShadow) continue;

      let best = null;
      let bestDist = Infinity;
      for (const [name, ref] of PILL_COLOR_REFERENCE) {
        const dist = (r - ref[0]) ** 2 + (g - ref[1]) ** 2 + (b - ref[2]) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          best = name;
        }
      }
      if (best) votes.set(best, votes.get(best) + 1);
    }

    let winner = null;
    let winnerVotes = 0;
    for (const [name, count] of votes) {
      if (count > winnerVotes) {
        winnerVotes = count;
        winner = name;
      }
    }
    return winner;
  }

  el.pillPhotoBtn.addEventListener("click", () => el.pillPhotoInput.click());

  el.pillPhotoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;

    el.pillPhotoStatus.textContent = "사진에서 색깔을 분석하는 중...";
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const colorName = detectDominantColorName(img);
      if (!colorName) {
        el.pillPhotoStatus.textContent = "색깔을 감지하지 못했습니다. 아래에서 직접 선택해주세요.";
        return;
      }
      // 드롭다운에 정확히 같은 값이 없으면(예: "노랑, 투명" 같은 복합 표기),
      // 감지한 색으로 시작하는 첫 옵션을 대신 고른다.
      const options = Array.from(el.pillFinderColor.options);
      const match = options.find((o) => o.value === colorName) || options.find((o) => o.value.startsWith(colorName));
      if (match) {
        el.pillFinderColor.value = match.value;
        el.pillFinderPanel.hidden = false;
        renderPillFinderResults();
        el.pillPhotoStatus.textContent = `📷 사진에서 "${colorName}" 계열 색상을 감지해 자동으로 선택했습니다. 아래 후보를 사진과 꼭 비교해서 확인하세요.`;
      } else {
        el.pillPhotoStatus.textContent = `"${colorName}" 계열로 보이지만 목록에 없어 자동 선택하지 못했습니다. 아래에서 직접 선택해주세요.`;
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      el.pillPhotoStatus.textContent = "사진을 불러오지 못했습니다. 다시 시도해주세요.";
    };
    img.src = url;
  });

  // ---------- 검색 히스토리 ----------
  const SEARCH_HISTORY_KEY = "dur_search_history";
  const MAX_HISTORY = 8;
  let searchHistory = loadSearchHistory();

  function loadSearchHistory() {
    try {
      const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function addToSearchHistory(item, uid) {
    searchHistory = searchHistory.filter((h) => h.uid !== uid);
    searchHistory.unshift({ ...item, uid });
    searchHistory = searchHistory.slice(0, MAX_HISTORY);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searchHistory));
  }

  function showSearchHistory() {
    if (!searchHistory.length) return;
    state.currentMatches = searchHistory;
    state.highlightIndex = -1;
    renderSuggestions(searchHistory, true);
  }

  // ---------- 검색 자동완성 ----------
  let searchDebounce = null;
  el.searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 120);
  });

  el.searchInput.addEventListener("focus", () => {
    if (!el.searchInput.value.trim()) showSearchHistory();
  });

  el.searchInput.addEventListener("keydown", (e) => {
    const items = el.suggestions.querySelectorAll(".suggestion-item");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.highlightIndex = Math.min(state.highlightIndex + 1, items.length - 1);
      updateHighlight(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.highlightIndex = Math.max(state.highlightIndex - 1, 0);
      updateHighlight(items);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (state.highlightIndex >= 0 && state.currentMatches[state.highlightIndex]) {
        addToBasket(state.currentMatches[state.highlightIndex]);
        closeSuggestions();
      }
    } else if (e.key === "Escape") {
      closeSuggestions();
    }
  });

  document.addEventListener("click", (e) => {
    if (!el.searchInput.contains(e.target) && !el.suggestions.contains(e.target)) {
      closeSuggestions();
    }
  });

  function updateHighlight(items) {
    items.forEach((it, idx) => it.classList.toggle("highlight", idx === state.highlightIndex));
  }

  // 표준 Levenshtein 편집거리. 짧은 문자열끼리만 비교하므로 성능 부담은 작다.
  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }
    return prev[n];
  }

  // label 안에서 query 길이만큼의 윈도우를 옮겨가며 가장 가까운 편집거리를 찾는다.
  // (예: "타이레늘"(오타) vs "타이레놀정500밀리그램..." 같은 긴 상품명 안에서도 앞부분만 비교)
  function fuzzyMinDistance(label, query) {
    const qLen = query.length;
    if (label.length <= qLen) return levenshtein(label, query);
    let min = Infinity;
    for (let i = 0; i <= label.length - qLen; i++) {
      const dist = levenshtein(label.slice(i, i + qLen), query);
      if (dist < min) min = dist;
      if (min === 0) break;
    }
    return min;
  }

  function runSearch() {
    const q = el.searchInput.value.trim().toLowerCase();
    if (!q || !state.suggestions.length) {
      closeSuggestions();
      return;
    }

    const starts = [];
    const contains = [];
    for (const s of state.suggestions) {
      if (s.searchText.startsWith(q) || s.label.toLowerCase().startsWith(q)) {
        starts.push(s);
      } else if (s.searchText.includes(q)) {
        contains.push(s);
      }
    }

    let matches = starts.concat(contains);

    // 정확/부분일치가 거의 없으면 오타를 감안한 유사 검색을 추가로 시도한다.
    // (매 입력마다 26,000여 건을 편집거리로 훑는 건 낭비라 결과가 부족할 때만 실행)
    if (matches.length < 5 && q.length >= 2) {
      const threshold = q.length <= 3 ? 1 : q.length <= 6 ? 2 : 3;
      const already = new Set(matches);
      const fuzzy = [];
      for (const s of state.suggestions) {
        if (already.has(s)) continue;
        const dist = fuzzyMinDistance(s.label.toLowerCase(), q);
        if (dist <= threshold) fuzzy.push({ s, dist });
      }
      fuzzy.sort((a, b) => a.dist - b.dist);
      matches = matches.concat(fuzzy.map((f) => f.s));
    }

    matches = matches.slice(0, 20);
    state.currentMatches = matches;
    state.highlightIndex = -1;
    renderSuggestions(matches);
  }

  function renderSuggestions(matches, isHistory) {
    if (!matches.length) {
      el.suggestions.innerHTML = '<div class="suggestion-empty">일치하는 약이 없습니다. 다른 이름으로 검색해보세요.</div>';
      el.suggestions.classList.add("open");
      return;
    }
    const header = isHistory ? '<div class="suggestion-history-header">최근 담은 약</div>' : "";
    el.suggestions.innerHTML =
      header +
      matches
        .map((m, idx) => {
          const tagLabel = m.kind === "product" ? "상품명" : "성분명";
          const tagClass = m.kind === "product" ? "product" : "ingredient";
          return `
        <div class="suggestion-item" data-idx="${idx}">
          <div class="suggestion-main">
            <span class="suggestion-name">${escapeHtml(m.label)}</span>
            <span class="suggestion-sub">${escapeHtml(m.sub)}</span>
          </div>
          <span class="tag ${tagClass}">${tagLabel}</span>
        </div>`;
        })
        .join("");
    el.suggestions.classList.add("open");

    el.suggestions.querySelectorAll(".suggestion-item").forEach((node) => {
      node.addEventListener("click", () => {
        const idx = Number(node.getAttribute("data-idx"));
        addToBasket(state.currentMatches[idx]);
        closeSuggestions();
      });
    });
  }

  function closeSuggestions() {
    el.suggestions.classList.remove("open");
    el.suggestions.innerHTML = "";
    el.searchInput.value = "";
    state.highlightIndex = -1;
    state.currentMatches = [];
  }

  // ---------- 바구니 ----------
  const BASKET_KEY = "dur_basket";

  function saveBasket() {
    localStorage.setItem(BASKET_KEY, JSON.stringify(state.basket));
    if (window.FamilySync) window.FamilySync.pushBasket(state.basket);
  }

  function loadBasket() {
    try {
      const raw = localStorage.getItem(BASKET_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function toBasketEntry(item) {
    return {
      uid: item.kind + ":" + (item.kind === "product" ? item.code : item.key),
      kind: item.kind,
      code: item.code,
      key: item.key,
      label: item.label,
      sub: item.sub,
      ingredientKeys: item.ingredientKeys,
      healthSearchName: item.healthSearchName || item.label,
    };
  }

  function addToBasket(item) {
    const entry = toBasketEntry(item);
    addToSearchHistory(item, entry.uid);
    if (!assertEditable()) return;
    if (state.basket.some((b) => b.uid === entry.uid)) return;
    state.basket.push(entry);
    saveBasket();
    renderBasket();
    renderResults();
  }

  function removeFromBasket(uid) {
    if (!assertEditable()) return;
    const item = state.basket.find((b) => b.uid === uid);
    if (item && !confirm(`정말로 "${item.label}"을(를) 바구니에서 삭제하시겠습니까?`)) return;
    state.basket = state.basket.filter((b) => b.uid !== uid);
    saveBasket();
    renderBasket();
    renderResults();
  }

  // 같은 브랜드(search_name, 용량/괄호 제거한 핵심 상품명)의 다른 용량 제품을 찾는다.
  // 오선택 방지용("아토젯정 10/20mg"를 담으려다 실수로 10/40mg을 담은 경우 등)이라
  // 브랜드 자체를 고정하고 용량만 다른 것만 후보로 삼는다 - 성분 키만 맞춰서 찾으면
  // 흔한 복합제(예: 아토르바스타틴+에제티미브)는 제네릭 수십 종이 한꺼번에 쏟아져
  // 나와서 오히려 헷갈린다. 다른 브랜드/제조사 비교는 이미 있는 "저렴한 대체약"
  // 기능(findCheaperAlternative)의 역할로 남겨둔다.
  function findSameIngredientProducts(basketItem) {
    if (basketItem.kind !== "product" || !basketItem.ingredientKeys || !basketItem.ingredientKeys.length) {
      return [];
    }
    const product = state.productsByCode[basketItem.code];
    if (!product || !product.search_name) return [];

    const keySet = [...basketItem.ingredientKeys].sort().join("|");
    const idx = state.drugsData.ingredient_key_index || {};
    const candidateCodes = new Set();
    for (const k of basketItem.ingredientKeys) {
      for (const code of idx[k] || []) candidateCodes.add(code);
    }
    const results = [];
    for (const code of candidateCodes) {
      if (code === basketItem.code) continue;
      const p = state.productsByCode[code];
      if (!p) continue;
      if (p.search_name !== product.search_name) continue;
      const pKeySet = [...(p.ingredient_keys || [])].sort().join("|");
      if (pKeySet !== keySet) continue;
      results.push(p);
    }
    results.sort((a, b) => a.product_name_display.localeCompare(b.product_name_display, "ko"));
    return results;
  }

  // 바구니에 실제로 함께 담은 약이 없어도, "이 약은 어떤 성분과 병용금기/병용주의인지"
  // 미리 참고할 수 있게 전체 DUR 규칙에서 이 약의 성분이 들어간 2성분 조합 규칙을 찾는다.
  // (효능군중복은 미리 정해진 쌍이 아니라 런타임 판정이라 여기서는 다루지 않는다)
  function findContraindicatedPartners(basketItem) {
    const rules = (state.rulesData && state.rulesData.rules) || [];
    const seen = new Set();
    const partners = [];
    for (const rule of rules) {
      if (!rule.ingredient_keys || rule.ingredient_keys.length !== 2) continue;
      if (rule.severity !== "contraindicated" && rule.severity !== "caution") continue;
      const [k1, k2] = rule.ingredient_keys;
      let partnerKey = null;
      if (basketItem.ingredientKeys.includes(k1) && !basketItem.ingredientKeys.includes(k2)) partnerKey = k2;
      else if (basketItem.ingredientKeys.includes(k2) && !basketItem.ingredientKeys.includes(k1)) partnerKey = k1;
      if (!partnerKey) continue;
      const dedupeKey = partnerKey + "|" + rule.id;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      partners.push({ partnerKey, rule });
    }
    partners.sort((a, b) => (a.rule.severity === b.rule.severity ? 0 : a.rule.severity === "contraindicated" ? -1 : 1));
    return partners;
  }

  // 식약처 마약류 약물 및 오남용 정보의 성분명(name_en_normalized)은 용량·염(salt)
  // 표기가 없는 "기초 성분명" 형태라(예: "nalbuphine"), 우리 ingredient_keys(예:
  // "nalbuphine hydrochloride")와 정확히 같지 않다. 그래서 정확히 같거나 "기초
  // 성분명 + 공백"으로 시작하는 것만 매칭한다 - 단순 포함(includes) 매칭은
  // "3,4,5-트리메톡시암페타민"처럼 숫자로 시작하는 이름이 엉뚱하게 매칭되는
  // 문제가 실제로 있어서(직접 검증함) 단어 경계 기준으로 엄격하게 비교한다.
  const NARCOTIC_TYPE_MESSAGES = {
    향정신성의약품: "오남용·의존성 위험이 있는 향정신성의약품입니다. 처방받은 대로만 복용하고, 임의로 양을 늘리거나 다른 사람과 나누어 복용하지 마세요.",
    마약: "마약류(의료용 마약)로 관리되는 성분입니다. 의사의 처방 없이 사용하거나 임의로 용량을 조절하면 안 되며, 의존성 위험이 있습니다.",
    환각성유해화학물: "환각성유해화학물질로 지정된 성분입니다. 오남용 시 심각한 건강 위해가 있을 수 있습니다.",
    대마: "대마 성분으로 지정된 물질입니다.",
    원료물질: "마약류 원료물질로 법에 따라 관리되는 성분입니다.",
  };

  function findNarcoticClassification(ingredientKeys) {
    if (!ingredientKeys || !ingredientKeys.length || !state.narcoticSubstances.length) return null;
    for (const key of ingredientKeys) {
      for (const substance of state.narcoticSubstances) {
        const norm = substance.name_en_normalized;
        if (key === norm || key.startsWith(norm + " ")) {
          return substance;
        }
      }
    }
    return null;
  }

  // 안전성서한은 성분명이 구조화된 필드로 안 오고 제목/본문 자유 텍스트에만
  // 있어서, 바구니 약의 정확한 상품명이 그 텍스트에 포함되는지로 "추정 매칭"만
  // 한다 - 완벽하지 않으니(표현이 다르면 놓칠 수 있음) 결과 옆에 항상 전체
  // 목록도 같이 보여준다(renderSafetyLetterList).
  function findRelatedSafetyLetters(productLabel) {
    if (!productLabel || !state.safetyLetters.length) return [];
    return state.safetyLetters.filter(
      (l) => l.title.includes(productLabel) || l.content.includes(productLabel)
    );
  }

  function renderSafetyLetterList() {
    if (!el.safetyLetterList) return;
    const recent = state.safetyLetters.slice(0, 15);
    if (!recent.length) {
      el.safetyLetterList.innerHTML = '<p class="basket-empty">불러온 안전성서한이 없습니다.</p>';
      return;
    }
    el.safetyLetterList.innerHTML = recent
      .map(
        (l) => `
      <li class="safety-letter-item">
        <div class="safety-letter-date">${escapeHtml(l.date)} · ${escapeHtml(l.category)}</div>
        <div class="safety-letter-title">${escapeHtml(l.title)}</div>
        ${l.summary ? `<div class="safety-letter-summary">${escapeHtml(l.summary)}</div>` : ""}
        ${l.attach_url ? `<a class="link-btn" href="${escapeHtml(l.attach_url)}" target="_blank" rel="noopener">원문 보기</a>` : ""}
      </li>`
      )
      .join("");
  }

  function swapBasketItem(oldUid, newProductCode) {
    if (!assertEditable()) return;
    const idx = state.basket.findIndex((b) => b.uid === oldUid);
    if (idx === -1) return;
    const product = state.productsByCode[newProductCode];
    if (!product) return;
    const entry = toBasketEntry(productSuggestionEntry(product));
    if (entry.uid === oldUid) return;
    if (state.basket.some((b) => b.uid === entry.uid)) {
      // 바꾸려는 제품이 이미 바구니에 있다면, 기존 항목은 중복이니 제거만 한다.
      state.basket.splice(idx, 1);
    } else {
      state.basket[idx] = entry;
    }
    saveBasket();
    renderBasket();
    renderResults();
  }

  // 올바른 용량인 걸 이미 확인했다면, 매번 "다른 용량으로 바꾸기"를 펼쳐볼 필요 없게
  // 그 항목만 접어둔다(취소도 가능). 바구니 항목 자체에 저장해서 가족 그룹과도
  // 함께 동기화된다 - 한 명이 확인하면 다른 멤버 화면에서도 접혀 보인다.
  function confirmDosage(uid) {
    if (!assertEditable()) return;
    const item = state.basket.find((b) => b.uid === uid);
    if (!item) return;
    item.dosageConfirmed = true;
    saveBasket();
    renderBasket();
  }

  function unconfirmDosage(uid) {
    if (!assertEditable()) return;
    const item = state.basket.find((b) => b.uid === uid);
    if (!item) return;
    item.dosageConfirmed = false;
    saveBasket();
    renderBasket();
  }

  el.clearBasketBtn.addEventListener("click", () => {
    if (!assertEditable()) return;
    if (!state.basket.length) return;
    if (!confirm(`바구니에 담긴 약 ${state.basket.length}개를 전부 삭제하시겠습니까?`)) return;
    state.basket = [];
    saveBasket();
    renderBasket();
    renderResults();
  });

  function healthKrLink(searchName) {
    const q = encodeURIComponent(searchName);
    return `https://www.health.kr/searchDrug/search_total_result.asp?search_word=${q}&search_flag=all`;
  }

  // 같은 성분코드(=동일 성분·동일 용량·동일 제형)의 다른 제조사 제품 중 더 저렴한 것을 찾는다.
  // 성분코드가 다르면(예: 용량이 다르면) 가격을 그대로 비교할 수 없어 대상에서 제외한다.
  function findCheaperAlternative(productCode) {
    const product = state.productsByCode[productCode];
    if (!product || product.price == null || !product.ingredient_code) return null;
    const group = state.drugsData.ingredients[product.ingredient_code];
    if (!group) return null;

    let cheapest = null;
    for (const code of group.product_codes) {
      const p = state.productsByCode[code];
      if (!p || p.price == null) continue;
      if (!cheapest || p.price < cheapest.price) cheapest = p;
    }
    if (!cheapest || cheapest.product_code === product.product_code || cheapest.price >= product.price) {
      return null;
    }
    return { current: product, cheapest, savings: product.price - cheapest.price };
  }

  // ---------- 바구니 정렬/순서 변경 ----------
  // "담은 순서"일 때만 사용자가 위/아래 버튼으로 직접 순서를 바꿀 수 있다(그 외
  // 정렬 기준은 계산해서 보여주기만 하고 원래 배열 순서는 안 바꾼다 - 정렬 기준을
  // "담은 순서"로 되돌리면 언제든 원래 순서를 다시 볼 수 있게 하기 위함).
  const BASKET_SORT_KEY = "dur_basket_sort";
  let basketSortMode = localStorage.getItem(BASKET_SORT_KEY) || "manual";
  el.basketSortSelect.value = basketSortMode;

  function getIngredientClassName(basketItem) {
    const pill = basketItem.kind === "product" ? state.pillInfoByCode[basketItem.code] : null;
    return (pill && pill.class_name) || null;
  }

  // 화면에 보여줄 순서를 계산한다. 각 항목에 실제 state.basket 배열 위치(realIndex)를
  // 함께 담아둬서, "담은 순서" 모드의 위/아래 이동 버튼이 정확한 위치를 알 수 있게 한다.
  function getSortedBasketEntries() {
    const entries = state.basket.map((item, realIndex) => ({ item, realIndex }));
    if (basketSortMode === "name") {
      entries.sort((a, b) => a.item.label.localeCompare(b.item.label, "ko"));
    } else if (basketSortMode === "ingredient") {
      entries.sort((a, b) => {
        const an = (a.item.ingredientKeys && a.item.ingredientKeys[0]) || "";
        const bn = (b.item.ingredientKeys && b.item.ingredientKeys[0]) || "";
        return an.localeCompare(bn);
      });
    } else if (basketSortMode === "class") {
      entries.sort((a, b) => {
        const ac = getIngredientClassName(a.item) || "￿"; // 분류 정보 없는 건 맨 뒤로
        const bc = getIngredientClassName(b.item) || "￿";
        return ac.localeCompare(bc, "ko");
      });
    }
    return entries;
  }

  function moveBasketItem(realIndex, direction) {
    if (!assertEditable()) return;
    const newIndex = realIndex + direction;
    if (newIndex < 0 || newIndex >= state.basket.length) return;
    const [item] = state.basket.splice(realIndex, 1);
    state.basket.splice(newIndex, 0, item);
    saveBasket();
    renderBasket();
    renderResults();
  }

  el.basketSortSelect.addEventListener("change", () => {
    basketSortMode = el.basketSortSelect.value;
    localStorage.setItem(BASKET_SORT_KEY, basketSortMode);
    renderBasket();
  });

  function renderBasket() {
    el.basketEmptyMsg.style.display = state.basket.length ? "none" : "block";
    el.basketCount.textContent = state.basket.length ? `담은 약 ${state.basket.length}개` : "";
    el.basketReadonlyNote.hidden = !state.familyReadOnly;
    el.clearBasketBtn.hidden = state.familyReadOnly;

    const sortedEntries = getSortedBasketEntries();
    const isManualSort = basketSortMode === "manual";

    el.basketList.innerHTML = sortedEntries
      .map(({ item: b, realIndex }) => {
        const healthLink = healthKrLink(b.healthSearchName);
        const alt = b.kind === "product" ? findCheaperAlternative(b.code) : null;
        const altHtml = alt
          ? `<div class="price-alt">💡 같은 성분·용량의 <strong>${escapeHtml(alt.cheapest.product_name_display)}</strong>(${escapeHtml(alt.cheapest.company)})이(가)
             ${alt.savings.toLocaleString()}원 더 저렴합니다 (${alt.current.price.toLocaleString()}원 → ${alt.cheapest.price.toLocaleString()}원)</div>`
          : "";

        const swapCandidates = state.familyReadOnly ? [] : findSameIngredientProducts(b);
        let swapHtml = "";
        if (swapCandidates.length) {
          if (b.dosageConfirmed) {
            // 이미 올바른 용량을 확인해뒀으면 매번 펼쳐볼 필요 없이 접어두고,
            // 다시 확인하고 싶을 때만 누르는 작은 링크만 남긴다.
            swapHtml = state.familyReadOnly
              ? ""
              : `<button type="button" class="link-btn dosage-recheck-btn no-print" data-uid="${escapeHtml(b.uid)}">🔄 용량 다시 확인하기</button>`;
          } else {
            swapHtml = `<button type="button" class="link-btn swap-toggle-btn no-print" data-uid="${escapeHtml(b.uid)}">🔄 다른 용량으로 바꾸기</button>
             <div class="swap-panel no-print" data-uid="${escapeHtml(b.uid)}" hidden>
               <p class="swap-panel-hint">같은 약의 다른 용량입니다. 실제 복용 중인 용량과 다르면 눌러서 바꾸세요.</p>
               ${
                 state.familyReadOnly
                   ? ""
                   : `<button type="button" class="link-btn confirm-dosage-btn" data-uid="${escapeHtml(b.uid)}">✓ 이 용량이 맞아요 (다시 안 보이기)</button>`
               }
               ${swapCandidates
                 .map(
                   (p) => `
                 <button type="button" class="swap-option-btn" data-uid="${escapeHtml(b.uid)}" data-code="${escapeHtml(p.product_code)}">
                   <span class="swap-option-name">${escapeHtml(p.product_name_display)}</span>
                   <span class="swap-option-meta">${escapeHtml(p.company)}${p.price != null ? " · " + p.price.toLocaleString() + "원" : ""}</span>
                 </button>`
                 )
                 .join("")}
             </div>`;
          }
        }

        const pill = b.kind === "product" ? state.pillInfoByCode[b.code] : null;
        const pillThumb = pill && pill.image_url
          ? `<img src="${escapeHtml(pill.image_url)}" alt="" class="pill-thumb" loading="lazy" onerror="this.style.display='none'" />`
          : pill && (pill.shape || pill.color1)
          ? `<span class="pill-thumb pill-thumb-empty" title="${escapeHtml([pill.shape, pill.color1].filter(Boolean).join(" · "))}" aria-hidden="true">💊</span>`
          : "";

        const partners = findContraindicatedPartners(b);
        const partnersHtml = partners.length
          ? `<button type="button" class="link-btn partners-toggle-btn no-print" data-uid="${escapeHtml(b.uid)}">⚠️ 병용금기·주의 목록 보기 (${partners.length})</button>
             <div class="partners-panel no-print" data-uid="${escapeHtml(b.uid)}" hidden>
               <p class="partners-panel-hint">지금 바구니에 없어도, 이 성분과 함께 먹으면 안 되거나 주의가 필요한 성분 목록입니다.</p>
               <ul class="partners-list">
                 ${partners
                   .map(
                     ({ partnerKey, rule }) => `
                   <li class="partners-item ${rule.severity === "contraindicated" ? "contraindicated" : "caution"}">
                     <span class="partners-badge">${rule.severity === "contraindicated" ? "병용금기" : "병용주의"}</span>
                     <span class="partners-name">${escapeHtml(prettifyKey(partnerKey))}</span>
                     ${rule.description ? `<span class="partners-desc">${escapeHtml(rule.description)}</span>` : ""}
                   </li>`
                   )
                   .join("")}
               </ul>
             </div>`
          : "";

        const narcotic = findNarcoticClassification(b.ingredientKeys);
        const narcoticHtml = narcotic
          ? `<div class="narcotic-badge-row">
               <span class="narcotic-badge">${escapeHtml(narcotic.type_code)}</span>
               <span class="narcotic-message">${escapeHtml(NARCOTIC_TYPE_MESSAGES[narcotic.type_code] || "")}</span>
             </div>`
          : "";

        const allergyMatches = matchAllergies(b.ingredientKeys);
        const allergyHtml = allergyMatches.length
          ? `<div class="allergy-alert">
               🚨 등록하신 알레르기 성분 포함: ${allergyMatches.map((a) => escapeHtml(a.label)).join(", ")}
             </div>`
          : "";

        const relatedLetters = findRelatedSafetyLetters(b.label);
        const safetyLetterHtml = relatedLetters.length
          ? `<div class="expert-only safety-letter-badge-row">
               <span class="safety-letter-badge">📋 관련 안전성서한 ${relatedLetters.length}건 (자동 검색, 정확하지 않을 수 있음)</span>
             </div>`
          : "";

        return `
        <li class="basket-item">
          ${pillThumb}
          <div class="info">
            <div class="name">${escapeHtml(b.label)}</div>
            <div class="meta">${escapeHtml(b.sub)}</div>
            ${allergyHtml}
            ${narcoticHtml}
            ${safetyLetterHtml}
            ${altHtml}
            ${swapHtml}
            ${partnersHtml}
          </div>
          <div class="actions">
            ${
              isManualSort && !state.familyReadOnly
                ? `<div class="move-btn-col no-print">
                     <button class="move-btn" title="위로 이동" data-index="${realIndex}" data-dir="-1" ${realIndex === 0 ? "disabled" : ""}>▲</button>
                     <button class="move-btn" title="아래로 이동" data-index="${realIndex}" data-dir="1" ${realIndex === state.basket.length - 1 ? "disabled" : ""}>▼</button>
                   </div>`
                : ""
            }
            <a class="link-btn health-link" title="약학정보원에서 상세정보 보기" href="${healthLink}" target="_blank" rel="noopener">약학정보원</a>
            ${state.familyReadOnly ? "" : `<button class="link-btn reminder-add-btn no-print" title="복약 알림 등록" data-label="${escapeHtml(b.label)}">⏰</button>`}
            ${state.familyReadOnly ? "" : `<button class="remove-btn" title="바구니에서 빼기" data-uid="${b.uid}">×</button>`}
          </div>
        </li>`;
      })
      .join("");

    el.basketList.querySelectorAll(".move-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        moveBasketItem(Number(btn.getAttribute("data-index")), Number(btn.getAttribute("data-dir")));
      });
    });
    el.basketList.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeFromBasket(btn.getAttribute("data-uid")));
    });
    el.basketList.querySelectorAll(".reminder-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => addReminder(btn.getAttribute("data-label")));
    });
    el.basketList.querySelectorAll(".swap-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = btn.getAttribute("data-uid");
        const panel = el.basketList.querySelector(`.swap-panel[data-uid="${cssEscape(uid)}"]`);
        if (panel) panel.hidden = !panel.hidden;
      });
    });
    el.basketList.querySelectorAll(".swap-option-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        swapBasketItem(btn.getAttribute("data-uid"), btn.getAttribute("data-code"));
      });
    });
    el.basketList.querySelectorAll(".confirm-dosage-btn").forEach((btn) => {
      btn.addEventListener("click", () => confirmDosage(btn.getAttribute("data-uid")));
    });
    el.basketList.querySelectorAll(".dosage-recheck-btn").forEach((btn) => {
      btn.addEventListener("click", () => unconfirmDosage(btn.getAttribute("data-uid")));
    });
    el.basketList.querySelectorAll(".partners-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uid = btn.getAttribute("data-uid");
        const panel = el.basketList.querySelector(`.partners-panel[data-uid="${cssEscape(uid)}"]`);
        if (panel) panel.hidden = !panel.hidden;
      });
    });
  }

  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
  }

  // ---------- DUR 분석 ----------
  // "advisory"는 성분 단일 기준 주의 안내(노인주의/특정연령대금기/투여기간주의/
  // 용량주의)를 하나의 색상으로 묶은 버킷이다. 배지에는 이 버킷 이름 대신 각
  // 규칙의 실제 category(rule.category, 예: "특정연령대금기")를 그대로 보여준다.
  function severityBucket(severity) {
    if (severity === "contraindicated") return "contraindicated";
    if (severity === "caution") return "caution";
    if (severity === "food-interaction") return "food-interaction";
    if (severity === "duplicate") return "duplicate";
    if (["elderly-caution", "age-restricted", "duration-caution", "dose-caution", "pregnancy-caution"].includes(severity)) {
      return "advisory";
    }
    return "other";
  }

  function severityLabel(bucket) {
    return {
      contraindicated: "병용금기",
      caution: "병용주의",
      "food-interaction": "음식상호작용",
      duplicate: "효능군중복",
      advisory: "복약 주의",
      other: "기타 주의",
    }[bucket];
  }

  // 일반인 모드에서는 의학적 세부사항 대신, 심각도에 맞는 상담 권고 문구를 강조해서 보여준다.
  function severityAdvice(bucket, category) {
    if (bucket === "contraindicated") {
      return "함께 복용하면 안 되는 조합(병용금기)입니다. 지금 복용 중이라면 반드시 처방한 의사 또는 약사와 상담하세요.";
    }
    if (bucket === "caution") {
      return "함께 복용 시 주의가 필요한 조합입니다. 복용 전 약사·의사와 상담하는 것이 안전합니다.";
    }
    if (bucket === "duplicate") {
      return "비슷한 효과의 약을 중복으로 복용하고 있을 수 있습니다. 정말 둘 다 필요한지 약사·의사와 확인해보세요.";
    }
    if (bucket === "food-interaction") {
      return "특정 음식과 함께 먹으면 약효나 부작용에 영향을 줄 수 있습니다. 아래 안내를 확인하세요.";
    }
    if (bucket === "advisory") {
      return `${category || "이 약"}에 해당하는 주의사항이 있습니다. 복용 여부를 약사·의사와 상의하세요.`;
    }
    return "등록된 주의사항이 있습니다. 약사·의사와 상담하세요.";
  }

  function analyzeBasket() {
    const rules = (state.rulesData && state.rulesData.rules) || [];
    const found = [];
    const basket = state.basket;

    // 단일 성분 주의사항 (예: 노인주의)
    for (const item of basket) {
      for (const rule of rules) {
        if (rule.ingredient_keys.length === 1 && item.ingredientKeys.includes(rule.ingredient_keys[0])) {
          found.push({ rule, items: [item] });
        }
      }
    }

    // 음식-약물 상호작용 (DUR API에는 없어 별도로 큐레이션한 데이터, js/food_interactions.js)
    for (const item of basket) {
      for (const food of typeof FOOD_INTERACTIONS !== "undefined" ? FOOD_INTERACTIONS : []) {
        if (item.ingredientKeys.some((k) => food.ingredient_keys.includes(k))) {
          found.push({
            rule: {
              id: food.id,
              category: "음식상호작용",
              severity: "food-interaction",
              ingredient_keys: item.ingredientKeys,
              title: `${item.label} + ${food.food}`,
              description: food.description,
              management: food.management,
            },
            items: [item],
          });
        }
      }
    }

    // 2제 조합 병용금기/병용주의
    for (let i = 0; i < basket.length; i++) {
      for (let j = i + 1; j < basket.length; j++) {
        const a = basket[i];
        const b = basket[j];
        for (const rule of rules) {
          if (rule.ingredient_keys.length !== 2) continue;
          const [k1, k2] = rule.ingredient_keys;
          const forward = a.ingredientKeys.includes(k1) && b.ingredientKeys.includes(k2);
          const backward = a.ingredientKeys.includes(k2) && b.ingredientKeys.includes(k1);
          if (forward || backward) {
            found.push({ rule, items: [a, b] });
          }
        }

        // 효능군중복: 미리 정해진 성분쌍이 아니라, 두 약의 성분키가 같은 효능군을
        // 공유하는지를 그때그때 확인한다 (예: 서로 다른 두 소염진통제를 함께 복용).
        const seenEffects = new Set();
        for (const keyA of a.ingredientKeys) {
          const groupsA = state.ingredientToGroups[keyA];
          if (!groupsA) continue;
          for (const keyB of b.ingredientKeys) {
            if (keyA === keyB) continue;
            const groupsB = state.ingredientToGroups[keyB];
            if (!groupsB) continue;
            for (const effectName of groupsA) {
              if (!groupsB.includes(effectName) || seenEffects.has(effectName)) continue;
              seenEffects.add(effectName);
              found.push({
                rule: {
                  id: `DUP-${effectName}`,
                  category: "효능군중복",
                  severity: "duplicate",
                  ingredient_keys: [keyA, keyB],
                  title: `${effectName} 효능군 중복`,
                  description: `두 약 모두 '${effectName}' 효능군에 속해 있어 효과가 중복되거나 부작용 위험이 커질 수 있습니다.`,
                  management: "",
                },
                items: [a, b],
              });
            }
          }
        }
      }
    }
    return found;
  }

  // 규칙 설명/관리방안 원문 안에서 등장하는 어려운 의학 용어만 골라 쉬운 설명을 붙인다.
  // (성분마다 새로 설명을 지어내지 않고, 이미 공식 데이터에 있는 문장 안의 용어만 풀이한다)
  function findGlossaryMatches(...texts) {
    if (typeof LAY_GLOSSARY === "undefined") return [];
    const combined = texts.filter(Boolean).join(" ");
    if (!combined) return [];
    const seen = new Set();
    const matches = [];
    for (const g of LAY_GLOSSARY) {
      if (seen.has(g.term)) continue;
      if (combined.includes(g.term)) {
        seen.add(g.term);
        matches.push(g);
      }
    }
    return matches;
  }

  // 발견된 항목들을 훑어 "종합 위험도"를 한 줄로 요약한다. 카드를 하나하나 안 읽어도
  // 맨 위에서 심각성을 바로 파악할 수 있게 하기 위함(특히 스크롤이 부담스러운 사용자).
  // 위험도를 숫자 점수(0~100)로도 보여준다 - "높음/중간/낮음" 문구만으로는 감이
  // 안 잡힐 수 있어, 실제 상용 앱(필톡 등)도 점수+단계를 같이 보여주는 걸 참고했다.
  // 절대적인 의학적 위험도 수치가 아니라, 발견된 건수·심각도를 단순 가중합한
  // "한눈에 보는 상대적 지표"라는 점을 UI 문구에서 분명히 한다.
  const RISK_SCORE_WEIGHTS = {
    contraindicated: 40,
    caution: 20,
    "food-interaction": 15,
    duplicate: 12,
    advisory: 6,
    other: 4,
  };

  function computeRiskScore(matches) {
    let score = 0;
    for (const m of matches) {
      const bucket = severityBucket(m.rule.severity);
      score += RISK_SCORE_WEIGHTS[bucket] || 4;
    }
    return Math.min(100, score);
  }

  function buildRiskSummary(matches) {
    const counts = {};
    for (const m of matches) {
      const b = severityBucket(m.rule.severity);
      counts[b] = (counts[b] || 0) + 1;
    }
    const total = matches.length;
    const score = computeRiskScore(matches);

    if (counts.contraindicated) {
      return {
        level: "높음",
        score,
        bucketClass: "contraindicated",
        headline: `병용금기 ${counts.contraindicated}건을 포함해 총 ${total}건 발견 — 반드시 약사·의사와 상담 후 복용하세요.`,
      };
    }
    if (counts.caution || counts["food-interaction"]) {
      const foodPart = counts["food-interaction"] ? ` (음식 상호작용 ${counts["food-interaction"]}건 포함)` : "";
      return {
        level: "중간",
        score,
        bucketClass: "caution",
        headline: `주의가 필요한 조합 총 ${total}건 발견${foodPart} — 복용 전 확인이 필요합니다.`,
      };
    }
    if (counts.duplicate) {
      return {
        level: "중간",
        score,
        bucketClass: "duplicate",
        headline: `효능군 중복 등 총 ${total}건 발견 — 중복으로 복용 중인 약이 없는지 확인해보세요.`,
      };
    }
    return {
      level: "낮음",
      score,
      bucketClass: "advisory",
      headline: `참고할 주의사항 총 ${total}건 발견 — 심각한 위험은 아니지만 확인해두시면 좋습니다.`,
    };
  }

  // 결과 화면이 한 번에 다 펼쳐져 있으면 너무 난잡해 보인다는 피드백에 따라,
  // 병용금기(가장 중요)만 기본으로 펼치고 나머지는 접어둔 채 심각도별 섹션으로
  // 묶는다. 필터 칩으로 특정 종류만 골라볼 수도 있다. 세션 동안만 유지(새로고침하면 초기화).
  let resultsFilter = "all";
  const expandedBuckets = new Set(["contraindicated"]);

  // 바구니 전체를 훑어 알레르기 등록 성분과 겹치는 약이 하나라도 있으면 상단에 띄울 배너 HTML.
  function buildAllergyBanner() {
    const hits = [];
    for (const item of state.basket) {
      const found = matchAllergies(item.ingredientKeys);
      if (found.length) hits.push({ item, found });
    }
    if (!hits.length) return "";
    const lines = hits
      .map((h) => `${escapeHtml(h.item.label)} (${h.found.map((a) => escapeHtml(a.label)).join(", ")})`)
      .join("<br>");
    return `<div class="allergy-alert allergy-alert-top">🚨 등록하신 알레르기 성분이 포함된 약이 있습니다<br>${lines}</div>`;
  }

  function renderResults() {
    if (!state.drugsData || !state.rulesData) return;

    const allergyBanner = buildAllergyBanner();

    if (state.basket.length === 0) {
      el.results.innerHTML = '<p class="basket-empty">약을 2개 이상 담으면 병용금기 여부를 분석합니다. (1개만 담아도 노인주의 등 단일 약물 주의사항은 표시됩니다.)</p>';
      return;
    }

    const matches = analyzeBasket();

    if (matches.length === 0) {
      el.results.innerHTML =
        allergyBanner +
        '<div class="no-result">현재 담긴 약들 사이에서는 등록된 병용금기·주의사항이 발견되지 않았습니다.<br>' +
        '<span style="font-weight:400;font-size:14px;">※ 본 데이터베이스에 없는 상호작용도 있을 수 있으니, 최종 확인은 약사·의사와 상의하세요.</span></div>';
      return;
    }

    const order = ["contraindicated", "caution", "food-interaction", "duplicate", "advisory", "other"];
    matches.sort((a, b) => order.indexOf(severityBucket(a.rule.severity)) - order.indexOf(severityBucket(b.rule.severity)));

    const risk = buildRiskSummary(matches);
    const summary = `
      <div class="risk-banner ${risk.bucketClass}">
        <div class="risk-level-row">
          <span class="risk-level">종합 위험도: ${risk.level}</span>
          <span class="risk-score" title="발견된 건수·심각도를 단순 합산한 상대적 지표로, 의학적 위험도 수치가 아닙니다.">${risk.score}점 / 100</span>
        </div>
        <div class="risk-score-bar"><div class="risk-score-bar-fill" style="width:${risk.score}%"></div></div>
        <p class="risk-headline">${escapeHtml(risk.headline)}</p>
      </div>`;

    // 심각도(버킷)별로 묶어서 섹션으로 만든다 - order 배열 순서를 그대로 따르되
    // 실제 매칭이 있는 버킷만 표시한다.
    const buckets = {};
    for (const m of matches) {
      const b = severityBucket(m.rule.severity);
      (buckets[b] = buckets[b] || []).push(m);
    }
    const bucketOrder = order.filter((b) => buckets[b] && buckets[b].length);

    const filterChips = `
      <div class="result-filter-row no-print">
        <button type="button" class="result-filter-chip ${resultsFilter === "all" ? "active" : ""}" data-filter="all">전체 (${matches.length})</button>
        ${bucketOrder
          .map(
            (b) => `<button type="button" class="result-filter-chip ${resultsFilter === b ? "active" : ""}" data-filter="${b}">${escapeHtml(severityLabel(b))} (${buckets[b].length})</button>`
          )
          .join("")}
      </div>`;

    const sections = bucketOrder
      .filter((b) => resultsFilter === "all" || resultsFilter === b)
      .map((b) => {
        const isOpen = expandedBuckets.has(b);
        const cardsHtml = buckets[b].map((m) => buildResultCardHtml(m, b)).join("");
        return `
        <div class="result-section">
          <button type="button" class="result-section-toggle no-print" data-bucket="${b}">
            <span class="result-section-chevron">${isOpen ? "▼" : "▶"}</span>
            <span class="result-section-label">${escapeHtml(severityLabel(b))}</span>
            <span class="result-section-count">${buckets[b].length}건</span>
          </button>
          <div class="result-section-body" ${isOpen ? "" : "hidden"}>${cardsHtml}</div>
        </div>`;
      })
      .join("");

    el.results.innerHTML = allergyBanner + summary + filterChips + sections;

    el.results.querySelectorAll(".result-filter-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        resultsFilter = btn.getAttribute("data-filter");
        renderResults();
      });
    });
    el.results.querySelectorAll(".result-section-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const b = btn.getAttribute("data-bucket");
        if (expandedBuckets.has(b)) expandedBuckets.delete(b);
        else expandedBuckets.add(b);
        renderResults();
      });
    });
  }

  function buildResultCardHtml(m, bucket) {
    const names = m.items.map((it) => it.label).join(" + ");
    const refItems = (m.rule.reference_items || []).filter(Boolean).join(", ");
    const ingredientKeyLabel = (m.rule.ingredient_keys || []).map(prettifyKey).join(" ↔ ");
    const pairCount = m.rule.product_pair_count;

    const badgeText = m.rule.category || severityLabel(bucket);
    // "내 정보" 탭에 65세 이상으로 등록해둔 경우, 노인주의 항목임이 확실한 것만
    // 강조한다(특정연령대금기는 API 원문이 자유 서술형이라 나이를 안전하게
    // 자동판별할 수 없어 여기서는 강조하지 않는다).
    const isElderlyMatch = profile.ageRange === "65-120" && m.rule.severity === "elderly-caution";
    const glossaryMatches = findGlossaryMatches(m.rule.description, m.rule.management);

    return `
    <div class="result-card ${bucket}">
      <span class="result-badge">${escapeHtml(badgeText)}</span>
      ${isElderlyMatch ? '<span class="result-highlight">👤 내 연령대 해당</span>' : ""}
      <p class="result-title">${escapeHtml(names)}</p>

      <div class="lay-only">
        ${m.rule.description ? `<p class="result-desc">${escapeHtml(m.rule.description)}</p>` : ""}
        <p class="result-advice">${escapeHtml(severityAdvice(bucket, m.rule.category))}</p>
        ${m.rule.management ? `<p class="result-tip">✅ ${escapeHtml(m.rule.management)}</p>` : ""}
        ${
          glossaryMatches.length
            ? `<details class="result-glossary">
                 <summary>🔤 어려운 용어 설명 (${glossaryMatches.length})</summary>
                 <ul>${glossaryMatches.map((g) => `<li><strong>${escapeHtml(g.term)}</strong>: ${escapeHtml(g.explain)}</li>`).join("")}</ul>
               </details>`
            : ""
        }
      </div>

      <div class="expert-only">
        <p class="result-desc">${escapeHtml(m.rule.description || "등록된 상세 설명 없음")}</p>
        ${m.rule.management ? `<p class="result-manage">비고: ${escapeHtml(m.rule.management)}</p>` : ""}
        <p class="result-meta">
          분류: ${escapeHtml(m.rule.category || "")} · 규칙 ID: ${escapeHtml(m.rule.id || "")}<br>
          성분 매칭: ${escapeHtml(ingredientKeyLabel)}
          ${pairCount ? ` · 등록된 실제 제품 조합: ${pairCount.toLocaleString()}건` : ""}
          ${refItems ? "<br>참고 품목 예시: " + escapeHtml(refItems) : ""}
        </p>
      </div>
    </div>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- 복약 알림 ----------
  // 이 브라우저 탭이 열려 있을 때만 알림이 울린다(백그라운드 푸시 서버가 없는
  // 정적 사이트의 한계). 그래도 localStorage에 저장해두면 다시 열었을 때 유지된다.
  const REMINDER_KEY = "dur_reminders";
  const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  let reminders = loadReminders();
  const remindersFiredToday = new Set(); // `${reminderId}_${time}_${YYYY-MM-DD}` 중복 알림 방지

  function loadReminders() {
    try {
      const raw = localStorage.getItem(REMINDER_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveReminders() {
    localStorage.setItem(REMINDER_KEY, JSON.stringify(reminders));
    if (window.FamilySync) window.FamilySync.pushReminders(reminders);
  }

  // days가 없거나 비어있으면 "매일"로 취급한다(기존에 만든 알림과의 호환용).
  function getReminderDays(reminder) {
    return reminder.days && reminder.days.length ? reminder.days : ALL_DAYS;
  }

  function addReminder(label) {
    if (!assertEditable()) return;
    if (reminders.some((r) => r.label === label)) {
      alert("이미 등록된 약입니다. 아래 목록에서 시간을 추가해주세요.");
      return;
    }
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    reminders.push({ id: "r" + Date.now(), label, times: [], days: [] });
    saveReminders();
    renderReminders();
  }

  function removeReminder(id) {
    reminders = reminders.filter((r) => r.id !== id);
    saveReminders();
    renderReminders();
  }

  function addReminderTime(id, time) {
    const reminder = reminders.find((r) => r.id === id);
    if (!reminder || !time || reminder.times.includes(time)) return;
    reminder.times.push(time);
    reminder.times.sort();
    saveReminders();
    renderReminders();
  }

  function removeReminderTime(id, time) {
    const reminder = reminders.find((r) => r.id === id);
    if (!reminder) return;
    reminder.times = reminder.times.filter((t) => t !== time);
    saveReminders();
    renderReminders();
  }

  // 특정 요일만 복용하는 약(예: 월·수·금 영양제)을 위한 요일 선택. 전부 해제하면
  // "매일"로 되돌린다(빈 배열로 두면 알림이 하나도 안 울리는 혼란을 막기 위함).
  function toggleReminderDay(id, day) {
    if (!assertEditable()) return;
    const reminder = reminders.find((r) => r.id === id);
    if (!reminder) return;
    const current = getReminderDays(reminder);
    let next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
    if (next.length === 0) next = [...ALL_DAYS];
    reminder.days = next;
    saveReminders();
    renderReminders();
  }

  // ---------- 복용 완료 체크 ----------
  // "오늘 먹을 약" 일정에서 각 시간대를 실제로 복용했는지 체크하는 기록. 그룹에
  // 연결돼 있으면 Firestore로도 동기화된다 - 예를 들어 할머니가 체크하면 손녀
  // 폰에서도 "드셨음"이 보이도록(보기전용 멤버도 이 체크만은 할 수 있게 보안
  // 규칙에서 허용해뒀다). 그룹이 없으면 이 브라우저에만 저장된다.
  const TAKEN_KEY = "dur_taken_doses";
  let takenDoses = loadTakenDoses();

  function loadTakenDoses() {
    try {
      const raw = localStorage.getItem(TAKEN_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  const TAKEN_RETENTION_DAYS = 35; // 월간 복용 기록 캘린더를 보여주려면 최소 한 달치는 남아있어야 함

  function saveTakenDoses() {
    // 기록이 무한정 쌓이지 않도록 최근 N일치 키만 남긴다.
    const recentDates = [];
    const now = new Date();
    for (let i = 0; i < TAKEN_RETENTION_DAYS; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      recentDates.push(d.toISOString().slice(0, 10));
    }
    takenDoses = new Set([...takenDoses].filter((key) => recentDates.some((d) => key.endsWith(d))));
    const arr = [...takenDoses];
    localStorage.setItem(TAKEN_KEY, JSON.stringify(arr));
    if (window.FamilySync) window.FamilySync.pushTakenDoses(arr);
  }

  function toggleTaken(fireKey, isTaken) {
    if (isTaken) takenDoses.add(fireKey);
    else takenDoses.delete(fireKey);
    saveTakenDoses();
    renderTodaySchedule();
    renderAdherenceCalendar();
  }

  // 그룹에 나 말고 다른 멤버가 있을 때만 "알림 받을 사람" 선택지를 보여준다
  // (혼자일 땐 굳이 고를 필요가 없으니 평소엔 안 보이게).
  function getAssignableMembers() {
    if (!window.FamilySync || !window.FamilySync.isConnected()) return null;
    const members = window.FamilySync.getActiveGroupMembers();
    return members && members.length > 1 ? members : null;
  }

  function renderReminders() {
    const members = getAssignableMembers();
    el.reminderEmptyMsg.style.display = reminders.length ? "none" : "block";
    el.reminderList.innerHTML = reminders
      .map((r) => {
        const chips = r.times
          .map(
            (t) => `<span class="time-chip">${t} <button class="time-remove-btn" data-id="${r.id}" data-time="${t}" aria-label="시간 삭제">×</button></span>`
          )
          .join("");
        const activeDays = getReminderDays(r);
        const dayBtns = DAY_LABELS.map(
          (label, day) => `
          <button type="button" class="day-btn ${activeDays.includes(day) ? "active" : ""}" data-id="${r.id}" data-day="${day}">${label}</button>`
        ).join("");
        const assignHtml = members
          ? `<div class="assign-row">
               <label>🔔 알림 받을 사람:
                 <select class="assign-select" data-id="${r.id}">
                   <option value="">전체(그룹원 모두)</option>
                   ${members
                     .map((m) => `<option value="${escapeHtml(m.uid)}" ${r.assignedTo === m.uid ? "selected" : ""}>${escapeHtml(m.displayName)}</option>`)
                     .join("")}
                 </select>
               </label>
             </div>`
          : "";
        return `
        <li class="reminder-item">
          <div class="info">
            <div class="name">${escapeHtml(r.label)}</div>
            <div class="day-selector" title="복용 요일 (전부 선택 = 매일)">${dayBtns}</div>
            ${assignHtml}
            <div class="time-chips">${chips || '<span class="basket-empty" style="padding:0;">아직 시간이 없습니다</span>'}</div>
            <div class="time-add-row">
              <input type="time" class="time-input" id="time-input-${r.id}" />
              <button class="clear-btn time-add-btn" data-id="${r.id}">+ 시간 추가</button>
            </div>
          </div>
          <button class="remove-btn" title="알림 삭제" data-id="${r.id}">×</button>
        </li>`;
      })
      .join("");

    el.reminderList.querySelectorAll(".time-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeReminderTime(btn.getAttribute("data-id"), btn.getAttribute("data-time")));
    });
    el.reminderList.querySelectorAll(".time-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const input = document.getElementById(`time-input-${id}`);
        if (input.value) addReminderTime(id, input.value);
      });
    });
    el.reminderList.querySelectorAll(".day-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggleReminderDay(btn.getAttribute("data-id"), Number(btn.getAttribute("data-day")));
      });
    });
    el.reminderList.querySelectorAll(".assign-select").forEach((select) => {
      select.addEventListener("change", () => {
        assignReminderTo(select.getAttribute("data-id"), select.value || null);
      });
    });
    el.reminderList.querySelectorAll(".reminder-item > .remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeReminder(btn.getAttribute("data-id")));
    });

    renderTodaySchedule();
    renderAdherenceCalendar();
  }

  // 알림을 그룹원 특정 한 명에게만 배정한다(예: 손녀가 할머니 몫 알림을 설정하되,
  // 정작 알람은 할머니 폰에만 울리고 손녀 폰엔 안 울리게). 배정 안 하면(null) 그룹의
  // 모든 사람 폰에서 울린다 - 예: "다같이 챙겨 먹는 영양제".
  function assignReminderTo(id, uid) {
    if (!assertEditable()) return;
    const reminder = reminders.find((r) => r.id === id);
    if (!reminder) return;
    reminder.assignedTo = uid || null;
    saveReminders();
    renderReminders();
  }

  // 등록된 알림 중 "오늘 요일"에 해당하는 시간만 하루 일정표로 모아 보여준다.
  // 복용 완료 체크를 하면 시간이 지나지 않았어도 완료로 표시되고, 알림도 다시 안 울린다.
  function renderTodaySchedule() {
    const now = new Date();
    const todayDow = now.getDay();
    const todayStr = now.toISOString().slice(0, 10);
    const members = getAssignableMembers();

    const flat = [];
    for (const r of reminders) {
      if (!getReminderDays(r).includes(todayDow)) continue;
      for (const t of r.times) flat.push({ time: t, label: r.label, reminderId: r.id, assignedTo: r.assignedTo });
    }
    if (!flat.length) {
      el.todayScheduleWrap.hidden = true;
      return;
    }
    flat.sort((a, b) => a.time.localeCompare(b.time));

    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    el.todayScheduleWrap.hidden = false;
    el.todayScheduleList.innerHTML = flat
      .map((entry) => {
        const fireKey = `${entry.reminderId}_${entry.time}_${todayStr}`;
        const taken = takenDoses.has(fireKey);
        const isPast = entry.time <= currentTime;
        const assignedMember = entry.assignedTo && members ? members.find((m) => m.uid === entry.assignedTo) : null;
        const assignedBadge = assignedMember ? ` <span class="assigned-badge">👤 ${escapeHtml(assignedMember.displayName)}</span>` : "";
        return `
        <li class="today-schedule-item ${taken ? "taken" : isPast ? "past" : "upcoming"}">
          <span class="today-schedule-time">${taken ? "✅" : isPast ? "⏰" : "🕒"} ${entry.time}</span>
          <span class="today-schedule-name">${escapeHtml(entry.label)}${assignedBadge}</span>
          <label class="today-schedule-check">
            <input type="checkbox" class="taken-check" data-key="${fireKey}" ${taken ? "checked" : ""} />
            복용함
          </label>
        </li>`;
      })
      .join("");

    el.todayScheduleList.querySelectorAll(".taken-check").forEach((cb) => {
      cb.addEventListener("change", () => toggleTaken(cb.getAttribute("data-key"), cb.checked));
    });
  }

  // ---------- 복용 기록 캘린더 ----------
  // 과거에 그 알림이 실제로 어떤 요일/시간에 등록돼 있었는지는 기록해두지 않으므로,
  // "지금 등록된 알림 설정 기준"으로 과거 날짜의 예상 복용 횟수를 역산한다(근사치).
  // 안내 문구에도 이 점을 명시해둔다.
  const now0 = new Date();
  let calendarYear = now0.getFullYear();
  let calendarMonth = now0.getMonth(); // 0-11

  function getExpectedSlotCount(dateObj) {
    const dow = dateObj.getDay();
    let count = 0;
    for (const r of reminders) {
      if (getReminderDays(r).includes(dow)) count += r.times.length;
    }
    return count;
  }

  function getTakenSlotCount(dateStr) {
    let count = 0;
    for (const key of takenDoses) {
      if (key.endsWith("_" + dateStr)) count++;
    }
    return count;
  }

  function renderAdherenceCalendar() {
    if (!el.calendarGrid) return;
    el.calendarMonthLabel.textContent = `${calendarYear}년 ${calendarMonth + 1}월`;

    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const startWeekday = firstDay.getDay();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cells = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push('<div class="calendar-cell empty"></div>');
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(calendarYear, calendarMonth, day);
      const dateStr = dateObj.toISOString().slice(0, 10);
      let statusClass = "future";
      if (dateObj <= today) {
        const expected = getExpectedSlotCount(dateObj);
        const taken = getTakenSlotCount(dateStr);
        if (expected === 0) statusClass = "none-scheduled";
        else if (taken >= expected) statusClass = "full";
        else if (taken > 0) statusClass = "partial";
        else statusClass = "none";
      }
      const isToday = dateObj.getTime() === today.getTime();
      cells.push(
        `<div class="calendar-cell ${statusClass} ${isToday ? "is-today" : ""}" title="${dateStr}"><span>${day}</span></div>`
      );
    }

    el.calendarGrid.innerHTML = cells.join("");
  }

  el.calendarPrevBtn.addEventListener("click", () => {
    calendarMonth -= 1;
    if (calendarMonth < 0) {
      calendarMonth = 11;
      calendarYear -= 1;
    }
    renderAdherenceCalendar();
  });
  el.calendarNextBtn.addEventListener("click", () => {
    calendarMonth += 1;
    if (calendarMonth > 11) {
      calendarMonth = 0;
      calendarYear += 1;
    }
    renderAdherenceCalendar();
  });

  // 정해진 시간에 안 먹고 넘어가면(=복용완료 체크가 안 돼 있으면) 15분, 30분 뒤에
  // 한 번씩 더 알려준다("필콕" 등 실제 복약 알림 앱들이 쓰는 재알림 방식을 참고함).
  // 이미 복용 체크를 해뒀으면 그 뒤 재알림은 전부 건너뛴다.
  const REMINDER_ESCALATION_OFFSETS_MIN = [0, 15, 30];

  function checkReminders() {
    if (!reminders.length) return;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const today = now.toISOString().slice(0, 10);
    const todayDow = now.getDay();
    const myUid = window.FamilySync ? window.FamilySync.getCurrentUserId() : null;

    for (const r of reminders) {
      // 다른 그룹원에게 배정된 알림은 이 폰에서는 울리지 않는다(예: 손녀가 설정한
      // 할머니 몫 알림이 손녀 폰에서는 안 울리고 할머니 폰에서만 울리도록).
      if (r.assignedTo && myUid && r.assignedTo !== myUid) continue;
      if (!getReminderDays(r).includes(todayDow)) continue;

      for (const t of r.times) {
        const [th, tm] = t.split(":").map(Number);
        const schedMinutes = th * 60 + tm;
        const fireKey = `${r.id}_${t}_${today}`;
        if (takenDoses.has(fireKey)) continue; // 이미 복용 체크했으면 원래 시간이든 재알림이든 다 생략

        for (const offset of REMINDER_ESCALATION_OFFSETS_MIN) {
          if (nowMinutes !== schedMinutes + offset) continue;
          const escalationKey = `${fireKey}_${offset}`;
          if (remindersFiredToday.has(escalationKey)) continue;
          remindersFiredToday.add(escalationKey);
          if ("Notification" in window && Notification.permission === "granted") {
            const suffix = offset === 0 ? "" : ` (${offset}분 경과 - 아직 복용 체크가 안 돼 있어요)`;
            new Notification("복약 알림", { body: `${r.label} 복용 시간입니다.${suffix}`, icon: "icons/icon-192.png" });
          }
        }
      }
    }
  }

  setInterval(checkReminders, 20000);

  // ---------- 탭 메뉴 ----------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.hidden = panel.getAttribute("data-panel") !== target;
      });
    });
  });

  // ---------- 내 정보(나이대/성별) - 로그인 없이 이 브라우저에만 저장 ----------
  const PROFILE_KEY = "dur_profile";

  function loadProfile() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      return raw ? JSON.parse(raw) : { ageRange: "", sex: "" };
    } catch {
      return { ageRange: "", sex: "" };
    }
  }

  let profile = loadProfile();

  function applyProfileToInputs() {
    el.profileAgeRange.value = profile.ageRange || "";
    el.profileSex.value = profile.sex || "";
  }

  function saveProfile() {
    profile = { ageRange: el.profileAgeRange.value, sex: el.profileSex.value };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    renderResults();
  }

  applyProfileToInputs();
  el.profileAgeRange.addEventListener("change", saveProfile);
  el.profileSex.addEventListener("change", saveProfile);
  el.profileClearBtn.addEventListener("click", () => {
    profile = { ageRange: "", sex: "" };
    localStorage.removeItem(PROFILE_KEY);
    applyProfileToInputs();
    renderResults();
  });

  // ---------- 부작용·특이사항 메모 ----------
  // 자유 텍스트 건강 기록이라 민감할 수 있어 그룹 공유 없이 이 브라우저에만 저장한다.
  const NOTES_KEY = "dur_side_effect_notes";
  let sideEffectNotes = loadSideEffectNotes();

  function loadSideEffectNotes() {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveSideEffectNotes() {
    localStorage.setItem(NOTES_KEY, JSON.stringify(sideEffectNotes));
  }

  function addSideEffectNote(date, text) {
    if (!text.trim()) return;
    sideEffectNotes.push({ id: "n" + Date.now(), date: date || new Date().toISOString().slice(0, 10), text: text.trim() });
    sideEffectNotes.sort((a, b) => b.date.localeCompare(a.date));
    saveSideEffectNotes();
    renderSideEffectNotes();
  }

  function removeSideEffectNote(id) {
    if (!confirm("이 메모를 삭제하시겠습니까?")) return;
    sideEffectNotes = sideEffectNotes.filter((n) => n.id !== id);
    saveSideEffectNotes();
    renderSideEffectNotes();
  }

  function renderSideEffectNotes() {
    el.noteEmptyMsg.style.display = sideEffectNotes.length ? "none" : "block";
    el.noteList.innerHTML = sideEffectNotes
      .map(
        (n) => `
      <li class="note-item">
        <div class="note-info">
          <div class="note-date">${escapeHtml(n.date)}</div>
          <div class="note-text">${escapeHtml(n.text)}</div>
        </div>
        <button class="remove-btn" data-id="${n.id}" title="메모 삭제">×</button>
      </li>`
      )
      .join("");
    el.noteList.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeSideEffectNote(btn.getAttribute("data-id")));
    });
  }

  el.noteDateInput.value = new Date().toISOString().slice(0, 10);
  el.noteAddBtn.addEventListener("click", () => {
    addSideEffectNote(el.noteDateInput.value, el.noteTextInput.value);
    el.noteTextInput.value = "";
  });

  // ---------- 상비약 유효기한 관리 ----------
  const MEDICINE_KEY = "dur_medicine_cabinet";
  let medicineCabinet = loadMedicineCabinet();

  function loadMedicineCabinet() {
    try {
      const raw = localStorage.getItem(MEDICINE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveMedicineCabinet() {
    localStorage.setItem(MEDICINE_KEY, JSON.stringify(medicineCabinet));
  }

  function addMedicine(name, expiry) {
    if (!name.trim() || !expiry) return;
    medicineCabinet.push({ id: "m" + Date.now(), name: name.trim(), expiry });
    medicineCabinet.sort((a, b) => a.expiry.localeCompare(b.expiry));
    saveMedicineCabinet();
    renderMedicineCabinet();
  }

  function removeMedicine(id) {
    if (!confirm("이 상비약을 목록에서 삭제하시겠습니까?")) return;
    medicineCabinet = medicineCabinet.filter((m) => m.id !== id);
    saveMedicineCabinet();
    renderMedicineCabinet();
  }

  function medicineStatus(expiry) {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (expiry < todayStr) return "expired";
    const diffDays = Math.round((new Date(expiry) - new Date(todayStr)) / 86400000);
    if (diffDays <= 30) return "soon";
    return "ok";
  }

  function renderMedicineCabinet() {
    el.medicineEmptyMsg.style.display = medicineCabinet.length ? "none" : "block";
    const statusLabels = { expired: "⚠️ 유효기한 지남", soon: "⏳ 임박(30일 이내)", ok: "✅ 정상" };
    el.medicineList.innerHTML = medicineCabinet
      .map((m) => {
        const status = medicineStatus(m.expiry);
        return `
      <li class="medicine-item ${status}">
        <div class="medicine-info">
          <div class="medicine-name">${escapeHtml(m.name)}</div>
          <div class="medicine-expiry">유효기한: ${escapeHtml(m.expiry)} <span class="medicine-status-badge">${statusLabels[status]}</span></div>
        </div>
        <button class="remove-btn" data-id="${m.id}" title="삭제">×</button>
      </li>`;
      })
      .join("");
    el.medicineList.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeMedicine(btn.getAttribute("data-id")));
    });
  }

  el.medicineAddBtn.addEventListener("click", () => {
    addMedicine(el.medicineNameInput.value, el.medicineExpiryInput.value);
    el.medicineNameInput.value = "";
    el.medicineExpiryInput.value = "";
  });

  renderSideEffectNotes();
  renderMedicineCabinet();

  // ---------- 약물 알레르기 등록 ----------
  // DUR 데이터는 "공식 병용금기"만 다루고 개인의 과거 알레르기 이력은 모르기 때문에,
  // 별도로 등록해두면 검색 결과와 무관하게 항상 우리 쪽에서 성분을 대조해 경고할 수 있다.
  const ALLERGY_KEY = "dur_allergies";
  let allergies = loadAllergies();

  function loadAllergies() {
    try {
      const raw = localStorage.getItem(ALLERGY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveAllergies() {
    localStorage.setItem(ALLERGY_KEY, JSON.stringify(allergies));
  }

  function addAllergy(entry, memo) {
    if (!entry || !entry.ingredientKeys || !entry.ingredientKeys.length) return;
    allergies.push({
      id: "al" + Date.now(),
      label: entry.label,
      ingredientKeys: entry.ingredientKeys,
      memo: (memo || "").trim(),
    });
    saveAllergies();
    renderAllergyList();
    renderBasket();
    renderResults();
  }

  function removeAllergy(id) {
    if (!confirm("이 알레르기 등록을 삭제하시겠습니까?")) return;
    allergies = allergies.filter((a) => a.id !== id);
    saveAllergies();
    renderAllergyList();
    renderBasket();
    renderResults();
  }

  // 바구니 약의 ingredientKeys 중 하나라도 등록된 알레르기 성분과 겹치면 매칭된 알레르기들을 반환한다.
  function matchAllergies(ingredientKeys) {
    if (!ingredientKeys || !ingredientKeys.length || !allergies.length) return [];
    return allergies.filter((a) => a.ingredientKeys.some((k) => ingredientKeys.includes(k)));
  }

  function renderAllergyList() {
    el.allergyEmptyMsg.style.display = allergies.length ? "none" : "block";
    el.allergyList.innerHTML = allergies
      .map(
        (a) => `
      <li class="allergy-item">
        <div class="allergy-info">
          <div class="allergy-name">${escapeHtml(a.label)}</div>
          ${a.memo ? `<div class="allergy-memo">${escapeHtml(a.memo)}</div>` : ""}
        </div>
        <button class="remove-btn" data-id="${a.id}" title="삭제">×</button>
      </li>`
      )
      .join("");
    el.allergyList.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeAllergy(btn.getAttribute("data-id")));
    });
  }

  function runAllergySearch() {
    const q = el.allergySearchInput.value.trim().toLowerCase();
    if (!q || !state.suggestions.length) {
      el.allergySuggestions.classList.remove("open");
      el.allergySuggestions.innerHTML = "";
      return;
    }
    const matches = state.suggestions
      .filter((s) => s.searchText.includes(q) || s.label.toLowerCase().includes(q))
      .slice(0, 20);

    if (!matches.length) {
      el.allergySuggestions.innerHTML = '<div class="suggestion-empty">일치하는 성분·약이 없습니다.</div>';
      el.allergySuggestions.classList.add("open");
      return;
    }

    el.allergySuggestions.innerHTML = matches
      .map((m, idx) => {
        const tagLabel = m.kind === "product" ? "상품명" : "성분명";
        const tagClass = m.kind === "product" ? "product" : "ingredient";
        return `
        <div class="suggestion-item" data-idx="${idx}">
          <div class="suggestion-main">
            <span class="suggestion-name">${escapeHtml(m.label)}</span>
            <span class="suggestion-sub">${escapeHtml(m.sub)}</span>
          </div>
          <span class="tag ${tagClass}">${tagLabel}</span>
        </div>`;
      })
      .join("");
    el.allergySuggestions.classList.add("open");

    el.allergySuggestions.querySelectorAll(".suggestion-item").forEach((node) => {
      node.addEventListener("click", () => {
        const idx = Number(node.getAttribute("data-idx"));
        addAllergy(matches[idx], el.allergyMemoInput.value);
        el.allergyMemoInput.value = "";
        el.allergySearchInput.value = "";
        el.allergySuggestions.classList.remove("open");
        el.allergySuggestions.innerHTML = "";
      });
    });
  }

  el.allergySearchInput.addEventListener("input", runAllergySearch);
  document.addEventListener("click", (e) => {
    if (!el.allergySearchInput.contains(e.target) && !el.allergySuggestions.contains(e.target)) {
      el.allergySuggestions.classList.remove("open");
    }
  });

  renderAllergyList();

  // ---------- 모드 전환 ----------
  el.modeLayBtn.addEventListener("click", () => setMode("lay"));
  el.modeExpertBtn.addEventListener("click", () => setMode("expert"));

  function setMode(mode) {
    state.mode = mode;
    document.body.classList.toggle("mode-expert", mode === "expert");
    document.body.classList.toggle("mode-lay", mode === "lay");
    el.modeLayBtn.classList.toggle("active", mode === "lay");
    el.modeExpertBtn.classList.toggle("active", mode === "expert");
    localStorage.setItem("dur_mode", mode);
  }

  // ---------- 인쇄 / PDF 저장 ----------
  el.printBtn.addEventListener("click", () => {
    if (state.basket.length === 0) {
      alert("바구니에 약을 담아야 인쇄할 내용이 있습니다.");
      return;
    }
    const now = new Date();
    el.printDate.textContent = now.toLocaleString("ko-KR");
    window.print();
  });

  // ---------- 음성으로 읽어주기 (TTS) ----------
  // 저시력·고령 사용자를 위해 브라우저 내장 SpeechSynthesis만 사용한다(외부 API 없음).
  function speak(text, btnEl, defaultLabel) {
    if (!("speechSynthesis" in window)) {
      alert("이 브라우저는 음성 읽어주기를 지원하지 않습니다.");
      return;
    }
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (btnEl) btnEl.textContent = defaultLabel;
      return;
    }
    if (!text) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ko-KR";
    const koVoice = window.speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith("ko"));
    if (koVoice) utter.voice = koVoice;
    const reset = () => {
      if (btnEl) btnEl.textContent = defaultLabel;
    };
    utter.onend = reset;
    utter.onerror = reset;
    if (btnEl) btnEl.textContent = "⏹ 중지";
    window.speechSynthesis.speak(utter);
  }

  function buildResultsSpeechText() {
    if (!state.basket.length) return "";
    const parts = [];
    const allergyHitTexts = [];
    for (const item of state.basket) {
      const found = matchAllergies(item.ingredientKeys);
      if (found.length) allergyHitTexts.push(`${item.label}에 등록하신 알레르기 성분이 포함되어 있습니다.`);
    }
    if (allergyHitTexts.length) parts.push("주의. " + allergyHitTexts.join(" "));

    const matches = analyzeBasket();
    if (!matches.length) {
      parts.push("현재 담긴 약들 사이에서는 등록된 병용금기, 주의사항이 발견되지 않았습니다.");
    } else {
      const risk = buildRiskSummary(matches);
      parts.push(risk.headline);
      matches.slice(0, 8).forEach((m) => {
        const names = m.items.map((it) => it.label).join("와 ");
        parts.push(`${names}: ${m.rule.category || severityLabel(severityBucket(m.rule.severity))}.`);
      });
    }
    return parts.join(" ");
  }

  function buildEmergencySpeechText() {
    const parts = [];
    if (allergies.length) {
      parts.push("등록된 알레르기: " + allergies.map((a) => a.label).join(", ") + ".");
    }
    if (!state.basket.length) {
      parts.push("담긴 약이 없습니다.");
      return parts.join(" ");
    }
    parts.push(`현재 복용 중인 약은 총 ${state.basket.length}개입니다: ` + state.basket.map((b) => b.label).join(", ") + ".");
    const matches = analyzeBasket();
    const contraindicated = matches.filter((m) => severityBucket(m.rule.severity) === "contraindicated");
    if (contraindicated.length) {
      parts.push(`병용금기 조합 ${contraindicated.length}건이 발견되었습니다. 반드시 의료진에게 알리세요.`);
    }
    return parts.join(" ");
  }

  el.ttsBtn.addEventListener("click", () => {
    const text = buildResultsSpeechText();
    if (!text) {
      alert("읽어줄 내용이 없습니다. 먼저 약을 담아주세요.");
      return;
    }
    speak(text, el.ttsBtn, "🔊 읽어주기");
  });

  el.emergencyTtsBtn.addEventListener("click", () => {
    speak(buildEmergencySpeechText(), el.emergencyTtsBtn, "🔊 읽어주기");
  });

  // ---------- 응급 상황용 요약 카드 ----------
  // 의식이 없거나 응급실에서 급하게 보여줘야 할 때를 위한 한 화면 요약. 외부 서버로
  // 데이터를 보내는 QR코드 생성 API 등은 건강정보를 제3자에게 노출시킬 위험이 있어
  // 의도적으로 배제하고, 이 브라우저 안에서만 렌더링되는 화면/인쇄물로 만든다.
  function renderEmergencyCard() {
    el.emergencyCardTime.textContent = `생성 시각: ${new Date().toLocaleString("ko-KR")}`;

    // 등록된 알레르기는 응급실에서 가장 먼저 알아야 할 정보라, 바구니가 비어 있어도 항상 보여준다.
    const allergyListHtml = allergies.length
      ? `<div class="emergency-allergy-box">
           <strong>🚫 등록된 알레르기</strong>
           <ul>${allergies.map((a) => `<li>${escapeHtml(a.label)}${a.memo ? ` — ${escapeHtml(a.memo)}` : ""}</li>`).join("")}</ul>
         </div>`
      : "";

    if (!state.basket.length) {
      el.emergencyCardBody.innerHTML =
        allergyListHtml + "<p>담긴 약이 없습니다. 먼저 '1. 복용 중인 약 검색해서 담기'에서 약을 담아주세요.</p>";
      return;
    }

    const matches = analyzeBasket();
    const contraindicated = matches.filter((m) => severityBucket(m.rule.severity) === "contraindicated");

    const drugRows = state.basket
      .map((b) => {
        const narcotic = findNarcoticClassification(b.ingredientKeys);
        const allergyMatches = matchAllergies(b.ingredientKeys);
        return `
        <li class="emergency-drug-item">
          <strong>${escapeHtml(b.label)}</strong>
          <div class="emergency-drug-sub">${escapeHtml(b.sub)}</div>
          ${narcotic ? `<span class="emergency-narcotic-tag">⚠️ ${escapeHtml(narcotic.type_code)}</span>` : ""}
          ${allergyMatches.length ? `<span class="emergency-narcotic-tag emergency-allergy-tag">🚨 알레르기 성분(${allergyMatches.map((a) => escapeHtml(a.label)).join(", ")})</span>` : ""}
        </li>`;
      })
      .join("");

    const warnHtml = contraindicated.length
      ? `<div class="emergency-warning">
           <strong>⚠️ 병용금기 조합 ${contraindicated.length}건 발견 — 반드시 의료진에게 알리세요</strong>
           <ul>${contraindicated.map((m) => `<li>${escapeHtml(m.items.map((it) => it.label).join(" + "))}</li>`).join("")}</ul>
         </div>`
      : "";

    el.emergencyCardBody.innerHTML = `
      ${allergyListHtml}
      <h3>복용 중인 약 (${state.basket.length}개)</h3>
      <ul class="emergency-drug-list">${drugRows}</ul>
      ${warnHtml}
      <p class="emergency-disclaimer">본 요약은 참고용이며, 실제 응급 처치는 반드시 의료진의 판단을 따르세요.</p>
    `;
  }

  el.emergencyCardBtn.addEventListener("click", () => {
    renderEmergencyCard();
    el.emergencyCardOverlay.hidden = false;
    document.body.classList.add("emergency-mode");
  });
  el.emergencyCardCloseBtn.addEventListener("click", () => {
    el.emergencyCardOverlay.hidden = true;
    document.body.classList.remove("emergency-mode");
  });
  el.emergencyCardPrintBtn.addEventListener("click", () => window.print());

  // ---------- 다크모드 수동 토글 ----------
  // "auto"일 때는 data-theme을 아예 안 붙여서 CSS의 prefers-color-scheme가 그대로 적용된다.
  const THEME_CYCLE = ["auto", "light", "dark"];
  const THEME_LABELS = { auto: "자동", light: "라이트", dark: "다크" };
  let themeIndex = 0;

  function applyTheme() {
    const theme = THEME_CYCLE[themeIndex];
    if (theme === "auto") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    el.themeToggleLabel.textContent = THEME_LABELS[theme];
    localStorage.setItem("dur_theme", theme);
  }

  el.themeToggleBtn.addEventListener("click", () => {
    themeIndex = (themeIndex + 1) % THEME_CYCLE.length;
    applyTheme();
  });

  // ---------- 글자 크기 조절 ----------
  const FONT_STEPS = [0.9, 1, 1.15, 1.3];
  let fontStepIndex = 1;

  function applyFontStep() {
    document.documentElement.style.setProperty("--font-zoom", FONT_STEPS[fontStepIndex]);
    localStorage.setItem("dur_font_step", String(fontStepIndex));
  }

  el.fontIncreaseBtn.addEventListener("click", () => {
    fontStepIndex = Math.min(fontStepIndex + 1, FONT_STEPS.length - 1);
    applyFontStep();
  });
  el.fontDecreaseBtn.addEventListener("click", () => {
    fontStepIndex = Math.max(fontStepIndex - 1, 0);
    applyFontStep();
  });

  // ---------- 음성 검색 ----------
  // 브라우저 호환성: 이 API는 Chrome/Edge(데스크톱·안드로이드)에서만 되고, iOS Safari는
  // 아예 지원하지 않는다 - 그런 브라우저에서는 버튼 자체가 hidden 상태로 유지된다.
  const VOICE_ERROR_MESSAGES = {
    "no-speech": "음성이 들리지 않았어요. 🎤 버튼을 다시 누르고 또렷하게 말씀해주세요.",
    "audio-capture": "마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인해주세요.",
    "not-allowed": "마이크 권한이 꺼져 있어요. 브라우저 설정에서 마이크 권한을 허용해주세요.",
    "service-not-allowed": "마이크 권한이 꺼져 있어요. 브라우저 설정에서 마이크 권한을 허용해주세요.",
    network: "네트워크 문제로 음성 인식을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.",
    aborted: "",
  };

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognitionCtor) {
    el.voiceSearchBtn.hidden = false;
    el.voiceSearchHint.hidden = false;
    const recognizer = new SpeechRecognitionCtor();
    recognizer.lang = "ko-KR";
    recognizer.continuous = false;
    recognizer.interimResults = false;

    let listening = false;

    function showVoiceStatus(message) {
      if (!message) {
        el.voiceSearchStatus.hidden = true;
        el.voiceSearchStatus.textContent = "";
        return;
      }
      el.voiceSearchStatus.hidden = false;
      el.voiceSearchStatus.textContent = message;
    }

    el.voiceSearchBtn.addEventListener("click", () => {
      if (listening) {
        recognizer.stop();
        return;
      }
      try {
        showVoiceStatus("🎤 듣고 있어요... 약 이름을 말씀해주세요.");
        recognizer.start();
      } catch (err) {
        console.error("음성 인식 시작 실패", err);
        showVoiceStatus("음성 인식을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
    });

    recognizer.addEventListener("start", () => {
      listening = true;
      el.voiceSearchBtn.classList.add("listening");
    });
    recognizer.addEventListener("end", () => {
      listening = false;
      el.voiceSearchBtn.classList.remove("listening");
    });
    recognizer.addEventListener("error", (e) => {
      console.error("음성 인식 오류", e.error);
      showVoiceStatus(VOICE_ERROR_MESSAGES[e.error] || "음성 인식 중 문제가 발생했습니다. 다시 시도해주세요.");
    });
    recognizer.addEventListener("result", (e) => {
      const transcript = e.results[0][0].transcript.trim();
      showVoiceStatus(`✅ "${transcript}"(으)로 검색합니다.`);
      el.searchInput.value = transcript;
      runSearch();
    });
  }

  // ---------- 약봉투 사진 OCR 일괄 등록 ----------
  // Tesseract.js는 index.html에서 defer로 로딩되는데, 이 스크립트는 defer가 아니라서
  // 타이밍상 window.Tesseract가 아직 없을 수 있다. load 이벤트(모든 defer 스크립트
  // 실행 완료 후 발생)에서 확인해야 안전하다.
  window.addEventListener("load", () => {
    if (window.Tesseract) {
      el.ocrBtn.hidden = false;
    } else {
      console.warn("Tesseract.js를 불러오지 못해 사진 등록 기능을 사용할 수 없습니다.");
    }
  });

  el.ocrBtn.addEventListener("click", () => el.ocrFileInput.click());
  el.ocrCancelBtn.addEventListener("click", () => {
    el.ocrPanel.hidden = true;
  });

  // 요즘 폰 카메라 사진은 원본이 수 MB(수천만 화소)라서 그대로 OCR에 넣으면 체감상
  // "멈춘 것처럼" 느껴질 만큼 오래 걸릴 수 있다. 글자를 읽는 데는 그 정도 해상도가
  // 필요 없으므로, 긴 변 기준 최대 1600px로 줄여서 속도를 크게 개선한다.
  function downscaleImage(file, maxDim) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width <= maxDim && height <= maxDim) {
          resolve(file);
          return;
        }
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.9);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file); // 축소에 실패해도 원본으로라도 계속 진행
      };
      img.src = url;
    });
  }

  const OCR_STATUS_LABELS = {
    "loading tesseract core": "OCR 엔진을 불러오는 중",
    "initializing tesseract": "OCR 엔진을 준비하는 중",
    "loading language traineddata": "언어 데이터를 불러오는 중 (처음 한 번만 시간이 걸려요)",
    "initializing api": "준비하는 중",
    "recognizing text": "글자를 읽는 중",
  };

  el.ocrFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || !window.Tesseract) return;

    el.ocrPanel.hidden = false;
    el.ocrResults.innerHTML = "";
    el.ocrAddBtn.style.display = "none";
    el.ocrStatus.textContent = "사진을 준비하는 중...";

    try {
      const processedImage = await downscaleImage(file, 1600);
      const { data } = await window.Tesseract.recognize(processedImage, "kor+eng", {
        logger: (m) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            el.ocrStatus.textContent = `글자를 읽는 중입니다... ${Math.round(m.progress * 100)}%`;
          } else if (m.status) {
            el.ocrStatus.textContent = `${OCR_STATUS_LABELS[m.status] || m.status}...`;
          }
        },
      });
      const matches = matchOcrTextToProducts(data.text || "");
      renderOcrResults(matches);
    } catch (err) {
      console.error("OCR 인식 실패", err);
      el.ocrStatus.textContent = "사진 인식에 실패했습니다. 다시 시도하거나 검색창에 직접 입력해주세요.";
    }
  });

  // 인식된 각 줄이 어떤 상품의 '핵심 상품명'(search_name, 용량/괄호 제거된 이름)을
  // 포함하는지로 후보를 찾는다. OCR 오타에 완전히 강건하진 않지만, 실제 약봉투는
  // 보통 상품명이 비교적 또렷하게 인쇄되어 있어 이 정도로도 실용적으로 동작한다.
  function matchOcrTextToProducts(text) {
    const lines = text
      .split(/\n+/)
      .map((l) => l.replace(/\s+/g, "").trim())
      .filter((l) => l.length >= 2);
    if (!lines.length || !state.drugsData) return [];

    const foundCodes = new Set();
    const matches = [];
    for (const p of state.drugsData.products) {
      if (!p.search_name || p.search_name.length < 2) continue;
      const compact = p.search_name.replace(/\s+/g, "");
      if (lines.some((line) => line.includes(compact))) {
        foundCodes.add(p.product_code);
        matches.push(p);
        if (matches.length >= 30) break; // 후보가 너무 많아지는 것 방지
      }
    }
    return matches;
  }

  function renderOcrResults(matches) {
    if (!matches.length) {
      el.ocrStatus.textContent = "일치하는 약을 찾지 못했습니다. 검색창에 직접 입력해주세요.";
      el.ocrAddBtn.style.display = "none";
      return;
    }
    el.ocrStatus.textContent = `${matches.length}개의 약을 찾았습니다. 담을 약을 선택하고 아래 버튼을 눌러주세요.`;
    el.ocrResults.innerHTML = matches
      .map(
        (p, idx) => `
      <li class="ocr-result-item">
        <label>
          <input type="checkbox" class="ocr-check" data-idx="${idx}" checked />
          <span class="name">${escapeHtml(p.product_name_display)}</span>
          <span class="sub">${escapeHtml(p.company)}</span>
        </label>
      </li>`
      )
      .join("");

    el.ocrAddBtn.style.display = "";
    el.ocrAddBtn.onclick = () => {
      el.ocrResults.querySelectorAll(".ocr-check:checked").forEach((cb) => {
        const p = matches[Number(cb.getAttribute("data-idx"))];
        addToBasket({
          kind: "product",
          code: p.product_code,
          label: p.product_name_display,
          sub: `${p.company} · ${p.ingredient_name_display}`,
          ingredientKeys: p.ingredient_keys,
          healthSearchName: p.search_name || p.product_name_display,
        });
      });
      el.ocrPanel.hidden = true;
    };
  }

  // ---------- 가족 공유 연동 ----------
  // family-sync.js가 Firestore에서 실시간으로 받은 데이터를 여기서 반영한다.
  // saveBasket()/saveReminders()는 family-sync.js의 applyingRemote 가드 덕분에
  // 이 반영을 다시 Firestore로 재전송하지 않는다.
  window.addEventListener("family-data-updated", (e) => {
    const data = e.detail || {};
    state.familyReadOnly = !!data.readOnly;
    if (Array.isArray(data.basket)) {
      state.basket = data.basket;
      saveBasket();
      renderBasket();
      renderResults();
    }
    if (Array.isArray(data.reminders)) {
      reminders = data.reminders;
      saveReminders();
      renderReminders();
    }
    if (Array.isArray(data.takenDoses)) {
      takenDoses = new Set(data.takenDoses);
      saveTakenDoses();
      renderTodaySchedule();
    renderAdherenceCalendar();
    }
  });

  // ---------- 초기화 ----------
  const savedMode = localStorage.getItem("dur_mode");
  if (savedMode === "expert") setMode("expert");

  const savedFontStep = parseInt(localStorage.getItem("dur_font_step"), 10);
  if (!Number.isNaN(savedFontStep) && FONT_STEPS[savedFontStep] !== undefined) {
    fontStepIndex = savedFontStep;
  }
  applyFontStep();

  const savedTheme = localStorage.getItem("dur_theme");
  const savedThemeIndex = THEME_CYCLE.indexOf(savedTheme);
  if (savedThemeIndex >= 0) themeIndex = savedThemeIndex;
  applyTheme();

  state.basket = loadBasket();
  renderBasket();
  renderReminders();
  loadData().catch((err) => {
    console.error(err);
    el.results.innerHTML = `<p class="basket-empty">데이터를 불러오지 못했습니다. data/drugs.json, data/dur_rules.json 파일이 있는지 확인하세요.<br>(${escapeHtml(err.message)})</p>`;
  });

  // ---------- PWA: 서비스워커 등록 ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => console.error("SW 등록 실패", err));
    });
  }
})();
