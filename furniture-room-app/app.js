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
let selectedId = null;
let isDragging = false;
let isResizing = false;
let isRotating = false;
let dragOffset = { x: 0, y: 0 };
let resizeState = null;
let rotateState = null;
let idCounter = 1;

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
  return {
    id: makeId(),
    type,
    label: raw.label || raw.name || preset.label || type,
    x: parseNumber(raw.x) ?? center.x,
    y: parseNumber(raw.y) ?? center.y,
    w: parseNumber(raw.w) ?? preset.w,
    h: parseNumber(raw.h) ?? preset.h,
    rotation: parseNumber(raw.rotation) ?? 0,
    color: raw.color || preset.color,
    pivot,
  };
};

const getRoomBounds = () => {
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
  const scale = Math.min(
    (width - pad * 2) / roomWidth,
    (height - pad * 2) / roomHeight
  );
  return {
    scale,
    offsetX: pad - bounds.minX * scale,
    offsetY: pad - bounds.minY * scale,
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

const rotatePoint = (point, angleRad) => ({
  x: point.x * Math.cos(angleRad) - point.y * Math.sin(angleRad),
  y: point.x * Math.sin(angleRad) + point.y * Math.cos(angleRad),
});

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
  const halfH = item.h / 2;
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

const applyMarkdown = () => {
  const { roomData, rawItems } = parseMarkdown(mdInput.value);
  room = roomData;

  const bounds = getRoomBounds();
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  items = rawItems.map((raw) => buildItem(raw, center));
  selectedId = null;
  draw();
};

const exportMarkdown = () => {
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
  mdInput.value = lines.join("\n");
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
};

const rotateSelected = (delta) => {
  const item = items.find((entry) => entry.id === selectedId);
  if (!item) return;
  item.rotation = (item.rotation + delta + 360) % 360;
  draw();
};

const deleteSelected = () => {
  if (!selectedId) return;
  items = items.filter((entry) => entry.id !== selectedId);
  selectedId = null;
  draw();
};

mdInput.value = defaultMd;
applyMarkdown();

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

canvas.addEventListener("mousedown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const transform = getRoomTransform();
  const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const roomPoint = screenToRoom(screenPoint, transform);
  const selectedItem = items.find((entry) => entry.id === selectedId);
  if (selectedItem && pickRotationHandle(selectedItem, screenPoint, transform)) {
    rotateState = {
      id: selectedItem.id,
      center: { x: selectedItem.x, y: selectedItem.y },
    };
    isRotating = true;
    isDragging = false;
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
      };
      isResizing = true;
      isDragging = false;
      draw();
      return;
    }
  }

  const hit = pickItem(roomPoint);
  if (hit) {
    selectedId = hit.id;
    isDragging = true;
    dragOffset = { x: roomPoint.x - hit.x, y: roomPoint.y - hit.y };
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

  if (isRotating && rotateState && item.id === rotateState.id) {
    const angle = Math.atan2(roomPoint.y - rotateState.center.y, roomPoint.x - rotateState.center.x);
    const degrees = (Math.round((angle * 180) / Math.PI) + 360) % 360;
    item.rotation = degrees;
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
    item.w = newW;
    item.h = newH;
    item.x = resizeState.startCenter.x + newCenterRoom.x;
    item.y = resizeState.startCenter.y + newCenterRoom.y;
    draw();
    return;
  }

  if (isDragging && selectedId) {
    item.x = roomPoint.x - dragOffset.x;
    item.y = roomPoint.y - dragOffset.y;
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
  canvas.style.cursor = "default";
};

canvas.addEventListener("mouseup", stopDrag);
canvas.addEventListener("mouseleave", stopDrag);

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
  if (event.key === "Delete" || event.key === "Backspace") {
    deleteSelected();
  }
});

window.addEventListener("resize", draw);
