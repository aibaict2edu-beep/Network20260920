"use strict";

/* ===========================================================
   状態
   =========================================================== */
const state = {
  step: 0,
  message: "",
  chunkSize: 6,
  packets: [],       // { seq, total, data }
  srcIp: "192.168.1.10",
  dstIp: "192.168.1.20",
  buildLevel: 0,      // 0:データのみ 1:+トランスポート層 2:+インターネット層(完成)
  arrivalOrder: [],   // 到着順の seq 配列
  inbox: [],          // { seq, peel }  peel 0..3
};

const stepLayerMap = {
  1: "app",
  2: "transport",
  3: null, // 動的に切り替える(荷札を重ねる操作に応じて変化)
  4: "physical",
  5: "all",
  6: null,
};

const LAYER_NAMES = {
  app: "4層 アプリケーション層",
  transport: "3層 トランスポート層",
  network: "2層 インターネット層",
  physical: "1層 ネットワークインターフェース層",
};

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function splitMessage(msg, size) {
  const chunks = [];
  for (let i = 0; i < msg.length; i += size) {
    chunks.push(msg.slice(i, i + size));
  }
  if (chunks.length === 0) chunks.push("");
  return chunks;
}

function buildPackets() {
  const chunks = splitMessage(state.message, state.chunkSize);
  state.packets = chunks.map((c, i) => ({
    seq: i + 1,
    total: chunks.length,
    data: c,
  }));
}

/* ===========================================================
   画面遷移
   =========================================================== */
function goToStep(n) {
  state.step = n;
  document.querySelectorAll(".step").forEach((sec) => {
    sec.hidden = Number(sec.dataset.step) !== n;
  });
  document.querySelectorAll("#routeList li").forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle("is-current", s === n);
    li.classList.toggle("is-done", s < n);
  });

  if (n === 2) renderStep2();
  if (n === 3) renderStep3();
  if (n === 4) renderStep4Reset();
  if (n === 5) renderStep5Setup();
  if (n === 6) renderStep6();

  updateLayerHighlight(stepLayerMap[n] ?? null);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => goToStep(Number(btn.dataset.goto)));
});

/* ===========================================================
   階層早見表(ドロワー)
   =========================================================== */
const layerGuide = document.getElementById("layerGuide");
const layerGuideToggle = document.getElementById("layerGuideToggle");
document.getElementById("layerGuideClose").addEventListener("click", closeLayerGuide);
layerGuideToggle.addEventListener("click", () => {
  if (layerGuide.hidden) openLayerGuide(); else closeLayerGuide();
});
function openLayerGuide() {
  layerGuide.hidden = false;
  layerGuideToggle.setAttribute("aria-expanded", "true");
}
function closeLayerGuide() {
  layerGuide.hidden = true;
  layerGuideToggle.setAttribute("aria-expanded", "false");
}
function updateLayerHighlight(layerKey) {
  document.querySelectorAll(".layer-card").forEach((el) => {
    const active = layerKey === "all" || (layerKey !== null && el.dataset.layer === layerKey);
    el.classList.toggle("is-active", active);
  });
}

/* ===========================================================
   STEP 1: 入力
   =========================================================== */
const messageInput = document.getElementById("messageInput");
const charCount = document.getElementById("charCount");
const toStep2Btn = document.getElementById("toStep2Btn");

messageInput.addEventListener("input", () => {
  state.message = messageInput.value;
  charCount.textContent = `${state.message.length} 文字`;
  toStep2Btn.disabled = state.message.trim().length === 0;
});
toStep2Btn.disabled = true;

toStep2Btn.addEventListener("click", () => {
  if (state.message.trim().length === 0) return;
  goToStep(2);
});

/* ===========================================================
   STEP 2: 分割
   =========================================================== */
const chunkSizeInput = document.getElementById("chunkSize");
const chunkSizeVal = document.getElementById("chunkSizeVal");
const originalPreview = document.getElementById("originalPreview");
const packetGrid = document.getElementById("packetGrid");

chunkSizeInput.addEventListener("input", () => {
  state.chunkSize = Number(chunkSizeInput.value);
  chunkSizeVal.textContent = state.chunkSize;
  renderStep2();
});

function renderStep2() {
  chunkSizeInput.value = state.chunkSize;
  chunkSizeVal.textContent = state.chunkSize;
  originalPreview.textContent = state.message || "(まだ手紙が書かれていません)";
  buildPackets();
  packetGrid.innerHTML = state.packets.map((p) => `
    <div class="packet-chip">
      <span class="packet-chip__no">${p.seq}/${p.total}</span>
      ${escapeHtml(p.data) || "(空)"}
    </div>
  `).join("");
}

