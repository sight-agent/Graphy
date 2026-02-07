const canvas = document.getElementById("graphCanvas");
const ctx = canvas.getContext("2d");
const container = document.getElementById("canvasContainer");

const imageInput = document.getElementById("imageInput");
const jsonInput = document.getElementById("jsonInput");
const imageNameEl = document.getElementById("imageName");
const imageSizeEl = document.getElementById("imageSize");
const fitViewBtn = document.getElementById("fitView");
const clearProjectBtn = document.getElementById("clearProject");

const pathsListEl = document.getElementById("pathsList");
const statusText = document.getElementById("statusText");
const statsEl = document.getElementById("stats");
const toastContainer = document.getElementById("toastContainer");
const nodeLabelEditor = document.getElementById("nodeLabelEditor");

const exportJsonBtn = document.getElementById("exportJson");
const exportPngBtn = document.getElementById("exportPng");
const pngModeSelect = document.getElementById("pngMode");
const imageOpacityInput = document.getElementById("imageOpacity");

const NODE_RADIUS = 10;
const EDGE_HIT_TOL = 7;
const EDGE_WIDTH = 2;
const PATH_WIDTH = 4;
const ACTIVE_PATH_WIDTH = 5;
const HOVER_RING = 14;
const MAP_FONT_SCALE = 1.5;

const PATH_COLORS = [
  "#2a9d8f",
  "#ef6f4a",
  "#1d3557",
  "#8d5b4c",
  "#457b9d",
];

const state = {
  image: null,
  expectedImage: null,
  projectLoadedFromJson: false,
  nodes: [],
  edges: [],
  paths: [],
  selectedNodeId: null,
  activePathId: null,
  activeAppendEnd: null,
  draftPathId: null,
  protectedNodeSet: new Set(),
  protectedEdgeSet: new Set(),
  hoveredNodeId: null,
  hoveredEdgeKey: null,
  viewport: {
    scale: 1,
    panX: 0,
    panY: 0,
  },
  imageOpacity: 1,
  undoStack: [],
  redoStack: [],
  nodeCounter: 1,
  pathCounter: 1,
};

let dpr = window.devicePixelRatio || 1;
let isPanning = false;
let panStart = null;
let panReady = false;
let dragNodeId = null;
let dragMoved = false;
let dragSnapshot = null;
let suppressClick = false;
let spaceDown = false;
let editingNodeId = null;
let lastPointerPos = { x: 0, y: 0 };

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  render();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function setStatus(message) {
  statusText.textContent = message;
}

function updateStats() {
  statsEl.textContent = `Nodes: ${state.nodes.length} · Edges: ${state.edges.length}`;
}

function syncImageOpacityUi() {
  const percent = Math.round(state.imageOpacity * 100);
  imageOpacityInput.value = String(percent);
}

function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function getNodeById(id) {
  return state.nodes.find((node) => node.id === id);
}

function getPathById(pathId) {
  return state.paths.find((path) => path.pathId === pathId);
}

function getNodeDisplayName(nodeId) {
  const node = getNodeById(nodeId);
  if (!node) return nodeId;
  const label = (node.label || "").trim();
  return label || node.id;
}

function getPathDisplayNodeIds(path) {
  const ids = [...path.nodeIds];
  if (
    state.activePathId === path.pathId &&
    state.activeAppendEnd &&
    state.activeAppendEnd.pathId === path.pathId &&
    state.activeAppendEnd.endIndex === 0
  ) {
    return ids.reverse();
  }
  return ids;
}

function findEdge(a, b) {
  const key = edgeKey(a, b);
  return state.edges.find((edge) => edgeKey(edge.a, edge.b) === key);
}

function parseWeightValue(raw) {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const fraction = trimmed.match(/^1\/(\d+)$/);
    if (fraction) {
      const denom = Number(fraction[1]);
      if (denom >= 2) return 1 / denom;
    }
    const numberFromString = Number(trimmed);
    if (Number.isFinite(numberFromString) && numberFromString > 0) return numberFromString;
    return 1;
  }
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 1;
}

function normalizeWeightValue(raw) {
  const value = parseWeightValue(raw);
  if (value >= 1) return Math.max(1, Math.round(value));
  const denom = Math.max(2, Math.round(1 / value));
  return 1 / denom;
}

function normalizeEdge(edge) {
  return {
    a: edge.a,
    b: edge.b,
    weight: normalizeWeightValue(edge.weight),
  };
}

function getEdgeWeight(a, b) {
  const edge = findEdge(a, b);
  return edge ? edge.weight : 1;
}

function formatWeightLabel(weight) {
  if (weight < 1) {
    return `1/${Math.round(1 / weight)}`;
  }
  return String(Math.round(weight));
}

function stepEdgeWeight(currentWeight, direction) {
  const weight = normalizeWeightValue(currentWeight);
  if (direction < 0) {
    if (weight > 1) return weight - 1;
    const denom = Math.round(1 / weight);
    return 1 / (denom + 1);
  }
  if (direction > 0) {
    if (weight < 1) {
      const denom = Math.round(1 / weight) - 1;
      if (denom <= 1) return 1;
      return 1 / denom;
    }
    return weight + 1;
  }
  return weight;
}

function createNodeId() {
  let id = `N${state.nodeCounter}`;
  while (state.nodes.some((node) => node.id === id)) {
    state.nodeCounter += 1;
    id = `N${state.nodeCounter}`;
  }
  state.nodeCounter += 1;
  return id;
}

function createPathId() {
  let id = `P${state.pathCounter}`;
  while (state.paths.some((path) => path.pathId === id)) {
    state.pathCounter += 1;
    id = `P${state.pathCounter}`;
  }
  state.pathCounter += 1;
  return id;
}

