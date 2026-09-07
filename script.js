function setDynamicViewportHeight() {
  const vv = window.visualViewport;
  const vh = vv ? vv.height : window.innerHeight;
  const offsetTop = vv ? vv.offsetTop : 0;

  document.body.style.height = `${vh}px`;
  document.body.style.top = `-${offsetTop}px`;

  // Resize chat wrapper height so input stays above keyboard
  const chatPage = document.getElementById("chat-page");
  if (chatPage && !chatPage.classList.contains("hidden")) {
    chatPage.style.height = `${vh}px`;
    const msgs = document.getElementById("chat-messages");
    if (msgs) setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 60);
  }

  // Keep the board filling the screen on resize/orientation change/keyboard toggle
  const gamePageEl = document.getElementById("game-page");
  if (gamePageEl && !gamePageEl.classList.contains("hidden") && typeof fitBoardToScreen === "function") {
    fitBoardToScreen();
  }
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", setDynamicViewportHeight);
  window.visualViewport.addEventListener("scroll", setDynamicViewportHeight);
} else {
  window.addEventListener("resize", setDynamicViewportHeight);
}
setDynamicViewportHeight();

window.addEventListener("pagehide", removePresence);
window.addEventListener("beforeunload", removePresence);

// --- APPWRITE INITIALIZATION ---
const { Client, Databases, ID, Query } = Appwrite;

const appwriteClient = new Client();
appwriteClient
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6a98502b0023f61a6477');

const databases = new Databases(appwriteClient);
const DATABASE_ID = '6a9853c300262f68c1fd';
const COLLECTION_MESSAGES = 'messages';
const COLLECTION_GAMES = 'games';
const COLLECTION_PRESENCE = 'presence'; // Appwrite collection for online tracking

// ── ONLINE PRESENCE SYSTEM ──────────────────────────────────────────────────
let presenceDocId = null;
let presenceInterval = null;
let onlinePopupVisible = false;

async function registerPresence() {
  if (!loggedInUser) return;
  try {
    // Try to update existing doc first
    if (presenceDocId) {
      await databases.updateDocument(DATABASE_ID, COLLECTION_PRESENCE, presenceDocId, {
        user: loggedInUser,
        lastSeen: new Date().toISOString()
      });
      return;
    }
    // Check if doc for this user already exists
    const res = await databases.listDocuments(DATABASE_ID, COLLECTION_PRESENCE, [
      Query.equal('user', loggedInUser), Query.limit(1)
    ]);
    if (res.documents.length > 0) {
      presenceDocId = res.documents[0].$id;
      await databases.updateDocument(DATABASE_ID, COLLECTION_PRESENCE, presenceDocId, {
        lastSeen: new Date().toISOString()
      });
    } else {
      const doc = await databases.createDocument(
        DATABASE_ID, COLLECTION_PRESENCE, ID.unique(),
        { user: loggedInUser, lastSeen: new Date().toISOString() }
      );
      presenceDocId = doc.$id;
    }
  } catch (e) { console.warn('Presence write failed:', e); }
}

async function removePresence() {
  if (presenceDocId) {
    try { await databases.deleteDocument(DATABASE_ID, COLLECTION_PRESENCE, presenceDocId); }
    catch(e) {}
    presenceDocId = null;
  }
  if (presenceInterval) { clearInterval(presenceInterval); presenceInterval = null; }
}

function startPresenceHeartbeat() {
  registerPresence();
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = setInterval(registerPresence, 20000); // every 20s
}

async function fetchOnlineUsers() {
  try {
    // Consider online = lastSeen within last 40 seconds
    const cutoff = new Date(Date.now() - 40000).toISOString();
    const res = await databases.listDocuments(DATABASE_ID, COLLECTION_PRESENCE, [
      Query.greaterThan('lastSeen', cutoff), Query.limit(20)
    ]);
    return res.documents.map(d => d.user);
  } catch(e) { return [loggedInUser]; }
}

async function toggleOnlinePopup() {
  const existing = document.getElementById('online-popup-box');
  if (existing) { existing.remove(); onlinePopupVisible = false; return; }
  onlinePopupVisible = true;

  const users = await fetchOnlineUsers();
  const chatPage = document.getElementById('chat-page');

  const box = document.createElement('div');
  box.className = 'online-popup';
  box.id = 'online-popup-box';

  const count = users.length;
  box.innerHTML = `
    <div class="online-popup-header">
      <span>🟢 Online (${count})</span>
      <span class="online-popup-close" onclick="document.getElementById('online-popup-box')?.remove()">❌</span>
    </div>
    <div class="online-popup-list">
      ${count === 0
        ? '<div class="online-empty">Koi online nahi</div>'
        : users.map(u => `
            <div class="online-user-row">
              <span class="online-dot"></span>
              <span>${u}</span>
            </div>`).join('')
      }
    </div>`;

  chatPage.appendChild(box);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!box.contains(e.target) && e.target.id !== 'online-status-btn') {
        box.remove();
        onlinePopupVisible = false;
        document.removeEventListener('click', handler);
      }
    });
  }, 50);
}

function updateOnlineCount(count) {
  const btn = document.getElementById('online-status-btn');
  if (btn) btn.textContent = `● Online (${count})`;
}

const PRESET_COLORS = ['#3295ff', '#a6e3a1', '#f38ba8', '#fab387', '#cba6f7'];

// Expanded Emojis Array
const ALL_EMOJIS = [
  "❤️", "👍", "😂", "😮", "🔥", "🎉", "😊", "😍", "🤣", "😭", 
  "👏", "🙏", "💯", "😎", "🥳", "🤔", "💩", "💔", "🙈", "🚀", 
  "✨", "⚡", "😴", "🤩", "😜", "😇", "💪", "🤡", "🤬", "🤮"
];