/* ===========================================================
   STEP 3: ヘッダー付与
   =========================================================== */
const srcIpInput = document.getElementById("srcIp");
const dstIpInput = document.getElementById("dstIp");
const buildStage = document.getElementById("buildStage");
const wrapStepBtn = document.getElementById("wrapStepBtn");
const buildStatus = document.getElementById("buildStatus");
const allPacketsWrap = document.getElementById("allPacketsWrap");
const allPacketsGrid = document.getElementById("allPacketsGrid");
const toStep4Btn = document.getElementById("toStep4Btn");

srcIpInput.addEventListener("input", () => { state.srcIp = srcIpInput.value; syncIpLabels(); });
dstIpInput.addEventListener("input", () => { state.dstIp = dstIpInput.value; syncIpLabels(); });

function renderStep3() {
  buildPackets();
  state.buildLevel = 0;
  allPacketsWrap.hidden = true;
  toStep4Btn.disabled = true;
  wrapStepBtn.disabled = false;
  wrapStepBtn.textContent = "次の荷札をつける";
  srcIpInput.value = state.srcIp;
  dstIpInput.value = state.dstIp;
  renderBuildStage();
  syncIpLabels();
}

const step3LayerBadge = document.getElementById("step3LayerBadge");

function renderBuildStage() {
  const packet = state.packets[0];
  if (!packet) return;
  buildStage.innerHTML = renderBuildHTML(packet, state.buildLevel);
  const labels = [
    "4層 アプリケーション層:まだ荷札がない、データ本体だけの状態",
    "3層 トランスポート層の荷札(通し番号)を追加した状態",
    "2層 インターネット層の荷札(IPアドレス)まで追加し、完成した状態",
  ];
  buildStatus.textContent = labels[state.buildLevel];
  const currentLayer = ["app", "transport", "network"][state.buildLevel];
  setLayerPill(step3LayerBadge, currentLayer);
  updateLayerHighlight(currentLayer);
}

function setLayerPill(el, layerKey) {
  if (!el || !layerKey) return;
  el.className = `layer-pill layer-pill--${layerKey}`;
  el.textContent = LAYER_NAMES[layerKey];
}

function renderBuildHTML(packet, level) {
  const dataDiv = `
    <div class="parcel parcel--data">
      <span class="parcel__tag">4層 アプリケーション層(データ本体)</span>
      <div class="parcel__body">${escapeHtml(packet.data) || "(空)"}</div>
    </div>`;
  if (level === 0) return dataDiv;

  const transportDiv = `
    <div class="parcel parcel--transport">
      <span class="parcel__tag">3層 トランスポート層(通し番号)</span>
      <div class="parcel__body">${packet.seq} / ${packet.total} 番目</div>
      ${dataDiv}
    </div>`;
  if (level === 1) return transportDiv;

  return `
    <div class="parcel parcel--network">
      <span class="parcel__tag">2層 インターネット層(IPアドレス)</span>
      <div class="parcel__body">送信元 ${escapeHtml(state.srcIp)} → 宛先 ${escapeHtml(state.dstIp)}</div>
      ${transportDiv}
    </div>`;
}

wrapStepBtn.addEventListener("click", () => {
  if (state.buildLevel < 2) {
    state.buildLevel += 1;
    renderBuildStage();
  }
  if (state.buildLevel === 2) {
    wrapStepBtn.disabled = true;
    wrapStepBtn.textContent = "できあがり";
    showAllPackets();
    toStep4Btn.disabled = false;
  }
});

function showAllPackets() {
  allPacketsWrap.hidden = false;
  allPacketsGrid.innerHTML = state.packets.map((p) => renderBuildHTML(p, 2)).join("");
}

toStep4Btn.addEventListener("click", () => goToStep(4));

function syncIpLabels() {
  const s = document.getElementById("senderIpLabel");
  const d = document.getElementById("receiverIpLabel");
  if (s) s.textContent = state.srcIp;
  if (d) d.textContent = state.dstIp;
}

/* ===========================================================
   STEP 4: 発送
   =========================================================== */
const shuffleToggle = document.getElementById("shuffleToggle");
const transitTrack = document.getElementById("transitTrack");
const sendBtn = document.getElementById("sendBtn");
const toStep5Btn = document.getElementById("toStep5Btn");

function renderStep4Reset() {
  transitTrack.innerHTML = "";
  toStep5Btn.disabled = true;
  sendBtn.disabled = false;
  sendBtn.textContent = "荷物を送り出す";
  document.getElementById("arrivalOrderBox").hidden = true;
  syncIpLabels();
}

const arrivalOrderBox = document.getElementById("arrivalOrderBox");
const arrivalOrderText = document.getElementById("arrivalOrderText");

