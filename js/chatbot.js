/*
 * 알리봇: Firebase AI Logic(Gemini Developer API 백엔드)을 클라이언트에서 직접 호출하는
 * 약물 Q&A 챗봇. 별도 백엔드 서버 없이 Firebase 프로젝트를 통해 Gemini를 호출한다.
 *
 * 이 모듈은 family-sync.js와 다른 Firebase 앱 인스턴스(이름: "aliyak-chatbot")를 사용한다.
 * family-sync.js는 구버전 compat SDK(10.14.1)를, 이 파일은 신버전 modular SDK(12.16.0)를
 * 쓰기 때문에 앱 인스턴스를 분리해야 두 SDK 내부 레지스트리가 충돌하지 않는다.
 *
 * 주의: 실제 동작하려면 Firebase 콘솔에서 "AI Logic" 기능을 활성화(Gemini Developer API
 * 사용 설정)해야 한다. 활성화 전이거나 네트워크 문제가 있으면 대화창에 안내 메시지만
 * 뜨고 앱의 다른 기능에는 전혀 영향이 없다.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-ai.js";

(async function () {
  "use strict";

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA7m0_YgkQBME3p3nTZjqLdlEnMJDsXigQ",
    authDomain: "aliyak.firebaseapp.com",
    projectId: "aliyak",
    storageBucket: "aliyak.firebasestorage.app",
    messagingSenderId: "652227945584",
    appId: "1:652227945584:web:20e8b1882c4ec983a9c0b5",
    measurementId: "G-RK6YLMGE3Z",
  };

  const SYSTEM_PROMPT = `너는 "알리봇", 한국의 다제약물 병용금기 확인 앱 "알리약"에 내장된 약물·건강 정보 도우미야.
사용자가 묻는 약물, 질병, 치료법(약물치료·비약물치료 모두)에 대해 최신 임상 지식을 바탕으로
약사·의사 수준의 정확성을 갖추되, 일반인이 이해하기 쉬운 말로 친절하게 답변해.

반드시 지켜야 할 규칙:
1. 절대 확진적인 진단을 내리지 마("당신은 OO병입니다" 금지). 가능성과 일반적인 정보만 제공해.
2. 개인 맞춤 처방 용량을 지시하지 마. 일반적으로 알려진 참고 정보 제공은 괜찮지만 "당신은 이만큼 드세요"처럼 처방을 대신하지 마.
3. 확실하지 않거나 최신 정보인지 모르면 솔직히 모른다고 인정해. 근거 없이 지어내지 마.
4. 응급 상황으로 보이는 증상(심한 흉통, 심한 호흡곤란, 의식저하, 심한 알레르기 반응 등)이 언급되면 즉시 119 신고 또는 응급실 방문을 안내해.
5. 답변 끝에는 실제 의사·약사 상담을 권장하는 짧은 문구를 자연스럽게 덧붙여.
6. 항상 한국어 존댓말로, 간결하고 이해하기 쉽게 답해.`;

  const msgEl = document.getElementById("chatbot-messages");
  const emptyMsgEl = document.getElementById("chatbot-empty-msg");
  const statusEl = document.getElementById("chatbot-status");
  const inputEl = document.getElementById("chatbot-input");
  const sendBtn = document.getElementById("chatbot-send-btn");
  const clearBtn = document.getElementById("chatbot-clear-btn");
  const usageEl = document.getElementById("chatbot-usage");

  if (!msgEl || !inputEl || !sendBtn) return; // 챗봇 탭 UI가 없는 페이지에서는 조용히 종료

  const USAGE_KEY = "dur_chatbot_usage";
  const DAILY_LIMIT = 30;

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function getUsage() {
    try {
      const raw = localStorage.getItem(USAGE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (!data || data.date !== todayStr()) return { date: todayStr(), count: 0 };
      return data;
    } catch {
      return { date: todayStr(), count: 0 };
    }
  }

  function saveUsage(usage) {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  }

  function renderUsage() {
    const usage = getUsage();
    usageEl.textContent = `오늘 남은 질문: ${Math.max(0, DAILY_LIMIT - usage.count)} / ${DAILY_LIMIT}`;
  }

  function getBasketContext() {
    try {
      const basket = JSON.parse(localStorage.getItem("dur_basket") || "[]");
      if (!basket.length) return "";
      const labels = basket.map((b) => b.label).filter(Boolean);
      return `\n\n(참고로 사용자가 앱에 등록해둔 현재 복용 약: ${labels.join(", ")}. 관련 질문일 때만 참고하고, 아니면 무시해.)`;
    } catch {
      return "";
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function appendMessage(role, text) {
    if (emptyMsgEl) emptyMsgEl.style.display = "none";
    const bubble = document.createElement("div");
    bubble.className = `chatbot-bubble ${role}`;
    bubble.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
    msgEl.appendChild(bubble);
    msgEl.scrollTop = msgEl.scrollHeight;
    return bubble;
  }

  function setBusy(busy) {
    inputEl.disabled = busy;
    sendBtn.disabled = busy;
    sendBtn.textContent = busy ? "답변 기다리는 중..." : "보내기";
  }

  function showStatus(text) {
    if (!text) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
  }

  let model = null;
  let chat = null;

  function initChat() {
    const app = initializeApp(FIREBASE_CONFIG, "aliyak-chatbot");
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    model = getGenerativeModel(ai, { model: "gemini-3.5-flash", systemInstruction: SYSTEM_PROMPT });
    chat = model.startChat({ history: [] });
  }

  try {
    initChat();
  } catch (err) {
    console.error("[chatbot] Firebase AI Logic 초기화 실패", err);
    showStatus("⚠️ 알리봇을 초기화할 수 없습니다. 잠시 후 다시 시도해주세요.");
  }

  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text) return;

    const usage = getUsage();
    if (usage.count >= DAILY_LIMIT) {
      showStatus(`오늘의 질문 횟수(${DAILY_LIMIT}회)를 모두 사용했습니다. 내일 다시 이용해주세요.`);
      return;
    }

    if (!chat) {
      showStatus("⚠️ 알리봇이 준비되지 않았습니다. 페이지를 새로고침해보세요.");
      return;
    }

    appendMessage("user", text);
    inputEl.value = "";
    showStatus("");
    setBusy(true);

    try {
      const result = await chat.sendMessage(text + getBasketContext());
      const answer = result.response.text();
      appendMessage("bot", answer);
      saveUsage({ date: usage.date, count: usage.count + 1 });
      renderUsage();
    } catch (err) {
      console.error("[chatbot] 응답 생성 실패", err);
      appendMessage(
        "bot",
        "죄송합니다. 지금 답변을 가져올 수 없습니다. Firebase AI Logic이 아직 활성화되지 않았거나 네트워크 문제일 수 있습니다. 잠시 후 다시 시도해주세요."
      );
    } finally {
      setBusy(false);
      inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", handleSend);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSend();
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("대화 내용을 모두 지우시겠습니까?")) return;
    msgEl.querySelectorAll(".chatbot-bubble").forEach((b) => b.remove());
    if (emptyMsgEl) emptyMsgEl.style.display = "block";
    showStatus("");
    try {
      initChat();
    } catch (err) {
      console.error("[chatbot] 재초기화 실패", err);
    }
  });

  renderUsage();
})();