let chatUnsubscribe = null;
let gameUnsubscribe = null;
let loggedInUser = "You";
let gameMode = "computer"; 
let currentGameDoc = null;
let myRole = "p1"; 
let isPaused = false;

let p1Name = "You";
let p2Name = "CPU";
let p1Color = "#3295ff";
let p2Color = "#ff3eaa";

const P1 = "p1";
const AI = "ai";

let gridSize = 4;
let startingPlayer = P1;
let currentPlayer = P1;
let p1Score = 0;
let aiScore = 0;
let hLines = [];
let vLines = [];
let boxes = [];

// Advanced Chat State Variables
let activeReplyTo = null; // { id, sender, text }
let editingMessageId = null;
let activePickerMsgId = null;

const gamePage = document.getElementById("game-page");
const boardEl = document.getElementById("board");
const boardWrapperEl = document.getElementById("board-wrapper");
let lastMoveEl = null; // the line element for the most recent move, highlighted green
const p1ScoreEl = document.getElementById("p1-score");
const aiScoreEl = document.getElementById("ai-score");
const p1Card = document.getElementById("p1-card");
const aiCard = document.getElementById("ai-card");
const gridSelect = document.getElementById("grid-select");
const modal = document.getElementById("game-over-modal");
const winnerTitle = document.getElementById("winner-title");
const winnerMsg = document.getElementById("winner-msg");
const pauseIcon = document.getElementById("pause-icon");
const restartIcon = document.getElementById("restart-icon");
const settingsIcon = document.getElementById("settings-icon");

const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const replyPreviewBar = document.getElementById("reply-preview-bar");
const replyPreviewText = document.getElementById("reply-preview-text");

// ── ANDROID SCROLL FIX ──────────────────────────────────────────────────────
// Android Chrome bug: when user swipes on chat-messages, the whole page
// scrolls up instead of just the message list. Fix: intercept touch events
// on chat-messages and stop them from reaching body/html.
(function fixAndroidChatScroll() {
  let startY = 0;

  chatMessages.addEventListener("touchstart", function(e) {
    startY = e.touches[0].clientY;
  }, { passive: true });

  chatMessages.addEventListener("touchmove", function(e) {
    const y = e.touches[0].clientY;
    const scrollTop = chatMessages.scrollTop;
    const maxScroll = chatMessages.scrollHeight - chatMessages.clientHeight;
    const goingUp = y < startY;   // finger moving up = scroll down
    const goingDown = y > startY; // finger moving down = scroll up

    // Only block body scroll when the list itself can still scroll
    if ((goingUp && scrollTop < maxScroll) || (goingDown && scrollTop > 0)) {
      e.stopPropagation();
    } else {
      // At the boundary — prevent the body from bouncing
      e.preventDefault();
    }
  }, { passive: false });
})();

function login() {
  const userId = document.getElementById("user-id").innerText.trim();
  if (!userId) {
    alert("Pehle apni ID enter karein!");
    return;
  }
  loggedInUser = userId;
  p1Name = userId;
  document.getElementById("welcome-text").textContent = "Welcome, " + userId;
  showPage("main-menu");
}

function quit() {
  document.getElementById("user-id").innerText = "";
  loggedInUser = "You";
  if (chatUnsubscribe) chatUnsubscribe();
  cancelOnlineSearch();
  removePresence();
  showPage("login-page");
}

function showPage(pageId) {
  const pages = [
    "login-page", "main-menu", "game-mode-page", "online-search-page",
    "settings-page", "leaderboard-page", "chat-page", "game-page"
  ];
  pages.forEach(id => document.getElementById(id).classList.add("hidden"));
  document.getElementById(pageId).classList.remove("hidden");
}

function changeTheme(accentColor, backgroundColor, btnEl) {
  p1Color = accentColor;
  document.documentElement.style.setProperty("--accent", accentColor);
  document.documentElement.style.setProperty("--bg", backgroundColor);
  
  if(btnEl) {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
    btnEl.classList.add('selected');
  }
}

/* ==================== GAME MODE LOGIC ==================== */

function startComputerGame() {
  gameMode = "computer";
  myRole = P1;
  p1Name = loggedInUser;
  p2Name = "CPU";
  p2Color = "#ff3eaa";

  document.documentElement.style.setProperty("--accent", p1Color);
  document.documentElement.style.setProperty("--p2-color", p2Color);

  document.getElementById("player-display-name").textContent = p1Name;
  document.getElementById("opponent-display-name").textContent = p2Name;
  gridSelect.disabled = false;
  showPage("game-page");
  initGame(true);
}

async function startOnlineSearch() {
  gameMode = "online";
  showPage("online-search-page");

  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_GAMES,
      [Query.equal('status', 'waiting'), Query.limit(1)]
    );

    if (response.documents.length > 0) {
      const matchDoc = response.documents[0];
      if (matchDoc.player1 === loggedInUser) return;

      myRole = AI;
      let chosenP2Color = p1Color;

      if (chosenP2Color.toLowerCase() === (matchDoc.p1Color || "").toLowerCase()) {
        chosenP2Color = PRESET_COLORS.find(c => c.toLowerCase() !== matchDoc.p1Color.toLowerCase()) || '#ff3eaa';
      }

      currentGameDoc = await databases.updateDocument(
        DATABASE_ID,
        COLLECTION_GAMES,
        matchDoc.$id,
        {
          player2: loggedInUser,
          p2Color: chosenP2Color,
          status: 'playing'
        }
      );

      listenToGameUpdates(matchDoc.$id);
      startCountdownAndPlay(currentGameDoc);
    } else {
      myRole = P1;
      currentGameDoc = await databases.createDocument(
        DATABASE_ID,
        COLLECTION_GAMES,
        ID.unique(),
        {
          player1: loggedInUser,
          p1Color: p1Color,
          player2: "",
          p2Color: "",
          status: "waiting",
          turn: P1,
          lastMove: "",
          isPaused: false,
          isRestarted: false
        }
      );

      listenToGameUpdates(currentGameDoc.$id);
    }
  } catch (err) {
    console.error("Matchmaking error:", err);
    alert("Matchmaking error. Check Appwrite connection.");
    showPage("game-mode-page");
  }
}

