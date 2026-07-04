import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const imageInput = document.querySelector("#imageInput");
const shuffleBtn = document.querySelector("#shuffleBtn");
const resetBtn = document.querySelector("#resetBtn");
const teacherView = document.querySelector("#teacherView");
const joinView = document.querySelector("#joinView");
const studentView = document.querySelector("#studentView");
const rebuildView = document.querySelector("#rebuildView");
const linkCards = document.querySelector("#linkCards");
const choiceCards = document.querySelector("#choiceCards");
const studentCard = document.querySelector("#studentCard");
const studentTitle = document.querySelector("#studentTitle");
const downloadStudentBtn = document.querySelector("#downloadStudentBtn");
const goRebuildBtn = document.querySelector("#goRebuildBtn");
const joinRebuildBtn = document.querySelector("#joinRebuildBtn");
const downloadRebuildBtn = document.querySelector("#downloadRebuildBtn");
const rebuildBoard = document.querySelector("#rebuildBoard");
const exportCanvas = document.querySelector("#exportCanvas");
const exportCtx = exportCanvas.getContext("2d");
const firebaseConfigInput = document.querySelector("#firebaseConfigInput");
const saveConfigBtn = document.querySelector("#saveConfigBtn");
const syncStatus = document.querySelector("#syncStatus");

const CONFIG_KEY = "imageStoryFirebaseConfig";
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBxgthP4UPtgvOK6CoLvSjEK2PmwVWSn_U",
  authDomain: "image-story-splitter.firebaseapp.com",
  projectId: "image-story-splitter",
  storageBucket: "image-story-splitter.firebasestorage.app",
  messagingSenderId: "1096978823722",
  appId: "1:1096978823722:web:634d69b88052955151a153",
  measurementId: "G-6L1XMSRGKN"
};

let app = null;
let db = null;
let currentProjectId = "";
let activity = null;
let pieces = [];
let tasks = [];
let selectedPiece = null;
let movingPlacement = null;
let unsubscribers = [];
let draggedRebuildId = null;
let activeGroup = null;

function makeGroupId(className, groupName) {
  return `${className.trim()}__${groupName.trim()}`
    .replace(/[.#$/[\]]/g, "-")
    .replace(/\s+/g, "_");
}

function groupParams() {
  if (!activeGroup) return "";
  return `&class=${encodeURIComponent(activeGroup.className)}&group=${encodeURIComponent(activeGroup.groupName)}`;
}

function setStatus(message, ok = false) {
  syncStatus.textContent = message;
  syncStatus.classList.toggle("ok", ok);
}

function parseConfig(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty-config");
  const match = trimmed.match(/firebaseConfig\s*=\s*(\{[\s\S]*?\})\s*;?/);
  const objectText = (match ? match[1] : trimmed)
    .replace(/^\s*const\s+firebaseConfig\s*=\s*/, "")
    .replace(/;\s*$/, "");
  try {
    return JSON.parse(objectText);
  } catch {
    const normalized = objectText
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,\s*}/g, "}");
    return JSON.parse(normalized);
  }
}

function initFirebase(config) {
  if (!config?.apiKey || !config?.projectId || !config?.appId) {
    throw new Error("missing-config-fields");
  }
  if (db && currentProjectId === config.projectId) {
    setStatus("Firebase 已連線，請使用 Realtime Database", true);
    return;
  }
  app = initializeApp(config);
  db = getDatabase(app);
  currentProjectId = config.projectId;
  setStatus("Firebase 已連線，請使用 Realtime Database", true);
}

function loadFirebaseConfig() {
  const saved = localStorage.getItem(CONFIG_KEY);
  if (!saved) {
    initFirebase(DEFAULT_FIREBASE_CONFIG);
    return;
  }
  firebaseConfigInput.value = saved;
  try {
    initFirebase(parseConfig(saved));
  } catch (error) {
    setStatus(`Firebase 設定格式需要修正：${error.message}`);
  }
}

function requireFirebase() {
  if (db) return true;
  setStatus("請先貼上並儲存 Firebase 設定");
  return false;
}

