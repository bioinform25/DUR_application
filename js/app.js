(function () {
  "use strict";

  const state = {
    drugsData: null,
    rulesData: null,
    productsByCode: {}, // product_code -> 제품 상세 (저렴한 대체약 비교용)
    ingredientToGroups: {}, // ingredient_key -> 효능군 이름 목록 (효능군중복 판정용)
    suggestions: [], // 검색 대상 통합 인덱스
    basket: [],       // 담은 약 목록
    mode: "lay",      // 'lay' | 'expert'
    highlightIndex: -1,
    currentMatches: [],
  };

  const el = {
    searchInput: document.getElementById("search-input"),
    suggestions: document.getElementById("suggestions"),
    basketList: document.getElementById("basket-list"),
    basketEmptyMsg: document.getElementById("basket-empty-msg"),
    basketCount: document.getElementById("basket-count"),
    clearBasketBtn: document.getElementById("clear-basket-btn"),
    results: document.getElementById("results"),
    modeLayBtn: document.getElementById("mode-lay-btn"),
    modeExpertBtn: document.getElementById("mode-expert-btn"),
    dataUpdated: document.getElementById("data-updated"),
    themeToggleBtn: document.getElementById("theme-toggle-btn"),
    themeToggleLabel: document.getElementById("theme-toggle-label"),
    fontDecreaseBtn: document.getElementById("font-decrease-btn"),
    fontIncreaseBtn: document.getElementById("font-increase-btn"),
    voiceSearchBtn: document.getElementById("voice-search-btn"),
    printBtn: document.getElementById("print-btn"),
    printDate: document.getElementById("print-date"),
    reminderList: document.getElementById("reminder-list"),
    reminderEmptyMsg: document.getElementById("reminder-empty-msg"),
    ocrBtn: document.getElementById("ocr-btn"),
    ocrFileInput: document.getElementById("ocr-file-input"),
    ocrPanel: document.getElementById("ocr-panel"),
    ocrStatus: document.getElementById("ocr-status"),
    ocrResults: document.getElementById("ocr-results"),
    ocrAddBtn: document.getElementById("ocr-add-btn"),
    ocrCancelBtn: document.getElementById("ocr-cancel-btn"),
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
  }

  function renderDataMeta() {
    const d = state.drugsData;
    if (!d) return;
    el.dataUpdated.textContent =
      ` (약제급여목록표 기준일: ${d.updated}, 수록 제품 ${d.product_count.toLocaleString()}건)`;
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
      list.push({
        kind: "product",
        code: p.product_code,
        label: p.product_name_display,
        sub: `${p.company} · ${p.ingredient_name_display}`,
        searchText: (p.product_name_display + " " + p.ingredient_name_display).toLowerCase(),
        ingredientKeys: p.ingredient_keys,
        healthSearchName: p.search_name || p.product_name_display,
      });
    }
    state.suggestions = list;
  }

  function prettifyKey(key) {
    if (!key) return key;
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  // ---------- 검색 자동완성 ----------
  let searchDebounce = null;
  el.searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 120);
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

  function renderSuggestions(matches) {
    if (!matches.length) {
      el.suggestions.innerHTML = '<div class="suggestion-empty">일치하는 약이 없습니다. 다른 이름으로 검색해보세요.</div>';
      el.suggestions.classList.add("open");
      return;
    }
    el.suggestions.innerHTML = matches
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
  }

  function loadBasket() {
    try {
      const raw = localStorage.getItem(BASKET_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function addToBasket(item) {
    const uid = item.kind + ":" + (item.kind === "product" ? item.code : item.key);
    if (state.basket.some((b) => b.uid === uid)) return;
    state.basket.push({
      uid,
      kind: item.kind,
      code: item.code,
      key: item.key,
      label: item.label,
      sub: item.sub,
      ingredientKeys: item.ingredientKeys,
      healthSearchName: item.healthSearchName || item.label,
    });
    saveBasket();
    renderBasket();
    renderResults();
  }

  function removeFromBasket(uid) {
    state.basket = state.basket.filter((b) => b.uid !== uid);
    saveBasket();
    renderBasket();
    renderResults();
  }

  el.clearBasketBtn.addEventListener("click", () => {
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

  function renderBasket() {
    el.basketEmptyMsg.style.display = state.basket.length ? "none" : "block";
    el.basketCount.textContent = state.basket.length ? `담은 약 ${state.basket.length}개` : "";

    el.basketList.innerHTML = state.basket
      .map((b) => {
        const healthLink = healthKrLink(b.healthSearchName);
        const alt = b.kind === "product" ? findCheaperAlternative(b.code) : null;
        const altHtml = alt
          ? `<div class="price-alt">💡 같은 성분·용량의 <strong>${escapeHtml(alt.cheapest.product_name_display)}</strong>(${escapeHtml(alt.cheapest.company)})이(가)
             ${alt.savings.toLocaleString()}원 더 저렴합니다 (${alt.current.price.toLocaleString()}원 → ${alt.cheapest.price.toLocaleString()}원)</div>`
          : "";
        return `
        <li class="basket-item">
          <div class="info">
            <div class="name">${escapeHtml(b.label)}</div>
            <div class="meta">${escapeHtml(b.sub)}</div>
            ${altHtml}
          </div>
          <div class="actions">
            <a class="link-btn health-link" title="약학정보원에서 상세정보 보기" href="${healthLink}" target="_blank" rel="noopener">약학정보원</a>
            <button class="link-btn reminder-add-btn no-print" title="복약 알림 등록" data-label="${escapeHtml(b.label)}">⏰</button>
            <button class="remove-btn" title="바구니에서 빼기" data-uid="${b.uid}">×</button>
          </div>
        </li>`;
      })
      .join("");

    el.basketList.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeFromBasket(btn.getAttribute("data-uid")));
    });
    el.basketList.querySelectorAll(".reminder-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => addReminder(btn.getAttribute("data-label")));
    });
  }

  // ---------- DUR 분석 ----------
  // "advisory"는 성분 단일 기준 주의 안내(노인주의/특정연령대금기/투여기간주의/
  // 용량주의)를 하나의 색상으로 묶은 버킷이다. 배지에는 이 버킷 이름 대신 각
  // 규칙의 실제 category(rule.category, 예: "특정연령대금기")를 그대로 보여준다.
  function severityBucket(severity) {
    if (severity === "contraindicated") return "contraindicated";
    if (severity === "caution") return "caution";
    if (severity === "duplicate") return "duplicate";
    if (["elderly-caution", "age-restricted", "duration-caution", "dose-caution"].includes(severity)) {
      return "advisory";
    }
    return "other";
  }

  function severityLabel(bucket) {
    return {
      contraindicated: "병용금기",
      caution: "병용주의",
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

  // 발견된 항목들을 훑어 "종합 위험도"를 한 줄로 요약한다. 카드를 하나하나 안 읽어도
  // 맨 위에서 심각성을 바로 파악할 수 있게 하기 위함(특히 스크롤이 부담스러운 사용자).
  function buildRiskSummary(matches) {
    const counts = {};
    for (const m of matches) {
      const b = severityBucket(m.rule.severity);
      counts[b] = (counts[b] || 0) + 1;
    }
    const total = matches.length;

    if (counts.contraindicated) {
      return {
        level: "높음",
        bucketClass: "contraindicated",
        headline: `병용금기 ${counts.contraindicated}건을 포함해 총 ${total}건 발견 — 반드시 약사·의사와 상담 후 복용하세요.`,
      };
    }
    if (counts.caution || counts["food-interaction"]) {
      const foodPart = counts["food-interaction"] ? ` (음식 상호작용 ${counts["food-interaction"]}건 포함)` : "";
      return {
        level: "중간",
        bucketClass: "caution",
        headline: `주의가 필요한 조합 총 ${total}건 발견${foodPart} — 복용 전 확인이 필요합니다.`,
      };
    }
    if (counts.duplicate) {
      return {
        level: "중간",
        bucketClass: "duplicate",
        headline: `효능군 중복 등 총 ${total}건 발견 — 중복으로 복용 중인 약이 없는지 확인해보세요.`,
      };
    }
    return {
      level: "낮음",
      bucketClass: "advisory",
      headline: `참고할 주의사항 총 ${total}건 발견 — 심각한 위험은 아니지만 확인해두시면 좋습니다.`,
    };
  }

  function renderResults() {
    if (!state.drugsData || !state.rulesData) return;

    if (state.basket.length === 0) {
      el.results.innerHTML = '<p class="basket-empty">약을 2개 이상 담으면 병용금기 여부를 분석합니다. (1개만 담아도 노인주의 등 단일 약물 주의사항은 표시됩니다.)</p>';
      return;
    }

    const matches = analyzeBasket();

    if (matches.length === 0) {
      el.results.innerHTML =
        '<div class="no-result">현재 담긴 약들 사이에서는 등록된 병용금기·주의사항이 발견되지 않았습니다.<br>' +
        '<span style="font-weight:400;font-size:14px;">※ 본 데이터베이스에 없는 상호작용도 있을 수 있으니, 최종 확인은 약사·의사와 상의하세요.</span></div>';
      return;
    }

    const order = ["contraindicated", "caution", "duplicate", "advisory", "other"];
    matches.sort((a, b) => order.indexOf(severityBucket(a.rule.severity)) - order.indexOf(severityBucket(b.rule.severity)));

    const risk = buildRiskSummary(matches);
    const summary = `
      <div class="risk-banner ${risk.bucketClass}">
        <span class="risk-level">종합 위험도: ${risk.level}</span>
        <p class="risk-headline">${escapeHtml(risk.headline)}</p>
      </div>`;

    const cards = matches
      .map((m) => {
        const bucket = severityBucket(m.rule.severity);
        const names = m.items.map((it) => it.label).join(" + ");
        const refItems = (m.rule.reference_items || []).filter(Boolean).join(", ");
        const ingredientKeyLabel = (m.rule.ingredient_keys || []).map(prettifyKey).join(" ↔ ");
        const pairCount = m.rule.product_pair_count;

        const badgeText = m.rule.category || severityLabel(bucket);

        return `
        <div class="result-card ${bucket}">
          <span class="result-badge">${escapeHtml(badgeText)}</span>
          <p class="result-title">${escapeHtml(names)}</p>

          <div class="lay-only">
            ${m.rule.description ? `<p class="result-desc">${escapeHtml(m.rule.description)}</p>` : ""}
            <p class="result-advice">${escapeHtml(severityAdvice(bucket, m.rule.category))}</p>
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
      })
      .join("");

    el.results.innerHTML = summary + cards;
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
  }

  function addReminder(label) {
    if (reminders.some((r) => r.label === label)) {
      alert("이미 등록된 약입니다. 아래 목록에서 시간을 추가해주세요.");
      return;
    }
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    reminders.push({ id: "r" + Date.now(), label, times: [] });
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

  function renderReminders() {
    el.reminderEmptyMsg.style.display = reminders.length ? "none" : "block";
    el.reminderList.innerHTML = reminders
      .map((r) => {
        const chips = r.times
          .map(
            (t) => `<span class="time-chip">${t} <button class="time-remove-btn" data-id="${r.id}" data-time="${t}" aria-label="시간 삭제">×</button></span>`
          )
          .join("");
        return `
        <li class="reminder-item">
          <div class="info">
            <div class="name">${escapeHtml(r.label)}</div>
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
    el.reminderList.querySelectorAll(".reminder-item > .remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeReminder(btn.getAttribute("data-id")));
    });
  }

  function checkReminders() {
    if (!reminders.length) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const currentTime = `${hh}:${mm}`;
    const today = now.toISOString().slice(0, 10);

    for (const r of reminders) {
      if (!r.times.includes(currentTime)) continue;
      const fireKey = `${r.id}_${currentTime}_${today}`;
      if (remindersFiredToday.has(fireKey)) continue;
      remindersFiredToday.add(fireKey);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("복약 알림", { body: `${r.label} 복용 시간입니다.`, icon: "icons/icon-192.png" });
      }
    }
  }

  setInterval(checkReminders, 20000);

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
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognitionCtor) {
    el.voiceSearchBtn.hidden = false;
    const recognizer = new SpeechRecognitionCtor();
    recognizer.lang = "ko-KR";
    recognizer.continuous = false;
    recognizer.interimResults = false;

    let listening = false;

    el.voiceSearchBtn.addEventListener("click", () => {
      if (listening) {
        recognizer.stop();
        return;
      }
      try {
        recognizer.start();
      } catch (err) {
        console.error("음성 인식 시작 실패", err);
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
    });
    recognizer.addEventListener("result", (e) => {
      const transcript = e.results[0][0].transcript.trim();
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

  el.ocrFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || !window.Tesseract) return;

    el.ocrPanel.hidden = false;
    el.ocrResults.innerHTML = "";
    el.ocrAddBtn.style.display = "none";
    el.ocrStatus.textContent = "사진을 분석하고 있습니다... (처음 실행 시 시간이 좀 걸릴 수 있어요)";

    try {
      const { data } = await window.Tesseract.recognize(file, "kor+eng");
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
