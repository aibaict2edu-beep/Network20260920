"use strict";

/* ===========================================================
   状態
   =========================================================== */
const state = {
  message: "",
  chunkSize: 6,
  srcIp: "192.168.1.10",
  dstIp: "192.168.1.20",
  packets: [],          // { seq, total, data }
  stage: 0,             // 0..8 (STAGES のインデックス)
  arrivalOrder: [],     // 実際に届いた順の seq 配列(再送分もこの末尾に追加される)
  deliveredSeqs: new Set(), // これまでに届いた(再送を含む)seqの集合
  busy: false,
  autoTimer: null,

  // 紛失シミュレーション設定
  randomLossEnabled: false,
  lossRate: 20,          // %
  manualLossSeqs: new Set(), // 必ず届かないようにするseq

  // 検知・再送
  awaitingRetransmit: false,
  retransmitting: false,
};

let autoPlayActive = false;

/* 段階の定義。key はDOMの data-row / id と対応する(transit は専用処理) */
const STAGES = [
  { key: "send-app",         pill: "app",        label: "4層 アプリケーション層",
    desc: "送りたい内容(手紙の中身)を用意した状態です。" },
  { key: "send-transport",   pill: "transport",   label: "3層 トランスポート層",
    desc: "トランスポート層が、分割した荷物に通し番号を付けました。" },
  { key: "send-network",     pill: "network",     label: "2層 インターネット層",
    desc: "インターネット層が、送信元と宛先のIPアドレスを荷札に書きました。" },
  { key: "send-physical",    pill: "physical",    label: "1層 ネットワークインターフェース層",
    desc: "ネットワークインターフェース層が、荷物を電気信号・電波に変えて送信の準備をしました。" },
  { key: "transit",          pill: "physical",    label: "1層 ネットワークインターフェース層(伝送中)",
    desc: "電気信号・電波としてケーブルや無線の中を運ばれています。途中で届かなくなることもあります。" },
  { key: "receive-physical", pill: "physical",    label: "1層 ネットワークインターフェース層",
    desc: "受信側が電気信号・電波を受け取りました。" },
  { key: "receive-network",  pill: "network",     label: "2層 インターネット層",
    desc: "インターネット層が、IPアドレスを確認して自分宛かどうか確かめました。" },
  { key: "receive-transport",pill: "transport",   label: "3層 トランスポート層",
    desc: "トランスポート層が、通し番号を確認して正しい順番に並べ替えました。届いていない番号があれば、ここで検知します。" },
  { key: "receive-app",      pill: "app",         label: "4層 アプリケーション層",
    desc: "アプリケーション層が中身のデータを受け取り、元の内容が復元されました。" },
];

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function splitMessage(msg, size) {
  const chunks = [];
  for (let i = 0; i < msg.length; i += size) chunks.push(msg.slice(i, i + size));
  if (chunks.length === 0) chunks.push("");
  return chunks;
}

function buildPackets() {
  const chunks = splitMessage(state.message, state.chunkSize);
  state.packets = chunks.map((c, i) => ({ seq: i + 1, total: chunks.length, data: c }));
  // 分割数が変わったら、手動紛失指定のうち範囲外になった番号は取り除く
  const validSeqs = new Set(state.packets.map((p) => p.seq));
  state.manualLossSeqs.forEach((seq) => {
    if (!validSeqs.has(seq)) state.manualLossSeqs.delete(seq);
  });
  renderLossPicker();
}

/* ===========================================================
   DOM参照
   =========================================================== */
const msgInput = document.getElementById("msgInput");
const msgCount = document.getElementById("msgCount");
const chunkInput = document.getElementById("chunkInput");
const chunkVal = document.getElementById("chunkVal");
const srcInput = document.getElementById("srcInput");
const dstInput = document.getElementById("dstInput");
const shuffleInput = document.getElementById("shuffleInput");
const applyBtn = document.getElementById("applyBtn");

const randomLossInput = document.getElementById("randomLossInput");
const lossRateInput = document.getElementById("lossRateInput");
const lossRateVal = document.getElementById("lossRateVal");
const lossRateWrap = document.getElementById("lossRateWrap");
const lossPicker = document.getElementById("lossPicker");

const nextBtn = document.getElementById("nextBtn");
const autoBtn = document.getElementById("autoBtn");
const resetBtn = document.getElementById("resetBtn");
const currentPill = document.getElementById("currentPill");
const currentDesc = document.getElementById("currentDesc");

const finalResult = document.getElementById("finalResult");
const finalText = document.getElementById("finalText");
const finalCheck = document.getElementById("finalCheck");
const layersTrack = document.getElementById("layersTrack");