function shuffle(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stopListeners() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

function detectPanelBounds(image) {
  const scanCanvas = document.createElement("canvas");
  scanCanvas.width = image.naturalWidth;
  scanCanvas.height = image.naturalHeight;
  const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
  scanCtx.drawImage(image, 0, 0);
  const imageData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
  const splitX = detectGridLine(imageData, "vertical") ?? Math.round(scanCanvas.width / 2);
  const splitY = detectGridLine(imageData, "horizontal") ?? Math.round(scanCanvas.height / 2);
  return {
    x: [0, splitX, scanCanvas.width],
    y: [0, splitY, scanCanvas.height]
  };
}

function detectGridLine(imageData, direction) {
  const { width, height, data } = imageData;
  const length = direction === "vertical" ? width : height;
  const crossLength = direction === "vertical" ? height : width;
  const start = Math.floor(length * .35);
  const end = Math.ceil(length * .65);
  const scores = [];

  for (let main = start; main <= end; main += 1) {
    let darkCount = 0;
    for (let cross = 0; cross < crossLength; cross += 1) {
      const x = direction === "vertical" ? main : cross;
      const y = direction === "vertical" ? cross : main;
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      if (r < 90 && g < 90 && b < 90) darkCount += 1;
    }
    scores.push({ main, score: darkCount / crossLength });
  }

  const maxScore = Math.max(...scores.map((item) => item.score));
  if (maxScore < .18) return null;

  const threshold = Math.max(.16, maxScore * .6);
  const best = scores.reduce((current, item) => item.score > current.score ? item : current, scores[0]);
  const group = scores.filter((item) => Math.abs(item.main - best.main) <= Math.max(4, Math.round(length * .015)) && item.score >= threshold);
  if (group.length === 0) return best.main;
  const average = group.reduce((sum, item) => sum + item.main, 0) / group.length;
  return Math.round(average);
}

function makePieceCanvas(image, row, col, bounds) {
  const sx = bounds.x[col];
  const sy = bounds.y[row];
  const nextX = bounds.x[col + 1];
  const nextY = bounds.y[row + 1];
  const rawWidth = nextX - sx;
  const rawHeight = nextY - sy;
  const maxWidth = 800;
  const scale = Math.min(1, maxWidth / rawWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(rawWidth * scale);
  canvas.height = Math.round(rawHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, sx, sy, rawWidth, rawHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function buildActivity(images) {
  if (!requireFirebase()) return;
  const activityId = makeId("activity");
  const madeTasks = [];
  const taskLabels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  images.forEach((image, imageIndex) => {
    const panelBounds = detectPanelBounds(image);
    const taskId = `task-${imageIndex + 1}`;
    const taskPieces = [];
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        const order = row * 2 + col + 1;
        taskPieces.push({
          id: `image-${imageIndex + 1}-piece-${order}`,
          taskId,
          taskLabel: taskLabels[imageIndex] || `任務${imageIndex + 1}`,
          sourceImage: imageIndex + 1,
          order,
          label: "",
          imageUrl: makePieceCanvas(image, row, col, panelBounds).toDataURL("image/jpeg", .78),
          placements: []
        });
      }
    }
    madeTasks.push({
      id: taskId,
      label: taskLabels[imageIndex] || `任務${imageIndex + 1}`,
      previewUrl: taskPieces[0].imageUrl,
      pieceOrder: taskPieces.map((piece) => piece.id),
      pieces: Object.fromEntries(taskPieces.map((piece) => [piece.id, piece]))
    });
  });

  tasks = shuffle(madeTasks);
  pieces = flattenTaskPieces(tasks);
  activity = {
    id: activityId,
    createdAt: new Date().toISOString(),
    sourceCount: images.length,
    taskOrder: tasks.map((task) => task.id),
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task]))
  };
  await set(ref(db, `activities/${activityId}`), activity);
  window.location.hash = `teacher=${activityId}`;
  renderTeacherView();
}

function getStudentUrl(pieceId, taskId = "") {
  const url = new URL(window.location.href);
  url.hash = `activity=${activity.id}&task=${taskId}&piece=${pieceId}`;
  return url.toString();
}

function getJoinUrl() {
  const url = new URL(window.location.href);
  url.hash = `join=${activity.id}`;
  return url.toString();
}

function getTaskJoinUrl(taskId) {
  const url = new URL(window.location.href);
  url.hash = `taskJoin=${activity.id}&task=${taskId}`;
  return url.toString();
}

function getRebuildUrl() {
  const url = new URL(window.location.href);
  url.hash = `rebuild=${activity.id}`;
  return url.toString();
}

function findTaskIdForPiece(pieceId) {
  const task = tasks.find((item) => (item.piecesList || []).some((piece) => piece.id === pieceId));
  return task?.id || "";
}

async function loadActivity(activityId) {
  if (!requireFirebase()) return false;
  const snap = await get(ref(db, `activities/${activityId}`));
  if (!snap.exists()) return false;
  activity = { id: activityId, ...snap.val() };
  syncPiecesFromActivity(activity);
  return true;
}

function syncPiecesFromActivity(data) {
  activity = { id: data.id || activity?.id, ...data };
  const taskMap = activity.tasks || {};
  const taskOrder = activity.taskOrder || Object.keys(taskMap);
  tasks = taskOrder.map((id) => {
    const task = taskMap[id];
    if (!task) return null;
    const pieceMap = task.pieces || {};
    const pieceOrder = task.pieceOrder || Object.keys(pieceMap);
    return {
      ...task,
      id,
      piecesList: pieceOrder.map((pieceId) => {
        const piece = pieceMap[pieceId];
        if (!piece) return null;
        return {
          ...piece,
          taskId: id,
          taskLabel: task.label,
          taskStudentName: task.studentName || ""
        };
      }).filter(Boolean)
    };
  }).filter(Boolean);
  pieces = flattenTaskPieces(tasks);
}