async function cancelOnlineSearch() {
  if (currentGameDoc && currentGameDoc.status === 'waiting') {
    try {
      await databases.deleteDocument(DATABASE_ID, COLLECTION_GAMES, currentGameDoc.$id);
    } catch(e) {}
  }
  if (gameUnsubscribe) gameUnsubscribe();
  currentGameDoc = null;
  showPage("game-mode-page");
}

function listenToGameUpdates(gameId) {
  if (gameUnsubscribe) gameUnsubscribe();

  gameUnsubscribe = appwriteClient.subscribe(
    `databases.${DATABASE_ID}.collections.${COLLECTION_GAMES}.documents.${gameId}`,
    response => {
      const doc = response.payload;
      
      if (currentGameDoc && currentGameDoc.status === 'waiting' && doc.status === 'playing') {
        currentGameDoc = doc;
        startCountdownAndPlay(doc);
      }

      if (doc.status === 'playing') {
        if (doc.isPaused !== isPaused) {
          isPaused = doc.isPaused;
          togglePauseUI(isPaused);
        }

        if (doc.isRestarted) {
          initGame(true);
          if (myRole === P1) {
            databases.updateDocument(DATABASE_ID, COLLECTION_GAMES, gameId, { isRestarted: false });
          }
        }

        if (doc.lastMove) {
          const moveData = JSON.parse(doc.lastMove);
          if (moveData.sender !== myRole) {
            executeMoveLocally(moveData.type, moveData.r, moveData.c, moveData.sender);
          }
        }
      }
    }
  );
}

function startCountdownAndPlay(doc) {
  p1Name = doc.player1;
  p2Name = doc.player2 || "Player 2";
  p1Color = doc.p1Color || "#3295ff";
  p2Color = doc.p2Color || "#ff3eaa";

  document.documentElement.style.setProperty("--accent", p1Color);
  document.documentElement.style.setProperty("--p2-color", p2Color);

  document.getElementById("player-display-name").textContent = p1Name;
  document.getElementById("opponent-display-name").textContent = p2Name;
  gridSelect.disabled = true;

  showPage("game-page");
  initGame(true);

  const overlay = document.getElementById("countdown-overlay");
  const countText = document.getElementById("countdown-text");
  overlay.classList.remove("hidden");

  let count = 3;
  countText.textContent = count;

  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      countText.textContent = count;
    } else if (count === 0) {
      countText.textContent = "Ready Go!";
    } else {
      clearInterval(timer);
      overlay.classList.add("hidden");
    }
  }, 900);
}

function leaveGame() {
  if (gameUnsubscribe) gameUnsubscribe();
  showPage("main-menu");
}

/* ==================== CORE GAME LOGIC ==================== */

function initGame(fullReset = false) {
  gridSize = parseInt(gridSelect.value);
  p1Score = 0;
  aiScore = 0;
  p1ScoreEl.textContent = "0";
  aiScoreEl.textContent = "0";
  modal.style.display = "none";
  isPaused = false;
  togglePauseUI(false);

  if (fullReset) {
    startingPlayer = P1;
  } else {
    startingPlayer = startingPlayer === P1 ? AI : P1;
  }

  currentPlayer = startingPlayer;

  hLines = Array.from({ length:gridSize + 1 }, () => Array(gridSize).fill(null));
  vLines = Array.from({ length:gridSize }, () => Array(gridSize + 1).fill(null));
  boxes = Array.from({ length:gridSize }, () => Array(gridSize).fill(null));
  lastMoveEl = null;

  updateTurnUI();
  renderBoard();
  fitBoardToScreen();
  requestAnimationFrame(fitBoardToScreen); // catch any late layout settling (safe-area, fonts)

  if (gameMode === "computer" && currentPlayer === AI) {
    setTimeout(aiMove, 500);
  }
}

// Sizes the board's dots/lines/boxes so the whole grid fills the space
// available between the header and footer — bigger cells on small grids
// (e.g. 3x3), smaller cells on big grids (e.g. 10x10) — instead of using
// fixed pixel sizes per grid option.
function fitBoardToScreen() {
  if (!boardWrapperEl || !boardEl || !gridSize) return;

  const wrapW = boardWrapperEl.clientWidth;
  const wrapH = boardWrapperEl.clientHeight;
  if (wrapW <= 0 || wrapH <= 0) return;

  const n = gridSize;
  const boardChrome = 20; // .board padding (10px each side)
  const safety = 6;       // small breathing margin so it never touches the edges
  const usableW = wrapW - boardChrome - safety;
  const usableH = wrapH - boardChrome - safety;

  // Dots shrink a little on bigger grids so more room goes to the cells
  const dot = Math.max(6, Math.min(14, 16 - n));

  let cell = Math.floor(Math.min(
    (usableW - (n + 1) * dot) / n,
    (usableH - (n + 1) * dot) / n
  ));
  cell = Math.max(14, Math.min(140, cell));

  const thick = Math.max(4, Math.min(14, Math.round(cell * 0.18)));

  boardEl.style.setProperty("--dot", dot + "px");
  boardEl.style.setProperty("--cell", cell + "px");
  boardEl.style.setProperty("--thick", thick + "px");
}