const lossAlert = document.getElementById("lossAlert");
const lossAlertText = document.getElementById("lossAlertText");
const retransmitBtn = document.getElementById("retransmitBtn");

/* ===========================================================
   入力パネル ― 紛失シミュレーションの設定
   =========================================================== */
function renderLossPicker() {
  if (!lossPicker) return;
  lossPicker.innerHTML = state.packets.map((p) => `
    <label class="layers-loss-check">
      <input type="checkbox" data-seq="${p.seq}" ${state.manualLossSeqs.has(p.seq) ? "checked" : ""}>
      <span>#${p.seq}</span>
    </label>
  `).join("");
}

if (lossPicker) {
  lossPicker.addEventListener("change", (e) => {
    const target = e.target;
    if (!target || !target.matches('input[type="checkbox"]')) return;
    const seq = Number(target.dataset.seq);
    if (target.checked) state.manualLossSeqs.add(seq);
    else state.manualLossSeqs.delete(seq);
  });
}

if (randomLossInput) {
  randomLossInput.addEventListener("change", () => {
    state.randomLossEnabled = randomLossInput.checked;
    if (lossRateWrap) lossRateWrap.hidden = !state.randomLossEnabled;
  });
}

if (lossRateInput) {
  lossRateInput.addEventListener("input", () => {
    state.lossRate = Number(lossRateInput.value);
    if (lossRateVal) lossRateVal.textContent = state.lossRate;
  });
}

/* ===========================================================
   行(層)の描画
   =========================================================== */
function packetOrderForRow(rowKey) {
  if (rowKey === "receive-physical" || rowKey === "receive-network") {
    return state.arrivalOrder
      .map((seq) => state.packets.find((p) => p.seq === seq))
      .filter(Boolean);
  }
  if (rowKey === "receive-transport" || rowKey === "receive-app") {
    // 届いていないパケットは、届くまでここには現れない
    return state.packets
      .filter((p) => state.deliveredSeqs.has(p.seq))
      .sort((a, b) => a.seq - b.seq);
  }
  return state.packets; // send-* は常に元の通し番号順
}

function bodyForRow(rowKey, packet) {
  const dataHtml = `<div class="layers-chip-data">「${escapeHtml(packet.data) || "(空)"}」</div>`;
  const tag = tagForRow(rowKey);
  return tag ? `${dataHtml}<div class="layers-chip-tag">${tag}</div>` : dataHtml;
}

function tagForRow(rowKey) {
  switch (rowKey) {
    case "send-app":
      return "";
    case "send-transport":
      return "＋通し番号";
    case "send-network":
      return `＋IP ${escapeHtml(state.srcIp)}→${escapeHtml(state.dstIp)}`;
    case "send-physical":
      return "📶 信号化";
    case "receive-physical":
      return "📶 受信(未確認)";
    case "receive-network":
      return "IP確認 ✓";
    case "receive-transport":
      return "通し番号確認・並べ替え ✓";
    case "receive-app":
      return "";
    default:
      return "";
  }
}

function renderChipsForRow(rowKey) {
  const list = packetOrderForRow(rowKey);
  if (list.length === 0) return "";
  return list.map((p) => `
    <div class="packet-chip">
      <span class="packet-chip__no">${p.seq}/${p.total}</span>
      ${bodyForRow(rowKey, p)}
    </div>
  `).join("");
}

function renderAllCells() {
  STAGES.forEach((def, idx) => {
    if (def.key === "transit") return;
    const cellEl = document.querySelector(`.layer-cell[data-row="${def.key}"]`);
    const packetsEl = document.getElementById(`cell-${def.key}`);
    if (!cellEl || !packetsEl) return;
    cellEl.classList.remove("layer-cell--pending", "layer-cell--active", "layer-cell--done");
    if (state.stage < idx) {
      cellEl.classList.add("layer-cell--pending");
      packetsEl.innerHTML = "";
    } else if (state.stage === idx) {
      cellEl.classList.add("layer-cell--active");
      packetsEl.innerHTML = renderChipsForRow(def.key);
    } else {
      cellEl.classList.add("layer-cell--done");
      packetsEl.innerHTML = renderChipsForRow(def.key);
    }
  });
  updateCurrentCaption();
  updateFinalResult();
  updateOrderSummary();
  checkForLoss();
  updateControlAvailability();
  updateResetButtonState();
}

function updateResetButtonState() {
  const complete = state.stage >= 8;
  resetBtn.classList.toggle("is-complete", complete);
  resetBtn.textContent = complete ? "はじめからやり直す" : "はじめから";
}