function rebuildProtectedSets() {
  state.protectedNodeSet = new Set();
  state.protectedEdgeSet = new Set();
  state.paths.forEach((path) => {
    path.nodeIds.forEach((nodeId) => state.protectedNodeSet.add(nodeId));
    for (let i = 0; i < path.nodeIds.length - 1; i += 1) {
      state.protectedEdgeSet.add(edgeKey(path.nodeIds[i], path.nodeIds[i + 1]));
    }
  });
}

function getPathsUsingNode(nodeId) {
  return state.paths.filter((path) => path.nodeIds.includes(nodeId));
}

function getPathsUsingEdge(edgeKeyToCheck) {
  return state.paths.filter((path) => {
    for (let i = 0; i < path.nodeIds.length - 1; i += 1) {
      if (edgeKey(path.nodeIds[i], path.nodeIds[i + 1]) === edgeKeyToCheck) {
        return true;
      }
    }
    return false;
  });
}

function captureSnapshot() {
  return {
    nodes: structuredClone(state.nodes),
    edges: structuredClone(state.edges),
    paths: structuredClone(state.paths),
    selectedNodeId: state.selectedNodeId,
    activePathId: state.activePathId,
    activeAppendEnd: state.activeAppendEnd ? { ...state.activeAppendEnd } : null,
    draftPathId: state.draftPathId,
  };
}

function pushSnapshot(snapshot) {
  state.undoStack.push(snapshot);
  state.redoStack.length = 0;
  updateUndoRedoButtons();
}

function saveSnapshot() {
  pushSnapshot(captureSnapshot());
}

function applySnapshot(snapshot) {
  state.nodes = structuredClone(snapshot.nodes);
  state.edges = structuredClone(snapshot.edges).map(normalizeEdge);
  state.paths = structuredClone(snapshot.paths);
  state.selectedNodeId = snapshot.selectedNodeId;
  state.activePathId = snapshot.activePathId;
  state.activeAppendEnd = snapshot.activeAppendEnd ? { ...snapshot.activeAppendEnd } : null;
  state.draftPathId = snapshot.draftPathId;
  rebuildProtectedSets();
  updatePathsList();
  updateStats();
  updateOverlay();
  render();
}

function undo() {
  if (state.undoStack.length === 0) return;
  const snapshot = state.undoStack.pop();
  const current = captureSnapshot();
  state.redoStack.push(current);
  applySnapshot(snapshot);
  updateUndoRedoButtons();
}