function flattenTaskPieces(taskList) {
  return taskList.flatMap((task) => task.piecesList || Object.values(task.pieces || {}));
}

function renderTeacherView() {
  teacherView.classList.remove("hidden");
  joinView.classList.add("hidden");
  studentView.classList.add("hidden");
  rebuildView.classList.add("hidden");
  stopListeners();
  if (!activity || pieces.length === 0) {
    linkCards.innerHTML = '<div class="empty-card">請先完成 Firebase 設定，再上傳圖片</div>';
    shuffleBtn.disabled = true;
    return;
  }
  shuffleBtn.disabled = false;
  linkCards.innerHTML = "";

  tasks.forEach((task) => {
    const card = document.createElement("article");
    card.className = "link-card";
    const image = document.createElement("img");
    image.src = task.previewUrl;
    image.alt = `${task.label}預覽`;
    const url = getTaskJoinUrl(task.id);
    card.append(
      image,
      makeTitle(`${task.label}任務`),
      makeOpenLink(url, "到學生自選頁")
    );
    linkCards.append(card);
  });
}

function showJoinView(activityId, onlyTaskId = "") {
  teacherView.classList.add("hidden");
  joinView.classList.remove("hidden");
  studentView.classList.add("hidden");
  rebuildView.classList.add("hidden");
  stopListeners();
  choiceCards.innerHTML = "";

  const visibleTasks = onlyTaskId ? tasks.filter((task) => task.id === onlyTaskId) : tasks;
  visibleTasks.forEach((task) => {
    const card = document.createElement("article");
    card.className = "link-card choice-card task-card";
    const image = document.createElement("img");
    image.src = task.previewUrl;
    image.alt = `${task.label}任務`;
    const status = document.createElement("p");
    status.className = "choice-status";
    status.textContent = `${task.piecesList?.length || 0} 張分割圖，進入後一起完成填空與排序`;
    const groupInput = document.createElement("input");
    groupInput.className = "name-input";
    groupInput.type = "text";
    groupInput.placeholder = "小組，例如：第 1 組";
    const classInput = document.createElement("input");
    classInput.className = "name-input";
    classInput.type = "text";
    classInput.placeholder = "班級，例如：五年一班";
    const chooseButton = document.createElement("button");
    chooseButton.type = "button";
    chooseButton.textContent = `開始${task.label}任務`;
    chooseButton.addEventListener("click", async () => {
      const className = classInput.value.trim();
      const groupName = groupInput.value.trim();
      if (!className || !groupName) {
        (groupName ? classInput : groupInput).focus();
        status.textContent = "請先輸入小組與班級";
        return;
      }
      const groupId = makeGroupId(className, groupName);
      await update(ref(db, `activities/${activityId}/tasks/${task.id}/groups/${groupId}`), {
        className,
        groupName,
        pieceOrder: task.pieceOrder || (task.piecesList || []).map((piece) => piece.id)
      });
      window.location.hash = `activity=${activityId}&task=${task.id}&class=${encodeURIComponent(className)}&group=${encodeURIComponent(groupName)}`;
    });
    card.append(image, makeTitle(`${task.label}任務`), groupInput, classInput, status, chooseButton);
    choiceCards.append(card);
  });
}

function makeTitle(text) {
  const title = document.createElement("h3");
  title.textContent = text;
  return title;
}

function makeReadonlyInput(value) {
  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = value;
  return input;
}

function makeCopyButton(value, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(value);
    button.textContent = "已複製";
    setTimeout(() => { button.textContent = label; }, 1200);
  });
  return button;
}

function makeOpenLink(url, label) {
  const link = document.createElement("a");
  link.href = url;
  link.textContent = label;
  link.target = "_blank";
  return link;
}

function showStudentView(activityId, taskId, pieceId) {
  if (!requireFirebase()) return;
  teacherView.classList.add("hidden");
  joinView.classList.add("hidden");
  studentView.classList.remove("hidden");
  rebuildView.classList.add("hidden");
  stopListeners();
  const pieceRef = ref(db, `activities/${activityId}/tasks/${taskId}/pieces/${pieceId}`);
  const unsubscribe = onValue(pieceRef, (snap) => {
    if (!snap.exists()) {
      studentCard.innerHTML = '<div class="empty-card">找不到這張學生圖片</div>';
      return;
    }
    selectedPiece = { id: pieceId, taskId, ...snap.val() };
    studentTitle.textContent = selectedPiece.studentName ? `${selectedPiece.studentName}的故事圖片` : "我的故事圖片";
    renderStudentCard(activityId, taskId, pieceId);
  });
  unsubscribers.push(unsubscribe);
}