function updateOrderSummary() {
  const sentLine = document.getElementById("sentOrderLine");
  const sentText = document.getElementById("sentOrderText");
  const arrivedLine = document.getElementById("arrivedOrderLine");
  const arrivedText = document.getElementById("arrivedOrderText");

  if (state.stage >= 3 && state.packets.length > 0) {
    sentLine.hidden = false;
    sentText.textContent = state.packets.map((p) => `#${p.seq}`).join(" → ");
  } else {
    sentLine.hidden = true;
  }

  if (state.stage >= 5 && state.arrivalOrder.length > 0) {
    arrivedLine.hidden = false;
    arrivedText.textContent = state.arrivalOrder.map((seq) => `#${seq}`).join(" → ");
  } else {
    arrivedLine.hidden = true;
  }
}

function updateCurrentCaption() {
  const def = STAGES[state.stage];
  currentPill.className = `layer-pill layer-pill--${def.pill}`;
  currentPill.textContent = def.label;
  currentDesc.textContent = def.desc;
}

function updateFinalResult() {
  if (state.stage < 8) {
    finalResult.hidden = true;
    return;
  }
  const sorted = [...state.packets].sort((a, b) => a.seq - b.seq);
  const joined = sorted.map((p) => p.data).join("");
  finalText.textContent = joined || "(空)";
  const ok = joined === state.message;
  finalCheck.textContent = ok
    ? "✓ 元の手紙とぴったり同じ内容に復元できました"
    : "✗ 元の手紙と一致しません";
  finalCheck.className = `reassembled__check ${ok ? "is-ok" : "is-ng"}`;
  finalResult.hidden = false;
}

/* ===========================================================
   3層トランスポート層 ― 欠け(パケット紛失)の検知
   =========================================================== */
function checkForLoss() {
  if (!lossAlert) return;
  if (state.stage !== 7) {
    lossAlert.hidden = true;
    return;
  }
  const missing = state.packets
    .map((p) => p.seq)
    .filter((seq) => !state.deliveredSeqs.has(seq));

  if (missing.length === 0) {
    lossAlert.hidden = true;
    state.awaitingRetransmit = false;
    return;
  }

  state.awaitingRetransmit = true;
  lossAlert.hidden = false;
  const list = missing.map((seq) => `#${seq}`).join("、");
  lossAlertText.textContent =
    `⚠ ${list} 番のパケットが届いていません。トランスポート層が再送を要求します。`;
  retransmitBtn.disabled = state.retransmitting;
  retransmitBtn.textContent = state.retransmitting ? "再送中…" : "再送する";
}

function updateControlAvailability() {
  const locked = state.stage >= 8 || state.awaitingRetransmit;
  nextBtn.disabled = state.busy || locked;
  autoBtn.disabled = locked && !autoPlayActive;
}

/* ===========================================================
   伝送(1層どうしをつなぐ経路)のアニメーション
   packetsToSend: 送るパケットの配列
   allowLoss: true のときだけ、紛失シミュレーションの対象になる
   =========================================================== */
function runCrossing(packetsToSend, allowLoss, onComplete) {
  layersTrack.innerHTML = "";
  const n = packetsToSend.length;
  if (n === 0) {
    onComplete();
    return;
  }
  const shuffle = shuffleInput.checked;
  let settled = 0;

  packetsToSend.forEach((p, i) => {
    const isLost = allowLoss && (
      state.manualLossSeqs.has(p.seq) ||
      (state.randomLossEnabled && Math.random() * 100 < state.lossRate)
    );

    const el = document.createElement("div");
    el.className = "envelope";
    el.textContent = `#${p.seq}`;
    el.style.top = `${8 + (i % 6) * 15}%`;

    let duration, delay;
    if (shuffle) {
      duration = 1.0 + Math.random() * 1.8;
      delay = Math.random() * 0.5;
    } else {
      duration = 1.5;
      delay = i * 0.3;
    }
    el.style.animationDuration = `${duration}s`;
    el.style.animationDelay = `${delay}s`;

    el.addEventListener("animationend", () => {
      if (isLost) {
        el.classList.add("has-lost");
      } else {
        el.classList.add("has-arrived");
        state.deliveredSeqs.add(p.seq);
        state.arrivalOrder.push(p.seq);
      }
      settled += 1;
      if (settled === n) onComplete();
    });

    layersTrack.appendChild(el);
    requestAnimationFrame(() => {
      el.classList.add(isLost ? "is-lost" : "is-flying");
    });
  });
}

/* ===========================================================
   段階の進行
   =========================================================== */
