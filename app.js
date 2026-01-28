const board = document.querySelector(".board");
const turnText = document.querySelector("#turn");
const promoModal = document.querySelector("#promoModal");

// V7 UI
const whiteClockEl = document.querySelector("#whiteClock");
const blackClockEl = document.querySelector("#blackClock");
const restartBtn = document.querySelector("#restartBtn");
const historyListEl = document.querySelector("#historyList");

// Start/Pause + time control
const startBtn = document.querySelector("#startBtn");
const pauseBtn = document.querySelector("#pauseBtn");
const minutesInput = document.querySelector("#minutesInput");
const applyTimeBtn = document.querySelector("#applyTimeBtn");

// ===== Sounds =====
const sMove = new Audio("sounds/move.mp3");
const sCapture = new Audio("sounds/capture.mp3");
const sError = new Audio("sounds/error.mp3");

[sMove, sCapture, sError].forEach(a => {
  a.preload = "auto";
  a.volume = 1;
});

function playSound(a) {
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (_) {}
}

// ✅ Unlock audio on first user interaction (mobile-safe)
document.addEventListener(
  "pointerdown",
  () => {
    [sMove, sCapture, sError].forEach(a => {
      try {
        a.muted = true;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
        a.pause();
        a.currentTime = 0;
        a.muted = false;
      } catch (_) {}
    });
  },
  { once: true }
);

// Initial board setup
const initialPieces = [
  "br","bn","bb","bq","bk","bb","bn","br",
  "bp","bp","bp","bp","bp","bp","bp","bp",
  "","","","","","","","",
  "","","","","","","","",
  "","","","","","","","",
  "","","","","","","","",
  "wp","wp","wp","wp","wp","wp","wp","wp",
  "wr","wn","wb","wq","wk","wb","wn","wr"
];

let pieces = [...initialPieces];
let selectedIndex = null;
let currentTurn = "w";
let gameOver = false;
let promoPending = null; // { idx, col, done }

// ===== Castling moved flags =====
// k = king moved, ra = rook A-file moved, rh = rook H-file moved
let movedFlags = {
  wk: false, wra: false, wrh: false,
  bk: false, bra: false, brh: false
};

// ===== V6 En Passant =====
let enPassantSquare = null;

// ===== V7 Move History + last move highlight =====
let moveHistory = []; // each element: { w: "e4", b: "e5" }
let lastMove = null;  // { from, to }

// ===== V7 Timer (Start/Pause + Minutes control) =====
let START_SECONDS = 5 * 60;       // default 5 minutes
let timeLeft = { w: START_SECONDS, b: START_SECONDS };
let timerId = null;
let clockRunning = false;         // interval is running
let clockEnabled = false;         // user pressed Start at least once

function idxToRC(i) { return { r: Math.floor(i / 8), c: i % 8 }; }
function rcToIdx(r, c) { return r * 8 + c; }
function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function colorOf(code) { return code ? code[0] : ""; }
function typeOf(code) { return code ? code[1] : ""; }
function other(col) { return col === "w" ? "b" : "w"; }

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function renderClocks() {
  if (whiteClockEl) whiteClockEl.textContent = formatTime(timeLeft.w);
  if (blackClockEl) blackClockEl.textContent = formatTime(timeLeft.b);

  if (whiteClockEl) whiteClockEl.classList.toggle("active", currentTurn === "w" && !gameOver);
  if (blackClockEl) blackClockEl.classList.toggle("active", currentTurn === "b" && !gameOver);
}

function hardStopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  clockRunning = false;
}

function startTimer() {
  if (gameOver) return;
  if (clockRunning) return;

  clockEnabled = true;
  clockRunning = true;
  renderClocks();

  timerId = setInterval(() => {
    if (gameOver) return;

    timeLeft[currentTurn] -= 1;

    if (timeLeft[currentTurn] <= 0) {
      timeLeft[currentTurn] = 0;
      renderClocks();

      gameOver = true;
      hardStopTimer();

      const winner = other(currentTurn);
      updateTurnText((winner === "w" ? "White" : "Black") + " Wins — Time!");
      render();
      return;
    }

    renderClocks();
  }, 1000);
}

function pauseTimer() {
  hardStopTimer(); // keep clockEnabled as-is
  renderClocks();
}

function setMinutes(mins) {
  const m = Math.max(1, Math.min(60, Math.floor(Number(mins) || 5)));
  START_SECONDS = m * 60;
  timeLeft = { w: START_SECONDS, b: START_SECONDS };
  renderClocks();
}

