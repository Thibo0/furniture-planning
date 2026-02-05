const mdInput = document.getElementById("mdInput");
const canvas = document.getElementById("roomCanvas");
const ctx = canvas.getContext("2d");

const typeCatalog = {
  sofa: { label: "Canapé", w: 180, h: 80, color: "#f59e0b" },
  table: { label: "Table", w: 120, h: 70, color: "#a16207" },
  chair: { label: "Chaise", w: 50, h: 50, color: "#d97706" },
  bed: { label: "Lit", w: 200, h: 140, color: "#60a5fa" },
  wardrobe: { label: "Armoire", w: 120, h: 60, color: "#475569" },
  door: { label: "Porte", w: 80, h: 15, color: "#92400e" },
  window: { label: "Fenêtre", w: 80, h: 15, color: "#38bdf8" },
  radiator: { label: "Radiateur", w: 120, h: 30, color: "#9ca3af" },
  custom: { label: "Objet", w: 80, h: 40, color: "#94a3b8" },
};

const DEFAULT_LIBRARY = [
  {
    id: "salon",
    label: "Salon",
    presets: [
      { id: "sofa-2", label: "Canapé 2 places", type: "sofa", w: 180, h: 80 },
      { id: "sofa-3", label: "Canapé 3 places", type: "sofa", w: 220, h: 90 },
      { id: "table-120", label: "Table 120 × 70", type: "table", w: 120, h: 70 },
      { id: "chair-45", label: "Chaise 45 × 45", type: "chair", w: 45, h: 45 },
    ],
  },
  {
    id: "ouvertures",
    label: "Ouvertures",
    presets: [
      { id: "door-70", label: "Porte 70", type: "door", w: 70, h: 15 },
      { id: "door-80", label: "Porte 80", type: "door", w: 80, h: 15 },
      { id: "door-90", label: "Porte 90", type: "door", w: 90, h: 15 },
      { id: "window-80", label: "Fenêtre 80", type: "window", w: 80, h: 15 },
      { id: "window-120", label: "Fenêtre 120", type: "window", w: 120, h: 15 },
      { id: "window-80v", label: "Fenêtre 80 verticale", type: "window", w: 80, h: 15, rotation: 90 },
    ],
  },
];

const STORAGE_KEY = "furniturePlannerState_v1";
const LIBRARY_KEY = "furniturePlannerLibrary_v1";
const HISTORY_LIMIT = 50;

const defaultMd = `# Room
unit: cm

points:
- 0,0
- 500,0
- 500,350
- 0,350

items:
- type: sofa
  x: 140
  y: 90
  w: 180
  h: 80
  rotation: 0
- type: table
  x: 320
  y: 210
  w: 120
  h: 70
  rotation: 0
- type: door
  x: 250
  y: 0
  w: 80
  h: 15
  rotation: 0
- type: window
  x: 500
  y: 170
  w: 80
  h: 15
  rotation: 90
- type: radiator
  x: 30
  y: 280
  w: 120
  h: 30
  rotation: 0
`;

let room = { unit: "cm", points: [], width: 500, height: 350 };
let items = [];
let rooms = [];
let activeRoomId = null;
let library = [];
let settings = {
  snap: true,
  avoidOverlap: true,
  showMeasures: true,
  snapDistance: 5,
  zoom: 1,
};
let selectedId = null;
let isDragging = false;
let isResizing = false;
let isRotating = false;
let isAltRotating = false;
let dragOffset = { x: 0, y: 0 };
let resizeState = null;
let rotateState = null;
let dragState = null;
let idCounter = 1;
let roomCounter = 1;
let historyStack = [];
let redoStack = [];
let interactionSnapshot = null;

const ANGLE_SNAP_DEG = 3;
const WALL_SNAP_DIST = 10;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

const makeId = () => `item-${idCounter++}`;

const getViewSize = () => ({
  width: canvas.clientWidth,
  height: canvas.clientHeight,
});

const toRadians = (deg) => (deg * Math.PI) / 180;

const parseNumber = (value) => {
  if (value === undefined || value === null) return null;
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : null;
};

const applyMinSize = (w, h) => {
  const minSize = 5;
  return { w: Math.max(w, minSize), h: Math.max(h, minSize) };
};

const makeRoomId = () => `room-${roomCounter++}`;

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const getSerializableState = () => ({
  version: 1,
  rooms: deepClone(rooms),
  activeRoomId,
  settings: deepClone(settings),
  library: deepClone(library),
});

const saveState = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getSerializableState()));
};

const loadState = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const loadLibrary = () => {
  const raw = localStorage.getItem(LIBRARY_KEY);
  if (!raw) return deepClone(DEFAULT_LIBRARY);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : deepClone(DEFAULT_LIBRARY);
  } catch {
    return deepClone(DEFAULT_LIBRARY);
  }
};

const saveLibrary = () => {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
};

const pushHistory = () => {
  const snapshot = JSON.stringify(getSerializableState());
  if (historyStack[historyStack.length - 1] === snapshot) return;
  historyStack.push(snapshot);
  if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
  redoStack = [];
  saveState();
  updateUndoRedoButtons();
};

const restoreFromSnapshot = (snapshot) => {
  const state = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
  rooms = state.rooms || [];
  activeRoomId = state.activeRoomId || (rooms[0] && rooms[0].id);
  settings = { ...settings, ...(state.settings || {}) };
  library = state.library || deepClone(DEFAULT_LIBRARY);
  ensureIds();
  setActiveRoom(activeRoomId);
  renderLibrary();
  renderRoomTabs();
  syncRoomInputs();
  updateOptionsUI();
  updateUndoRedoButtons();
  draw();
};

const undo = () => {
  if (historyStack.length <= 1) return;
  const current = historyStack.pop();
  redoStack.push(current);
  const previous = historyStack[historyStack.length - 1];
  restoreFromSnapshot(previous);
};

const redo = () => {
  if (!redoStack.length) return;
  const next = redoStack.pop();
  historyStack.push(next);
  restoreFromSnapshot(next);
};