function redo() {
  if (state.redoStack.length === 0) return;
  const snapshot = state.redoStack.pop();
  const current = captureSnapshot();
  state.undoStack.push(current);
  applySnapshot(snapshot);
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {}

function resetProject() {
  state.nodes = [];
  state.edges = [];
  state.paths = [];
  state.selectedNodeId = null;
  state.activePathId = null;
  state.activeAppendEnd = null;
  state.draftPathId = null;
  state.undoStack = [];
  state.redoStack = [];
  state.nodeCounter = 1;
  state.pathCounter = 1;
  state.imageOpacity = 1;
  state.projectLoadedFromJson = false;
  state.expectedImage = null;
  rebuildProtectedSets();
  updatePathsList();
  updateUndoRedoButtons();
  syncImageOpacityUi();
  updateStats();
  render();
}

function setImage(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      state.image = {
        dataUrl: reader.result,
        width: img.width,
        height: img.height,
        name: file.name,
        img,
      };
      imageNameEl.textContent = file.name;
      imageSizeEl.textContent = `${img.width} x ${img.height}`;
      if (state.expectedImage) {
        const matches =
          state.expectedImage.width === img.width && state.expectedImage.height === img.height;
        if (!matches) {
          showToast(
            `Warning: image size ${img.width}x${img.height} does not match JSON ${state.expectedImage.width}x${state.expectedImage.height}.`,
            "error",
          );
        }
      }
      if (!state.projectLoadedFromJson) {
        resetProject();
      }
      fitToView();
      setStatus("Image loaded. Create nodes with left click.");
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function computeNextCounter(ids, prefix) {
  let max = 0;
  ids.forEach((id) => {
    const match = id.match(new RegExp(`^${prefix}(\\d+)$`));
    if (match) {
      const value = Number(match[1]);
      if (value > max) max = value;
    }
  });
  return max + 1;
}

function loadProjectFromJson(payload) {
  if (!payload || !payload.imageWidth || !payload.imageHeight) {
    showToast("Invalid JSON: missing imageWidth/imageHeight.", "error");
    return;
  }
  state.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  state.edges = Array.isArray(payload.edges) ? payload.edges.map(normalizeEdge) : [];
  state.paths = Array.isArray(payload.paths) ? payload.paths : [];
  state.selectedNodeId = null;
  state.activePathId = null;
  state.activeAppendEnd = null;
  state.draftPathId = null;
  state.undoStack = [];
  state.redoStack = [];
  state.nodeCounter = computeNextCounter(state.nodes.map((n) => n.id), "N");
  state.pathCounter = computeNextCounter(state.paths.map((p) => p.pathId), "P");
  state.expectedImage = { width: payload.imageWidth, height: payload.imageHeight };
  state.projectLoadedFromJson = true;
  rebuildProtectedSets();
  updatePathsList();
  updateUndoRedoButtons();
  imageNameEl.textContent = state.image ? state.image.name : "(no image loaded)";
  imageSizeEl.textContent = `${payload.imageWidth} x ${payload.imageHeight}`;
  updateOverlay();
  render();
  setStatus(
    state.image ? "Project imported from JSON." : "Project imported from JSON. Import an image to continue.",
  );
}

function fitToView() {
  if (!state.image) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / state.image.width;
  const scaleY = rect.height / state.image.height;
  state.viewport.scale = Math.min(scaleX, scaleY) * 0.95;
  state.viewport.panX = (rect.width - state.image.width * state.viewport.scale) / 2;
  state.viewport.panY = (rect.height - state.image.height * state.viewport.scale) / 2;
  render();
}

function clearProjectData() {
  saveSnapshot();
  state.nodes = [];
  state.edges = [];
  state.paths = [];
  state.selectedNodeId = null;
  state.activePathId = null;
  state.activeAppendEnd = null;
  state.draftPathId = null;
  state.nodeCounter = 1;
  state.pathCounter = 1;
  state.projectLoadedFromJson = false;
  state.expectedImage = null;
  rebuildProtectedSets();
  updatePathsList();
  updateUndoRedoButtons();
  updateStats();
  render();
  setStatus("Project cleared. Image preserved.");
}

function screenToWorld(screenX, screenY) {
  const { scale, panX, panY } = state.viewport;
  return {
    x: (screenX - panX) / scale,
    y: (screenY - panY) / scale,
  };
}

function worldToScreen(worldX, worldY) {
  const { scale, panX, panY } = state.viewport;
  return {
    x: worldX * scale + panX,
    y: worldY * scale + panY,
  };
}

function hitTestNode(screenX, screenY) {
  let found = null;
  for (let i = state.nodes.length - 1; i >= 0; i -= 1) {
    const node = state.nodes[i];
    const pos = worldToScreen(node.x, node.y);
    const dist = Math.hypot(screenX - pos.x, screenY - pos.y);
    if (dist <= NODE_RADIUS) {
      found = node;
      break;
    }
  }
  return found;
}

function distancePointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const projX = x1 + clamped * dx;
  const projY = y1 + clamped * dy;
  return Math.hypot(px - projX, py - projY);
}

function hitTestEdge(screenX, screenY) {
  let found = null;
  let minDist = Infinity;
  state.edges.forEach((edge) => {
    const a = getNodeById(edge.a);
    const b = getNodeById(edge.b);
    if (!a || !b) return;
    const pa = worldToScreen(a.x, a.y);
    const pb = worldToScreen(b.x, b.y);
    const dist = distancePointToSegment(screenX, screenY, pa.x, pa.y, pb.x, pb.y);
    if (dist <= EDGE_HIT_TOL && dist < minDist) {
      minDist = dist;
      found = { edge, key: edgeKey(edge.a, edge.b) };
    }
  });
  return found;
}

function updatePathsList() {
  pathsListEl.innerHTML = "";
  state.paths.forEach((path, index) => {
    const pathItem = document.createElement("div");
    pathItem.className = "path-item";
    if (state.activePathId === path.pathId) {
      pathItem.classList.add("active");
    }

    const controls = document.createElement("div");
    controls.className = "path-controls";

    const eyeBtn = document.createElement("button");
    eyeBtn.className = `icon-button icon-eye ${path.visible ? "active" : ""}`;
    eyeBtn.textContent = path.visible ? "👁️" : "🙈";
    eyeBtn.title = "Show/hide";
    eyeBtn.addEventListener("click", () => {
      saveSnapshot();
      path.visible = !path.visible;
      updatePathsList();
      render();
    });

    const pencilBtn = document.createElement("button");
    pencilBtn.className = `icon-button icon-pencil ${state.activePathId === path.pathId ? "active" : ""}`;
    pencilBtn.textContent = "✏️";
    pencilBtn.title = "Edit";
    pencilBtn.addEventListener("click", () => {
      if (state.activePathId === path.pathId) {
        state.activePathId = null;
        state.activeAppendEnd = null;
      } else {
        state.activePathId = path.pathId;
        state.activeAppendEnd = null;
        state.draftPathId = null;
        state.selectedNodeId = null;
      }
      updatePathsList();
      updateOverlay();
      render();
    });

    controls.appendChild(eyeBtn);
    controls.appendChild(pencilBtn);

    const info = document.createElement("div");
    const labelWrapper = document.createElement("div");
    labelWrapper.className = "path-label";
    labelWrapper.textContent = path.label;
    labelWrapper.addEventListener("dblclick", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.value = path.label;
      labelWrapper.textContent = "";
      labelWrapper.appendChild(input);
      input.focus();
      input.select();

      const commit = () => {
        const newLabel = input.value.trim() || path.pathId;
        if (newLabel !== path.label) {
          saveSnapshot();
          path.label = newLabel;
        }
        updatePathsList();
        render();
      };

      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          commit();
        }
        if (event.key === "Escape") {
          updatePathsList();
        }
      });
    });

    const nodesCount = path.nodeIds.length;
    const edgesCount = Math.max(0, nodesCount - 1);
    const meta = document.createElement("div");
    meta.className = "path-meta";
    meta.textContent = `${nodesCount} nodes · ${edgesCount} edges`;

    const pathString = document.createElement("div");
    pathString.className = "path-string";
    pathString.textContent =
      getPathDisplayNodeIds(path)
        .map((nodeId) => getNodeDisplayName(nodeId))
        .join("-") || "(empty)";

    info.appendChild(labelWrapper);
    info.appendChild(meta);
    info.appendChild(pathString);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-button icon-delete";
    deleteBtn.textContent = "🗑️";
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", () => {
      saveSnapshot();
      state.paths = state.paths.filter((p) => p.pathId !== path.pathId);
      if (state.activePathId === path.pathId) {
        state.activePathId = null;
        state.activeAppendEnd = null;
      }
      if (state.draftPathId === path.pathId) {
        state.draftPathId = null;
      }
      rebuildProtectedSets();
      updatePathsList();
      updateOverlay();
      render();
    });

    controls.appendChild(deleteBtn);

    pathItem.appendChild(info);
    pathItem.appendChild(controls);

    pathsListEl.appendChild(pathItem);
  });

  if (state.paths.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No saved paths.";
    pathsListEl.appendChild(empty);
  }
}