function scrollElementIntoView(el) {
  if (el && el.scrollIntoView) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function scrollActiveRowIntoView() {
  if (state.stage === 4) {
    scrollElementIntoView(document.querySelector(".layer-gutter--track"));
    return;
  }
  const def = STAGES[state.stage];
  const target = def && document.querySelector(`.layer-cell[data-row="${def.key}"]`);
  scrollElementIntoView(target);
}

function advance(onDone) {
  if (state.stage >= 8 || state.awaitingRetransmit) {
    onDone && onDone();
    return;
  }
  const nextIndex = state.stage + 1;

  if (nextIndex === 4) {
    // これから伝送(1層どうしの経路)へ入る
    state.stage = 4;
    renderAllCells();
    scrollActiveRowIntoView();
    runCrossing(state.packets, true, () => {
      state.stage = 5;
      renderAllCells();
      scrollActiveRowIntoView();
      onDone && onDone();
    });
    return;
  }

  state.stage = nextIndex;
  renderAllCells();
  scrollActiveRowIntoView();
  onDone && onDone();
}

nextBtn.addEventListener("click", () => {
  if (state.busy || state.stage >= 8 || state.awaitingRetransmit) return;
  setBusy(true);
  advance(() => setBusy(false));
});

function setBusy(busy) {
  state.busy = busy;
  updateControlAvailability();
}

function autoStep() {
  if (!autoPlayActive) return;
  if (state.stage >= 8 || state.awaitingRetransmit) {
    stopAutoPlay();
    return;
  }
  if (state.busy) {
    state.autoTimer = setTimeout(autoStep, 250);
    return;
  }
  setBusy(true);
  advance(() => {
    setBusy(false);
    if (autoPlayActive && !state.awaitingRetransmit) {
      state.autoTimer = setTimeout(autoStep, 900);
    } else if (state.awaitingRetransmit) {
      stopAutoPlay();
    }
  });
}

function startAutoPlay() {
  if (state.stage >= 8 || state.awaitingRetransmit) return;
  autoPlayActive = true;
  autoBtn.textContent = "自動再生を停止 ⏸";
  autoStep();
}

function stopAutoPlay() {
  autoPlayActive = false;
  clearTimeout(state.autoTimer);
  autoBtn.textContent = "自動再生 ▶";
  setBusy(false);
}

autoBtn.addEventListener("click", () => {
  if (autoPlayActive) stopAutoPlay(); else startAutoPlay();
});

/* ===========================================================
   再送(トランスポート層が欠けを検知したあと、ボタンで実行)
   =========================================================== */
if (retransmitBtn) {
  retransmitBtn.addEventListener("click", () => {
    if (state.retransmitting) return;
    const missingPackets = state.packets.filter((p) => !state.deliveredSeqs.has(p.seq));
    if (missingPackets.length === 0) return;

    state.retransmitting = true;
    retransmitBtn.disabled = true;
    retransmitBtn.textContent = "再送中…";
    scrollElementIntoView(document.querySelector(".layer-gutter--track"));

    // 再送したパケットは必ず届く(2回目の紛失判定はしない)
    runCrossing(missingPackets, false, () => {
      state.retransmitting = false;
      renderAllCells();
      scrollElementIntoView(document.querySelector('.layer-cell[data-row="receive-transport"]'));
    });
  });
}

function resetDiagram() {
  stopAutoPlay();
  state.stage = 0;
  state.arrivalOrder = [];
  state.deliveredSeqs = new Set();
  state.awaitingRetransmit = false;
  state.retransmitting = false;
  layersTrack.innerHTML = "";
  if (lossAlert) lossAlert.hidden = true;
  renderAllCells();
  setBusy(false);
}

resetBtn.addEventListener("click", resetDiagram);

/* ===========================================================
   入力パネル
   =========================================================== */
function syncInputDisplays() {
  msgCount.textContent = `${msgInput.value.length} 文字`;
  chunkVal.textContent = chunkInput.value;
}

msgInput.addEventListener("input", syncInputDisplays);
chunkInput.addEventListener("input", syncInputDisplays);

function applyInputs() {
  state.message = msgInput.value;
  state.chunkSize = Number(chunkInput.value);
  state.srcIp = srcInput.value;
  state.dstIp = dstInput.value;
  buildPackets();
  resetDiagram();
}

applyBtn.addEventListener("click", () => {
  applyInputs();
  // クリックされたときだけ、入力パネルの右上を自動的に「閉じる」
  const inputPanel = document.getElementById("inputPanel");
  if (inputPanel) inputPanel.open = false;
});

/* ===========================================================
   初期化(ページを開いた直後は、入力パネルを閉じない)
   =========================================================== */
syncInputDisplays();
applyInputs();