const parseKeyValue = (line) => {
  const match = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
  if (!match) return null;
  return { key: match[1].toLowerCase(), value: match[2].trim() };
};

const parseMarkdown = (md) => {
  const lines = md.split(/\r?\n/);
  const roomData = {
    unit: "cm",
    points: [],
    width: 400,
    height: 300,
  };
  const walls = [];
  const rawItems = [];
  let section = null;
  let currentItem = null;

  const pushCurrentItem = () => {
    if (currentItem) rawItems.push(currentItem);
    currentItem = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.toLowerCase() === "points:") {
      pushCurrentItem();
      section = "points";
      continue;
    }

    if (line.toLowerCase() === "items:") {
      pushCurrentItem();
      section = "items";
      continue;
    }

    if (line.toLowerCase() === "walls:") {
      pushCurrentItem();
      section = "walls";
      continue;
    }

    if (section === "points" && line.startsWith("-")) {
      const nums = line.match(/-?\d+(\.\d+)?/g);
      if (nums && nums.length >= 2) {
        roomData.points.push({
          x: Number.parseFloat(nums[0]),
          y: Number.parseFloat(nums[1]),
        });
      }
      continue;
    }

    if (section === "walls" && line.startsWith("-")) {
      const nums = line.match(/-?\d+(\.\d+)?/g);
      if (nums && nums.length) {
        walls.push(Number.parseFloat(nums[0]));
      }
      continue;
    }

    if (section === "items") {
      if (line.startsWith("-")) {
        pushCurrentItem();
        const rest = line.replace(/^-+\s*/, "");
        const kv = parseKeyValue(rest);
        if (kv) {
          currentItem = { [kv.key]: kv.value };
        } else {
          currentItem = { type: rest };
        }
        continue;
      }

      if (currentItem) {
        const kv = parseKeyValue(line);
        if (kv) currentItem[kv.key] = kv.value;
      }
      continue;
    }

    const kv = parseKeyValue(line);
    if (kv) {
      if (kv.key === "unit") roomData.unit = kv.value;
      if (kv.key === "width") roomData.width = parseNumber(kv.value) ?? roomData.width;
      if (kv.key === "height") roomData.height = parseNumber(kv.value) ?? roomData.height;
    }
  }

  pushCurrentItem();

  if (!roomData.points.length) {
    if (walls.length >= 2) {
      roomData.width = walls[0];
      roomData.height = walls[1];
    }
    roomData.points = [
      { x: 0, y: 0 },
      { x: roomData.width, y: 0 },
      { x: roomData.width, y: roomData.height },
      { x: 0, y: roomData.height },
    ];
  }

  return { roomData, rawItems };
};

const buildItem = (raw, center) => {
  const type = (raw.type || raw.kind || raw.label || "table").toLowerCase();
  const preset = typeCatalog[type] || typeCatalog.table;
  const pivot =
    raw.pivot ||
    raw.hinge ||
    ((type === "door" || type === "window") ? "left" : null);
  const size = applyMinSize(
    parseNumber(raw.w) ?? preset.w,
    parseNumber(raw.h) ?? preset.h
  );
  return {
    id: makeId(),
    type,
    label: raw.label || raw.name || preset.label || type,
    x: parseNumber(raw.x) ?? center.x,
    y: parseNumber(raw.y) ?? center.y,
    w: size.w,
    h: size.h,
    rotation: parseNumber(raw.rotation) ?? 0,
    color: raw.color || preset.color,
    pivot,
  };
};

const getRoomBounds = () => {
  if (!room.points || !room.points.length) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  }
  const xs = room.points.map((p) => p.x);
  const ys = room.points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
};

const getRoomTransform = () => {
  const { width, height } = getViewSize();
  const bounds = getRoomBounds();
  const roomWidth = Math.max(1, bounds.maxX - bounds.minX);
  const roomHeight = Math.max(1, bounds.maxY - bounds.minY);
  const pad = 60;
  const baseScale = Math.min(
    (width - pad * 2) / roomWidth,
    (height - pad * 2) / roomHeight
  );
  const scale = baseScale * (settings.zoom || 1);
  const centerRoom = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const baseCenterScreen = {
    x: centerRoom.x * baseScale + (pad - bounds.minX * baseScale),
    y: centerRoom.y * baseScale + (pad - bounds.minY * baseScale),
  };
  return {
    scale,
    offsetX: baseCenterScreen.x - centerRoom.x * scale,
    offsetY: baseCenterScreen.y - centerRoom.y * scale,
  };
};

const roomToScreen = (point, transform) => ({
  x: point.x * transform.scale + transform.offsetX,
  y: point.y * transform.scale + transform.offsetY,
});