function showTaskView(activityId, taskId, className = "", groupName = "") {
  if (!requireFirebase()) return;
  if (!className || !groupName) {
    window.location.hash = `join=${activityId}`;
    return;
  }
  const groupId = makeGroupId(className, groupName);
  activeGroup = { className, groupName, groupId };
  teacherView.classList.add("hidden");
  joinView.classList.add("hidden");
  studentView.classList.remove("hidden");
  rebuildView.classList.add("hidden");
  stopListeners();
  const taskRef = ref(db, `activities/${activityId}/tasks/${taskId}`);
  const unsubscribe = onValue(taskRef, (snap) => {
    if (!snap.exists()) {
      studentCard.innerHTML = '<div class="empty-card">找不到這個任務</div>';
      return;
    }
    const task = { id: taskId, ...snap.val() };
    const group = task.groups?.[groupId] || { className, groupName, pieces: {}, pieceOrder: task.pieceOrder };
    const basePieceMap = task.pieces || {};
    const groupPieceMap = group.pieces || {};
    const pieceOrder = group.pieceOrder || task.pieceOrder || Object.keys(basePieceMap);
    const taskPieces = pieceOrder.map((id) => ({
      ...basePieceMap[id],
      ...(groupPieceMap[id] || {}),
      id
    })).filter((piece) => piece.imageUrl);
    studentTitle.textContent = `${className} ${groupName}：${task.label}任務`;
    renderTaskCards(activityId, task, taskPieces);
  });
  unsubscribers.push(unsubscribe);
}

function renderTaskCards(activityId, task, taskPieces) {
  studentCard.innerHTML = "";
  const taskWrap = document.createElement("div");
  taskWrap.className = "task-work-grid";
  taskPieces.forEach((piece) => {
    taskWrap.append(renderTaskPieceCard(activityId, task, { ...piece, taskId: task.id }));
  });
  studentCard.append(taskWrap);
}

function renderTaskPieceCard(activityId, task, piece) {
  const card = document.createElement("article");
  card.className = "piece-card task-piece-card";
  const imageFrame = document.createElement("div");
  imageFrame.className = "image-frame";
  imageFrame.addEventListener("click", async (event) => {
    if (event.target.closest(".placed-text")) return;
    const textarea = card.querySelector("textarea");
    const text = textarea.value.trim();
    if (!text) return;
    const rect = imageFrame.getBoundingClientRect();
    piece.placements = [
      ...(piece.placements || []),
      {
        id: makeId("text"),
        text,
        x: Math.max(.05, Math.min(.95, (event.clientX - rect.left) / rect.width)),
        y: Math.max(.08, Math.min(.9, (event.clientY - rect.top) / rect.height)),
        size: 1
      }
    ];
    await update(ref(db, `activities/${activityId}/tasks/${task.id}/groups/${activeGroup.groupId}/pieces/${piece.id}`), { placements: piece.placements });
  });
  const image = document.createElement("img");
  image.src = piece.imageUrl;
  image.alt = `${task.label}任務分割圖`;
  imageFrame.append(image);
  const textarea = document.createElement("textarea");
  textarea.placeholder = "請在這裡填寫對話或重點，再點圖片中的空白框";
  textarea.value = piece.label || "";
  textarea.addEventListener("change", async () => {
    piece.label = textarea.value;
    await update(ref(db, `activities/${activityId}/tasks/${task.id}/groups/${activeGroup.groupId}/pieces/${piece.id}`), { label: piece.label });
  });
  card.append(imageFrame, textarea);
  renderPiecePlacements(imageFrame, activityId, task.id, piece);
  return card;
}

