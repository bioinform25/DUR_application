/*
 * 공유: Firebase Auth(구글 로그인) + Firestore로 바구니/복약알림을
 * 그룹 안에서 실시간으로 공유한다.
 *
 * 설계(2단계): 한 사용자가 여러 그룹에 속할 수 있고, 그중 "활성 그룹" 하나만
 * 현재 바구니/알림과 실시간 동기화된다(동시에 여러 그룹과 동기화하면 충돌 해결이
 * 복잡해지므로). 그룹마다 멤버는 editor(편집 가능) 또는 viewer(읽기 전용) 역할을
 * 가지며, 그룹 이름(닉네임)은 사용자 각자가 자기 화면에서만 보이게 자유롭게 붙인다
 * (공유 데이터가 아니라 users/{uid} 문서 아래에 개인적으로 저장됨).
 *
 * FIREBASE_CONFIG가 비어 있으면 이 파일은 아무 것도 하지 않고 조용히 빠진다 -
 * 즉 공유 기능을 설정하지 않은 사용자에게는 이 파일이 있어도 전혀 영향이 없다.
 */
(function () {
  "use strict";

  // 카카오톡/인스타그램 등 메신저 앱 내장 브라우저(WebView)에서는 구글이 보안 정책상
  // OAuth 로그인을 아예 차단한다("disallowed_useragent" 403 에러). 코드로 우회할 방법은
  // 없어서, 감지되면 실제 브라우저로 열어달라는 안내만 미리 보여준다.
  // Firebase 스크립트 로딩 여부와 무관하게 항상 실행되어야 하므로, 이 파일에서 가장
  // 먼저(다른 모든 로직보다 앞서) 실행한다 - 인앱 브라우저는 외부 CDN(Firebase) 로딩을
  // 막거나 늦추는 경우가 많아서, 아래쪽에 있으면 감지 자체가 실행되지 못할 수 있다.
  function isInAppBrowser() {
    const ua = navigator.userAgent || "";
    return /KAKAOTALK|Instagram|FBAN|FBAV|FB_IAB|Line\/|NAVER\(inapp|DaumApps|; ?wv\)/i.test(ua);
  }
  if (isInAppBrowser()) {
    // 이 경고는 탭(공유) 안이 아니라 페이지 상단에 항상 떠 있는 배너라서,
    // 사용자가 어느 탭을 보고 있든, Firebase가 로딩되든 안 되든 상관없이 보인다.
    const warning = document.getElementById("webview-warning");
    if (warning) warning.hidden = false;
  }

  // Firebase 콘솔 > 프로젝트 설정 > 일반 > 내 앱에서 복사한 값.
  // apiKey는 Firebase 웹 앱의 경우 공개되어도 되는 값(진짜 접근 제어는
  // Firestore 보안 규칙으로 함) - README의 안내대로 규칙을 반드시 설정할 것.
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA7m0_YgkQBME3p3nTZjqLdlEnMJDsXigQ",
    authDomain: "aliyak.firebaseapp.com",
    projectId: "aliyak",
    storageBucket: "aliyak.firebasestorage.app",
    messagingSenderId: "652227945584",
    appId: "1:652227945584:web:20e8b1882c4ec983a9c0b5",
    measurementId: "G-RK6YLMGE3Z",
  };

  if (!FIREBASE_CONFIG || typeof firebase === "undefined") {
    console.info("[family-sync] Firebase 설정이 없어 공유 기능이 비활성화됩니다.");
    return;
  }

  document.getElementById("family-share-card").hidden = false;

  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();

  const ACTIVE_FAMILY_KEY = "dur_active_family";

  const state = {
    user: null,
    groups: {}, // familyId -> { nickname, members, myRole }
    activeFamilyId: null,
    unsubscribe: null,
    applyingRemote: false, // 원격에서 받은 변경을 반영하는 동안 재전송 방지
  };

  const el = {
    signedOut: document.getElementById("family-signed-out"),
    signedIn: document.getElementById("family-signed-in"),
    signInBtn: document.getElementById("family-signin-btn"),
    signOutBtn: document.getElementById("family-signout-btn"),
    status: document.getElementById("family-status"),
    createBtn: document.getElementById("family-create-btn"),
    joinBtn: document.getElementById("family-join-btn"),
    joinCodeInput: document.getElementById("family-join-code"),
    groupList: document.getElementById("family-group-list"),
    memberPanel: document.getElementById("family-member-panel"),
    memberList: document.getElementById("family-member-list"),
    consentCheckbox: document.getElementById("family-consent-checkbox"),
  };

  // 공유 기능은 담은 약 목록 등 건강 관련 민감정보를 Firebase에 저장하므로, 로그인
  // 버튼은 개인정보처리방침/이용약관에 동의 체크를 하기 전까지 비활성화해둔다.
  // 한 번 동의하면 다음 방문 때는 다시 안 물어보도록 localStorage에 기억해둔다.
  const CONSENT_KEY = "dur_privacy_consent_v1";
  if (localStorage.getItem(CONSENT_KEY) === "true") {
    el.consentCheckbox.checked = true;
    el.signInBtn.disabled = false;
  }
  el.consentCheckbox.addEventListener("change", () => {
    el.signInBtn.disabled = !el.consentCheckbox.checked;
    localStorage.setItem(CONSENT_KEY, el.consentCheckbox.checked ? "true" : "false");
  });

  function genFamilyCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O/1/I 제외
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function escapeAttr(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  auth.onAuthStateChanged(async (user) => {
    state.user = user;
    if (user) {
      el.signedOut.hidden = true;
      el.signedIn.hidden = false;
      el.status.textContent = `${user.displayName}님으로 로그인됨`;
      await loadUserGroups(user.uid);
    } else {
      el.signedOut.hidden = false;
      el.signedIn.hidden = true;
      if (state.unsubscribe) {
        state.unsubscribe();
        state.unsubscribe = null;
      }
      state.groups = {};
      state.activeFamilyId = null;
    }
  });

  el.signInBtn.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch((err) => alert("로그인 실패: " + err.message));
  });

  el.signOutBtn.addEventListener("click", () => auth.signOut());

  async function loadUserGroups(uid) {
    const userDoc = await db.collection("users").doc(uid).get();
    const data = userDoc.exists ? userDoc.data() : {};
    let familyGroups = data.familyGroups || {};

    // 이전 버전(그룹 하나만 지원)에서 쓰던 familyId 문자열이 남아있으면 새 구조로 옮긴다.
    if (data.familyId && !familyGroups[data.familyId]) {
      familyGroups = { ...familyGroups, [data.familyId]: { nickname: "" } };
      await db
        .collection("users")
        .doc(uid)
        .set({ familyGroups, familyId: firebase.firestore.FieldValue.delete() }, { merge: true })
        .catch((err) => console.error("[family-sync] 이전 데이터 이전 실패", err));
    }

    state.groups = {};
    for (const familyId in familyGroups) {
      state.groups[familyId] = { nickname: (familyGroups[familyId] || {}).nickname || "" };
    }

    await refreshGroupMemberInfo();

    const familyIds = Object.keys(state.groups);
    if (!familyIds.length) {
      // 속한 그룹이 하나도 없으면 "내 약"이라는 개인 그룹을 자동으로 만들어준다.
      // 이러면 나중에 다른 사람 그룹(예: 할머니 그룹)에 참여해도, 그건 완전히 다른
      // Firestore 문서라 내 개인 바구니는 전혀 안 건드려진다 - 그룹 전환 버튼으로
      // 언제든 "내 약"으로 돌아올 수 있다. (이 로직이 없던 이전 버전에서는, 그룹에
      // 참여하는 순간 로컬에만 있던 개인 바구니가 통째로 대체돼버리는 문제가 있었다)
      await createGroup(uid, "내 약");
      return;
    }

    const savedActive = localStorage.getItem(ACTIVE_FAMILY_KEY);
    const activeId = savedActive && state.groups[savedActive] ? savedActive : familyIds[0] || null;
    setActiveGroup(activeId);
  }

  async function createGroup(uid, nickname) {
    const code = genFamilyCode();
    await db
      .collection("families")
      .doc(code)
      .set({
        createdBy: uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        members: { [uid]: { role: "editor", displayName: state.user.displayName || "" } },
        basket: [],
        reminders: [],
        takenDoses: [],
      });
    await db
      .collection("users")
      .doc(uid)
      .set({ familyGroups: { [code]: { nickname: nickname || "" } } }, { merge: true });
    state.groups[code] = { nickname: nickname || "" };
    await refreshGroupMemberInfo();
    setActiveGroup(code);
    return code;
  }

  // 그룹 목록에 표시할 멤버 수/내 역할을 파악하려고, 속한 각 그룹 문서를 한 번씩 읽어온다
  // (실시간 구독은 활성 그룹 하나에만 건다 - 나머지는 목록 표시용 스냅샷이면 충분).
  async function refreshGroupMemberInfo() {
    const familyIds = Object.keys(state.groups);
    await Promise.all(
      familyIds.map(async (familyId) => {
        try {
          const doc = await db.collection("families").doc(familyId).get();
          if (!doc.exists) {
            delete state.groups[familyId];
            return;
          }
          const data = doc.data();
          state.groups[familyId].members = data.members || {};
          state.groups[familyId].myRole = (data.members && data.members[state.user.uid] && data.members[state.user.uid].role) || null;
        } catch (err) {
          console.error("[family-sync] 그룹 정보 조회 실패", familyId, err);
        }
      })
    );
    renderGroupList();
  }

  // app.js가 localStorage에 저장해둔 현재 로컬 바구니/알림을 읽는다(직접 참조하지
  // 않고 같은 localStorage 키를 공유해서 파일 간 결합도를 낮춘다).
  function getLocalSnapshot() {
    let basket = [];
    let reminders = [];
    try {
      basket = JSON.parse(localStorage.getItem("dur_basket") || "[]");
    } catch {
      /* 무시 */
    }
    try {
      reminders = JSON.parse(localStorage.getItem("dur_reminders") || "[]");
    } catch {
      /* 무시 */
    }
    return { basket, reminders };
  }

  function setActiveGroup(familyId) {
    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = null;
    }
    state.activeFamilyId = familyId || null;
    if (familyId) {
      localStorage.setItem(ACTIVE_FAMILY_KEY, familyId);
    } else {
      localStorage.removeItem(ACTIVE_FAMILY_KEY);
    }
    renderGroupList();

    if (!familyId) {
      // 활성 그룹이 없어졌다는 것도 app.js에 알려서 읽기 전용 표시 등을 정리하게 한다.
      window.dispatchEvent(new CustomEvent("family-data-updated", { detail: { basket: [], reminders: [], readOnly: false, noGroup: true } }));
      return;
    }

    let isFirstSnapshot = true;
    state.unsubscribe = db
      .collection("families")
      .doc(familyId)
      .onSnapshot((doc) => {
        if (!doc.exists) return;
        const data = doc.data();
        const myRole = (data.members && data.members[state.user.uid] && data.members[state.user.uid].role) || null;
        if (state.groups[familyId]) {
          state.groups[familyId].members = data.members || {};
          state.groups[familyId].myRole = myRole;
        }
        renderGroupList();

        if (isFirstSnapshot) {
          isFirstSnapshot = false;
          // 방금 연결된 시점: 이 기기에 이미 담겨있던 로컬 데이터가 있는데 원격은
          // 비어있다면(예: 막 만든 새 그룹), 빈 원격으로 로컬을 덮어쓰는 대신
          // 로컬 걸 원격에 올린다. 그래야 "연결 직후 바로 약을 담았는데 사라지는"
          // 경쟁 상태를 피할 수 있다. (viewer는 어차피 쓰기 권한이 없어 시도하지 않는다)
          const local = getLocalSnapshot();
          const localHasData = (local.basket && local.basket.length) || (local.reminders && local.reminders.length);
          const remoteEmpty = (!data.basket || !data.basket.length) && (!data.reminders || !data.reminders.length);
          if (localHasData && remoteEmpty && myRole === "editor") {
            db.collection("families")
              .doc(familyId)
              .update({ basket: sanitize(local.basket), reminders: sanitize(local.reminders) })
              .catch((err) => console.error("[family-sync] 초기 동기화 실패", err));
            return;
          }
        }

        state.applyingRemote = true;
        window.dispatchEvent(
          new CustomEvent("family-data-updated", {
            detail: {
              basket: data.basket || [],
              reminders: data.reminders || [],
              takenDoses: data.takenDoses || [],
              readOnly: myRole !== "editor",
            },
          })
        );
        state.applyingRemote = false;
      });
  }

  el.createBtn.addEventListener("click", () => createGroup(state.user.uid, ""));

  el.joinBtn.addEventListener("click", async () => {
    const code = el.joinCodeInput.value.trim().toUpperCase();
    if (!code) return;
    const famRef = db.collection("families").doc(code);
    const famDoc = await famRef.get();
    if (!famDoc.exists) {
      alert("존재하지 않는 코드입니다. 코드를 다시 확인해주세요.");
      return;
    }
    const existingMembers = famDoc.data().members || {};
    if (existingMembers[state.user.uid]) {
      alert("이미 참여 중인 그룹입니다.");
      el.joinCodeInput.value = "";
      return;
    }
    // 참여 시 항상 viewer로 시작한다(편집 권한은 기존 편집자가 나중에 올려줘야 함) -
    // 보안 규칙도 셀프 editor 승격을 막도록 되어 있다.
    await famRef
      .update({ [`members.${state.user.uid}`]: { role: "viewer", displayName: state.user.displayName || "" } })
      .catch((err) => {
        alert("참여 실패: " + err.message);
        throw err;
      });
    await db
      .collection("users")
      .doc(state.user.uid)
      .set({ familyGroups: { [code]: { nickname: "" } } }, { merge: true });
    el.joinCodeInput.value = "";
    state.groups[code] = { nickname: "" };
    await refreshGroupMemberInfo();
    setActiveGroup(code);
  });

  async function leaveGroup(familyId) {
    if (!confirm("이 그룹에서 나가시겠습니까? (그룹 자체는 없어지지 않습니다)")) return;
    await db
      .collection("families")
      .doc(familyId)
      .update({ [`members.${state.user.uid}`]: firebase.firestore.FieldValue.delete() })
      .catch((err) => console.error("[family-sync] 그룹 나가기 실패", err));
    await db
      .collection("users")
      .doc(state.user.uid)
      .update({ [`familyGroups.${familyId}`]: firebase.firestore.FieldValue.delete() })
      .catch((err) => console.error("[family-sync] 그룹 목록 갱신 실패", err));
    delete state.groups[familyId];
    if (state.activeFamilyId === familyId) {
      const remaining = Object.keys(state.groups);
      setActiveGroup(remaining[0] || null);
    } else {
      renderGroupList();
    }
  }

  async function updateNickname(familyId, nickname) {
    if (!state.groups[familyId]) return;
    state.groups[familyId].nickname = nickname;
    try {
      await db
        .collection("users")
        .doc(state.user.uid)
        .set({ familyGroups: { [familyId]: { nickname } } }, { merge: true });
    } catch (err) {
      console.error("[family-sync] 닉네임 저장 실패", err);
    }
  }

  async function changeRole(familyId, memberUid, newRole) {
    try {
      await db
        .collection("families")
        .doc(familyId)
        .update({ [`members.${memberUid}.role`]: newRole });
      await refreshGroupMemberInfo();
    } catch (err) {
      alert("역할 변경 실패: " + err.message);
    }
  }

  async function removeMember(familyId, memberUid) {
    if (!confirm("이 멤버를 그룹에서 내보내시겠습니까?")) return;
    try {
      await db
        .collection("families")
        .doc(familyId)
        .update({ [`members.${memberUid}`]: firebase.firestore.FieldValue.delete() });
      await refreshGroupMemberInfo();
    } catch (err) {
      alert("멤버 추방 실패: " + err.message);
    }
  }

  function renderGroupList() {
    const familyIds = Object.keys(state.groups);
    if (!familyIds.length) {
      el.groupList.innerHTML = '<p class="reminder-hint">아직 속한 그룹이 없습니다. 위에서 만들거나 참여해보세요.</p>';
      el.memberPanel.hidden = true;
      return;
    }

    el.groupList.innerHTML = familyIds
      .map((familyId) => {
        const group = state.groups[familyId];
        const isActive = familyId === state.activeFamilyId;
        const role = group.myRole;
        const memberCount = group.members ? Object.keys(group.members).length : 0;
        const roleLabel = role === "editor" ? "편집자" : role === "viewer" ? "보기전용" : "";
        return `
        <li class="family-group-item ${isActive ? "active" : ""}">
          <div class="family-group-main">
            <input type="text" class="family-nickname-input" data-family-id="${escapeAttr(familyId)}"
              value="${escapeAttr(group.nickname || "")}" placeholder="그룹 이름 (예: 우리 가족)" />
            ${roleLabel ? `<span class="family-role-badge">${roleLabel}</span>` : ""}
          </div>
          <div class="family-group-meta">초대 코드: ${escapeAttr(familyId)} · 멤버 ${memberCount}명</div>
          <div class="family-group-actions">
            ${
              isActive
                ? '<span class="family-active-tag">✅ 활성 그룹(지금 바구니와 연결됨)</span>'
                : `<button type="button" class="link-btn family-activate-btn" data-family-id="${escapeAttr(familyId)}">이 그룹 활성화</button>`
            }
            <button type="button" class="clear-btn family-leave-btn" data-family-id="${escapeAttr(familyId)}">나가기</button>
          </div>
        </li>`;
      })
      .join("");

    el.groupList.querySelectorAll(".family-nickname-input").forEach((input) => {
      input.addEventListener("change", () => {
        updateNickname(input.getAttribute("data-family-id"), input.value.trim());
      });
    });
    el.groupList.querySelectorAll(".family-activate-btn").forEach((btn) => {
      btn.addEventListener("click", () => setActiveGroup(btn.getAttribute("data-family-id")));
    });
    el.groupList.querySelectorAll(".family-leave-btn").forEach((btn) => {
      btn.addEventListener("click", () => leaveGroup(btn.getAttribute("data-family-id")));
    });

    renderMemberPanel();
  }

  function renderMemberPanel() {
    const activeGroup = state.activeFamilyId ? state.groups[state.activeFamilyId] : null;
    const myUid = state.user && state.user.uid;
    if (!activeGroup || !activeGroup.members || activeGroup.myRole !== "editor") {
      el.memberPanel.hidden = true;
      return;
    }
    el.memberPanel.hidden = false;
    const members = activeGroup.members;
    el.memberList.innerHTML = Object.keys(members)
      .map((uid) => {
        const m = members[uid];
        const isMe = uid === myUid;
        const name = m.displayName || (isMe ? "나" : "이름 없음");
        return `
        <li class="family-member-item">
          <span class="family-member-name">${escapeAttr(name)}${isMe ? " (나)" : ""}</span>
          ${
            isMe
              ? `<span class="family-role-badge">${m.role === "editor" ? "편집자" : "보기전용"}</span>`
              : `<select class="family-role-select" data-uid="${escapeAttr(uid)}">
                   <option value="editor" ${m.role === "editor" ? "selected" : ""}>편집자</option>
                   <option value="viewer" ${m.role === "viewer" ? "selected" : ""}>보기전용</option>
                 </select>
                 <button type="button" class="clear-btn family-remove-member-btn" data-uid="${escapeAttr(uid)}">추방</button>`
          }
        </li>`;
      })
      .join("");

    el.memberList.querySelectorAll(".family-role-select").forEach((select) => {
      select.addEventListener("change", () => {
        changeRole(state.activeFamilyId, select.getAttribute("data-uid"), select.value);
      });
    });
    el.memberList.querySelectorAll(".family-remove-member-btn").forEach((btn) => {
      btn.addEventListener("click", () => removeMember(state.activeFamilyId, btn.getAttribute("data-uid")));
    });
  }

  // Firestore는 값이 undefined인 필드가 있으면 update()/set() 자체를 동기적으로 예외를
  // 던지며 거부한다(localStorage/JSON.stringify는 조용히 무시하는 것과 다르다).
  // 바구니 항목에는 kind에 따라 안 쓰는 필드(code 또는 key)가 undefined로 남아있을
  // 수 있어, 보내기 전에 JSON 왕복으로 그런 필드를 전부 제거한다.
  function sanitize(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // app.js가 바구니/알림을 저장할 때마다 호출해서 Firestore에도 반영한다.
  // (원격 변경을 받아 반영하는 도중이거나, 활성 그룹에서 내 역할이 viewer면 보내지 않는다)
  window.FamilySync = {
    isConnected: () => !!state.activeFamilyId,
    isApplyingRemote: () => state.applyingRemote,
    isReadOnly() {
      const g = state.activeFamilyId && state.groups[state.activeFamilyId];
      return !!g && g.myRole !== "editor";
    },
    getCurrentUserId: () => (state.user ? state.user.uid : null),
    // 활성 그룹 멤버 목록(알림 받을 사람 지정 등에 사용) - 연결 안 돼 있으면 null.
    getActiveGroupMembers() {
      const g = state.activeFamilyId && state.groups[state.activeFamilyId];
      if (!g || !g.members) return null;
      return Object.keys(g.members).map((uid) => ({
        uid,
        displayName: g.members[uid].displayName || "이름 없음",
        role: g.members[uid].role,
      }));
    },
    pushBasket(basket) {
      if (!state.activeFamilyId || state.applyingRemote || this.isReadOnly()) return;
      db.collection("families")
        .doc(state.activeFamilyId)
        .update({ basket: sanitize(basket) })
        .catch((err) => console.error("[family-sync] 바구니 동기화 실패", err));
    },
    pushReminders(reminders) {
      if (!state.activeFamilyId || state.applyingRemote || this.isReadOnly()) return;
      db.collection("families")
        .doc(state.activeFamilyId)
        .update({ reminders: sanitize(reminders) })
        .catch((err) => console.error("[family-sync] 알림 동기화 실패", err));
    },
    // 복용 완료 체크는 보기전용 멤버도 자기 몫은 표시할 수 있어야 하므로 isReadOnly 가드를
    // 걸지 않는다(Firestore 보안 규칙에서도 viewer가 takenDoses만 갱신하는 건 허용해둠).
    pushTakenDoses(takenDoses) {
      if (!state.activeFamilyId || state.applyingRemote) return;
      db.collection("families")
        .doc(state.activeFamilyId)
        .update({ takenDoses: sanitize(takenDoses) })
        .catch((err) => console.error("[family-sync] 복용 체크 동기화 실패", err));
    },
  };
})();