const screenToRoom = (point, transform) => ({
  x: (point.x - transform.offsetX) / transform.scale,
  y: (point.y - transform.offsetY) / transform.scale,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeAngle = (deg) => ((deg % 360) + 360) % 360;

const clampZoom = (value) => clamp(value, ZOOM_MIN, ZOOM_MAX);

const setZoom = (value, save = true) => {
  settings.zoom = clampZoom(value);
  const slider = document.getElementById("zoomRange");
  const valueEl = document.getElementById("zoomValue");
  if (slider) slider.value = settings.zoom;
  if (valueEl) valueEl.textContent = `${Math.round(settings.zoom * 100)}%`;
  draw();
  if (save) saveState();
};

const ensureIds = () => {
  let roomCount = 0;
  let itemCount = 0;
  items.forEach((item) => {
    if (!item.id) item.id = makeId();
    itemCount += 1;
  });
  rooms.forEach((entry) => {
    if (!entry.id) entry.id = makeRoomId();
    if (!entry.name) entry.name = `Pièce ${roomCount + 1}`;
    if (!entry.items) entry.items = [];
    entry.items.forEach((item) => {
      if (!item.id) item.id = makeId();
      const size = applyMinSize(item.w ?? 0, item.h ?? 0);
      item.w = size.w;
      item.h = size.h;
      itemCount += 1;
    });
    roomCount += 1;
  });
  roomCounter = Math.max(roomCounter, roomCount + 1);
  idCounter = Math.max(idCounter, itemCount + 1);
};

const getActiveRoom = () => rooms.find((entry) => entry.id === activeRoomId);

const setActiveRoom = (roomId) => {
  const next = rooms.find((entry) => entry.id === roomId) || rooms[0];
  if (!next) return;
  activeRoomId = next.id;
  room = next;
  items = next.items;
  selectedId = null;
  exportMarkdown();
  syncRoomInputs();
  renderRoomTabs();
  draw();
};

const renderRoomTabs = () => {
  const container = document.getElementById("roomTabs");
  container.innerHTML = "";
  rooms.forEach((entry) => {
    const btn = document.createElement("button");
    btn.className = `room-tab${entry.id === activeRoomId ? " active" : ""}`;
    btn.textContent = entry.name || "Pièce";
    btn.title = "Basculer vers cette pièce";
    btn.addEventListener("click", () => setActiveRoom(entry.id));
    container.appendChild(btn);
  });
};

const renderLibrary = () => {
  const select = document.getElementById("presetCategory");
  const list = document.getElementById("presetList");
  select.innerHTML = "";
  list.innerHTML = "";
  library.forEach((cat, index) => {
    const option = document.createElement("option");
    option.value = cat.id;
    option.textContent = cat.label;
    if (index === 0) option.selected = true;
    select.appendChild(option);
  });

  const renderPresets = () => {
    list.innerHTML = "";
    const category = library.find((cat) => cat.id === select.value);
    if (!category) return;
    category.presets.forEach((preset) => {
      const button = document.createElement("button");
      button.textContent = preset.label;
      button.title = "Ajouter ce preset";
      button.addEventListener("click", () => addPreset(preset));
      list.appendChild(button);
    });
  };

  select.onchange = renderPresets;
  renderPresets();
};

const updateUndoRedoButtons = () => {
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  if (!undoBtn || !redoBtn) return;
  undoBtn.disabled = historyStack.length <= 1;
  redoBtn.disabled = redoStack.length === 0;
};

const updateOptionsUI = () => {
  document.getElementById("snapToggle").checked = settings.snap;
  document.getElementById("collisionToggle").checked = settings.avoidOverlap;
  document.getElementById("measureToggle").checked = settings.showMeasures;
  setZoom(settings.zoom ?? 1, false);
};

const syncRoomInputs = () => {
  const nameInput = document.getElementById("roomName");
  if (nameInput) nameInput.value = room.name || "";
  updatePointsTextarea();
};

const updatePointsTextarea = () => {
  const pointsInput = document.getElementById("pointsInput");
  if (!pointsInput) return;
  pointsInput.value = (room.points || [])
    .map((point) => `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`)
    .join("\n");
};

const parsePointsTextarea = () => {
  const pointsInput = document.getElementById("pointsInput");
  if (!pointsInput) return null;
  const lines = pointsInput.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const points = [];
  for (const line of lines) {
    const nums = line.match(/-?\d+(\.\d+)?/g);
    if (!nums || nums.length < 2) continue;
    points.push({ x: Number.parseFloat(nums[0]), y: Number.parseFloat(nums[1]) });
  }
  return points;
};

const addRoom = () => {
  const bounds = getRoomBounds();
  const index = rooms.length + 1;
  const newRoom = {
    id: makeRoomId(),
    name: `Pièce ${index}`,
    unit: room.unit || "cm",
    points: [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ],
    items: [],
  };
  rooms.push(newRoom);
  setActiveRoom(newRoom.id);
  pushHistory();
};

const rotatePoint = (point, angleRad) => ({
  x: point.x * Math.cos(angleRad) - point.y * Math.sin(angleRad),
  y: point.x * Math.sin(angleRad) + point.y * Math.cos(angleRad),
});

const getWallSnapTargets = (point) => {
  if (!room.points || room.points.length < 2) return null;
  let closest = null;
  let minDistance = Infinity;
  room.points.forEach((start, index) => {
    const end = room.points[(index + 1) % room.points.length];
    const dist = distancePointToSegment(point, start, end);
    if (dist < minDistance) {
      minDistance = dist;
      closest = { start, end };
    }
  });
  if (!closest) return null;
  const angle =
    (Math.atan2(closest.end.y - closest.start.y, closest.end.x - closest.start.x) * 180) /
    Math.PI;
  const base = normalizeAngle(angle);
  return {
    distance: minDistance,
    angles: [base, normalizeAngle(base + 180)],
  };
};

const snapAngle = (degrees, item) => {
  const angle = normalizeAngle(degrees);
  const targets = [0, 90, 180, 270];
  const wallSnap = getWallSnapTargets({ x: item.x, y: item.y });
  if (wallSnap && wallSnap.distance <= WALL_SNAP_DIST) {
    targets.push(...wallSnap.angles);
  }
  let best = angle;
  let bestDelta = ANGLE_SNAP_DEG + 1;
  targets.forEach((target) => {
    const delta = Math.abs(normalizeAngle(angle - target));
    const normalizedDelta = Math.min(delta, 360 - delta);
    if (normalizedDelta < bestDelta) {
      bestDelta = normalizedDelta;
      best = target;
    }
  });
  return bestDelta <= ANGLE_SNAP_DEG ? best : angle;
};

const getItemRoomCorners = (item, centerOverride = null) => {
  const angle = toRadians(item.rotation);
  const halfW = item.w / 2;
  const halfH = item.h / 2;
  const center = centerOverride || { x: item.x, y: item.y };
  const cornersLocal = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];
  return cornersLocal.map((corner) => {
    const rotated = rotatePoint(corner, angle);
    return { x: center.x + rotated.x, y: center.y + rotated.y };
  });
};

const getItemAABB = (item, centerOverride = null) => {
  const corners = getItemRoomCorners(item, centerOverride);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
};

const aabbOverlap = (a, b) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

const snapValue = (value, targets, threshold) => {
  let closest = value;
  let minDelta = threshold + 1;
  targets.forEach((target) => {
    const delta = Math.abs(target - value);
    if (delta < minDelta) {
      minDelta = delta;
      closest = target;
    }
  });
  return minDelta <= threshold ? closest : value;
};

const applySnapping = (item, proposed) => {
  if (!settings.snap) return proposed;
  const threshold = settings.snapDistance;
  const bounds = getRoomBounds();
  const targetsX = [bounds.minX, bounds.maxX];
  const targetsY = [bounds.minY, bounds.maxY];

  items.forEach((other) => {
    if (other.id === item.id) return;
    const otherBox = getItemAABB(other);
    targetsX.push(otherBox.minX, otherBox.maxX, (otherBox.minX + otherBox.maxX) / 2);
    targetsY.push(otherBox.minY, otherBox.maxY, (otherBox.minY + otherBox.maxY) / 2);
  });

  const box = getItemAABB(item, proposed);
  const halfW = (box.maxX - box.minX) / 2;
  const halfH = (box.maxY - box.minY) / 2;

  const snappedX = snapValue(
    proposed.x,
    targetsX.map((target) => target - halfW).concat(targetsX.map((target) => target + halfW)),
    threshold
  );
  const snappedY = snapValue(
    proposed.y,
    targetsY.map((target) => target - halfH).concat(targetsY.map((target) => target + halfH)),
    threshold
  );

  return { x: snappedX, y: snappedY };
};

const overlapsAny = (item, proposed, sizeOverride = null) => {
  const probe = sizeOverride ? { ...item, w: sizeOverride.w, h: sizeOverride.h } : item;
  const box = getItemAABB(probe, proposed);
  return items.some((other) => {
    if (other.id === item.id) return false;
    const otherBox = getItemAABB(other);
    return aabbOverlap(box, otherBox);
  });
};

const getItemCorners = (item, transform) => {
  const angle = toRadians(item.rotation);
  const halfW = item.w / 2;
  const halfH = item.h / 2;
  const cornersLocal = [
    { x: -halfW, y: -halfH, key: "nw" },
    { x: halfW, y: -halfH, key: "ne" },
    { x: halfW, y: halfH, key: "se" },
    { x: -halfW, y: halfH, key: "sw" },
  ];
  return cornersLocal.map((corner) => {
    const rotated = rotatePoint(corner, angle);
    const roomPoint = { x: item.x + rotated.x, y: item.y + rotated.y };
    const screenPoint = roomToScreen(roomPoint, transform);
    return { ...screenPoint, key: corner.key };
  });
};

const getRotationHandle = (item, transform) => {
  const angle = toRadians(item.rotation);
  const offset = 28;
  const pointLocal = rotatePoint({ x: 0, y: -item.h / 2 - offset }, angle);
  const roomPoint = { x: item.x + pointLocal.x, y: item.y + pointLocal.y };
  return roomToScreen(roomPoint, transform);
};

const getItemScreenBounds = (item, transform) => {
  const corners = getItemCorners(item, transform);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
};

const getNextPivot = (current) => (current === "right" ? "left" : "right");

const drawSwingArc = (item, transform) => {
  if (item.type !== "door" && item.type !== "window") return;
  const pivot = item.pivot === "right" ? "right" : "left";
  const angle = toRadians(item.rotation);
  const halfW = item.w / 2;
  const hingeLocal = {
    left: { x: -halfW, y: 0 },
    right: { x: halfW, y: 0 },
  }[pivot];
  const hingeRoom = rotatePoint(hingeLocal, angle);
  const hingePoint = {
    x: item.x + hingeRoom.x,
    y: item.y + hingeRoom.y,
  };
  const screen = roomToScreen(hingePoint, transform);
  const radius = item.w;
  const sweep =
    pivot === "right"
      ? { start: Math.PI, end: Math.PI / 2, anticlockwise: true }
      : { start: 0, end: Math.PI / 2, anticlockwise: false };

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(angle);
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.arc(0, 0, radius * transform.scale, sweep.start, sweep.end, sweep.anticlockwise);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
};

const drawText = (text, x, y, viewSize, options = {}) => {
  const {
    fontSize = 12,
    maxWidth = null,
    align = "left",
    baseline = "top",
    color = "#111827",
    halo = "rgba(255, 255, 255, 0.85)",
  } = options;

  ctx.save();
  let size = fontSize;
  let textWidth = 0;
  for (let i = 0; i < 6; i += 1) {
    ctx.font = `${size}px 'Inter', sans-serif`;
    textWidth = ctx.measureText(text).width;
    if (!maxWidth || textWidth <= maxWidth || size <= 10) break;
    size -= 1;
  }

  const margin = 6;
  let drawX = x;
  let drawY = y;
  if (align === "center") drawX = x;
  if (align === "right") drawX = x;

  drawX = clamp(drawX, margin, viewSize.width - margin);
  drawY = clamp(drawY, margin, viewSize.height - margin);

  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineWidth = 4;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, drawX, drawY);
  ctx.fillStyle = color;
  ctx.fillText(text, drawX, drawY);
  ctx.restore();
};