function updateTurnText(extra = "") {
  const base = gameOver
    ? extra
    : (currentTurn === "w" ? "White Turn" : "Black Turn") + (extra ? ` — ${extra}` : "");
  if (turnText) turnText.textContent = base;
}

/* ============================= */
/* Promotion helpers             */
/* ============================= */
function shouldPromotePawn(pieceCode, toIdx) {
  if (!pieceCode) return false;
  if (typeOf(pieceCode) !== "p") return false;
  const col = colorOf(pieceCode);
  const row = Math.floor(toIdx / 8);
  return (col === "w" && row === 0) || (col === "b" && row === 7);
}

function showPromotion(col, idx, done) {
  promoPending = { idx, col, done };

  const wasRunning = clockRunning;
  if (wasRunning) pauseTimer();

  if (!promoModal) {
    done(col + "q");
    promoPending = null;
    if (wasRunning) startTimer();
    return;
  }

  promoModal.classList.remove("hidden");

  promoModal.querySelectorAll(".promo-btn").forEach(btn => {
    btn.onclick = () => {
      const t = btn.dataset.piece; // q r b n
      promoModal.classList.add("hidden");

      const newPiece = col + t;
      const cb = promoPending?.done;
      promoPending = null;

      if (cb) cb(newPiece);
      if (!gameOver && wasRunning) startTimer();
    };
  });
}