function updateOverlay() {}

function addEdge(a, b) {
  if (a === b) return;
  const existing = findEdge(a, b);
  if (!existing) {
    state.edges.push({ a, b, weight: 1 });
  }
}

function removeEdge(a, b) {
  const key = edgeKey(a, b);
  state.edges = state.edges.filter((edge) => edgeKey(edge.a, edge.b) !== key);
}

function toggleEdge(a, b) {
  const existing = findEdge(a, b);
  if (existing) {
    const key = edgeKey(a, b);
    if (state.protectedEdgeSet.has(key)) {
      const blockers = getPathsUsingEdge(key)
        .map((path) => path.label)
        .join(", ");
      showToast(`Edge used in saved paths: ${blockers}`, "error");
      return false;
    }
    removeEdge(a, b);
    return true;
  }
  addEdge(a, b);
  return true;
}

function buildAdjacency() {
  const adjacency = new Map();
  state.nodes.forEach((node) => adjacency.set(node.id, []));
  state.edges.forEach((edge) => {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a).push({ to: edge.b, weight: edge.weight });
    adjacency.get(edge.b).push({ to: edge.a, weight: edge.weight });
  });
  return adjacency;
}

function shortestPathByWeight(startId, targetId) {
  if (startId === targetId) return [startId];
  const adjacency = buildAdjacency();
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  state.nodes.forEach((node) => dist.set(node.id, Infinity));
  dist.set(startId, 0);

  while (visited.size < state.nodes.length) {
    let current = null;
    let best = Infinity;
    dist.forEach((value, nodeId) => {
      if (!visited.has(nodeId) && value < best) {
        best = value;
        current = nodeId;
      }
    });
    if (!current || best === Infinity) break;
    if (current === targetId) break;
    visited.add(current);

    const neighbors = adjacency.get(current) || [];
    for (const { to, weight } of neighbors) {
      if (visited.has(to)) continue;
      const candidate = dist.get(current) + weight;
      if (candidate < dist.get(to)) {
        dist.set(to, candidate);
        prev.set(to, current);
      }
    }
  }

  if (!Number.isFinite(dist.get(targetId))) return null;
  const path = [];
  let cursor = targetId;
  while (cursor) {
    path.unshift(cursor);
    if (cursor === startId) break;
    cursor = prev.get(cursor);
  }
  return path[0] === startId ? path : null;
}

function applyPathEdit(path, targetId, endIndex) {
  const existingIndex = path.nodeIds.indexOf(targetId);
  if (existingIndex !== -1) {
    if (endIndex === 0) {
      path.nodeIds = path.nodeIds.slice(existingIndex);
    } else {
      path.nodeIds = path.nodeIds.slice(0, existingIndex + 1);
    }
    if (state.activePathId === path.pathId) {
      state.activeAppendEnd = { pathId: path.pathId, endIndex: endIndex === 0 ? 0 : existingIndex };
    }
    return true;
  }

  const endNodeId = path.nodeIds[endIndex];
  const isAdjacent = !!findEdge(endNodeId, targetId);
  let segment = null;
  if (isAdjacent) {
    segment = [endNodeId, targetId];
  } else {
    segment = shortestPathByWeight(endNodeId, targetId);
  }

  if (!segment) {
    showToast(`No path in graph between ${endNodeId} and ${targetId}`, "error");
    return false;
  }

  if (endIndex === 0) {
    const prefix = segment.slice(1).reverse();
    path.nodeIds = [...prefix, ...path.nodeIds];
    if (state.activePathId === path.pathId) {
      state.activeAppendEnd = { pathId: path.pathId, endIndex: 0 };
    }
  } else {
    const trimmed = path.nodeIds.slice(0, endIndex + 1);
    path.nodeIds = [...trimmed, ...segment.slice(1)];
    if (state.activePathId === path.pathId) {
      state.activeAppendEnd = { pathId: path.pathId, endIndex: path.nodeIds.length - 1 };
    }
  }
  return true;
}

function appendAdjacentOnly(path, targetId, endIndex) {
  const endNodeId = path.nodeIds[endIndex];
  if (!findEdge(endNodeId, targetId)) {
    return false;
  }
  if (endIndex === 0) {
    path.nodeIds = [targetId, ...path.nodeIds];
    if (state.activePathId === path.pathId) {
      state.activeAppendEnd = { pathId: path.pathId, endIndex: 0 };
    }
    return true;
  }
  const trimmed = path.nodeIds.slice(0, endIndex + 1);
  path.nodeIds = [...trimmed, targetId];
  if (state.activePathId === path.pathId) {
    state.activeAppendEnd = { pathId: path.pathId, endIndex: path.nodeIds.length - 1 };
  }
  return true;
}

function handleShiftClick(targetNodeId) {
  if (!state.image) return;
  if (state.activePathId) {
    if (!state.activeAppendEnd) {
      showToast("Select an active endpoint before continuing.", "error");
      updateOverlay();
      return;
    }
    const path = getPathById(state.activePathId);
    if (!path) return;
    const snapshot = captureSnapshot();
    const changed = applyPathEdit(path, targetNodeId, state.activeAppendEnd.endIndex);
    if (changed) {
      pushSnapshot(snapshot);
    }
    rebuildProtectedSets();
    updatePathsList();
    render();
    return;
  }

  saveSnapshot();
  const newPath = {
    pathId: createPathId(),
    label: `Path ${state.paths.length + 1}`,
    nodeIds: [targetNodeId],
    visible: true,
  };
  state.paths.push(newPath);
  state.activePathId = newPath.pathId;
  state.activeAppendEnd = { pathId: newPath.pathId, endIndex: 0 };
  state.draftPathId = null;
  rebuildProtectedSets();
  updatePathsList();
  updateOverlay();
  render();
}