function renderBoard() {
  boardEl.innerHTML = "";
  boardEl.className = "board grid-" + gridSize;

  for (let r = 0; r <= gridSize; r++) {
    const hRow = document.createElement("div");
    hRow.className = "row";

    for (let c = 0; c < gridSize; c++) {
      const dot = document.createElement("div");
      dot.className = "dot";
      hRow.appendChild(dot);

      const line = document.createElement("div");
      line.className = "h-line line";
      line.dataset.type = "h";
      line.dataset.r = r;
      line.dataset.c = c;
      line.addEventListener("click", handleLineClick);
      hRow.appendChild(line);
    }

    const lastDot = document.createElement("div");
    lastDot.className = "dot";
    hRow.appendChild(lastDot);
    boardEl.appendChild(hRow);

    if (r < gridSize) {
      const vRow = document.createElement("div");
      vRow.className = "row";

      for (let c = 0; c <= gridSize; c++) {
        const line = document.createElement("div");
        line.className = "v-line line";
        line.dataset.type = "v";
        line.dataset.r = r;
        line.dataset.c = c;
        line.addEventListener("click", handleLineClick);
        vRow.appendChild(line);

        if (c < gridSize) {
          const box = document.createElement("div");
          box.className = "box";
          box.id = `box-${r}-${c}`;
          vRow.appendChild(box);
        }
      }
      boardEl.appendChild(vRow);
    }
  }
}

async function handleLineClick(event) {
  if (isPaused) return;
  if (currentPlayer !== myRole) return;

  const type = event.target.dataset.type;
  const r = parseInt(event.target.dataset.r);
  const c = parseInt(event.target.dataset.c);

  if (gameMode === "online") {
    if (executeMoveLocally(type, r, c, myRole)) {
      try {
        await databases.updateDocument(
          DATABASE_ID,
          COLLECTION_GAMES,
          currentGameDoc.$id,
          {
            lastMove: JSON.stringify({ type, r, c, sender: myRole }),
            turn: currentPlayer
          }
        );
      } catch (err) {
        console.error("Online move update failed", err);
      }
    }
  } else {
    if (executeMoveLocally(type, r, c, P1)) {
      if (checkGameOver()) return;
      if (currentPlayer === AI) {
        setTimeout(aiMove, 400);
      }
    }
  }
}

function executeMoveLocally(type, r, c, player) {
  const lineArray = type === "h" ? hLines : vLines;
  if (lineArray[r][c] !== null) return false;

  lineArray[r][c] = player;
  const selector = `.line[data-type="${type}"][data-r="${r}"][data-c="${c}"]`;
  const lineElement = document.querySelector(selector);

  if (lineElement) {
    lineElement.classList.add("taken", player);
    if (lastMoveEl) lastMoveEl.classList.remove("last-move");
    lineElement.classList.add("last-move");
    lastMoveEl = lineElement;
  }

  const completed = checkBoxes(type, r, c, player);

  if (completed > 0) {
    if (player === P1) p1Score += completed;
    else aiScore += completed;
    updateScores();
  } else {
    currentPlayer = currentPlayer === P1 ? AI : P1;
    updateTurnUI();
  }

  checkGameOver();
  return true;
}

function checkBoxes(type, r, c, player) {
  let completed = 0;
  getAffectedBoxes(type, r, c).forEach(({br, bc}) => {
    if (boxes[br][bc] === null && getBoxEdgeCount(br, bc) === 4) {
      boxes[br][bc] = player;
      const boxElement = document.getElementById(`box-${br}-${bc}`);
      boxElement.classList.add(`filled-${player}`);

      const initial = (player === P1 ? p1Name : p2Name).charAt(0).toUpperCase();
      boxElement.textContent = initial;
      completed++;
    }
  });
  return completed;
}

function getAffectedBoxes(type, r, c) {
  const result = [];
  if (type === "h") {
    if (r > 0) result.push({br:r - 1, bc:c});
    if (r < gridSize) result.push({br:r, bc:c});
  } else {
    if (c > 0) result.push({br:r, bc:c - 1});
    if (c < gridSize) result.push({br:r, bc:c});
  }
  return result;
}

function getBoxEdgeCount(r, c) {
  let count = 0;
  if (hLines[r][c] !== null) count++;
  if (hLines[r + 1][c] !== null) count++;
  if (vLines[r][c] !== null) count++;
  if (vLines[r][c + 1] !== null) count++;
  return count;
}

function aiMove() {
  if (isPaused || currentPlayer !== AI) return;
  const availableMoves = getAllAvailableMoves();
  if (!availableMoves.length) return;

  for (const move of availableMoves) {
    if (createsBox(move)) {
      executeMoveLocally(move.type, move.r, move.c, AI);
      if (!checkGameOver() && currentPlayer === AI) {
        setTimeout(aiMove, 400);
      }
      return;
    }
  }

  const safeMoves = availableMoves.filter(move => !givesAwayBox(move));
  const choice = safeMoves.length
    ? safeMoves[Math.floor(Math.random() * safeMoves.length)]
    : availableMoves[Math.floor(Math.random() * availableMoves.length)];

  executeMoveLocally(choice.type, choice.r, choice.c, AI);

  if (!checkGameOver() && currentPlayer === AI) {
    setTimeout(aiMove, 400);
  }
}

function getAllAvailableMoves() {
  const moves = [];
  for (let r = 0; r <= gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (hLines[r][c] === null) moves.push({type:"h", r, c});
    }
  }
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c <= gridSize; c++) {
      if (vLines[r][c] === null) moves.push({type:"v", r, c});
    }
  }
  return moves;
}

function createsBox(move) {
  return getAffectedBoxes(move.type, move.r, move.c).some(({br, bc}) => getBoxEdgeCount(br, bc) === 3);
}

function givesAwayBox(move) {
  return getAffectedBoxes(move.type, move.r, move.c).some(({br, bc}) => getBoxEdgeCount(br, bc) === 2);
}

function updateScores() {
  p1ScoreEl.textContent = p1Score;
  aiScoreEl.textContent = aiScore;
}

function updateTurnUI() {
  p1Card.classList.toggle("active-p1", currentPlayer === P1);
  aiCard.classList.toggle("active-ai", currentPlayer === AI);
}