function renderPiecePlacements(frame, activityId, taskId, piece) {
  (piece.placements || []).forEach((placement) => {
    const textLayer = document.createElement("div");
    textLayer.className = "placed-text";
    textLayer.dataset.placementId = placement.id;
    textLayer.style.left = `${placement.x * 100}%`;
    textLayer.style.top = `${placement.y * 100}%`;
    textLayer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".placement-tools")) return;
      event.stopPropagation();
      movingPlacement = { id: placement.id };
      textLayer.setPointerCapture(event.pointerId);
    });
    textLayer.addEventListener("pointermove", (event) => {
      if (!movingPlacement || movingPlacement.id !== placement.id) return;
      event.preventDefault();
      const rect = frame.getBoundingClientRect();
      placement.x = Math.max(.05, Math.min(.95, (event.clientX - rect.left) / rect.width));
      placement.y = Math.max(.08, Math.min(.9, (event.clientY - rect.top) / rect.height));
      textLayer.style.left = `${placement.x * 100}%`;
      textLayer.style.top = `${placement.y * 100}%`;
    });
    textLayer.addEventListener("pointerup", async () => {
      if (!movingPlacement || movingPlacement.id !== placement.id) return;
      movingPlacement = null;
      await update(ref(db, `activities/${activityId}/tasks/${taskId}/groups/${activeGroup.groupId}/pieces/${piece.id}`), { placements: piece.placements });
    });
    textLayer.addEventListener("click", (event) => {
      event.stopPropagation();
      document.querySelectorAll(".placed-text").forEach((item) => item.classList.remove("selected"));
      textLayer.classList.add("selected");
    });
    const editor = document.createElement("div");
    editor.className = "placed-text-content";
    editor.contentEditable = "true";
    editor.textContent = placement.text;
    editor.style.fontSize = `${placement.size || 1}em`;
    editor.addEventListener("blur", async () => {
      placement.text = editor.textContent.trim();
      await update(ref(db, `activities/${activityId}/tasks/${taskId}/groups/${activeGroup.groupId}/pieces/${piece.id}`), { placements: piece.placements });
    });
    const tools = document.createElement("div");
    tools.className = "placement-tools";
    tools.append(
      makeToolButton("－", "縮小文字", async () => {
        placement.size = Math.max(.55, (placement.size || 1) - .12);
        await update(ref(db, `activities/${activityId}/tasks/${taskId}/groups/${activeGroup.groupId}/pieces/${piece.id}`), { placements: piece.placements });
      }),
      makeToolButton("＋", "放大文字", async () => {
        placement.size = Math.min(2.2, (placement.size || 1) + .12);
        await update(ref(db, `activities/${activityId}/tasks/${taskId}/groups/${activeGroup.groupId}/pieces/${piece.id}`), { placements: piece.placements });
      }),
      makeToolButton("×", "刪除文字點", async () => {
        piece.placements = piece.placements.filter((item) => item.id !== placement.id);
        await update(ref(db, `activities/${activityId}/tasks/${taskId}/groups/${activeGroup.groupId}/pieces/${piece.id}`), { placements: piece.placements });
      }, "delete-placement")
    );
    textLayer.append(editor, tools);
    frame.append(textLayer);
  });
}

function renderStudentCard(activityId, taskId, pieceId) {
  const activeEditor = document.activeElement?.closest?.(".placed-text-content")?.dataset.placementId;
  studentCard.innerHTML = "";
  const imageFrame = document.createElement("div");
  imageFrame.className = "image-frame";
  imageFrame.addEventListener("click", async (event) => {
    if (event.target.closest(".placed-text")) return;
    const textarea = studentCard.querySelector("textarea");
    const text = textarea.value.trim();
    if (!text) return;
    const rect = imageFrame.getBoundingClientRect();
    selectedPiece.placements = [
      ...(selectedPiece.placements || []),
      {
        id: makeId("text"),
        text,
        x: Math.max(.05, Math.min(.95, (event.clientX - rect.left) / rect.width)),
        y: Math.max(.08, Math.min(.9, (event.clientY - rect.top) / rect.height)),
        size: 1
      }
    ];
    await update(ref(db, `activities/${activityId}/tasks/${taskId}/pieces/${pieceId}`), { placements: selectedPiece.placements });
  });
  const image = document.createElement("img");
  image.src = selectedPiece.imageUrl;
  image.alt = "我的故事圖片";
  imageFrame.append(image);
  const textarea = document.createElement("textarea");
  textarea.placeholder = "請在這裡填寫對話或重點，再點圖片中的空白框";
  textarea.value = selectedPiece.label || "";
  textarea.addEventListener("change", async () => {
    selectedPiece.label = textarea.value;
    await update(ref(db, `activities/${activityId}/tasks/${taskId}/pieces/${pieceId}`), { label: selectedPiece.label });
  });
  studentCard.append(imageFrame, textarea);
  renderPlacements(imageFrame, activityId, taskId, pieceId, activeEditor);
}

