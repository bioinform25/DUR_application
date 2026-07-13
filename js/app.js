(function () {
  "use strict";

  const state = {
    drugsData: null,
    rulesData: null,
    productsByCode: {}, // product_code -> 제품 상세 (저렴한 대체약 비교용)
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
    fontDecreaseBtn: document.getElementById("font-decrease-btn"),
    fontIncreaseBtn: document.getElementById("font-increase-btn"),
    voiceSearchBtn: document.getElementById("voice-search-btn"),
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
      if (starts.length >= 20) break;
    }
    const matches = starts.concat(contains).slice(0, 20);
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
    renderBasket();
    renderResults();
  }

  function removeFromBasket(uid) {
    state.basket = state.basket.filter((b) => b.uid !== uid);
    renderBasket();
    renderResults();
  }

  el.clearBasketBtn.addEventListener("click", () => {
    state.basket = [];
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
            <button class="remove-btn" title="바구니에서 빼기" data-uid="${b.uid}">×</button>
          </div>
        </li>`;
      })
      .join("");

    el.basketList.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeFromBasket(btn.getAttribute("data-uid")));
    });
  }

  // ---------- DUR 분석 ----------
  function severityBucket(severity) {
    if (severity === "contraindicated") return "contraindicated";
    if (severity === "caution") return "caution";
    if (severity === "elderly-caution") return "elderly";
    return "other";
  }

  function severityLabel(bucket) {
    return {
      contraindicated: "병용금기",
      caution: "병용주의",
      elderly: "노인주의 등",
      other: "기타 주의",
    }[bucket];
  }

  // 일반인 모드에서는 의학적 세부사항 대신, 심각도에 맞는 상담 권고 문구를 강조해서 보여준다.
  function severityLayAdvice(bucket) {
    return {
      contraindicated: "함께 복용하면 안 되는 조합(병용금기)입니다. 지금 복용 중이라면 반드시 처방한 의사 또는 약사와 상담하세요.",
      caution: "함께 복용 시 주의가 필요한 조합입니다. 복용 전 약사·의사와 상담하는 것이 안전합니다.",
      elderly: "고령 환자는 특히 주의가 필요한 약입니다. 복용 여부를 의사·약사와 상의하세요.",
      other: "등록된 주의사항이 있습니다. 약사·의사와 상담하세요.",
    }[bucket];
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
      }
    }
    return found;
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

    const order = ["contraindicated", "caution", "elderly", "other"];
    matches.sort((a, b) => order.indexOf(severityBucket(a.rule.severity)) - order.indexOf(severityBucket(b.rule.severity)));

    const summary = `<p class="result-summary"><strong>${matches.length}건</strong>의 주의사항이 발견되었습니다.</p>`;

    const cards = matches
      .map((m) => {
        const bucket = severityBucket(m.rule.severity);
        const names = m.items.map((it) => it.label).join(" + ");
        const refItems = (m.rule.reference_items || []).filter(Boolean).join(", ");
        const ingredientKeyLabel = (m.rule.ingredient_keys || []).map(prettifyKey).join(" ↔ ");
        const pairCount = m.rule.product_pair_count;

        return `
        <div class="result-card ${bucket}">
          <span class="result-badge">${severityLabel(bucket)}</span>
          <p class="result-title">${escapeHtml(names)}</p>

          <div class="lay-only">
            ${m.rule.description ? `<p class="result-desc">${escapeHtml(m.rule.description)}</p>` : ""}
            <p class="result-advice">${escapeHtml(severityLayAdvice(bucket))}</p>
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

  // ---------- 초기화 ----------
  const savedMode = localStorage.getItem("dur_mode");
  if (savedMode === "expert") setMode("expert");

  const savedFontStep = parseInt(localStorage.getItem("dur_font_step"), 10);
  if (!Number.isNaN(savedFontStep) && FONT_STEPS[savedFontStep] !== undefined) {
    fontStepIndex = savedFontStep;
  }
  applyFontStep();

  renderBasket();
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