function handleLeftClick(event) {
  if (!state.image) return;
  const { x, y } = getPointerPosition(event);
  const hitNode = hitTestNode(x, y);

  if (state.activePathId) {
    const path = getPathById(state.activePathId);
    if (!path) return;

    // Endpoint selection is allowed only once when entering path edit mode.
    if (!state.activeAppendEnd) {
      if (hitNode) {
        const index = path.nodeIds.indexOf(hitNode.id);
        if (index !== -1) {
          const isEndpoint = index === 0 || index === path.nodeIds.length - 1;
          if (!isEndpoint) {
            showToast("Select one of the path endpoints.", "error");
            return;
          }
          state.activeAppendEnd = { pathId: path.pathId, endIndex: index };
          updateOverlay();
          render();
          return;
        }
      }
      showToast("Select one of the path endpoints first.", "error");
      return;
    }

    if (event.shiftKey && hitNode) {
      handleShiftClick(hitNode.id);
      return;
    }

    // Normal click while editing: append only via direct adjacency.
    if (!event.shiftKey) {
      if (!hitNode) return;
      const snapshot = captureSnapshot();
      const changed = appendAdjacentOnly(path, hitNode.id, state.activeAppendEnd.endIndex);
      if (!changed) {
        showToast("Not adjacent. Use Shift+click for shortest path.", "error");
        return;
      }
      pushSnapshot(snapshot);
      rebuildProtectedSets();
      updatePathsList();
      render();
      return;
    }
  }

  if (event.shiftKey && hitNode) {
    handleShiftClick(hitNode.id);
    return;
  }

  if (!hitNode) {
    if (state.activePathId) {
      return;
    }
    const world = screenToWorld(x, y);
    if (world.x < 0 || world.y < 0 || world.x > state.image.width || world.y > state.image.height) {
      return;
    }
    saveSnapshot();
    const id = createNodeId();
    const node = { id, label: id, x: Math.round(world.x), y: Math.round(world.y) };
    state.nodes.push(node);
    if (state.selectedNodeId) {
      toggleEdge(state.selectedNodeId, id);
    }
    state.selectedNodeId = id;
    rebuildProtectedSets();
    updateStats();
    render();
    return;
  }

  if (state.selectedNodeId === null) {
    if (state.activePathId) {
      return;
    }
    state.selectedNodeId = hitNode.id;
    render();
    return;
  }

  if (state.selectedNodeId === hitNode.id) {
    state.selectedNodeId = null;
    render();
    return;
  }

  if (state.activePathId) {
    return;
  }
  const existing = findEdge(state.selectedNodeId, hitNode.id);
  if (existing) {
    state.selectedNodeId = hitNode.id;
    render();
    return;
  }
  const snapshot = captureSnapshot();
  addEdge(state.selectedNodeId, hitNode.id);
  pushSnapshot(snapshot);
  state.selectedNodeId = hitNode.id;
  rebuildProtectedSets();
  render();
}

function handleRightClick(event) {
  if (!state.image) return;
  if (state.activePathId) {
    state.activePathId = null;
    state.activeAppendEnd = null;
    state.selectedNodeId = null;
    updatePathsList();
    updateOverlay();
    render();
    return;
  }
  const { x, y } = getPointerPosition(event);
  const hitNode = hitTestNode(x, y);
  if (hitNode) {
    if (state.protectedNodeSet.has(hitNode.id)) {
      const blockers = getPathsUsingNode(hitNode.id)
        .map((path) => path.label)
        .join(", ");
      showToast(`Node used in saved paths: ${blockers}`, "error");
      return;
    }
    saveSnapshot();
    state.nodes = state.nodes.filter((node) => node.id !== hitNode.id);
    state.edges = state.edges.filter((edge) => edge.a !== hitNode.id && edge.b !== hitNode.id);
    if (state.selectedNodeId === hitNode.id) {
      state.selectedNodeId = null;
    }
    rebuildProtectedSets();
    updateStats();
    updatePathsList();
    render();
    return;
  }

  const hitEdge = hitTestEdge(x, y);
  if (hitEdge) {
    if (state.protectedEdgeSet.has(hitEdge.key)) {
      const blockers = getPathsUsingEdge(hitEdge.key)
        .map((path) => path.label)
        .join(", ");
      showToast(`Edge used in saved paths: ${blockers}`, "error");
      return;
    }
    saveSnapshot();
    removeEdge(hitEdge.edge.a, hitEdge.edge.b);
    rebuildProtectedSets();
    updateStats();
    render();
    return;
  }

  state.selectedNodeId = null;
  render();
}

function getPointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function startNodeLabelEdit(nodeId) {
  const node = getNodeById(nodeId);
  if (!node) return;
  const pos = worldToScreen(node.x, node.y);
  nodeLabelEditor.value = node.label;
  nodeLabelEditor.style.left = `${pos.x + 12}px`;
  nodeLabelEditor.style.top = `${pos.y - 12}px`;
  nodeLabelEditor.classList.remove("hidden");
  nodeLabelEditor.focus();
  nodeLabelEditor.select();
  editingNodeId = nodeId;
}