function renderPlacements(frame, activityId, taskId, pieceId, activeEditor) {
  (selectedPiece.placements || []).forEach((placement) => {
    const textLayer = document.createElement("div");
    textLayer.className = "placed-text";
    textLayer.dataset.placementId = placement.id;
    textLayer.style.left = `${placement.x * 100}%`;
    textLayer.style.top = `${placement.y * 100}%`;
    textLayer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".placement-tools")) return;
      event.stopPropagation();
      movingPlacement = { id: placement.id };
      textLayer.setPointerCapture(event.pointerId);
    });
    textLayer.addEventListener("pointermove", (event) => {
      if (!movingPlacement || movingPlacement.id !== placement.id) return;
      event.preventDefault();
      const rect = frame.getBoundingClientRect();
      placement.x = Math.max(.05, Math.min(.95, (event.clientX - rect.left) / rect.width));
      placement.y = Math.max(.08, Math.min(.9, (event.clientY - rect.top) / rect.height));
      textLayer.style.left = `${placement.x * 100}%`;
      textLayer.style.top = `${placement.y * 100}%`;
    });
    textLayer.addEventListener("pointerup", async () => {
      if (!movingPlacement || movingPlacement.id !== placement.id) return;
      movingPlacement = null;
      await update(ref(db, `activities/${activityId}/tasks/${taskId}/pieces/${pieceId}`), { placements: selectedPiece.placements });
    });
    textLayer.addEventListener("click", (event) => {
      event.stopPropagation();
      document.querySelectorAll(".placed-text").forEach((item) => item.classList.remove("selected"));
      textLayer.classList.add("selected");
    });
    const editor = document.createElement("div");
    editor.className = "placed-text-content";
    editor.dataset.placementId = placement.id;
    editor.contentEditable = "true";
    editor.textContent = placement.text;
    editor.style.fontSize = `${placement.size || 1}em`;
    editor.addEventListener("blur", async () => {
      placement.text = editor.textContent.trim();
      await update(ref(db, `activities/${activityId}/tasks/${taskId}/pieces/${pieceId}`), { placements: selectedPiece.placements });
    });
    const tools = document.createElement("div");
    tools.className = "placement-tools";
    tools.append(
      makeToolButton("－", "縮小文字", async () => {
        placement.size = Math.max(.55, (placement.size || 1) - .12);
        await update(ref(db, `activities/${activityId}/tasks/${taskId}/pieces/${pieceId}`), { placements: selectedPiece.placements });
      }),
      makeToolButton("＋", "放大文字", async () => {
        placement.size = Math.min(2.2, (placement.size || 1) + .12);
        await update(ref(db, `activities/${activityId}/tasks/${taskId}/pieces/${pieceId}`), { placements: selectedPiece.placements });
      }),
      makeToolButton("×", "刪除文字點", async () => {
        selectedPiece.placements = selectedPiece.placements.filter((item) => item.id !== placement.id);
        await update(ref(db, `activities/${activityId}/tasks/${taskId}/pieces/${pieceId}`), { placements: selectedPiece.placements });
      }, "delete-placement")
    );
    textLayer.append(editor, tools);
    frame.append(textLayer);
    if (activeEditor === placement.id) editor.focus();
  });
}