function checkGameOver() {
  if (p1Score + aiScore !== gridSize * gridSize) return false;

  if (p1Score > aiScore) {
    winnerTitle.textContent = `${p1Name} Won!`;
    winnerMsg.textContent = `Score: ${p1Score} - ${aiScore}.`;
  } else if (aiScore > p1Score) {
    winnerTitle.textContent = `${p2Name} Won!`;
    winnerMsg.textContent = `Score: ${aiScore} - ${p1Score}.`;
  } else {
    winnerTitle.textContent = "It's a Tie!";
    winnerMsg.textContent = `Score: ${p1Score} - ${aiScore}.`;
  }

  modal.style.display = "flex";
  return true;
}

async function togglePause() {
  isPaused = !isPaused;
  togglePauseUI(isPaused);

  if (gameMode === "online" && currentGameDoc) {
    try {
      await databases.updateDocument(DATABASE_ID, COLLECTION_GAMES, currentGameDoc.$id, {
        isPaused: isPaused
      });
    } catch(e) {}
  }
}

function togglePauseUI(paused) {
  pauseIcon.textContent = paused ? "▶" : "⏸";
  boardEl.style.opacity = paused ? "0.4" : "1";
  boardEl.style.pointerEvents = paused ? "none" : "auto";
}

async function handleRestart() {
  if (confirm("Restart game?")) {
    if (gameMode === "online" && currentGameDoc) {
      try {
        await databases.updateDocument(DATABASE_ID, COLLECTION_GAMES, currentGameDoc.$id, {
          isRestarted: true
        });
      } catch(e) {}
    } else {
      initGame(true);
    }
  }
}

/* ==================== SECRET CHAT LOGIC (UPDATED) ==================== */
function submitCoupon() {
  const couponInput = document.getElementById("coupon-code");
  if (couponInput.innerText.trim() === "Gorilla") {
    couponInput.innerText = "";
    openSecretChat();
  } else {
    alert("Wrong coupon code!");
  }
}

async function openSecretChat() {
  showPage("chat-page");
  chatMessages.innerHTML = "";
  addChatMessageDoc({ sender: "", text: "Connecting To Chat Room...", $id: "status-msg" }, "status");
  await loadPreviousMessages();
  subscribeToRealtimeChat();
  startPresenceHeartbeat();
  // Show live online count after short delay
  setTimeout(async () => {
    const users = await fetchOnlineUsers();
    updateOnlineCount(users.length);
  }, 1000);
}

async function loadPreviousMessages() {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_MESSAGES,
      [Query.orderDesc('createdAt'), Query.limit(30)]
    );
    chatMessages.innerHTML = "";
    
    const messages = response.documents.reverse();
    messages.forEach(doc => {
      const type = doc.sender === loggedInUser ? "mine" : "other";
      addChatMessageDoc(doc, type);
    });
    trimChatToMax30();
  } catch (error) {
    console.error("Fetch chat error:", error);
    chatMessages.innerHTML = "";
    addChatMessageDoc({ sender: "", text: "Failed to load messages.", $id: "error-msg" }, "status");
  }
}

function subscribeToRealtimeChat() {
  if (chatUnsubscribe) chatUnsubscribe();
  chatUnsubscribe = appwriteClient.subscribe(
    `databases.${DATABASE_ID}.collections.${COLLECTION_MESSAGES}.documents`,
    response => {
      const events = response.events;
      const doc = response.payload;

      if (events.includes("databases.*.collections.*.documents.*.create")) {
        if (doc.sender !== loggedInUser) {
          addChatMessageDoc(doc, "other");
          trimChatToMax30();
        }
      } else if (events.includes("databases.*.collections.*.documents.*.update")) {
        updateChatMessageUI(doc);
      } else if (events.includes("databases.*.collections.*.documents.*.delete")) {
        const targetEl = document.getElementById(`msg-${doc.$id}`);
        if (targetEl) targetEl.remove();
      }
    }
  );
}