sendBtn.addEventListener("click", () => {
  sendBtn.disabled = true;
  sendBtn.textContent = "送信中...";
  toStep5Btn.disabled = true;
  transitTrack.innerHTML = "";
  arrivalOrderBox.hidden = true;
  arrivalOrderText.textContent = "";
  state.arrivalOrder = [];
  updateLayerHighlight("physical");

  const shuffle = shuffleToggle.checked;
  const n = state.packets.length;
  const arrivalSlot = { count: 0 }; // 到着後に並べる位置(右端で重ならないように)

  state.packets.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "envelope";
    el.textContent = `#${p.seq}`;
    const top = 10 + (i % 5) * 16;
    el.style.top = `${top}%`;

    let duration, delay;
    if (shuffle) {
      duration = 1.1 + Math.random() * 2.2;
      delay = Math.random() * 0.6;
    } else {
      duration = 1.8;
      delay = i * 0.35;
    }
    el.style.animationDuration = `${duration}s`;
    el.style.animationDelay = `${delay}s`;

    el.addEventListener("animationend", () => {
      // 届いた荷物は消さず、右端に「到着◯番目」として残しておく
      state.arrivalOrder.push(p.seq);
      arrivalSlot.count += 1;
      el.classList.add("has-arrived");
      el.style.top = `${10 + ((arrivalSlot.count - 1) % 5) * 16}%`;
      el.textContent = `#${p.seq}\n着${arrivalSlot.count}`;

      arrivalOrderBox.hidden = false;
      arrivalOrderText.textContent = state.arrivalOrder.map((seq) => `#${seq}`).join(" → ");

      if (state.arrivalOrder.length === n) {
        sendBtn.disabled = false;
        sendBtn.textContent = "もう一度送り出す";
        toStep5Btn.disabled = false;
      }
    });

    transitTrack.appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-flying"));
  });
});

toStep5Btn.addEventListener("click", () => goToStep(5));

/* ===========================================================
   STEP 5: 受信・復元
   =========================================================== */
const inboxGrid = document.getElementById("inboxGrid");
const peelAllBtn = document.getElementById("peelAllBtn");
const sortBtn = document.getElementById("sortBtn");
const reassembled = document.getElementById("reassembled");
const reassembledText = document.getElementById("reassembledText");
const reassembledCheck = document.getElementById("reassembledCheck");
const toStep6Btn = document.getElementById("toStep6Btn");

function renderStep5Setup() {
  const order = state.arrivalOrder.length ? state.arrivalOrder : state.packets.map((p) => p.seq);
  state.inbox = order.map((seq) => ({ seq, peel: 0 }));
  reassembled.hidden = true;
  sortBtn.disabled = true;
  toStep6Btn.disabled = true;
  renderInbox();
}

function findPacket(seq) {
  return state.packets.find((p) => p.seq === seq);
}

function renderParcelForInbox(item) {
  const packet = findPacket(item.seq);
  if (item.peel === 0) {
    return `<div class="parcel parcel--sealed" data-seq="${item.seq}">
      <span class="parcel__tag">未開封の荷物</span>
      <div class="parcel__body">クリックしてはがす</div>
    </div>`;
  }
  const dataInner = item.peel >= 3
    ? `<div class="parcel parcel--data"><span class="parcel__tag">4層 アプリケーション層(データ本体)</span><div class="parcel__body">${escapeHtml(packet.data) || "(空)"}</div></div>`
    : `<div class="parcel parcel--data" style="opacity:.35"><span class="parcel__tag">4層 アプリケーション層</span><div class="parcel__body">▶ まだ見えない</div></div>`;

  const transportInner = item.peel >= 2
    ? `<div class="parcel parcel--transport"><span class="parcel__tag">3層 トランスポート層(通し番号)</span><div class="parcel__body">${packet.seq} / ${packet.total} 番目</div>${dataInner}</div>`
    : `<div class="parcel parcel--transport" style="opacity:.35"><span class="parcel__tag">3層 トランスポート層</span><div class="parcel__body">▶ まだ見えない</div></div>`;

  return `<div class="parcel parcel--network" data-seq="${item.seq}">
    <span class="parcel__tag">2層 インターネット層(IPアドレス)</span>
    <div class="parcel__body">送信元 ${escapeHtml(state.srcIp)} → 宛先 ${escapeHtml(state.dstIp)}</div>
    ${transportInner}
  </div>`;
}

function renderInbox() {
  inboxGrid.innerHTML = state.inbox.map((item) => `
    <div class="inbox-item" data-seq="${item.seq}">${renderParcelForInbox(item)}</div>
  `).join("");
  inboxGrid.querySelectorAll(".inbox-item").forEach((el) => {
    el.addEventListener("click", () => {
      const seq = Number(el.dataset.seq);
      const item = state.inbox.find((it) => it.seq === seq);
      if (item.peel < 3) item.peel += 1;
      updateLayerHighlight(["physical", "network", "transport", "app"][item.peel]);
      renderInbox();
      checkAllPeeled();
    });
  });
}