function makeToolButton(text, title, onClick, extraClass = "resize-placement") {
  const button = document.createElement("button");
  button.className = extraClass;
  button.type = "button";
  button.textContent = text;
  button.title = title;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function showRebuildView(activityId, className = "", groupName = "") {
  if (!requireFirebase()) return;
  activeGroup = className && groupName ? { className, groupName, groupId: makeGroupId(className, groupName) } : null;
  teacherView.classList.add("hidden");
  joinView.classList.add("hidden");
  studentView.classList.add("hidden");
  rebuildView.classList.remove("hidden");
  stopListeners();
  const activityRef = ref(db, `activities/${activityId}`);
  const unsubscribe = onValue(activityRef, (snap) => {
    if (!snap.exists()) {
      rebuildBoard.innerHTML = '<div class="empty-card">找不到這個活動</div>';
      return;
    }
    syncPiecesFromActivity({ id: activityId, ...snap.val() });
    renderRebuildBoard();
  });
  unsubscribers.push(unsubscribe);
}

function renderRebuildBoard() {
  rebuildBoard.innerHTML = "";
  tasks.forEach((task) => {
    const taskSection = document.createElement("section");
    taskSection.className = "task-rebuild-group";
    const heading = document.createElement("h3");
    heading.textContent = `${task.label}任務`;
    const row = document.createElement("div");
    row.className = "task-rebuild-row";
    row.dataset.taskId = task.id;
    const group = activeGroup ? task.groups?.[activeGroup.groupId] : null;
    const groupPieces = group?.pieces || {};
    const pieceOrder = group?.pieceOrder || task.pieceOrder || (task.piecesList || []).map((piece) => piece.id);
    const rowPieces = pieceOrder.map((pieceId) => {
      const base = (task.piecesList || []).find((piece) => piece.id === pieceId);
      if (!base) return null;
      return { ...base, ...(groupPieces[pieceId] || {}) };
    }).filter(Boolean);
    (activeGroup ? rowPieces : task.piecesList || []).forEach((piece, index) => {
      row.append(makeRebuildCard(piece, index));
    });
    taskSection.append(heading, row);
    rebuildBoard.append(taskSection);
  });
}

function makeRebuildCard(piece, index) {
    const card = document.createElement("article");
    card.className = "rebuild-card";
    card.draggable = true;
    card.dataset.id = piece.id;
    card.style.setProperty("--sort-number", `"${index + 1}"`);
    const frame = document.createElement("div");
    frame.className = "image-frame";
    const image = document.createElement("img");
    image.src = piece.imageUrl;
    image.alt = `重組圖片 ${index + 1}`;
    frame.append(image);
    renderStaticPlacements(frame, piece);
    const label = document.createElement("p");
    const owner = activeGroup ? `${activeGroup.className} ${activeGroup.groupName}：` : (piece.studentName ? `${piece.studentName}：` : "");
    label.textContent = `${owner}${piece.label || "尚未填寫下方重點"}`;
    card.append(frame, label);
    card.addEventListener("dragstart", () => {
      draggedRebuildId = piece.id;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", saveRebuildOrder);
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      const row = card.closest(".task-rebuild-row");
      const active = row?.querySelector(`[data-id="${draggedRebuildId}"]`);
      if (!active || active === card) return;
      const rect = card.getBoundingClientRect();
      row.insertBefore(active, event.clientX > rect.left + rect.width / 2 ? card.nextSibling : card);
      updateRebuildNumbers(row);
    });
    return card;
}

function renderStaticPlacements(frame, piece) {
  (piece.placements || []).forEach((placement) => {
    const text = document.createElement("div");
    text.className = "placed-text static-text";
    text.textContent = placement.text;
    text.style.left = `${placement.x * 100}%`;
    text.style.top = `${placement.y * 100}%`;
    text.style.fontSize = `${placement.size || 1}em`;
    frame.append(text);
  });
}

function updateRebuildNumbers(container = rebuildBoard) {
  container.querySelectorAll(".rebuild-card").forEach((card, index) => {
    card.style.setProperty("--sort-number", `"${index + 1}"`);
  });
}

async function saveRebuildOrder() {
  const updates = {};
  rebuildBoard.querySelectorAll(".task-rebuild-row").forEach((row) => {
    const taskId = row.dataset.taskId;
    const order = [...row.querySelectorAll(".rebuild-card")].map((card) => card.dataset.id);
    const path = activeGroup ? `tasks/${taskId}/groups/${activeGroup.groupId}/pieceOrder` : `tasks/${taskId}/pieceOrder`;
    updates[path] = order;
  });
  await update(ref(db, `activities/${activity.id}`), updates);
  draggedRebuildId = null;
}

function drawWrappedCenteredText(ctx, text, centerX, y, maxWidth, lineHeight) {
  const chars = text.trim().split("");
  let line = "";
  let currentY = y;
  chars.forEach((char) => {
    const testLine = line + char;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, centerX, currentY);
      line = char;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  });
  if (line) ctx.fillText(line, centerX, currentY);
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = text.trim().split("");
  let line = "";
  let currentY = y;
  chars.forEach((char) => {
    const testLine = line + char;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = char;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  });
  if (line) ctx.fillText(line, x, currentY);
}

function drawNumber(ctx, number, x, y) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.94)";
  ctx.strokeStyle = "#263238";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x + 30, y + 30, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#263238";
  ctx.font = '700 30px "Microsoft JhengHei", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), x + 30, y + 31);
  ctx.restore();
}

function downloadStudentWork() {
  if (!selectedPiece) return;
  renderDownload([selectedPiece], `學生作品_${selectedPiece.order}.png`, false);
}

function downloadRebuildWork() {
  const orderedPieces = [];
  const renderedPieces = [];
  tasks.forEach((task) => {
    const group = activeGroup ? task.groups?.[activeGroup.groupId] : null;
    const groupPieces = group?.pieces || {};
    (task.piecesList || []).forEach((piece) => {
      renderedPieces.push({ ...piece, ...(groupPieces[piece.id] || {}) });
    });
  });
  rebuildBoard.querySelectorAll(".task-rebuild-row").forEach((row) => {
    row.querySelectorAll(".rebuild-card").forEach((card) => {
      const piece = renderedPieces.find((item) => item.id === card.dataset.id);
      if (piece) orderedPieces.push(piece);
    });
  });
  if (orderedPieces.length === 0) return;
  renderDownload(orderedPieces, "共編重組故事圖.png", true);
}