function addChatMessageDoc(doc, forceType = null) {
  const type = forceType || (doc.sender === loggedInUser ? "mine" : "other");
  const messageBox = document.createElement("div");
  messageBox.className = "chat-message " + type;
  messageBox.id = `msg-${doc.$id}`;
  messageBox.dataset.doc = JSON.stringify(doc);

  if (type === "status") {
    messageBox.textContent = doc.text;
    chatMessages.appendChild(messageBox);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return;
  }

  // Toggle Actions Bar on Message Click
  messageBox.addEventListener("click", (e) => {
    // Don't toggle if clicking on interactive internal elements
    if (e.target.closest('.msg-act-btn') || e.target.closest('.emoji-picker-popover') || e.target.closest('.reaction-badge') || e.target.closest('.reply-quote')) {
      return;
    }
    
    // Close other opened messages
    document.querySelectorAll('.chat-message.actions-open').forEach(el => {
      if (el !== messageBox) el.classList.remove('actions-open');
    });

    messageBox.classList.toggle("actions-open");
  });

  // Header (Sender Name)
  const senderHeader = document.createElement("div");
  senderHeader.className = "chat-sender";
  
  const senderSpan = document.createElement("span");
  senderSpan.textContent = doc.sender;
  senderHeader.appendChild(senderSpan);

  if (doc.isEdited) {
    const editedSpan = document.createElement("span");
    editedSpan.className = "edited-tag";
    editedSpan.textContent = "(edited)";
    senderHeader.appendChild(editedSpan);
  }
  messageBox.appendChild(senderHeader);

  // Reply Quoted Section
  if (doc.replyTo) {
    try {
      const replyData = typeof doc.replyTo === 'string' ? JSON.parse(doc.replyTo) : doc.replyTo;
      const replyQuote = document.createElement("div");
      replyQuote.className = "reply-quote";
      replyQuote.innerHTML = `<strong>${replyData.sender}:</strong> ${replyData.text}`;
      replyQuote.onclick = (e) => {
        e.stopPropagation();
        const targetMsg = document.getElementById(`msg-${replyData.id}`);
        if (targetMsg) targetMsg.scrollIntoView({ behavior: 'smooth' });
      };
      messageBox.appendChild(replyQuote);
    } catch(e) {}
  }

  // Text Body (or GIF)
  const messageText = document.createElement("div");
  messageText.className = "msg-body";
  if (doc.text && doc.text.startsWith("[GIF]")) {
    const gifUrl = doc.text.slice(5);
    const gifImg = document.createElement("img");
    gifImg.src = gifUrl;
    gifImg.className = "gif-msg-img";
    gifImg.alt = "GIF";
    gifImg.loading = "lazy";
    gifImg.onclick = (e) => e.stopPropagation();
    messageText.appendChild(gifImg);
  } else {
    messageText.textContent = doc.text;
  }
  messageBox.appendChild(messageText);

  // Reactions Display
  const reactionsContainer = document.createElement("div");
  reactionsContainer.className = "reactions-bar";
  renderReactionsUI(reactionsContainer, doc);
  messageBox.appendChild(reactionsContainer);

  // Action Buttons Container
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "msg-actions";

  // Emoji Reaction Button - ONLY FOR RECEIVED MESSAGES
  if (doc.sender !== loggedInUser) {
    const reactBtn = document.createElement("button");
    reactBtn.className = "msg-act-btn";
    reactBtn.textContent = "😃 React";
    reactBtn.onclick = (e) => { 
      e.stopPropagation(); 
      toggleEmojiPicker(doc.$id, messageBox); 
    };
    actionsDiv.appendChild(reactBtn);
  }

  // Reply Button (Available for all messages)
  const replyBtn = document.createElement("button");
  replyBtn.className = "msg-act-btn";
  replyBtn.textContent = "Reply";
  replyBtn.onclick = (e) => {
    e.stopPropagation();
    setReplyTo(doc.$id, doc.sender, doc.text);
  };
  actionsDiv.appendChild(replyBtn);

  // Edit & Delete Buttons - ONLY FOR SENDER
  if (doc.sender === loggedInUser) {
    const editBtn = document.createElement("button");
    editBtn.className = "msg-act-btn";
    editBtn.textContent = "Edit";
    editBtn.onclick = (e) => {
      e.stopPropagation();
      startEditMessage(doc.$id, doc.text);
    };
    actionsDiv.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "msg-act-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteChatMessage(doc.$id);
    };
    actionsDiv.appendChild(deleteBtn);
  }

  messageBox.appendChild(actionsDiv);

  chatMessages.appendChild(messageBox);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateChatMessageUI(doc) {
  const existingEl = document.getElementById(`msg-${doc.$id}`);
  if (!existingEl) return;

  existingEl.dataset.doc = JSON.stringify(doc);

  // Update Body Text (or GIF)
  const bodyEl = existingEl.querySelector(".msg-body");
  if (bodyEl) {
    if (doc.text && doc.text.startsWith("[GIF]")) {
      // GIF messages don't need update
    } else {
      bodyEl.textContent = doc.text;
    }
  }

  // Update Edited status
  const senderHeader = existingEl.querySelector(".chat-sender");
  if (senderHeader && doc.isEdited && !senderHeader.querySelector(".edited-tag")) {
    const editedSpan = document.createElement("span");
    editedSpan.className = "edited-tag";
    editedSpan.textContent = "(edited)";
    senderHeader.appendChild(editedSpan);
  }

  // Update Reactions
  const reactionsContainer = existingEl.querySelector(".reactions-bar");
  if (reactionsContainer) {
    renderReactionsUI(reactionsContainer, doc);
  }
}

function renderReactionsUI(container, doc) {
  container.innerHTML = "";
  if (!doc.reactions) return;

  try {
    const reactionsMap = typeof doc.reactions === 'string' ? JSON.parse(doc.reactions) : doc.reactions;
    
    // Group reactions by emoji
    const emojiCounts = {};
    const userReacted = {};

    Object.entries(reactionsMap).forEach(([user, emoji]) => {
      if (!emojiCounts[emoji]) emojiCounts[emoji] = 0;
      emojiCounts[emoji]++;
      if (user === loggedInUser) userReacted[emoji] = true;
    });

    Object.keys(emojiCounts).forEach(emoji => {
      const badge = document.createElement("div");
      badge.className = "reaction-badge " + (userReacted[emoji] ? "user-reacted" : "");
      badge.innerHTML = `${emoji} <span>${emojiCounts[emoji]}</span>`;
      
      // Allow toggle/react click if it's not own message OR if user already reacted
      if (doc.sender !== loggedInUser) {
        badge.onclick = (e) => {
          e.stopPropagation();
          addReaction(doc.$id, emoji);
        };
      }
      container.appendChild(badge);
    });
  } catch(e) {}
}

function toggleEmojiPicker(msgId, messageBox) {
  const existingPicker = document.querySelector(".emoji-picker-popover");
  if (existingPicker) existingPicker.remove();

  if (activePickerMsgId === msgId) {
    activePickerMsgId = null;
    return;
  }

  activePickerMsgId = msgId;
  const picker = document.createElement("div");
  picker.className = "emoji-picker-popover";

  ALL_EMOJIS.forEach(emoji => {
    const btn = document.createElement("span");
    btn.className = "emoji-btn";
    btn.textContent = emoji;
    btn.onclick = (e) => {
      e.stopPropagation();
      addReaction(msgId, emoji);
      picker.remove();
      activePickerMsgId = null;
    };
    picker.appendChild(btn);
  });

  messageBox.appendChild(picker);
}

