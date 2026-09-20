"use strict";

/* ===========================================================
   状態
   =========================================================== */
const state = {
  message: "",
  chunkSize: 6,
  srcIp: "192.168.1.10",
  dstIp: "192.168.1.20",
  packets: [],       // { seq, total, data }
  stage: 0,          // 0..8 (STAGES のインデックス)
  arrivalOrder: [],  // 伝送後、到着した順の seq 配列
  busy: false,
  autoTimer: null,
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
    desc: "電気信号・電波としてケーブルや無線の中を運ばれています。届く順番が入れ替わることもあります。" },
  { key: "receive-physical", pill: "physical",    label: "1層 ネットワークインターフェース層",
    desc: "受信側が電気信号・電波を受け取りました。" },
  { key: "receive-network",  pill: "network",     label: "2層 インターネット層",
    desc: "インターネット層が、IPアドレスを確認して自分宛かどうか確かめました。" },
  { key: "receive-transport",pill: "transport",   label: "3層 トランスポート層",
    desc: "トランスポート層が、通し番号を確認して正しい順番に並べ替えました。" },
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

const nextBtn = document.getElementById("nextBtn");
const autoBtn = document.getElementById("autoBtn");
const resetBtn = document.getElementById("resetBtn");
const currentPill = document.getElementById("currentPill");
const currentDesc = document.getElementById("currentDesc");

const finalResult = document.getElementById("finalResult");
const finalText = document.getElementById("finalText");
const finalCheck = document.getElementById("finalCheck");
const layersTrack = document.getElementById("layersTrack");

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
    return [...state.packets].sort((a, b) => a.seq - b.seq);
  }
  return state.packets; // send-* は常に元の通し番号順
}

function bodyForRow(rowKey, packet) {
  switch (rowKey) {
    case "send-app":
      return `「${escapeHtml(packet.data) || "(空)"}」`;
    case "send-transport":
      return "通し番号を追加";
    case "send-network":
      return `IP: ${escapeHtml(state.srcIp)} → ${escapeHtml(state.dstIp)}`;
    case "send-physical":
      return "📶 信号化して送信準備完了";
    case "receive-physical":
      return "📶 信号を受信(未開封)";
    case "receive-network":
      return "宛先IPを確認 ✓";
    case "receive-transport":
      return "通し番号を確認して並べ替え ✓";
    case "receive-app":
      return `「${escapeHtml(packet.data) || "(空)"}」`;
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
   伝送(1層どうしをつなぐ経路)のアニメーション
   =========================================================== */
function runCrossing(onComplete) {
  layersTrack.innerHTML = "";
  state.arrivalOrder = [];
  const n = state.packets.length;
  if (n === 0) {
    onComplete();
    return;
  }
  const shuffle = shuffleInput.checked;

  state.packets.forEach((p, i) => {
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
      el.classList.add("has-arrived");
      state.arrivalOrder.push(p.seq);
      if (state.arrivalOrder.length === n) onComplete();
    });

    layersTrack.appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-flying"));
  });
}

/* ===========================================================
   段階の進行
   =========================================================== */
function setBusy(busy) {
  state.busy = busy;
  nextBtn.disabled = busy || state.stage >= 8;
  autoBtn.disabled = state.stage >= 8 && !autoPlayActive;
}

function advance(onDone) {
  if (state.stage >= 8) {
    onDone && onDone();
    return;
  }
  const nextIndex = state.stage + 1;

  if (nextIndex === 4) {
    // これから伝送(1層どうしの経路)へ入る
    state.stage = 4;
    renderAllCells();
    runCrossing(() => {
      state.stage = 5;
      renderAllCells();
      onDone && onDone();
    });
    return;
  }

  state.stage = nextIndex;
  renderAllCells();
  onDone && onDone();
}

nextBtn.addEventListener("click", () => {
  if (state.busy || state.stage >= 8) return;
  setBusy(true);
  advance(() => setBusy(false));
});

function autoStep() {
  if (!autoPlayActive) return;
  if (state.stage >= 8) {
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
    if (autoPlayActive) {
      state.autoTimer = setTimeout(autoStep, 900);
    }
  });
}

function startAutoPlay() {
  if (state.stage >= 8) return;
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

function resetDiagram() {
  stopAutoPlay();
  state.stage = 0;
  state.arrivalOrder = [];
  layersTrack.innerHTML = "";
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

applyBtn.addEventListener("click", applyInputs);

/* ===========================================================
   初期化
   =========================================================== */
syncInputDisplays();
applyInputs();