function renderDownload(downloadPieces, filename, isGrid) {
  Promise.all(downloadPieces.map((piece) => loadImage(piece.imageUrl))).then((images) => {
    const cellWidth = isGrid ? 600 : 900;
    const textHeight = isGrid ? 150 : 160;
    const cellImageHeight = Math.round(cellWidth * images[0].height / images[0].width);
    exportCanvas.width = isGrid ? cellWidth * 2 : cellWidth;
    const gridRows = Math.ceil(downloadPieces.length / 2);
    exportCanvas.height = isGrid ? (cellImageHeight + textHeight) * gridRows : cellImageHeight + textHeight;
    exportCtx.fillStyle = "#fffdf6";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    downloadPieces.forEach((piece, index) => {
      const x = isGrid ? (index % 2) * cellWidth : 0;
      const y = isGrid ? Math.floor(index / 2) * (cellImageHeight + textHeight) : 0;
      exportCtx.drawImage(images[index], x, y, cellWidth, cellImageHeight);
      (piece.placements || []).forEach((placement) => {
        const fontSize = Math.round(30 * (placement.size || 1));
        exportCtx.save();
        exportCtx.fillStyle = "#263238";
        exportCtx.textAlign = "center";
        exportCtx.font = `${fontSize}px "Microsoft JhengHei", sans-serif`;
        drawWrappedCenteredText(exportCtx, placement.text, x + placement.x * cellWidth, y + placement.y * cellImageHeight, cellWidth * .55, Math.round(fontSize * 1.25));
        exportCtx.restore();
      });
      exportCtx.fillStyle = "#ffffff";
      exportCtx.fillRect(x, y + cellImageHeight, cellWidth, textHeight);
      exportCtx.strokeStyle = "#263238";
      exportCtx.lineWidth = 3;
      exportCtx.strokeRect(x, y, cellWidth, cellImageHeight + textHeight);
      if (isGrid) drawNumber(exportCtx, index + 1, x + 18, y + cellImageHeight + 18);
      exportCtx.fillStyle = "#263238";
      exportCtx.font = isGrid ? '30px "Microsoft JhengHei", sans-serif' : '32px "Microsoft JhengHei", sans-serif';
      const owner = activeGroup ? `${activeGroup.className} ${activeGroup.groupName}：` : (piece.studentName ? `${piece.studentName}：` : "");
      const labelText = `${owner}${piece.label || ""}`;
      drawWrappedText(exportCtx, labelText, x + (isGrid ? 84 : 28), y + cellImageHeight + 48, cellWidth - (isGrid ? 110 : 56), isGrid ? 40 : 42);
    });
    const link = document.createElement("a");
    link.download = filename;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  });
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.src = src;
  });
}

async function loadSourceImages(files) {
  const imageFiles = [...files].filter((file) => file.type.startsWith("image/"));
  if (imageFiles.length === 0) return;
  const images = await Promise.all(imageFiles.map(loadFileImage));
  buildActivity(images);
}

function loadFileImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const img = new Image();
      img.addEventListener("load", () => resolve(img));
      img.src = reader.result;
    });
    reader.readAsDataURL(file);
  });
}

async function showFromHash() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const activityId = hash.get("activity") || hash.get("teacher");
  const rebuildId = hash.get("rebuild");
  const joinId = hash.get("join");
  const taskJoinId = hash.get("taskJoin");
  const taskId = hash.get("task");
  const pieceId = hash.get("piece");
  if (taskJoinId && await loadActivity(taskJoinId)) {
    showJoinView(taskJoinId, taskId);
    return;
  }
  if (joinId && await loadActivity(joinId)) {
    showJoinView(joinId);
    return;
  }
  if (rebuildId && await loadActivity(rebuildId)) {
    showRebuildView(rebuildId, hash.get("class") || "", hash.get("group") || "");
    return;
  }
  if (activityId && await loadActivity(activityId)) {
    if (pieceId) {
      showStudentView(activityId, taskId || findTaskIdForPiece(pieceId), pieceId);
      return;
    }
    if (taskId) {
      showTaskView(activityId, taskId, hash.get("class") || "", hash.get("group") || "");
      return;
    }
    renderTeacherView();
    return;
  }
  renderTeacherView();
}

function resetApp() {
  stopListeners();
  activity = null;
  pieces = [];
  selectedPiece = null;
  imageInput.value = "";
  window.location.hash = "";
  renderTeacherView();
}

saveConfigBtn.addEventListener("click", () => {
  try {
    const raw = firebaseConfigInput.value.trim();
    if (!raw) {
      setStatus("請先貼上 Firebase 設定");
      return;
    }
    initFirebase(parseConfig(raw));
    localStorage.setItem(CONFIG_KEY, raw);
    showFromHash();
  } catch (error) {
    setStatus(`Firebase 設定格式不正確：${error.message}`);
  }
});

imageInput.addEventListener("change", () => loadSourceImages(imageInput.files));
shuffleBtn.addEventListener("click", async () => {
  if (!activity) return;
  tasks = shuffle(tasks);
  await update(ref(db, `activities/${activity.id}`), { taskOrder: tasks.map((task) => task.id) });
  renderTeacherView();
});
resetBtn.addEventListener("click", resetApp);
downloadStudentBtn.addEventListener("click", downloadStudentWork);
downloadRebuildBtn.addEventListener("click", downloadRebuildWork);
goRebuildBtn.addEventListener("click", () => {
  if (!activity) return;
  window.location.hash = `rebuild=${activity.id}${groupParams()}`;
});
joinRebuildBtn.addEventListener("click", () => {
  if (!activity) return;
  window.location.hash = `rebuild=${activity.id}`;
});
window.addEventListener("hashchange", showFromHash);
loadFirebaseConfig();
showFromHash();