/* ============================= */
/* Move Animation (flying piece) */
/* ============================= */
function animateMove(fromIdx, toIdx, done) {
  const fromSq = board.querySelector(`.square[data-index="${fromIdx}"]`);
  const toSq = board.querySelector(`.square[data-index="${toIdx}"]`);
  if (!fromSq || !toSq) return done();

  const fromImg = fromSq.querySelector("img.piece");
  if (!fromImg) return done();

  const fromRect = fromSq.getBoundingClientRect();
  const toRect = toSq.getBoundingClientRect();

  const pieceSize =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--piece")) || 45;

  fromImg.style.visibility = "hidden";

  const fly = fromImg.cloneNode(true);
  fly.classList.add("flying-piece");
  fly.alt = "";
  fly.draggable = false;

  fly.style.left = (fromRect.left + (fromRect.width - pieceSize) / 2) + "px";
  fly.style.top  = (fromRect.top  + (fromRect.height - pieceSize) / 2) + "px";
  fly.style.transform = "translate(0px, 0px)";

  document.body.appendChild(fly);

  const dx = (toRect.left - fromRect.left);
  const dy = (toRect.top - fromRect.top);

  requestAnimationFrame(() => {
    fly.style.transform = `translate(${dx}px, ${dy}px)`;
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    fly.removeEventListener("transitionend", finish);
    fly.remove();
    done();
  };

  fly.addEventListener("transitionend", finish);
  setTimeout(finish, 320);
}

/* ============================= */
/* Check helpers                 */
/* ============================= */
function findKingIndex(boardArr, col) {
  for (let i = 0; i < 64; i++) {
    if (boardArr[i] === col + "k") return i;
  }
  return -1;
}

function isSquareAttacked(boardArr, sqIdx, byCol) {
  const { r, c } = idxToRC(sqIdx);

  // Pawn attacks
  const pawnDir = byCol === "w" ? -1 : 1;
  for (const dc of [-1, 1]) {
    const rr = r + pawnDir, cc = c + dc;
    if (inBounds(rr, cc)) {
      const p = boardArr[rcToIdx(rr, cc)];
      if (p === byCol + "p") return true;
    }
  }

  // Knight attacks
  const knightD = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  for (const [dr, dc] of knightD) {
    const rr = r + dr, cc = c + dc;
    if (inBounds(rr, cc)) {
      const p = boardArr[rcToIdx(rr, cc)];
      if (p === byCol + "n") return true;
    }
  }

  // King attacks (adjacent)
  for (let dr=-1; dr<=1; dr++) {
    for (let dc=-1; dc<=1; dc++) {
      if (dr===0 && dc===0) continue;
      const rr=r+dr, cc=c+dc;
      if (inBounds(rr,cc)) {
        const p = boardArr[rcToIdx(rr,cc)];
        if (p === byCol + "k") return true;
      }
    }
  }

  // Sliding pieces: rook/queen
  const rookDirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const [dr, dc] of rookDirs) {
    let rr=r+dr, cc=c+dc;
    while (inBounds(rr,cc)) {
      const p = boardArr[rcToIdx(rr,cc)];
      if (p) {
        if (p[0] === byCol && (p[1] === "r" || p[1] === "q")) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }

  // Sliding pieces: bishop/queen
  const bishDirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
  for (const [dr, dc] of bishDirs) {
    let rr=r+dr, cc=c+dc;
    while (inBounds(rr,cc)) {
      const p = boardArr[rcToIdx(rr,cc)];
      if (p) {
        if (p[0] === byCol && (p[1] === "b" || p[1] === "q")) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }

  return false;
}

function isInCheck(boardArr, col) {
  const k = findKingIndex(boardArr, col);
  if (k === -1) return false;
  return isSquareAttacked(boardArr, k, other(col));
}

/* ============================= */
/* Move generation + Castling    */
/* ============================= */
function pseudoMoves(boardArr, fromIdx) {
  const code = boardArr[fromIdx];
  if (!code) return [];

  const col = colorOf(code);
  const t = typeOf(code);
  const { r, c } = idxToRC(fromIdx);
  const moves = [];

  const pushIf = (rr, cc) => {
    if (!inBounds(rr, cc)) return;
    const idx = rcToIdx(rr, cc);
    const target = boardArr[idx];
    if (!target || colorOf(target) !== col) moves.push(idx);
  };

  const addSlide = (dirs) => {
    dirs.forEach(([dr,dc]) => {
      let rr=r+dr, cc=c+dc;
      while (inBounds(rr,cc)) {
        const idx = rcToIdx(rr,cc);
        const target = boardArr[idx];
        if (!target) {
          moves.push(idx);
        } else {
          if (colorOf(target) !== col) moves.push(idx);
          break;
        }
        rr+=dr; cc+=dc;
      }
    });
  };

  if (t === "p") {
    const dir = col === "w" ? -1 : 1;
    const startRow = col === "w" ? 6 : 1;

    // forward
    if (inBounds(r + dir, c) && !boardArr[rcToIdx(r + dir, c)]) {
      moves.push(rcToIdx(r + dir, c));
      if (r === startRow && !boardArr[rcToIdx(r + 2*dir, c)]) {
        moves.push(rcToIdx(r + 2*dir, c));
      }
    }

    // normal captures
    [-1, 1].forEach(dc => {
      const rr = r + dir, cc = c + dc;
      if (inBounds(rr, cc)) {
        const idx = rcToIdx(rr, cc);
        if (boardArr[idx] && colorOf(boardArr[idx]) !== col) moves.push(idx);
      }
    });

    // EN PASSANT
    if (enPassantSquare !== null) {
      const ep = enPassantSquare;
      const epRC = idxToRC(ep);
      if (epRC.r === r + dir && Math.abs(epRC.c - c) === 1) {
        const adjIdx = rcToIdx(r, epRC.c);
        const adj = boardArr[adjIdx];
        if (adj === other(col) + "p" && !boardArr[ep]) moves.push(ep);
      }
    }
  }

  if (t === "n") {
    [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => {
      pushIf(r+dr, c+dc);
    });
  }

  if (t === "k") {
    for (let dr=-1; dr<=1; dr++) {
      for (let dc=-1; dc<=1; dc++) {
        if (dr===0 && dc===0) continue;
        pushIf(r+dr, c+dc);
      }
    }

    // CASTLING (pseudo)
    const row = (col === "w") ? 7 : 0;
    const kingStart = rcToIdx(row, 4);
    if (fromIdx === kingStart) {
      const kingMoved = (col === "w") ? movedFlags.wk : movedFlags.bk;

      if (!kingMoved && !isInCheck(boardArr, col)) {
        // kingside
        const rookH = rcToIdx(row, 7);
        const rookOkH = boardArr[rookH] === (col + "r");
        const rookMovedH = (col === "w") ? movedFlags.wrh : movedFlags.brh;

        const f = rcToIdx(row, 5), g = rcToIdx(row, 6);
        if (rookOkH && !rookMovedH && !boardArr[f] && !boardArr[g]) {
          if (!isSquareAttacked(boardArr, f, other(col)) && !isSquareAttacked(boardArr, g, other(col))) {
            moves.push(g);
          }
        }

        // queenside
        const rookA = rcToIdx(row, 0);
        const rookOkA = boardArr[rookA] === (col + "r");
        const rookMovedA = (col === "w") ? movedFlags.wra : movedFlags.bra;

        const b = rcToIdx(row, 1), c2 = rcToIdx(row, 2), d = rcToIdx(row, 3);
        if (rookOkA && !rookMovedA && !boardArr[b] && !boardArr[c2] && !boardArr[d]) {
          if (!isSquareAttacked(boardArr, d, other(col)) && !isSquareAttacked(boardArr, c2, other(col))) {
            moves.push(c2);
          }
        }
      }
    }
  }

  if (t === "r") addSlide([[1,0],[-1,0],[0,1],[0,-1]]);
  if (t === "b") addSlide([[1,1],[1,-1],[-1,1],[-1,-1]]);
  if (t === "q") addSlide([[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]);

  return moves;
}

function applyMoveOnBoard(boardArr, fromIdx, toIdx) {
  const copy = [...boardArr];
  const moved = copy[fromIdx];

  // EN PASSANT simulation capture
  if (moved && typeOf(moved) === "p" && enPassantSquare !== null && toIdx === enPassantSquare && !copy[toIdx]) {
    const col = colorOf(moved);
    const dir = col === "w" ? -1 : 1;
    const capIdx = toIdx - (8 * dir);
    copy[capIdx] = "";
  }

  copy[toIdx] = moved;
  copy[fromIdx] = "";

  // Castling simulation
  if (moved && typeOf(moved) === "k" && Math.abs(toIdx - fromIdx) === 2) {
    const col = colorOf(moved);
    const row = (col === "w") ? 7 : 0;

    const g = rcToIdx(row, 6);
    const c2 = rcToIdx(row, 2);

    if (toIdx === g) {
      const rookFrom = rcToIdx(row, 7);
      const rookTo = rcToIdx(row, 5);
      copy[rookTo] = copy[rookFrom];
      copy[rookFrom] = "";
    } else if (toIdx === c2) {
      const rookFrom = rcToIdx(row, 0);
      const rookTo = rcToIdx(row, 3);
      copy[rookTo] = copy[rookFrom];
      copy[rookFrom] = "";
    }
  }

  return copy;
}

function legalMoves(fromIdx) {
  const code = pieces[fromIdx];
  if (!code) return [];
  const col = colorOf(code);
  if (col !== currentTurn) return [];

  const pm = pseudoMoves(pieces, fromIdx);
  const out = [];

  for (const to of pm) {
    const copy = applyMoveOnBoard(pieces, fromIdx, to);
    if (!isInCheck(copy, col)) out.push(to);
  }
  return out;
}

function anyLegalMove(col) {
  for (let i = 0; i < 64; i++) {
    if (pieces[i] && pieces[i][0] === col) {
      const savedTurn = currentTurn;
      currentTurn = col;
      const lm = legalMoves(i);
      currentTurn = savedTurn;
      if (lm.length) return true;
    }
  }
  return false;
}

/* ============================= */
/* Move History helpers          */
/* ============================= */
function idxToAlg(idx) {
  const { r, c } = idxToRC(idx);
  const file = "abcdefgh"[c];
  const rank = String(8 - r);
  return file + rank;
}

function pieceLetter(code) {
  const t = typeOf(code);
  if (t === "p") return "";
  if (t === "n") return "N";
  return t.toUpperCase();
}

function isCastleMove(piece, from, to) {
  return piece && typeOf(piece) === "k" && Math.abs(to - from) === 2;
}

function addHistoryMove(col, text) {
  if (col === "w") {
    moveHistory.push({ w: text, b: "" });
  } else {
    if (moveHistory.length === 0) moveHistory.push({ w: "", b: text });
    else moveHistory[moveHistory.length - 1].b = text;
  }
  renderHistory();
}

function renderHistory() {
  if (!historyListEl) return;

  historyListEl.innerHTML = "";
  moveHistory.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "move-row";

    const no = document.createElement("div");
    no.className = "move-no";
    no.textContent = String(i + 1) + ".";

    const w = document.createElement("div");
    w.className = "move-w";
    w.textContent = row.w || "—";

    const b = document.createElement("div");
    b.className = "move-b";
    b.textContent = row.b || "—";

    div.appendChild(no);
    div.appendChild(w);
    div.appendChild(b);

    historyListEl.appendChild(div);
  });

  historyListEl.scrollTop = historyListEl.scrollHeight;
}

/* ============================= */
/* Render + clicks               */
/* ============================= */
function render() {
  board.innerHTML = "";

  for (let i = 0; i < 64; i++) {
    const sq = document.createElement("div");
    sq.classList.add("square");
    sq.dataset.index = String(i);

    const r = Math.floor(i / 8);
    const c = i % 8;
    if ((r + c) % 2 === 0) sq.classList.add("light");
    else sq.classList.add("dark");

    if (lastMove && lastMove.from === i) sq.classList.add("last-from");
    if (lastMove && lastMove.to === i) sq.classList.add("last-to");

    const code = pieces[i];
    if (code) {
      const img = document.createElement("img");
      img.classList.add("piece");
      img.alt = "";
      img.draggable = false;
      img.onerror = () => img.remove();
      img.src = `images/${code}.png`;
      sq.appendChild(img);
    }

    sq.addEventListener("click", () => onSquareClick(i));
    board.appendChild(sq);
  }

  if (selectedIndex !== null) {
    const selectedSq = board.querySelector(`.square[data-index="${selectedIndex}"]`);
    if (selectedSq) selectedSq.classList.add("selected");

    const moves = legalMoves(selectedIndex);
    moves.forEach(m => {
      const moveSq = board.querySelector(`.square[data-index="${m}"]`);
      if (moveSq) moveSq.classList.add("move");
    });
  }
}

function updateMovedFlagsOnRealMove(piece, from) {
  if (piece === "wk") movedFlags.wk = true;
  if (piece === "bk") movedFlags.bk = true;

  if (piece === "wr") {
    if (from === rcToIdx(7,0)) movedFlags.wra = true;
    if (from === rcToIdx(7,7)) movedFlags.wrh = true;
  }
  if (piece === "br") {
    if (from === rcToIdx(0,0)) movedFlags.bra = true;
    if (from === rcToIdx(0,7)) movedFlags.brh = true;
  }
}

function doCastlingRookMoveIfNeeded(piece, from, to) {
  if (!piece || typeOf(piece) !== "k") return;

  const col = colorOf(piece);
  const row = (col === "w") ? 7 : 0;

  if (Math.abs(to - from) !== 2) return;

  if (to === rcToIdx(row,6)) {
    const rookFrom = rcToIdx(row,7);
    const rookTo = rcToIdx(row,5);
    pieces[rookTo] = pieces[rookFrom];
    pieces[rookFrom] = "";
    if (col === "w") movedFlags.wrh = true; else movedFlags.brh = true;
  }

  if (to === rcToIdx(row,2)) {
    const rookFrom = rcToIdx(row,0);
    const rookTo = rcToIdx(row,3);
    pieces[rookTo] = pieces[rookFrom];
    pieces[rookFrom] = "";
    if (col === "w") movedFlags.wra = true; else movedFlags.bra = true;
  }

  if (col === "w") movedFlags.wk = true; else movedFlags.bk = true;
}

function applyEnPassantCaptureIfNeeded(movedPiece, to) {
  if (!movedPiece || typeOf(movedPiece) !== "p") return false;
  if (enPassantSquare === null) return false;

  if (to === enPassantSquare && !pieces[to]) {
    const col = colorOf(movedPiece);
    const dir = col === "w" ? -1 : 1;
    const capIdx = to - (8 * dir);
    if (pieces[capIdx] === other(col) + "p") {
      pieces[capIdx] = "";
      return true;
    }
  }
  return false;
}

function updateEnPassantSquareAfterMove(movedPiece, from, to) {
  enPassantSquare = null;
  if (movedPiece && typeOf(movedPiece) === "p") {
    const fromR = idxToRC(from).r;
    const toR = idxToRC(to).r;
    if (Math.abs(toR - fromR) === 2) {
      const midR = (fromR + toR) / 2;
      const midC = idxToRC(from).c;
      enPassantSquare = rcToIdx(midR, midC);
    }
  }
}

function buildMoveText({ piece, from, to, capture, ep, castle, promoType, givesCheck, givesMate }) {
  if (castle) {
    const row = (colorOf(piece) === "w") ? 7 : 0;
    const g = rcToIdx(row, 6);
    const c2 = rcToIdx(row, 2);
    let s = (to === g) ? "O-O" : (to === c2 ? "O-O-O" : "O-O");
    if (givesMate) s += "#";
    else if (givesCheck) s += "+";
    return s;
  }

  const pl = pieceLetter(piece);
  const toAlg = idxToAlg(to);
  let s = "";

  if (pl === "") {
    if (capture) {
      const fromFile = idxToAlg(from)[0];
      s = `${fromFile}x${toAlg}`;
      if (ep) s += " ep";
    } else {
      s = `${toAlg}`;
    }
  } else {
    s = capture ? `${pl}x${toAlg}` : `${pl}${toAlg}`;
  }

  if (promoType) s += `=${promoType.toUpperCase()}`;
  if (givesMate) s += "#";
  else if (givesCheck) s += "+";
  return s;
}

function onSquareClick(i) {
  if (gameOver) return;

  const clickedPiece = pieces[i];
  const clickedColor = colorOf(clickedPiece);

  if (selectedIndex === null) {
    if (clickedPiece && clickedColor === currentTurn) {
      selectedIndex = i;
      render();
    }
    return;
  }

  if (i === selectedIndex) {
    selectedIndex = null;
    render();
    return;
  }

  const selectedPiece = pieces[selectedIndex];
  const selectedColor = colorOf(selectedPiece);

  if (clickedPiece && clickedColor === selectedColor) {
    selectedIndex = i;
    render();
    return;
  }

  const moves = legalMoves(selectedIndex);

  if (moves.includes(i)) {
    const from = selectedIndex;
    const to = i;

    const movedPiece = pieces[from];

    const normalCapture = !!pieces[to];
    const epCapture = (
      movedPiece &&
      typeOf(movedPiece) === "p" &&
      enPassantSquare !== null &&
      to === enPassantSquare &&
      !pieces[to]
    );
    const isCapture = normalCapture || epCapture;
    const isCastle = isCastleMove(movedPiece, from, to);

    lastMove = { from, to };

    selectedIndex = null;
    render();

    animateMove(from, to, () => {
      const didEp = applyEnPassantCaptureIfNeeded(movedPiece, to);

      pieces[to] = movedPiece;
      pieces[from] = "";

      doCastlingRookMoveIfNeeded(movedPiece, from, to);
      updateMovedFlagsOnRealMove(movedPiece, from);

      updateEnPassantSquareAfterMove(movedPiece, from, to);

      if (isCapture) playSound(sCapture);
      else playSound(sMove);

      const afterMoveCommon = (promoType = "") => {
        const nextTurn = other(currentTurn);
        const inCheck = isInCheck(pieces, nextTurn);
        const hasMove = anyLegalMove(nextTurn);

        let mate = false;

        if (!hasMove) {
          gameOver = true;
          hardStopTimer();

          if (inCheck) {
            mate = true;
            updateTurnText((nextTurn === "w" ? "Black" : "White") + " Wins — Checkmate!");
          } else {
            updateTurnText("Draw — Stalemate!");
          }
        } else {
          updateTurnText(inCheck ? "CHECK!" : "");
        }

        const moveText = buildMoveText({
          piece: pieces[to],
          from,
          to,
          capture: isCapture,
          ep: didEp,
          castle: isCastle,
          promoType,
          givesCheck: inCheck,
          givesMate: mate
        });

        addHistoryMove(currentTurn, moveText);

        currentTurn = nextTurn;
        renderClocks(); // ✅ فقط نغير الإضاءة/الدور

        render();
      };

      if (shouldPromotePawn(movedPiece, to)) {
        showPromotion(colorOf(movedPiece), to, (newPiece) => {
          const promoType = typeOf(newPiece);
          pieces[to] = newPiece;
          afterMoveCommon(promoType);
        });
      } else {
        afterMoveCommon("");
      }
    });

  } else {
    playSound(sError);
    selectedIndex = null;
    render();
  }
}

/* ============================= */
/* Restart                       */
/* ============================= */
function resetGame() {
  hardStopTimer();
  clockEnabled = false; // لازم Start من جديد

  pieces = [...initialPieces];
  selectedIndex = null;
  currentTurn = "w";
  gameOver = false;
  promoPending = null;

  movedFlags = {
    wk: false, wra: false, wrh: false,
    bk: false, bra: false, brh: false
  };

  enPassantSquare = null;
  moveHistory = [];
  lastMove = null;

  // reset time based on input
  setMinutes(minutesInput?.value);

  updateTurnText("");
  renderHistory();
  renderClocks();
  render();
}

if (restartBtn) restartBtn.addEventListener("click", resetGame);

// Apply minutes
if (applyTimeBtn) {
  applyTimeBtn.addEventListener("click", () => {
    if (clockRunning) return; // لا نغير أثناء التشغيل
    setMinutes(minutesInput?.value);
  });
}

// Start / Pause
if (startBtn) {
  startBtn.addEventListener("click", () => {
    if (gameOver) return;
    startTimer();
  });
}

if (pauseBtn) {
  pauseBtn.addEventListener("click", () => {
    pauseTimer();
  });
}

// init (NO auto start)
updateTurnText("");
renderHistory();
setMinutes(minutesInput?.value);
renderClocks();
render();