function checkAllPeeled() {
  const allDone = state.inbox.every((it) => it.peel === 3);
  sortBtn.disabled = !allDone;
}

peelAllBtn.addEventListener("click", () => {
  state.inbox.forEach((it) => (it.peel = 3));
  updateLayerHighlight("app");
  renderInbox();
  checkAllPeeled();
});

sortBtn.addEventListener("click", () => {
  updateLayerHighlight("transport");
  state.inbox.sort((a, b) => a.seq - b.seq);
  renderInbox();
  const joined = state.inbox.map((it) => findPacket(it.seq).data).join("");
  reassembledText.textContent = joined || "(空)";
  const ok = joined === state.message;
  reassembledCheck.textContent = ok
    ? "✓ 元の手紙とぴったり同じ内容に復元できました"
    : "✗ 元の手紙と一致しません。もう一度確認してみよう";
  reassembledCheck.className = `reassembled__check ${ok ? "is-ok" : "is-ng"}`;
  reassembled.hidden = false;
  toStep6Btn.disabled = !ok;
});

toStep6Btn.addEventListener("click", () => goToStep(6));

/* ===========================================================
   STEP 6: まとめ・クイズ
   =========================================================== */
const quizData = [
  {
    q: "元のデータをいくつかのパケットに分割する、いちばんの理由は何だろう?",
    options: [
      "回線が一度に運べるデータ量に限りがあるため",
      "データを他人に見られないようにするため",
      "文字数を数えやすくするため",
    ],
    correct: 0,
    explain: "通信回線には一度に送れる量の限度がある。だから大きなデータは小分けにして送る。",
  },
  {
    q: "トランスポート層がつける「通し番号」の荷札は、主に何のためにある?",
    options: [
      "荷物の重さを量るため",
      "バラバラの順番で届いても、正しい順に並べ直せるようにするため",
      "宛先の住所を書くため",
    ],
    correct: 1,
    explain: "通り道によって届く速さが変わるため、パケットは送った順に届くとは限らない。通し番号があるから、受け取った側(トランスポート層)で正しく並べ替えられる。",
  },
  {
    q: "インターネット層がつけるIPアドレスの荷札は、主に何を表している?",
    options: [
      "データが何番目の荷物かということ",
      "データの中身が何文字かということ",
      "どこから送られ、どこへ届けるかという場所の情報",
    ],
    correct: 2,
    explain: "送信元IPアドレスと宛先IPアドレスによって、荷物がどこから来て、どこへ届けられるべきかが分かる。",
  },
];

let quizScoreCount = 0;
let quizAnsweredCount = 0;

function renderStep6() {
  quizScoreCount = 0;
  quizAnsweredCount = 0;
  const quizEl = document.getElementById("quiz");
  const scoreEl = document.getElementById("quizScore");
  scoreEl.textContent = "";

  quizEl.innerHTML = quizData.map((item, qi) => `
    <div class="quiz-item" data-qi="${qi}">
      <p>問${qi + 1}. ${escapeHtml(item.q)}</p>
      <div class="quiz-options">
        ${item.options.map((opt, oi) => `
          <button class="quiz-option" data-qi="${qi}" data-oi="${oi}">${escapeHtml(opt)}</button>
        `).join("")}
      </div>
      <p class="quiz-feedback" data-qi="${qi}"></p>
    </div>
  `).join("");

  quizEl.querySelectorAll(".quiz-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const qi = Number(btn.dataset.qi);
      const oi = Number(btn.dataset.oi);
      const item = quizData[qi];
      const group = quizEl.querySelectorAll(`.quiz-option[data-qi="${qi}"]`);
      if (group[0].disabled) return; // 解答済み

      group.forEach((b) => {
        b.disabled = true;
        if (Number(b.dataset.oi) === item.correct) b.classList.add("is-correct");
      });
      if (oi !== item.correct) btn.classList.add("is-wrong");

      const feedback = quizEl.querySelector(`.quiz-feedback[data-qi="${qi}"]`);
      feedback.textContent = (oi === item.correct ? "正解! " : "おしい。") + item.explain;

      quizAnsweredCount += 1;
      if (oi === item.correct) quizScoreCount += 1;
      if (quizAnsweredCount === quizData.length) {
        scoreEl.textContent = `${quizData.length}問中 ${quizScoreCount}問正解でした。`;
      }
    });
  });
}

/* ===========================================================
   初期化
   =========================================================== */
goToStep(0);