document.addEventListener("click", (e) => {
  const isInsideMsg = e.target.closest(".chat-message");
  const isActionBtn = e.target.closest(".msg-act-btn");
  const isEmojiPicker = e.target.closest(".emoji-picker-popover");

  // Close emoji picker on outside click
  if (!isEmojiPicker && !isActionBtn) {
    const picker = document.querySelector(".emoji-picker-popover");
    if (picker) picker.remove();
    activePickerMsgId = null;
  }

  // Close actions menu when clicking anywhere outside a message
  if (!isInsideMsg) {
    document.querySelectorAll(".chat-message.actions-open").forEach(el => {
      el.classList.remove("actions-open");
    });
  }
});

async function addReaction(msgId, emoji) {
  const targetEl = document.getElementById(`msg-${msgId}`);
  if (!targetEl) return;

  const doc = JSON.parse(targetEl.dataset.doc);

  // Security Check: Users cannot react to their own messages
  if (doc.sender === loggedInUser) {
    return;
  }

  let reactionsMap = {};

  if (doc.reactions) {
    try {
      reactionsMap = typeof doc.reactions === 'string' ? JSON.parse(doc.reactions) : doc.reactions;
    } catch(e) {}
  }

  // Toggle reaction logic
  if (reactionsMap[loggedInUser] === emoji) {
    delete reactionsMap[loggedInUser];
  } else {
    reactionsMap[loggedInUser] = emoji;
  }

  try {
    await databases.updateDocument(
      DATABASE_ID,
      COLLECTION_MESSAGES,
      msgId,
      { reactions: JSON.stringify(reactionsMap) }
    );
  } catch (err) {
    console.error("Reaction update failed", err);
  }
}

function setReplyTo(msgId, sender, text) {
  activeReplyTo = { id: msgId, sender, text };
  editingMessageId = null;
  replyPreviewText.textContent = `Replying to ${sender}: "${text}"`;
  replyPreviewBar.classList.remove("hidden");
  chatInput.focus();
}

function cancelReply() {
  activeReplyTo = null;
  editingMessageId = null;
  replyPreviewBar.classList.add("hidden");
  chatInput.innerText = "";
}

function startEditMessage(msgId, currentText) {
  editingMessageId = msgId;
  activeReplyTo = null;
  replyPreviewText.textContent = `Editing Message: "${currentText}"`;
  replyPreviewBar.classList.remove("hidden");
  chatInput.innerText = currentText;
  chatInput.focus();
}

async function deleteChatMessage(msgId) {
  if (!confirm("Delete this message?")) return;
  try {
    await databases.deleteDocument(DATABASE_ID, COLLECTION_MESSAGES, msgId);
    const targetEl = document.getElementById(`msg-${msgId}`);
    if (targetEl) targetEl.remove();
  } catch (err) {
    alert("Could not delete message.");
  }
}

async function clearAllChats() {
  if (!confirm("Sari chats clear ho jayengi dono users ki — sure ho?")) return;

  // 1. Clear UI immediately — instant response
  const chatMsgsEl = document.getElementById("chat-messages");
  chatMsgsEl.innerHTML = "";

  try {
    // 2. Fetch all messages and delete all at once (parallel)
    let keepGoing = true;
    while (keepGoing) {
      const res = await databases.listDocuments(
        DATABASE_ID,
        COLLECTION_MESSAGES,
        [Query.limit(100)]
      );
      if (res.documents.length === 0) break;

      // Delete all fetched docs in parallel — much faster than one by one
      await Promise.all(
        res.documents.map(doc =>
          databases.deleteDocument(DATABASE_ID, COLLECTION_MESSAGES, doc.$id)
        )
      );

      if (res.documents.length < 100) keepGoing = false;
    }
  } catch (err) {
    console.error("Clear error:", err);
    // UI already cleared, DB might have partial delete — acceptable
  }
}

function trimChatToMax30() {
  // Only trims the DISPLAY — never touches the database.
  // This ensures UI shows max 30 messages without deleting any data.
  const realMessages = Array.from(chatMessages.querySelectorAll(".chat-message:not(.status)"));
  while (realMessages.length > 30) {
    const oldestMsg = realMessages.shift();
    oldestMsg.remove();
  }
}

async function cleanUpOldMessages() {
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_MESSAGES,
      [Query.orderDesc('createdAt'), Query.offset(30), Query.limit(10)]
    );

    for (const doc of response.documents) {
      await databases.deleteDocument(DATABASE_ID, COLLECTION_MESSAGES, doc.$id);
    }
  } catch (err) {
    console.error("Cleanup error:", err);
  }
}

async function sendChatMessage() {
  const message = chatInput.innerText.trim();
  if (!message) return;

  // Mode 1: Edit existing message
  if (editingMessageId) {
    const msgId = editingMessageId;
    cancelReply();
    try {
      const updatedDoc = await databases.updateDocument(
        DATABASE_ID,
        COLLECTION_MESSAGES,
        msgId,
        { text: message, isEdited: true }
      );
      updateChatMessageUI(updatedDoc);
    } catch (err) {
      alert("Failed to edit message.");
    }
    return;
  }

  // Mode 2: Send new message (with optional reply)
  const payload = {
    sender: loggedInUser,
    text: message,
    createdAt: new Date().toISOString()
  };

  if (activeReplyTo) {
    payload.replyTo = JSON.stringify(activeReplyTo);
  }

  cancelReply();

  try {
    const newDoc = await databases.createDocument(
      DATABASE_ID,
      COLLECTION_MESSAGES,
      ID.unique(),
      payload
    );
    addChatMessageDoc(newDoc, "mine");
    trimChatToMax30();
    // NOTE: cleanUpOldMessages() intentionally removed.
    // It was deleting old messages from the database permanently,
    // causing messages to disappear for the other user.
    // We only trim the UI display to 30 — old messages stay safe in DB.
  } catch (error) {
    console.error(error);
    alert("Failed to send message. Make sure Appwrite attributes are configured.");
  }
}