const drawRoom = (transform) => {
  if (!room.points || room.points.length < 2) return;
  ctx.beginPath();
  room.points.forEach((point, index) => {
    const screen = roomToScreen(point, transform);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.closePath();
  ctx.fillStyle = "#f9fafb";
  ctx.fill();
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.stroke();
};

const drawRoomDimensions = (transform, viewSize) => {
  if (!room.points || room.points.length < 2) return;
  const bounds = getRoomBounds();
  const topLeft = roomToScreen({ x: bounds.minX, y: bounds.minY }, transform);
  const topRight = roomToScreen({ x: bounds.maxX, y: bounds.minY }, transform);
  const bottomLeft = roomToScreen({ x: bounds.minX, y: bounds.maxY }, transform);
  const width = Math.round(bounds.maxX - bounds.minX);
  const height = Math.round(bounds.maxY - bounds.minY);
  const unit = room.unit || "cm";
  const offset = 24;
  const safe = 24;

  let y = topLeft.y - offset;
  if (y < safe + 10) y = topLeft.y + offset;
  y = clamp(y, safe + 10, viewSize.height - safe - 10);

  let x = topLeft.x - offset;
  if (x < safe + 10) x = topLeft.x + offset;
  x = clamp(x, safe + 10, viewSize.width - safe - 10);

  ctx.save();
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(topLeft.x, y);
  ctx.lineTo(topRight.x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(topLeft.x, y - 6);
  ctx.lineTo(topLeft.x, y + 6);
  ctx.moveTo(topRight.x, y - 6);
  ctx.lineTo(topRight.x, y + 6);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, topLeft.y);
  ctx.lineTo(x, bottomLeft.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 6, topLeft.y);
  ctx.lineTo(x + 6, topLeft.y);
  ctx.moveTo(x - 6, bottomLeft.y);
  ctx.lineTo(x + 6, bottomLeft.y);
  ctx.stroke();
  ctx.restore();

  drawText(`${width} ${unit}`, (topLeft.x + topRight.x) / 2, y - 8, viewSize, {
    align: "center",
    baseline: "bottom",
  });
  drawText(`${height} ${unit}`, x - 8, (topLeft.y + bottomLeft.y) / 2, viewSize, {
    align: "center",
    baseline: "middle",
  });
};

const drawItemAnnotations = (item, transform, viewSize) => {
  const bounds = getItemScreenBounds(item, transform);
  const unit = room.unit || "cm";
  const label = item.label || item.type;

  const innerWidth = Math.max(0, bounds.maxX - bounds.minX - 12);
  const innerHeight = Math.max(0, bounds.maxY - bounds.minY - 12);
  let labelX = bounds.minX + 6;
  let labelY = bounds.minY + 6;
  let maxWidth = innerWidth;
  const minLabelSpace = 42;
  if (innerWidth < minLabelSpace || innerHeight < 18) {
    labelX = bounds.minX;
    labelY = bounds.minY - 20;
    maxWidth = bounds.maxX - bounds.minX;
  }

  drawText(label, labelX, labelY, viewSize, {
    maxWidth,
    align: "left",
    baseline: "top",
  });

  const widthText = `${Math.round(item.w)} ${unit}`;
  const heightText = `${Math.round(item.h)} ${unit}`;
  const offset = 10;
  const fitsInside = innerWidth >= 60 && innerHeight >= 26;
  if (fitsInside) {
    drawText(widthText, (bounds.minX + bounds.maxX) / 2, bounds.minY + 6, viewSize, {
      align: "center",
      baseline: "top",
    });
  } else {
    drawText(widthText, (bounds.minX + bounds.maxX) / 2, bounds.minY - offset, viewSize, {
      align: "center",
      baseline: "bottom",
    });
  }

  drawText(heightText, bounds.maxX + offset, (bounds.minY + bounds.maxY) / 2, viewSize, {
    align: "left",
    baseline: "middle",
  });
};

const drawResizeHandles = (item, transform) => {
  const handleSize = 12;
  const half = handleSize / 2;
  const corners = getItemCorners(item, transform);
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#6366f1";
  ctx.lineWidth = 1.5;
  corners.forEach((corner) => {
    ctx.fillRect(corner.x - half, corner.y - half, handleSize, handleSize);
    ctx.strokeRect(corner.x - half, corner.y - half, handleSize, handleSize);
  });
  ctx.restore();
};

const drawRotationHandle = (item, transform) => {
  const handle = getRotationHandle(item, transform);
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#0ea5e9";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const drawItem = (item, transform, viewSize) => {
  const center = roomToScreen({ x: item.x, y: item.y }, transform);
  const width = item.w * transform.scale;
  const height = item.h * transform.scale;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(toRadians(item.rotation));
  ctx.fillStyle = item.color;
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 1;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.strokeRect(-width / 2, -height / 2, width, height);

  if (item.id === selectedId) {
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 2;
    ctx.strokeRect(-width / 2 - 4, -height / 2 - 4, width + 8, height + 8);
    ctx.setLineDash([]);
  }
  ctx.restore();

  if (item.id === selectedId) {
    drawResizeHandles(item, transform);
    drawRotationHandle(item, transform);
  }
};

const distancePointToSegment = (point, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy);
  const clamped = clamp(t, 0, 1);
  const proj = { x: a.x + clamped * dx, y: a.y + clamped * dy };
  return Math.hypot(point.x - proj.x, point.y - proj.y);
};

const drawMeasurements = (item, transform, viewSize) => {
  if (!settings.showMeasures) return;
  const unit = room.unit || "cm";
  const center = { x: item.x, y: item.y };
  if (!room.points || room.points.length < 2) return;
  const segments = room.points.map((point, index) => {
    const next = room.points[(index + 1) % room.points.length];
    return [point, next];
  });
  let minWallDistance = Infinity;
  let closestSegment = null;
  segments.forEach(([a, b]) => {
    const d = distancePointToSegment(center, a, b);
    if (d < minWallDistance) {
      minWallDistance = d;
      closestSegment = [a, b];
    }
  });

  if (closestSegment) {
    const [a, b] = closestSegment;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const centerScreen = roomToScreen(center, transform);
    const midScreen = roomToScreen(mid, transform);
    ctx.save();
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(centerScreen.x, centerScreen.y);
    ctx.lineTo(midScreen.x, midScreen.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    drawText(
      `${Math.round(minWallDistance)} ${unit}`,
      (centerScreen.x + midScreen.x) / 2,
      (centerScreen.y + midScreen.y) / 2,
      viewSize,
      { align: "center", baseline: "middle" }
    );
  }

  let nearest = null;
  let nearestDistance = Infinity;
  const itemBox = getItemAABB(item);
  items.forEach((other) => {
    if (other.id === item.id) return;
    const otherBox = getItemAABB(other);
    const dx = Math.max(0, Math.max(otherBox.minX - itemBox.maxX, itemBox.minX - otherBox.maxX));
    const dy = Math.max(0, Math.max(otherBox.minY - itemBox.maxY, itemBox.minY - otherBox.maxY));
    const dist = Math.hypot(dx, dy);
    if (dist < nearestDistance) {
      nearestDistance = dist;
      nearest = other;
    }
  });

  if (nearest && nearestDistance < Infinity) {
    const otherCenter = { x: nearest.x, y: nearest.y };
    const a = roomToScreen(center, transform);
    const b = roomToScreen(otherCenter, transform);
    ctx.save();
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    drawText(`${Math.round(nearestDistance)} ${unit}`, (a.x + b.x) / 2, (a.y + b.y) / 2, viewSize, {
      align: "center",
      baseline: "middle",
    });
  }
};

const draw = () => {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = getViewSize();
  if (!width || !height) return;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const transform = getRoomTransform();
  drawRoom(transform);
  drawRoomDimensions(transform, { width, height });
  items.forEach((item) => drawItem(item, transform, { width, height }));
  items.forEach((item) => drawSwingArc(item, transform));
  items.forEach((item) => drawItemAnnotations(item, transform, { width, height }));
  const selected = items.find((entry) => entry.id === selectedId);
  if (selected) drawMeasurements(selected, transform, { width, height });
};

const pickItem = (roomPoint) => {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    const angle = toRadians(-item.rotation);
    const dx = roomPoint.x - item.x;
    const dy = roomPoint.y - item.y;
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
    if (Math.abs(localX) <= item.w / 2 && Math.abs(localY) <= item.h / 2) {
      return item;
    }
  }
  return null;
};

const pickResizeHandle = (item, screenPoint, transform) => {
  const handleRadius = 14;
  const corners = getItemCorners(item, transform);
  for (const corner of corners) {
    const dx = screenPoint.x - corner.x;
    const dy = screenPoint.y - corner.y;
    if (Math.hypot(dx, dy) <= handleRadius) return corner.key;
  }
  return null;
};

const pickRotationHandle = (item, screenPoint, transform) => {
  const handle = getRotationHandle(item, transform);
  const dx = screenPoint.x - handle.x;
  const dy = screenPoint.y - handle.y;
  return Math.hypot(dx, dy) <= 12;
};

const applyMarkdown = (skipHistory = false) => {
  const { roomData, rawItems } = parseMarkdown(mdInput.value);
  room.unit = roomData.unit;
  room.points = roomData.points;

  const bounds = getRoomBounds();
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  items = rawItems.map((raw) => buildItem(raw, center));
  room.items = items;
  selectedId = null;
  updatePointsTextarea();
  draw();
  if (!skipHistory) pushHistory();
};

const buildMarkdown = () => {
  const lines = ["# Room", `unit: ${room.unit || "cm"}`, "", "points:"];
  room.points.forEach((point) => {
    lines.push(`- ${point.x},${point.y}`);
  });
  lines.push("", "items:");
  items.forEach((item) => {
    lines.push(`- type: ${item.type}`);
    lines.push(`  label: ${item.label}`);
    lines.push(`  x: ${Math.round(item.x * 10) / 10}`);
    lines.push(`  y: ${Math.round(item.y * 10) / 10}`);
    lines.push(`  w: ${Math.round(item.w * 10) / 10}`);
    lines.push(`  h: ${Math.round(item.h * 10) / 10}`);
    if (item.pivot) lines.push(`  pivot: ${item.pivot}`);
    lines.push(`  rotation: ${Math.round(item.rotation)}`);
  });
  return lines.join("\n");
};

const exportMarkdown = () => {
  mdInput.value = buildMarkdown();
};

const addItem = (type) => {
  const bounds = getRoomBounds();
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const item = buildItem({ type }, center);
  items.push(item);
  selectedId = item.id;
  draw();
  pushHistory();
};

const addPreset = (preset) => {
  const bounds = getRoomBounds();
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const item = buildItem(
    {
      type: preset.type,
      label: preset.label,
      w: preset.w,
      h: preset.h,
      rotation: preset.rotation ?? 0,
      color: preset.color,
      pivot: preset.pivot,
    },
    center
  );
  items.push(item);
  selectedId = item.id;
  draw();
  pushHistory();
};

const addCustomItem = () => {
  const label = document.getElementById("customLabel").value.trim();
  const w = parseNumber(document.getElementById("customWidth").value);
  const h = parseNumber(document.getElementById("customHeight").value);
  const color = document.getElementById("customColor").value.trim();
  if (!w || !h) return;

  const size = applyMinSize(w, h);
  const bounds = getRoomBounds();
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const item = buildItem(
    { type: "custom", label: label || "Objet", w: size.w, h: size.h, color },
    center
  );
  items.push(item);
  selectedId = item.id;
  draw();
  pushHistory();
};

const saveCustomPreset = () => {
  const label = document.getElementById("customLabel").value.trim() || "Objet";
  const w = parseNumber(document.getElementById("customWidth").value);
  const h = parseNumber(document.getElementById("customHeight").value);
  const color = document.getElementById("customColor").value.trim();
  const categoryName = document.getElementById("customCategory").value.trim() || "Perso";
  if (!w || !h) return;
  const size = applyMinSize(w, h);
  let category = library.find((entry) => entry.label.toLowerCase() === categoryName.toLowerCase());
  if (!category) {
    category = { id: `cat-${Date.now()}`, label: categoryName, presets: [] };
    library.push(category);
  }
  category.presets.push({
    id: `preset-${Date.now()}`,
    label,
    type: "custom",
    w: size.w,
    h: size.h,
    color,
  });
  saveLibrary();
  renderLibrary();
};

const rotateSelected = (delta) => {
  const item = items.find((entry) => entry.id === selectedId);
  if (!item) return;
  item.rotation = (item.rotation + delta + 360) % 360;
  draw();
  pushHistory();
};

const deleteSelected = () => {
  if (!selectedId) return;
  items = items.filter((entry) => entry.id !== selectedId);
  room.items = items;
  selectedId = null;
  draw();
  pushHistory();
};

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const exportJson = () => {
  const blob = new Blob([JSON.stringify(getSerializableState(), null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, "plan.json");
};

const importJson = (file) => {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      restoreFromSnapshot(parsed);
      pushHistory();
    } catch {
      // ignore invalid files
    }
  };
  reader.readAsText(file);
};

const exportPng = () => {
  const link = document.createElement("a");
  link.download = "plan.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
};

const buildSvg = () => {
  const bounds = getRoomBounds();
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const roomPoints = room.points.map((point) => `${point.x - bounds.minX},${point.y - bounds.minY}`).join(" ");

  const itemRects = items
    .map((item) => {
      const x = item.x - bounds.minX;
      const y = item.y - bounds.minY;
      const rectX = x - item.w / 2;
      const rectY = y - item.h / 2;
      const rotate = item.rotation ? ` transform="rotate(${item.rotation} ${x} ${y})"` : "";
      return `<rect x="${rectX}" y="${rectY}" width="${item.w}" height="${item.h}" fill="${item.color}" stroke="#111827"${rotate} />`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <polygon points="${roomPoints}" fill="#f9fafb" stroke="#111827" stroke-width="2" />
  ${itemRects}
</svg>`;
};

const exportSvg = () => {
  const svg = buildSvg();
  const blob = new Blob([svg], { type: "image/svg+xml" });
  downloadBlob(blob, "plan.svg");
};

const initializeApp = () => {
  library = loadLibrary();
  const saved = loadState();
  if (saved && saved.rooms && saved.rooms.length) {
    restoreFromSnapshot(saved);
    historyStack = [JSON.stringify(getSerializableState())];
    redoStack = [];
    updateUndoRedoButtons();
    return;
  }

  mdInput.value = defaultMd;
  applyMarkdown(true);
  rooms = [
    {
      id: makeRoomId(),
      name: "Pièce 1",
      unit: room.unit || "cm",
      points: room.points,
      items,
    },
  ];
  activeRoomId = rooms[0].id;
  room = rooms[0];
  renderLibrary();
  renderRoomTabs();
  syncRoomInputs();
  updateOptionsUI();
  pushHistory();
  draw();
};

initializeApp();

document.getElementById("applyMd").addEventListener("click", applyMarkdown);
document.getElementById("exportMd").addEventListener("click", exportMarkdown);
document.getElementById("resetMd").addEventListener("click", () => {
  mdInput.value = defaultMd;
  applyMarkdown();
});

document.querySelectorAll(".addBtn").forEach((button) => {
  button.addEventListener("click", () => addItem(button.dataset.type));
});

document.getElementById("rotateLeft").addEventListener("click", () => rotateSelected(-90));
document.getElementById("rotateRight").addEventListener("click", () =>
  rotateSelected(90)
);
document.getElementById("deleteItem").addEventListener("click", deleteSelected);
document.getElementById("addCustom").addEventListener("click", addCustomItem);
document.getElementById("savePreset").addEventListener("click", saveCustomPreset);
document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("redoBtn").addEventListener("click", redo);
document.getElementById("exportJson").addEventListener("click", exportJson);
document.getElementById("exportPng").addEventListener("click", exportPng);
document.getElementById("exportSvg").addEventListener("click", exportSvg);
document.getElementById("addRoom").addEventListener("click", addRoom);

document.getElementById("importJson").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) importJson(file);
  event.target.value = "";
});

document.getElementById("snapToggle").addEventListener("change", (event) => {
  settings.snap = event.target.checked;
  pushHistory();
});
document.getElementById("collisionToggle").addEventListener("change", (event) => {
  settings.avoidOverlap = event.target.checked;
  pushHistory();
});
document.getElementById("measureToggle").addEventListener("change", (event) => {
  settings.showMeasures = event.target.checked;
  draw();
  pushHistory();
});

document.getElementById("zoomIn").addEventListener("click", () => {
  setZoom(settings.zoom * 1.1);
});
document.getElementById("zoomOut").addEventListener("click", () => {
  setZoom(settings.zoom / 1.1);
});
document.getElementById("zoomReset").addEventListener("click", () => {
  setZoom(1);
});
document.getElementById("zoomRange").addEventListener("input", (event) => {
  setZoom(parseNumber(event.target.value) ?? 1);
});

document.getElementById("roomName").addEventListener("input", (event) => {
  room.name = event.target.value.trim() || "Pièce";
  renderRoomTabs();
  pushHistory();
});

document.getElementById("addPoint").addEventListener("click", () => {
  const x = parseNumber(document.getElementById("pointX").value);
  const y = parseNumber(document.getElementById("pointY").value);
  if (x === null || y === null) return;
  room.points.push({ x, y });
  updatePointsTextarea();
  draw();
  pushHistory();
});

document.getElementById("removePoint").addEventListener("click", () => {
  room.points.pop();
  updatePointsTextarea();
  draw();
  pushHistory();
});

document.getElementById("applyPoints").addEventListener("click", () => {
  const points = parsePointsTextarea();
  if (!points || points.length < 3) return;
  room.points = points;
  updatePointsTextarea();
  draw();
  pushHistory();
});

canvas.addEventListener("mousedown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const transform = getRoomTransform();
  const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const roomPoint = screenToRoom(screenPoint, transform);
  const selectedItem = items.find((entry) => entry.id === selectedId);
  const hit = pickItem(roomPoint);

  if (event.altKey && hit) {
    selectedId = hit.id;
    rotateState = {
      id: hit.id,
      center: { x: hit.x, y: hit.y },
    };
    isAltRotating = true;
    isDragging = false;
    isResizing = false;
    interactionSnapshot = JSON.stringify(getSerializableState());
    draw();
    return;
  }

  if (selectedItem && pickRotationHandle(selectedItem, screenPoint, transform)) {
    rotateState = {
      id: selectedItem.id,
      center: { x: selectedItem.x, y: selectedItem.y },
    };
    isRotating = true;
    isDragging = false;
    interactionSnapshot = JSON.stringify(getSerializableState());
    draw();
    return;
  }
  if (selectedItem) {
    const handleKey = pickResizeHandle(selectedItem, screenPoint, transform);
    if (handleKey) {
      const signX = handleKey.includes("w") ? -1 : 1;
      const signY = handleKey.includes("n") ? -1 : 1;
      const minSize = 5;
      const minW = minSize;
      const minH = minSize;
      resizeState = {
        id: selectedItem.id,
        startCenter: { x: selectedItem.x, y: selectedItem.y },
        startW: selectedItem.w,
        startH: selectedItem.h,
        rotation: selectedItem.rotation,
        anchorLocal: { x: -signX * selectedItem.w / 2, y: -signY * selectedItem.h / 2 },
        minW,
        minH,
        signX,
        signY,
        lastValid: {
          w: selectedItem.w,
          h: selectedItem.h,
          x: selectedItem.x,
          y: selectedItem.y,
        },
      };
      isResizing = true;
      isDragging = false;
      interactionSnapshot = JSON.stringify(getSerializableState());
      draw();
      return;
    }
  }

  if (hit) {
    selectedId = hit.id;
    isDragging = true;
    dragOffset = { x: roomPoint.x - hit.x, y: roomPoint.y - hit.y };
    dragState = { lastValidPosition: { x: hit.x, y: hit.y } };
    interactionSnapshot = JSON.stringify(getSerializableState());
  } else {
    selectedId = null;
  }
  draw();
});

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const transform = getRoomTransform();
  const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const roomPoint = screenToRoom(screenPoint, transform);
  const item = items.find((entry) => entry.id === selectedId);
  if (!item) return;

  if (isAltRotating && rotateState && item.id === rotateState.id) {
    const angle = Math.atan2(roomPoint.y - rotateState.center.y, roomPoint.x - rotateState.center.x);
    const degrees = (Math.round((angle * 180) / Math.PI) + 360) % 360;
    item.rotation = snapAngle(degrees, item);
    draw();
    return;
  }

  if (isRotating && rotateState && item.id === rotateState.id) {
    const angle = Math.atan2(roomPoint.y - rotateState.center.y, roomPoint.x - rotateState.center.x);
    const degrees = (Math.round((angle * 180) / Math.PI) + 360) % 360;
    item.rotation = snapAngle(degrees, item);
    draw();
    return;
  }

  if (isResizing && resizeState && item.id === resizeState.id) {
    const angle = toRadians(resizeState.rotation);
    const local = rotatePoint(
      { x: roomPoint.x - resizeState.startCenter.x, y: roomPoint.y - resizeState.startCenter.y },
      -angle
    );
    const anchor = resizeState.anchorLocal;
    let localX = local.x;
    let localY = local.y;
    if (resizeState.signX * (localX - anchor.x) < resizeState.minW) {
      localX = anchor.x + resizeState.signX * resizeState.minW;
    }
    if (resizeState.signY * (localY - anchor.y) < resizeState.minH) {
      localY = anchor.y + resizeState.signY * resizeState.minH;
    }
    const newW = Math.abs(localX - anchor.x);
    const newH = Math.abs(localY - anchor.y);
    const newCenterLocal = { x: (anchor.x + localX) / 2, y: (anchor.y + localY) / 2 };
    const newCenterRoom = rotatePoint(newCenterLocal, angle);
    const nextPos = {
      x: resizeState.startCenter.x + newCenterRoom.x,
      y: resizeState.startCenter.y + newCenterRoom.y,
    };
    if (settings.avoidOverlap && overlapsAny(item, nextPos, { w: newW, h: newH })) {
      item.w = resizeState.lastValid.w;
      item.h = resizeState.lastValid.h;
      item.x = resizeState.lastValid.x;
      item.y = resizeState.lastValid.y;
    } else {
      item.w = newW;
      item.h = newH;
      item.x = nextPos.x;
      item.y = nextPos.y;
      resizeState.lastValid = { w: item.w, h: item.h, x: item.x, y: item.y };
    }
    draw();
    return;
  }

  if (isDragging && selectedId) {
    const proposed = {
      x: roomPoint.x - dragOffset.x,
      y: roomPoint.y - dragOffset.y,
    };
    const snapped = applySnapping(item, proposed);
    const nextPos = settings.avoidOverlap && overlapsAny(item, snapped) && dragState
      ? dragState.lastValidPosition
      : snapped;
    item.x = nextPos.x;
    item.y = nextPos.y;
    if (!settings.avoidOverlap || !overlapsAny(item, snapped)) {
      if (dragState) dragState.lastValidPosition = { x: item.x, y: item.y };
    }
    draw();
    return;
  }

  if (item.id === selectedId) {
    if (pickRotationHandle(item, screenPoint, transform)) {
      canvas.style.cursor = "grab";
      return;
    }
    const handleKey = pickResizeHandle(item, screenPoint, transform);
    if (handleKey) {
      canvas.style.cursor =
        handleKey === "nw" || handleKey === "se" ? "nwse-resize" : "nesw-resize";
      return;
    }
  }

  canvas.style.cursor = "default";
});

const stopDrag = () => {
  isDragging = false;
  isResizing = false;
  resizeState = null;
  isRotating = false;
  rotateState = null;
  isAltRotating = false;
  dragState = null;
  canvas.style.cursor = "default";
  if (interactionSnapshot && interactionSnapshot !== JSON.stringify(getSerializableState())) {
    pushHistory();
  }
  interactionSnapshot = null;
};

canvas.addEventListener("mouseup", stopDrag);
canvas.addEventListener("mouseleave", stopDrag);

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.08 : 0.92;
  setZoom(settings.zoom * factor);
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const transform = getRoomTransform();
  const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const roomPoint = screenToRoom(screenPoint, transform);
  const hit = pickItem(roomPoint);
  if (!hit) return;
  if (hit.type === "door" || hit.type === "window") {
    hit.pivot = getNextPivot(hit.pivot || "left");
    selectedId = hit.id;
    draw();
  }
});

window.addEventListener("keydown", (event) => {
  const isInput =
    event.target.tagName === "TEXTAREA" || event.target.tagName === "INPUT";
  if (event.ctrlKey && !isInput) {
    if (event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
    }
    if (event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    }
  }
  if (!isInput && (event.key === "Delete" || event.key === "Backspace")) {
    deleteSelected();
  }
});

window.addEventListener("resize", draw);