function commitNodeLabelEdit(apply) {
  if (!editingNodeId) return;
  const node = getNodeById(editingNodeId);
  let changed = false;
  if (apply && node) {
    const newLabel = nodeLabelEditor.value.trim() || node.id;
    if (newLabel !== node.label) {
      saveSnapshot();
      node.label = newLabel;
      changed = true;
    }
  }
  nodeLabelEditor.classList.add("hidden");
  editingNodeId = null;
  if (changed) {
    updatePathsList();
  }
  render();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const rect = canvas.getBoundingClientRect();
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!state.image) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.restore();
    updateStats();
    return;
  }

  ctx.translate(state.viewport.panX, state.viewport.panY);
  ctx.scale(state.viewport.scale, state.viewport.scale);
  ctx.globalAlpha = state.imageOpacity;
  ctx.drawImage(state.image.img, 0, 0);
  ctx.globalAlpha = 1;

  const scale = state.viewport.scale;
  ctx.lineWidth = EDGE_WIDTH / scale;
  ctx.strokeStyle = "#4b5563";
  ctx.beginPath();
  state.edges.forEach((edge) => {
    const a = getNodeById(edge.a);
    const b = getNodeById(edge.b);
    if (!a || !b) return;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  });
  ctx.stroke();

  // Edge weight labels (only when different from default 1)
  ctx.fillStyle = "#334155";
  ctx.font = `${(11 * MAP_FONT_SCALE) / scale}px "Space Grotesk"`;
  state.edges.forEach((edge) => {
    if (edge.weight === 1) return;
    const a = getNodeById(edge.a);
    const b = getNodeById(edge.b);
    if (!a || !b) return;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    ctx.fillText(formatWeightLabel(edge.weight), midX + 4 / scale, midY - 4 / scale);
  });

  // Edge overlays for paths (parallel colored lines)
  const edgePathMap = new Map();
  state.paths.forEach((path, index) => {
    if (!path.visible) return;
    const color = PATH_COLORS[index % PATH_COLORS.length];
    for (let i = 0; i < path.nodeIds.length - 1; i += 1) {
      const key = edgeKey(path.nodeIds[i], path.nodeIds[i + 1]);
      if (!edgePathMap.has(key)) {
        edgePathMap.set(key, []);
      }
      edgePathMap.get(key).push(color);
    }
  });

  edgePathMap.forEach((colors, key) => {
    const [aId, bId] = key.split("|");
    const a = getNodeById(aId);
    const b = getNodeById(bId);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const nx = -dy / len;
    const ny = dx / len;
    const offsetPx = 5;
    const offsetStep = offsetPx / scale;
    const startIndex = -(colors.length - 1) / 2;

    colors.forEach((color, i) => {
      const offset = (startIndex + i) * offsetStep;
      ctx.strokeStyle = color;
      ctx.lineWidth = PATH_WIDTH / scale;
      ctx.beginPath();
      ctx.moveTo(a.x + nx * offset, a.y + ny * offset);
      ctx.lineTo(b.x + nx * offset, b.y + ny * offset);
      ctx.stroke();
    });
  });

  // Paths are rendered via edge overlays to keep thickness consistent.

  // Active path highlight
  if (state.activePathId) {
    const activePath = getPathById(state.activePathId);
    if (activePath && activePath.nodeIds.length > 1) {
      ctx.strokeStyle = "#f4d35e";
      ctx.lineWidth = ACTIVE_PATH_WIDTH / scale;
      ctx.setLineDash([12 / scale, 8 / scale]);
      ctx.beginPath();
      activePath.nodeIds.forEach((nodeId, idx) => {
        const node = getNodeById(nodeId);
        if (!node) return;
        if (idx === 0) ctx.moveTo(node.x, node.y);
        else ctx.lineTo(node.x, node.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Nodes
  state.nodes.forEach((node) => {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    ctx.arc(node.x, node.y, NODE_RADIUS / scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  // Path nodes highlight (active path)
  if (state.activePathId) {
    const activePath = getPathById(state.activePathId);
    if (activePath) {
      const activeSet = new Set(activePath.nodeIds);
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = "#b7e3f7";
      activeSet.forEach((nodeId) => {
        const node = getNodeById(nodeId);
        if (!node) return;
        ctx.beginPath();
        ctx.arc(node.x, node.y, (NODE_RADIUS + 5) / scale, 0, Math.PI * 2);
        ctx.stroke();
      });
    }
  }

  // Selected node highlight
  if (state.selectedNodeId && !state.activePathId) {
    const node = getNodeById(state.selectedNodeId);
    if (node) {
      ctx.strokeStyle = "#ef6f4a";
      ctx.lineWidth = 2 / scale;
      ctx.beginPath();
      ctx.arc(node.x, node.y, HOVER_RING / scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Active append end highlight
  if (state.activeAppendEnd) {
    const path = getPathById(state.activeAppendEnd.pathId);
    if (path) {
      const nodeId = path.nodeIds[state.activeAppendEnd.endIndex];
      const node = getNodeById(nodeId);
      if (node) {
        ctx.strokeStyle = "#f4d35e";
        ctx.lineWidth = 3 / scale;
        ctx.beginPath();
        ctx.arc(node.x, node.y, (NODE_RADIUS + 6) / scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // Node labels
  ctx.fillStyle = "#111827";
  ctx.font = `${(12 * MAP_FONT_SCALE) / scale}px "Space Grotesk"`;
  state.nodes.forEach((node) => {
    if (node.label !== node.id) {
      ctx.fillText(node.label, node.x + 12 / scale, node.y - 12 / scale);
    }
  });

  if (state.hoveredNodeId) {
    const node = getNodeById(state.hoveredNodeId);
    if (node) {
      ctx.fillStyle = "#ef6f4a";
      ctx.fillText(node.id, node.x + 12 / scale, node.y + 18 / scale);
    }
  }

  ctx.restore();
  updateStats();

  // Edge hover tooltip (screen space)
  if (state.hoveredEdgeKey) {
    const paths = getPathsUsingEdge(state.hoveredEdgeKey);
    if (paths.length > 0) {
      const label = paths.map((p) => p.label).join(", ");
      const paddingX = 10;
      const paddingY = 6;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${Math.round(12 * MAP_FONT_SCALE)}px "Space Grotesk"`;
      const textWidth = ctx.measureText(label).width;
      const rectWidth = textWidth + paddingX * 2;
      const rectHeight = 24;
      const x = Math.min(rect.width - rectWidth - 10, Math.max(10, lastPointerPos.x + 12));
      const y = Math.min(rect.height - rectHeight - 10, Math.max(10, lastPointerPos.y + 12));
      ctx.fillStyle = "rgba(31,31,36,0.85)";
      ctx.fillRect(x, y, rectWidth, rectHeight);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x + paddingX, y + 16);
      ctx.restore();
    }
  }
}

function handleWheel(event) {
  if (!state.image) return;
  if (event.shiftKey) {
    event.preventDefault();
    const { x, y } = getPointerPosition(event);
    const hitEdge = hitTestEdge(x, y);
    if (!hitEdge) return;
    const edge = findEdge(hitEdge.edge.a, hitEdge.edge.b);
    if (!edge) return;
    const direction = event.deltaY > 0 ? -1 : 1;
    const nextWeight = stepEdgeWeight(edge.weight, direction);
    if (nextWeight === edge.weight) return;
    const before = captureSnapshot();
    edge.weight = nextWeight;
    pushSnapshot(before);
    render();
    return;
  }

  event.preventDefault();
  const { x, y } = getPointerPosition(event);
  const world = screenToWorld(x, y);
  const zoom = Math.exp(-event.deltaY * 0.0015);
  const nextScale = Math.min(10, Math.max(0.2, state.viewport.scale * zoom));
  state.viewport.scale = nextScale;
  state.viewport.panX = x - world.x * nextScale;
  state.viewport.panY = y - world.y * nextScale;
  render();
}

canvas.addEventListener("wheel", handleWheel, { passive: false });

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  handleRightClick(event);
});

canvas.addEventListener("auxclick", (event) => {
  if (event.button === 1) {
    event.preventDefault();
  }
});

canvas.addEventListener("mousedown", (event) => {
  if (!state.image) return;
  if (event.button === 1 && event.shiftKey) {
    const { x, y } = getPointerPosition(event);
    const hitEdge = hitTestEdge(x, y);
    if (!hitEdge) return;
    event.preventDefault();
    const edge = findEdge(hitEdge.edge.a, hitEdge.edge.b);
    if (!edge || edge.weight === 1) return;
    const before = captureSnapshot();
    edge.weight = 1;
    pushSnapshot(before);
    render();
    return;
  }
  if (event.button === 1 || (event.button === 0 && spaceDown)) {
    panStart = {
      x: event.clientX,
      y: event.clientY,
      panX: state.viewport.panX,
      panY: state.viewport.panY,
    };
    if (event.button === 1) {
      isPanning = true;
      canvas.style.cursor = "grabbing";
    } else {
      panReady = true;
    }
    return;
  }

  if (event.button === 0 && !event.shiftKey) {
    if (state.activePathId) return;
    const { x, y } = getPointerPosition(event);
    const hitNode = hitTestNode(x, y);
    if (hitNode) {
      dragNodeId = hitNode.id;
      dragSnapshot = captureSnapshot();
      dragMoved = false;
    }
  }
});

window.addEventListener("mousemove", (event) => {
  if (!state.image) return;
  const rect = canvas.getBoundingClientRect();
  const hoverX = event.clientX - rect.left;
  const hoverY = event.clientY - rect.top;
  lastPointerPos = { x: hoverX, y: hoverY };
  if (panStart && (isPanning || panReady)) {
    const dx = event.clientX - panStart.x;
    const dy = event.clientY - panStart.y;
    if (!isPanning && panReady) {
      if (Math.hypot(dx, dy) < 3) {
        return;
      }
      isPanning = true;
      canvas.style.cursor = "grabbing";
    }
    state.viewport.panX = panStart.panX + dx;
    state.viewport.panY = panStart.panY + dy;
    render();
    return;
  }
  if (dragNodeId) {
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);
    const node = getNodeById(dragNodeId);
    if (node) {
      const clampedX = Math.min(state.image.width, Math.max(0, world.x));
      const clampedY = Math.min(state.image.height, Math.max(0, world.y));
      node.x = clampedX;
      node.y = clampedY;
      dragMoved = true;
      render();
    }
    return;
  }

  const hitNode = hitTestNode(hoverX, hoverY);
  state.hoveredNodeId = hitNode ? hitNode.id : null;
  if (!hitNode) {
    const hitEdge = hitTestEdge(hoverX, hoverY);
    state.hoveredEdgeKey = hitEdge ? hitEdge.key : null;
  } else {
    state.hoveredEdgeKey = null;
  }
  render();
});

window.addEventListener("mouseup", () => {
  if (isPanning) {
    isPanning = false;
    panStart = null;
    panReady = false;
    canvas.style.cursor = "crosshair";
    suppressClick = true;
  } else if (panReady) {
    panReady = false;
    panStart = null;
  }
  if (dragNodeId) {
    if (dragMoved) {
      const node = getNodeById(dragNodeId);
      if (node) {
        node.x = Math.round(node.x);
        node.y = Math.round(node.y);
      }
      pushSnapshot(dragSnapshot);
      suppressClick = true;
    }
    dragNodeId = null;
    dragSnapshot = null;
    dragMoved = false;
    rebuildProtectedSets();
    render();
  }
});

canvas.addEventListener("click", (event) => {
  if (event.button !== 0) return;
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  handleLeftClick(event);
});

canvas.addEventListener("dblclick", (event) => {
  const { x, y } = getPointerPosition(event);
  const hitNode = hitTestNode(x, y);
  if (hitNode) {
    startNodeLabelEdit(hitNode.id);
  }
});

nodeLabelEditor.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    commitNodeLabelEdit(true);
  }
  if (event.key === "Escape") {
    commitNodeLabelEdit(false);
  }
});

nodeLabelEditor.addEventListener("blur", () => {
  commitNodeLabelEdit(true);
});

imageInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) {
    setImage(file);
  }
});

jsonInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      loadProjectFromJson(payload);
    } catch (error) {
      showToast("Invalid JSON.", "error");
    }
  };
  reader.readAsText(file);
});

fitViewBtn.addEventListener("click", () => {
  fitToView();
});

clearProjectBtn.addEventListener("click", () => {
  clearProjectData();
});

imageOpacityInput.addEventListener("input", (event) => {
  state.imageOpacity = Math.max(0, Math.min(1, Number(event.target.value) / 100));
  syncImageOpacityUi();
  render();
});


exportJsonBtn.addEventListener("click", () => {
  const width = state.image ? state.image.width : state.expectedImage?.width;
  const height = state.image ? state.image.height : state.expectedImage?.height;
  if (!width || !height) {
    showToast("Cannot export JSON without image dimensions.", "error");
    return;
  }
  const payload = {
    imageWidth: width,
    imageHeight: height,
    nodes: state.nodes,
    edges: state.edges,
    paths: state.paths,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "project.json";
  link.click();
  URL.revokeObjectURL(url);
});

exportPngBtn.addEventListener("click", () => {
  if (!state.image) return;
  const offscreen = document.createElement("canvas");
  offscreen.width = state.image.width;
  offscreen.height = state.image.height;
  const octx = offscreen.getContext("2d");
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, offscreen.width, offscreen.height);
  octx.globalAlpha = state.imageOpacity;
  octx.drawImage(state.image.img, 0, 0);
  octx.globalAlpha = 1;

  const mode = pngModeSelect.value;

  // Draw edges
  octx.strokeStyle = "#4b5563";
  octx.lineWidth = 2;
  octx.beginPath();
  state.edges.forEach((edge) => {
    const a = getNodeById(edge.a);
    const b = getNodeById(edge.b);
    if (!a || !b) return;
    octx.moveTo(a.x, a.y);
    octx.lineTo(b.x, b.y);
  });
  octx.stroke();

  octx.fillStyle = "#334155";
  octx.font = `${Math.round(12 * MAP_FONT_SCALE)}px 'Space Grotesk'`;
  state.edges.forEach((edge) => {
    if (edge.weight === 1) return;
    const a = getNodeById(edge.a);
    const b = getNodeById(edge.b);
    if (!a || !b) return;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    octx.fillText(formatWeightLabel(edge.weight), midX + 4, midY - 4);
  });

  // Draw paths
  const drawPath = (path, color, width, dashed) => {
    if (!path || path.nodeIds.length < 2) return;
    octx.strokeStyle = color;
    octx.lineWidth = width;
    if (dashed) {
      octx.setLineDash([18, 12]);
    } else {
      octx.setLineDash([]);
    }
    octx.beginPath();
    path.nodeIds.forEach((nodeId, idx) => {
      const node = getNodeById(nodeId);
      if (!node) return;
      if (idx === 0) octx.moveTo(node.x, node.y);
      else octx.lineTo(node.x, node.y);
    });
    octx.stroke();
    octx.setLineDash([]);
  };

  if (mode === "visible") {
    state.paths.forEach((path, index) => {
      if (path.visible) {
        drawPath(path, PATH_COLORS[index % PATH_COLORS.length], 5, false);
      }
    });
  }

  if (mode === "all") {
    state.paths.forEach((path, index) => {
      drawPath(path, PATH_COLORS[index % PATH_COLORS.length], 5, false);
    });
  }

  // Draw nodes
  state.nodes.forEach((node) => {
    octx.fillStyle = "#ffffff";
    octx.strokeStyle = "#1f2937";
    octx.lineWidth = 2;
    octx.beginPath();
    octx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
    octx.fill();
    octx.stroke();
    if (node.label && node.label !== node.id) {
      octx.fillStyle = "#111827";
      octx.font = `${Math.round(12 * MAP_FONT_SCALE)}px 'Space Grotesk'`;
      octx.fillText(node.label, node.x + 12, node.y - 12);
    }
  });

  const link = document.createElement("a");
  link.download = "overlay.png";
  link.href = offscreen.toDataURL("image/png");
  link.click();
});

window.addEventListener("keydown", (event) => {
  if (event.key === " ") {
    event.preventDefault();
    spaceDown = true;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undo();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
  }

  if (event.key === "Escape") {
    if (editingNodeId) {
      commitNodeLabelEdit(false);
      return;
    }
    if (state.activePathId) {
      state.activeAppendEnd = null;
      updateOverlay();
      render();
      return;
    }
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === " ") {
    spaceDown = false;
  }
});

window.addEventListener("blur", () => {
  spaceDown = false;
  panReady = false;
  if (isPanning) {
    isPanning = false;
    panStart = null;
    canvas.style.cursor = "crosshair";
  }
});

updatePathsList();
updateOverlay();
updateUndoRedoButtons();
syncImageOpacityUi();
render();

	if ("serviceWorker" in navigator) {
	  window.addEventListener("load", () => {
	    const appScriptUrl =
	      document.querySelector("script[src$='app.js'],script[src*='app.js']")?.src || window.location.href;
	    const swUrl = new URL("sw.js", appScriptUrl);
	    navigator.serviceWorker
	      .register(swUrl, { updateViaCache: "none" })
	      .then((registration) => registration.update())
	      .catch(() => {});

    let reloadedForSw = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadedForSw) return;
      reloadedForSw = true;
      window.location.reload();
    });
  });
}