/* ==================== EMOJI / GIF PICKER ==================== */

const GIPHY_API_KEY = "FN9GOy48CMyQvN0MmunG1ATaWyLDsqQA";
let pickerOpen = false;
let currentPickerTab = "emoji";
let gifSearchTimeout = null;

// Populate emoji grid on first open
function populateEmojiTab() {
  const container = document.getElementById("content-emoji");
  if (container.children.length > 0) return; // already populated
  ALL_EMOJIS.forEach(emoji => {
    const btn = document.createElement("span");
    btn.className = "panel-emoji-btn";
    btn.textContent = emoji;
    btn.onclick = () => {
      // Insert emoji at cursor position in chat input
      const input = document.getElementById("chat-input");
      input.focus();
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(emoji));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        input.innerText += emoji;
      }
      closePickerPanel();
    };
    container.appendChild(btn);
  });
}

function togglePickerPanel() {
  const panel = document.getElementById("chat-picker-panel");
  pickerOpen = !pickerOpen;
  if (pickerOpen) {
    panel.classList.remove("hidden");
    populateEmojiTab();
    if (currentPickerTab === "gif") loadTrendingGifs();
    // Update emoji btn indicator
    document.querySelector(".chat-emoji-open-btn").style.color = "#3295ff";
  } else {
    closePickerPanel();
  }
}

function closePickerPanel() {
  const panel = document.getElementById("chat-picker-panel");
  panel.classList.add("hidden");
  pickerOpen = false;
  document.querySelector(".chat-emoji-open-btn").style.color = "#9aa8c7";
}

function switchPickerTab(tab) {
  currentPickerTab = tab;

  // Update tab active states
  document.getElementById("tab-emoji").classList.toggle("active", tab === "emoji");
  document.getElementById("tab-gif").classList.toggle("active", tab === "gif");
  document.getElementById("content-emoji").classList.toggle("active", tab === "emoji");
  document.getElementById("content-gif").classList.toggle("active", tab === "gif");

  if (tab === "gif") {
    const grid = document.getElementById("gif-grid");
    if (grid.querySelector(".gif-loading")) {
      loadTrendingGifs();
    }
  }
}

async function loadTrendingGifs() {
  const grid = document.getElementById("gif-grid");
  grid.innerHTML = `<div class="gif-loading">⏳ Trending load ho raha hai...</div>`;
  try {
    const res = await fetch(
      `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=20&rating=pg`
    );
    const data = await res.json();
    renderGifs(data.data);
  } catch(e) {
    grid.innerHTML = `<div class="gif-loading">⚠️ GIFs load nahi hue. Internet check karo.</div>`;
  }
}

async function searchGifs() {
  const query = document.getElementById("gif-search-input").value.trim();
  if (!query) { loadTrendingGifs(); return; }

  const grid = document.getElementById("gif-grid");
  grid.innerHTML = `<div class="gif-loading">🔍 "${query}" search ho raha hai...</div>`;

  try {
    const res = await fetch(
      `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=20&rating=pg`
    );
    const data = await res.json();
    renderGifs(data.data);
  } catch(e) {
    grid.innerHTML = `<div class="gif-loading">⚠️ Search fail ho gayi.</div>`;
  }
}

// Live search on typing
document.addEventListener("DOMContentLoaded", () => {
  const gifSearchInput = document.getElementById("gif-search-input");
  if (gifSearchInput) {
    gifSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { searchGifs(); return; }
      clearTimeout(gifSearchTimeout);
      gifSearchTimeout = setTimeout(searchGifs, 600);
    });
  }
});

function renderGifs(gifs) {
  const grid = document.getElementById("gif-grid");
  grid.innerHTML = "";
  if (!gifs || gifs.length === 0) {
    grid.innerHTML = `<div class="gif-loading">Koi GIF nahi mili 😕</div>`;
    return;
  }
  gifs.forEach(gif => {
    const previewUrl = gif.images.fixed_height_small.url;
    const originalUrl = gif.images.original.url;

    const item = document.createElement("div");
    item.className = "gif-item";
    item.style.cssText = "width:100%;height:100px;overflow:hidden;border-radius:8px;cursor:pointer;background:#0d1117;";

    const img = document.createElement("img");
    img.src = previewUrl;
    img.alt = gif.title || "GIF";
    img.loading = "lazy";
    img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";

    item.appendChild(img);
    item.onclick = () => sendGifMessage(originalUrl, gif.title || "GIF");
    grid.appendChild(item);
  });
}

async function sendGifMessage(gifUrl, gifTitle) {
  closePickerPanel();

  const payload = {
    sender: loggedInUser,
    text: `[GIF]${gifUrl}`,   // store as special marker
    createdAt: new Date().toISOString()
  };

  if (activeReplyTo) {
    payload.replyTo = JSON.stringify(activeReplyTo);
    cancelReply();
  }

  try {
    const newDoc = await databases.createDocument(
      DATABASE_ID,
      COLLECTION_MESSAGES,
      ID.unique(),
      payload
    );
    addChatMessageDoc(newDoc, "mine");
    trimChatToMax30();
  } catch (error) {
    console.error(error);
    alert("GIF send nahi ho saka.");
  }
}

// Close picker when clicking outside
document.addEventListener("click", (e) => {
  if (!pickerOpen) return;
  const panel = document.getElementById("chat-picker-panel");
  const emojiBtn = document.querySelector(".chat-emoji-open-btn");
  if (!panel.contains(e.target) && !emojiBtn.contains(e.target)) {
    closePickerPanel();
  }
});

document.getElementById("chat-send-btn").addEventListener("click", sendChatMessage);
document.getElementById("modal-reset-btn").addEventListener("click", handleRestart);
restartIcon.addEventListener("click", handleRestart);
pauseIcon.addEventListener("click", togglePause);
settingsIcon.addEventListener("click", () => showPage("settings-page"));
