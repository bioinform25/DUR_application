/*
 * 가족 공유: Firebase Auth(구글 로그인) + Firestore로 바구니/복약알림을
 * 가족 그룹 안에서 실시간으로 공유한다.
 *
 * 설계(1단계, 단순화 버전): 가족 그룹당 "하나의 공유 바구니/알림 목록"을 쓴다.
 * (여러 사람 프로필을 나누는 건 나중에 필요하면 추가하기로 함)
 *
 * FIREBASE_CONFIG가 비어 있으면 이 파일은 아무 것도 하지 않고 조용히 빠진다 -
 * 즉 가족 공유를 설정하지 않은 사용자에게는 이 파일이 있어도 전혀 영향이 없다.
 */
(function () {
  "use strict";

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
    console.info("[family-sync] Firebase 설정이 없어 가족 공유 기능이 비활성화됩니다.");
    return;
  }

  document.getElementById("family-share-card").hidden = false;

  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();

  const state = {
    user: null,
    familyId: null,
    unsubscribe: null,
    applyingRemote: false, // 원격에서 받은 변경을 반영하는 동안 재전송 방지
  };

  const el = {
    signedOut: document.getElementById("family-signed-out"),
    signedIn: document.getElementById("family-signed-in"),
    signInBtn: document.getElementById("family-signin-btn"),
    signOutBtn: document.getElementById("family-signout-btn"),
    status: document.getElementById("family-status"),
    noGroup: document.getElementById("family-no-group"),
    groupInfo: document.getElementById("family-group-info"),
    createBtn: document.getElementById("family-create-btn"),
    joinBtn: document.getElementById("family-join-btn"),
    joinCodeInput: document.getElementById("family-join-code"),
    codeDisplay: document.getElementById("family-code-display"),
    leaveBtn: document.getElementById("family-leave-btn"),
  };

  function genFamilyCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O/1/I 제외
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  auth.onAuthStateChanged(async (user) => {
    state.user = user;
    if (user) {
      el.signedOut.hidden = true;
      el.signedIn.hidden = false;
      el.status.textContent = `${user.displayName}님으로 로그인됨`;
      await loadUserFamily(user.uid);
    } else {
      el.signedOut.hidden = false;
      el.signedIn.hidden = true;
      if (state.unsubscribe) {
        state.unsubscribe();
        state.unsubscribe = null;
      }
      state.familyId = null;
    }
  });

  el.signInBtn.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch((err) => alert("로그인 실패: " + err.message));
  });

  el.signOutBtn.addEventListener("click", () => auth.signOut());

  async function loadUserFamily(uid) {
    const userDoc = await db.collection("users").doc(uid).get();
    const familyId = userDoc.exists ? userDoc.data().familyId : null;
    if (familyId) {
      connectToFamily(familyId);
    } else {
      showNoGroup();
    }
  }

  function showNoGroup() {
    el.noGroup.hidden = false;
    el.groupInfo.hidden = true;
  }

  function showGroup(familyId) {
    el.noGroup.hidden = true;
    el.groupInfo.hidden = false;
    el.codeDisplay.textContent = familyId;
  }

  el.createBtn.addEventListener("click", async () => {
    const code = genFamilyCode();
    await db.collection("families").doc(code).set({
      createdBy: state.user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      members: [state.user.uid],
      basket: [],
      reminders: [],
    });
    await db.collection("users").doc(state.user.uid).set({ familyId: code }, { merge: true });
    connectToFamily(code);
  });

  el.joinBtn.addEventListener("click", async () => {
    const code = el.joinCodeInput.value.trim().toUpperCase();
    if (!code) return;
    const famRef = db.collection("families").doc(code);
    const famDoc = await famRef.get();
    if (!famDoc.exists) {
      alert("존재하지 않는 코드입니다. 코드를 다시 확인해주세요.");
      return;
    }
    await famRef.update({ members: firebase.firestore.FieldValue.arrayUnion(state.user.uid) });
    await db.collection("users").doc(state.user.uid).set({ familyId: code }, { merge: true });
    connectToFamily(code);
  });

  el.leaveBtn.addEventListener("click", async () => {
    if (!state.familyId) return;
    if (!confirm("가족 그룹에서 나가시겠습니까? (그룹 자체는 없어지지 않습니다)")) return;
    await db.collection("users").doc(state.user.uid).set({ familyId: null }, { merge: true });
    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = null;
    }
    state.familyId = null;
    showNoGroup();
  });

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

  function connectToFamily(familyId) {
    state.familyId = familyId;
    showGroup(familyId);
    if (state.unsubscribe) state.unsubscribe();

    let isFirstSnapshot = true;
    state.unsubscribe = db.collection("families").doc(familyId).onSnapshot((doc) => {
      if (!doc.exists) return;
      const data = doc.data();

      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        // 방금 연결된 시점: 이 기기에 이미 담겨있던 로컬 데이터가 있는데 원격은
        // 비어있다면(예: 막 만든 새 그룹), 빈 원격으로 로컬을 덮어쓰는 대신
        // 로컬 걸 원격에 올린다. 그래야 "연결 직후 바로 약을 담았는데 사라지는"
        // 경쟁 상태를 피할 수 있다.
        const local = getLocalSnapshot();
        const localHasData = (local.basket && local.basket.length) || (local.reminders && local.reminders.length);
        const remoteEmpty = (!data.basket || !data.basket.length) && (!data.reminders || !data.reminders.length);
        if (localHasData && remoteEmpty) {
          db.collection("families").doc(familyId).update({ basket: local.basket, reminders: local.reminders });
          return;
        }
      }

      state.applyingRemote = true;
      window.dispatchEvent(new CustomEvent("family-data-updated", { detail: data }));
      state.applyingRemote = false;
    });
  }

  // app.js가 바구니/알림을 저장할 때마다 호출해서 Firestore에도 반영한다.
  // (원격 변경을 받아 반영하는 도중에는 재전송하지 않아 무한 루프를 막는다)
  window.FamilySync = {
    isConnected: () => !!state.familyId,
    isApplyingRemote: () => state.applyingRemote,
    pushBasket(basket) {
      if (!state.familyId || state.applyingRemote) return;
      db.collection("families").doc(state.familyId).update({ basket });
    },
    pushReminders(reminders) {
      if (!state.familyId || state.applyingRemote) return;
      db.collection("families").doc(state.familyId).update({ reminders });
    },
  };
})();
