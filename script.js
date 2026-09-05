function setDynamicViewportHeight() {
  const vv = window.visualViewport;
  const vh = vv ? vv.height : window.innerHeight;
  const offsetTop = vv ? vv.offsetTop : 0;
  document.body.style.height = `${vh}px`;
  document.body.style.top = `-${offsetTop}px`;
  
  const chatPage = document.getElementById("chat-page");
  if (chatPage && !chatPage.classList.contains("hidden")) {
    chatPage.style.height = `${vh}px`;
    const msgs = document.getElementById("chat-messages");
    if (msgs) setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 60);
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
const COLLECTION_PRESENCE = 'presence';

// ── ONLINE PRESENCE SYSTEM ──────────────────────────────────────────────────
let presenceDocId = null;
let presenceInterval = null;
let onlinePopupVisible = false;

async function registerPresence() {
  if (!loggedInUser) return;
  try {
    if (presenceDocId) {
      await databases.updateDocument(DATABASE_ID, COLLECTION_PRESENCE, presenceDocId, { user: loggedInUser, lastSeen: new Date().toISOString() });
      return;
    }
    const res = await databases.listDocuments(DATABASE_ID, COLLECTION_PRESENCE, [
      Query.equal('user', loggedInUser),
      Query.limit(1)
    ]);
    if (res.documents.length > 0) {
      presenceDocId = res.documents[0].$id;
      await databases.updateDocument(DATABASE_ID, COLLECTION_PRESENCE, presenceDocId, { lastSeen: new Date().toISOString() });
    } else {
      const doc = await databases.createDocument(
        DATABASE_ID, COLLECTION_PRESENCE, ID.unique(),
        { user: loggedInUser, lastSeen: new Date().toISOString() }
      );
      presenceDocId = doc.$id;
    }
  } catch (e) {
    console.warn('Presence write failed:', e);
  }
}

async function removePresence() {
  if (presenceDocId) {
    try { await databases.deleteDocument(DATABASE_ID, COLLECTION_PRESENCE, presenceDocId); } catch(e) {}
    presenceDocId = null;
  }
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
}

function startPresenceHeartbeat() {
  registerPresence();
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = setInterval(registerPresence, 20000);
}

async function fetchOnlineUsers() {
  try {
    const cutoff = new Date(Date.now() - 40000).toISOString();
    const res = await databases.listDocuments(DATABASE_ID, COLLECTION_PRESENCE, [
      Query.greaterThan('lastSeen', cutoff),
      Query.limit(20)
    ]);
    return res.documents.map(d => d.user);
  } catch(e) {
    return [loggedInUser];
  }
}

async function toggleOnlinePopup() {
  const existing = document.getElementById('online-popup-box');
  if (existing) {
    existing.remove();
    onlinePopupVisible = false;
    return;
  }

  const users = await fetchOnlineUsers();
  const popup = document.createElement('div');
  popup.id = 'online-popup-box';
  popup.className = 'online-popup';

  let listHtml = '';
  if (users.length === 0) {
    listHtml = `<div class="online-empty">Koi online nahi hai</div>`;
  } else {
    listHtml = users.map(u => `
      <div class="online-user-row">
        <span class="online-dot"></span>
        <span>${u === loggedInUser ? u + ' (You)' : u}</span>
      </div>
    `).join('');
  }

  popup.innerHTML = `
    <div class="online-popup-header">
      <span>Online Users (${users.length})</span>
      <span class="online-popup-close" onclick="toggleOnlinePopup()">✕</span>
    </div>
    <div class="online-popup-list">${listHtml}</div>
  `;

  document.getElementById('chat-page').appendChild(popup);
  onlinePopupVisible = true;
}

document.addEventListener('click', (e) => {
  if (!onlinePopupVisible) return;
  const popup = document.getElementById('online-popup-box');
  const btn = document.getElementById('online-status-btn');
  if (popup && !popup.contains(e.target) && btn && !btn.contains(e.target)) {
    popup.remove();
    onlinePopupVisible = false;
  }
});

// ── GLOBAL VARIABLES ──
let loggedInUser = "";
let currentMode = "cpu"; 
let currentGridSize = 4;
let currentPlayer = 1; 
let p1Score = 0, p2Score = 0;
let horizontalLines = [], verticalLines = [], boxes = [];
let gameUnsubscribe = null, chatUnsubscribe = null;
let currentGameId = null, onlineRole = null; 
let myPlayerNum = 1; 
let activeReplyTo = null; 

const pages = ["login-page", "main-menu", "game-mode-page", "online-search-page", "settings-page", "leaderboard-page", "chat-page", "game-page"];

// ── PAGE NAVIGATION ──
function showPage(pageId) {
  pages.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.classList.add("hidden");
  });
  const target = document.getElementById(pageId);
  if(target) target.classList.remove("hidden");

  if(pageId === 'chat-page') {
    startPresenceHeartbeat();
    subscribeChat();
    loadRecentMessages();
  } else if(pageId !== 'game-page' && pageId !== 'online-search-page') {
    unsubscribeAll();
    removePresence();
  }
}

function login() {
  const input = document.getElementById("user-id");
  const val = input.innerText.trim();
  if(!val) { alert("Please enter a valid Player ID!"); return; }
  loggedInUser = val;
  document.getElementById("welcome-text").innerText = `Welcome, ${loggedInUser}!`;
  showPage("main-menu");
}

function quit() {
  loggedInUser = "";
  document.getElementById("user-id").innerText = "";
  showPage("login-page");
}

function submitCoupon() {
  const code = document.getElementById("coupon-code").innerText.trim().toUpperCase();
  if(code === "CHAT" || code === "SECRET" || code === "GORILLA") {
    alert("Secret feature unlocked: Secret Live Chat!");
    showPage("chat-page");
  } else {
    alert("Invalid coupon code!");
  }
}

function changeTheme(accentColor, bgColor, btnEl) {
  document.documentElement.style.setProperty('--accent', accentColor);
  document.documentElement.style.setProperty('--bg', bgColor);
  document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
  if(btnEl) btnEl.classList.add('selected');
}

// ── SOUND ENGINE ──
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
  const toggle = document.getElementById("sound-toggle");
  if(!toggle || !toggle.checked) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  const now = audioCtx.currentTime;
  if(type === 'click') {
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.08);
    osc.start(now); osc.stop(now + 0.08);
  } else if(type === 'box') {
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.2);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  } else if(type === 'win') {
    osc.frequency.setValueAtTime(523.25, now); 
    osc.frequency.setValueAtTime(659.25, now + 0.15); 
    osc.frequency.setValueAtTime(783.99, now + 0.3); 
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.5);
    osc.start(now); osc.stop(now + 0.5);
  }
}

// ── SINGLE PLAYER / CPU MODE ──
function startComputerGame() {
  currentMode = "cpu";
  myPlayerNum = 1;
  document.getElementById("player-display-name").innerText = loggedInUser || "You";
  document.getElementById("opponent-display-name").innerText = "CPU";
  showPage("game-page");
  initGame();
}

function initGame() {
  currentGridSize = parseInt(document.getElementById("grid-select").value);
  const totalH = (currentGridSize + 1) * currentGridSize;
  const totalV = currentGridSize * (currentGridSize + 1);
  
  horizontalLines = new Array(totalH).fill(0);
  verticalLines = new Array(totalV).fill(0);
  boxes = new Array(currentGridSize * currentGridSize).fill(0);
  
  currentPlayer = 1;
  p1Score = 0; p2Score = 0;
  updateScoreboard();
  renderBoard();
}

function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  board.className = `board grid-${currentGridSize}`;
  
  let hIdx = 0, vIdx = 0, boxIdx = 0;
  
  for(let r = 0; r <= currentGridSize; r++) {
    const rowDots = document.createElement("div");
    rowDots.className = "row";
    for(let c = 0; c <= currentGridSize; c++) {
      const dot = document.createElement("div");
      dot.className = "dot";
      rowDots.appendChild(dot);
      if(c < currentGridSize) {
        const hLine = document.createElement("div");
        const idx = hIdx++;
        hLine.className = `h-line line ${horizontalLines[idx] ? (horizontalLines[idx]===1?'taken p1':'taken ai') : ''}`;
        hLine.onclick = () => handleLineClick('h', idx);
        rowDots.appendChild(hLine);
      }
    }
    board.appendChild(rowDots);
    
    if(r < currentGridSize) {
      const rowBoxes = document.createElement("div");
      rowBoxes.className = "row";
      for(let c = 0; c <= currentGridSize; c++) {
        const vLine = document.createElement("div");
        const idx = vIdx++;
        vLine.className = `v-line line ${verticalLines[idx] ? (verticalLines[idx]===1?'taken p1':'taken ai') : ''}`;
        vLine.onclick = () => handleLineClick('v', idx);
        rowBoxes.appendChild(vLine);
        
        if(c < currentGridSize) {
          const box = document.createElement("div");
          const bIdx = boxIdx++;
          box.className = `box ${boxes[bIdx] ? (boxes[bIdx]===1?'filled-p1':'filled-ai') : ''}`;
          box.innerText = boxes[bIdx] ? (boxes[bIdx] === 1 ? (loggedInUser ? loggedInUser[0] : 'P1') : (currentMode==='cpu'?'CPU':'P2')) : '';
          rowBoxes.appendChild(box);
        }
      }
      board.appendChild(rowBoxes);
    }
  }
}

function handleLineClick(type, idx) {
  if(currentMode === 'online' && currentPlayer !== myPlayerNum) return; 
  if(type === 'h' && horizontalLines[idx]) return;
  if(type === 'v' && verticalLines[idx]) return;
  
  playSound('click');
  makeMove(type, idx, currentPlayer);
}

function makeMove(type, idx, player) {
  if(type === 'h') horizontalLines[idx] = player;
  else verticalLines[idx] = player;
  
  const completedBoxes = checkNewBoxes(type, idx, player);
  
  if(completedBoxes > 0) {
    playSound('box');
    if(player === 1) p1Score += completedBoxes;
    else p2Score += completedBoxes;
    updateScoreboard();
    
    if(p1Score + p2Score === currentGridSize * currentGridSize) {
      endGame();
      return;
    }
  } else {
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    updateScoreboard();
  }
  
  renderBoard();
  
  if(currentMode === 'cpu' && currentPlayer === 2) {
    setTimeout(cpuTurn, 500);
  } else if(currentMode === 'online') {
    syncOnlineGameState();
  }
}

function checkNewBoxes(type, idx, player) {
  let made = 0;
  const size = currentGridSize;
  
  if(type === 'h') {
    const r = Math.floor(idx / size);
    const c = idx % size;
    if(r > 0) {
      const topBox = (r - 1) * size + c;
      if(isBoxComplete(r - 1, c)) { boxes[topBox] = player; made++; }
    }
    if(r < size) {
      const botBox = r * size + c;
      if(isBoxComplete(r, c)) { boxes[botBox] = player; made++; }
    }
  } else {
    const r = Math.floor(idx / (size + 1));
    const c = idx % (size + 1);
    if(c > 0) {
      const leftBox = r * size + (c - 1);
      if(isBoxComplete(r, c - 1)) { boxes[leftBox] = player; made++; }
    }
    if(c < size) {
      const rightBox = r * size + c;
      if(isBoxComplete(r, c)) { boxes[rightBox] = player; made++; }
    }
  }
  return made;
}

function isBoxComplete(r, c) {
  const size = currentGridSize;
  const top = r * size + c;
  const bot = (r + 1) * size + c;
  const left = r * (size + 1) + c;
  const right = r * (size + 1) + (c + 1);
  return horizontalLines[top] && horizontalLines[bot] && verticalLines[left] && verticalLines[right];
}

function cpuTurn() {
  if(currentPlayer !== 2) return;
  
  const size = currentGridSize;
  let availableH = [], availableV = [];
  horizontalLines.forEach((val, i) => { if(!val) availableH.push(i); });
  verticalLines.forEach((val, i) => { if(!val) availableV.push(i); });
  
  if(availableH.length === 0 && availableV.length === 0) return;
  
  let choice;
  if(availableH.length > 0 && (availableV.length === 0 || Math.random() < 0.5)) {
    choice = { type: 'h', idx: availableH[Math.floor(Math.random() * availableH.length)] };
  } else {
    choice = { type: 'v', idx: availableV[Math.floor(Math.random() * availableV.length)] };
  }
  
  makeMove(choice.type, choice.idx, 2);
}

function updateScoreboard() {
  document.getElementById("p1-score").innerText = p1Score;
  document.getElementById("ai-score").innerText = p2Score;
  
  const p1Card = document.getElementById("p1-card");
  const aiCard = document.getElementById("ai-card");
  
  if(currentPlayer === 1) {
    p1Card.classList.add("active-p1");
    aiCard.classList.remove("active-ai");
  } else {
    aiCard.classList.add("active-ai");
    p1Card.classList.remove("active-p1");
  }
}

function endGame() {
  playSound('win');
  const modal = document.getElementById("game-over-modal");
  const title = document.getElementById("winner-title");
  const msg = document.getElementById("winner-msg");
  
  if(p1Score > p2Score) {
    title.innerText = "Congratulations!";
    msg.innerText = `${loggedInUser || 'Player 1'} Won!`;
  } else if(p2Score > p1Score) {
    title.innerText = "Game Over";
    msg.innerText = `${currentMode==='cpu'?'CPU':'Opponent'} Won!`;
  } else {
    title.innerText = "It's a Draw!";
    msg.innerText = "Equal Boxes!";
  }
  modal.style.display = "flex";
}

function leaveGame() {
  unsubscribeAll();
  showPage("main-menu");
}

document.getElementById("modal-reset-btn").addEventListener("click", () => {
  document.getElementById("game-over-modal").style.display = "none";
  if(currentMode === 'online') {
    startOnlineSearch();
  } else {
    initGame();
  }
});

const restartIcon = document.getElementById("restart-icon");
if (restartIcon) {
  restartIcon.addEventListener("click", () => {
    if(confirm("Are you sure you want to restart the game?")) initGame();
  });
}

document.getElementById("grid-select").addEventListener("change", () => {
  if(currentMode === 'cpu') initGame();
});

// ── MULTIPLAYER ONLINE MATCHMAKING ──
async function startOnlineSearch() {
  currentMode = "online";
  showPage("online-search-page");
  
  try {
    const res = await databases.listDocuments(DATABASE_ID, COLLECTION_GAMES, [
      Query.equal("status", "waiting"),
      Query.limit(1)
    ]);
    
    if(res.documents.length > 0) {
      const gameDoc = res.documents[0];
      if(gameDoc.player1 !== loggedInUser) {
        currentGameId = gameDoc.$id;
        onlineRole = "p2";
        myPlayerNum = 2;
        
        await databases.updateDocument(DATABASE_ID, COLLECTION_GAMES, currentGameId, {
          player2: loggedInUser,
          status: "playing"
        });
        
        setupOnlineMatch(gameDoc.player1, loggedInUser);
        return;
      }
    }
    
    onlineRole = "p1";
    myPlayerNum = 1;
    const newGame = await databases.createDocument(
      DATABASE_ID,
      COLLECTION_GAMES,
      ID.unique(),
      {
        player1: loggedInUser,
        player2: "",
        status: "waiting",
        turn: 1,
        gridSize: 4,
        hLines: JSON.stringify(new Array(20).fill(0)),
        vLines: JSON.stringify(new Array(20).fill(0)),
        boxes: JSON.stringify(new Array(16).fill(0)),
        p1Score: 0,
        p2Score: 0
      }
    );
    currentGameId = newGame.$id;
    
    gameUnsubscribe = appwriteClient.subscribe(
      `databases.${DATABASE_ID}.collections.${COLLECTION_GAMES}.documents.${currentGameId}`,
      response => {
        const payload = response.payload;
        if(payload.status === "playing" && onlineRole === "p1") {
          setupOnlineMatch(payload.player1, payload.player2);
        }
      }
    );
    
  } catch(e) {
    console.error(e);
    alert("Online matchmaking error! Check Appwrite connection/collections.");
    showPage("main-menu");
  }
}

function cancelOnlineSearch() {
  if(currentGameId && onlineRole === "p1") {
    databases.deleteDocument(DATABASE_ID, COLLECTION_GAMES, currentGameId).catch(()=>{});
  }
  unsubscribeAll();
  showPage("main-menu");
}

function setupOnlineMatch(p1Name, p2Name) {
  showPage("game-page");
  document.getElementById("player-display-name").innerText = p1Name;
  document.getElementById("opponent-display-name").innerText = p2Name;
  
  initGame();
  listenToOnlineGame();
}

function listenToOnlineGame() {
  if(gameUnsubscribe) gameUnsubscribe();
  
  gameUnsubscribe = appwriteClient.subscribe(
    `databases.${DATABASE_ID}.collections.${COLLECTION_GAMES}.documents.${currentGameId}`,
    response => {
      const payload = response.payload;
      horizontalLines = JSON.parse(payload.hLines);
      verticalLines = JSON.parse(payload.vLines);
      boxes = JSON.parse(payload.boxes);
      currentPlayer = payload.turn;
      p1Score = payload.p1Score;
      p2Score = payload.p2Score;
      
      updateScoreboard();
      renderBoard();
      
      if(p1Score + p2Score === currentGridSize * currentGridSize) {
        endGame();
      }
    }
  );
}

async function syncOnlineGameState() {
  if(!currentGameId) return;
  try {
    await databases.updateDocument(DATABASE_ID, COLLECTION_GAMES, currentGameId, {
      hLines: JSON.stringify(horizontalLines),
      vLines: JSON.stringify(verticalLines),
      boxes: JSON.stringify(boxes),
      turn: currentPlayer,
      p1Score: p1Score,
      p2Score: p2Score
    });
  } catch(e) {
    console.error("Sync error:", e);
  }
}

function unsubscribeAll() {
  if(gameUnsubscribe) { gameUnsubscribe(); gameUnsubscribe = null; }
  if(chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
  currentGameId = null;
}

// ── SECRET CHAT SYSTEM ──
const POPULAR_EMOJIS = ["😊","😂","❤️","👍","🔥","🎉","😍","😎","🙏","👏","😭","🤔","🥳","💀","✨","💯","🙌","🥺","️💥","🚀"];

function buildEmojiPickerPanel() {
  const container = document.getElementById("content-emoji");
  if (!container || container.children.length > 0) return;
  
  POPULAR_EMOJIS.forEach(emoji => {
    const btn = document.createElement("span");
    btn.className = "panel-emoji-btn";
    btn.innerText = emoji;
    btn.onclick = () => insertEmojiToChat(emoji);
    container.appendChild(btn);
  });
}

function insertEmojiToChat(emoji) {
  const input = document.getElementById("chat-input");
  input.focus();
  document.execCommand("insertText", false, emoji);
}

let pickerOpen = false;
let activePickerTab = "emoji";

function togglePickerPanel() {
  const panel = document.getElementById("chat-picker-panel");
  pickerOpen = !pickerOpen;
  if (pickerOpen) {
    panel.classList.remove("hidden");
    buildEmojiPickerPanel();
    if (activePickerTab === "gif") loadTrendingGifs();
  } else {
    panel.classList.add("hidden");
  }
}

function closePickerPanel() {
  const panel = document.getElementById("chat-picker-panel");
  if (panel) panel.classList.add("hidden");
  pickerOpen = false;
}

function switchPickerTab(tab) {
  activePickerTab = tab;
  document.getElementById("tab-emoji").classList.toggle("active", tab === "emoji");
  document.getElementById("tab-gif").classList.toggle("active", tab === "gif");
  document.getElementById("content-emoji").classList.toggle("active", tab === "emoji");
  document.getElementById("content-gif").classList.toggle("active", tab === "gif");

  if (tab === "emoji") {
    buildEmojiPickerPanel();
  } else if (tab === "gif") {
    loadTrendingGifs();
  }
}

// ── GIPHY INTEGRATION ──
const GIPHY_API_KEY = "dc6zaTOxFJmzC"; 

async function loadTrendingGifs() {
  const grid = document.getElementById("gif-grid");
  grid.innerHTML = `<div class="gif-loading">Trending GIFs load ho rahe hain...</div>`;
  try {
    const res = await fetch(`https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=20&rating=g`);
    const data = await res.json();
    renderGifGrid(data.data);
  } catch (e) {
    grid.innerHTML = `<div class="gif-loading">GIFs load nahi ho sakay.</div>`;
  }
}

async function searchGifs() {
  const q = document.getElementById("gif-search-input").value.trim();
  if (!q) { loadTrendingGifs(); return; }
  const grid = document.getElementById("gif-grid");
  grid.innerHTML = `<div class="gif-loading">Searching "${q}"...</div>`;
  try {
    const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=20&rating=g`);
    const data = await res.json();
    renderGifGrid(data.data);
  } catch (e) {
    grid.innerHTML = `<div class="gif-loading">Search error. Dobara try karein.</div>`;
  }
}

const gifInput = document.getElementById("gif-search-input");
if (gifInput) {
  gifInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchGifs();
  });
}

function renderGifGrid(gifs) {
  const grid = document.getElementById("gif-grid");
  grid.innerHTML = "";
  if (!gifs || gifs.length === 0) {
    grid.innerHTML = `<div class="gif-loading">Koi GIF nahi mila.</div>`;
    return;
  }
  gifs.forEach(gif => {
    const previewUrl = gif.images.fixed_height_small?.url || gif.images.fixed_height?.url;
    const originalUrl = gif.images.fixed_height?.url || gif.images.original?.url;

    const item = document.createElement("div");
    item.className = "gif-item";

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
    text: `[GIF]${gifUrl}`,
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

document.addEventListener("click", (e) => {
  if (!pickerOpen) return;
  const panel = document.getElementById("chat-picker-panel");
  const emojiBtn = document.querySelector(".chat-emoji-open-btn");
  if (panel && !panel.contains(e.target) && emojiBtn && !emojiBtn.contains(e.target)) {
    closePickerPanel();
  }
});

async function loadRecentMessages() {
  try {
    const res = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_MESSAGES,
      [Query.orderAsc("$createdAt"), Query.limit(30)]
    );
    const msgsContainer = document.getElementById("chat-messages");
    msgsContainer.innerHTML = "";
    res.documents.forEach(doc => {
      const isMine = doc.sender === loggedInUser;
      addChatMessageDoc(doc, isMine ? "mine" : "other");
    });
    msgsContainer.scrollTop = msgsContainer.scrollHeight;
  } catch(e) {
    console.error("Failed to load chat history:", e);
  }
}

function subscribeChat() {
  if(chatUnsubscribe) return;
  chatUnsubscribe = appwriteClient.subscribe(
    `databases.${DATABASE_ID}.collections.${COLLECTION_MESSAGES}.documents`,
    response => {
      const event = response.events[0];
      const payload = response.payload;

      if(event.includes(".create")) {
        if(payload.sender !== loggedInUser) {
          addChatMessageDoc(payload, "other");
          trimChatToMax30();
        }
      } else if(event.includes(".update")) {
        updateChatMessageDocUI(payload);
      } else if(event.includes(".delete")) {
        if (payload && payload.$id) {
          removeChatMessageDocUI(payload.$id);
        }
      }
    }
  );
}

async function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const text = input.innerText.trim();
  if(!text) return;

  const payload = {
    sender: loggedInUser,
    text: text,
    createdAt: new Date().toISOString()
  };

  if(activeReplyTo) {
    payload.replyTo = JSON.stringify(activeReplyTo);
    cancelReply();
  }

  input.innerText = "";

  try {
    const newDoc = await databases.createDocument(
      DATABASE_ID,
      COLLECTION_MESSAGES,
      ID.unique(),
      payload
    );
    addChatMessageDoc(newDoc, "mine");
    trimChatToMax30();
  } catch(e) {
    console.error("Message send failed:", e);
  }
}

const chatInputEl = document.getElementById("chat-input");
if (chatInputEl) {
  chatInputEl.addEventListener("keydown", (e) => {
    if(e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
}

function setReplyTo(msgDoc) {
  activeReplyTo = {
    id: msgDoc.$id,
    sender: msgDoc.sender,
    text: msgDoc.text
  };
  const previewBar = document.getElementById("reply-preview-bar");
  const previewText = document.getElementById("reply-preview-text");
  previewText.innerText = `Replying to ${msgDoc.sender}: ${msgDoc.text}`;
  previewBar.classList.remove("hidden");
  document.getElementById("chat-input").focus();
}

function cancelReply() {
  activeReplyTo = null;
  document.getElementById("reply-preview-bar").classList.add("hidden");
}

function addChatMessageDoc(doc, type) {
  const msgs = document.getElementById("chat-messages");
  
  if(document.getElementById(`msg-${doc.$id}`)) return;

  const msgDiv = document.createElement("div");
  msgDiv.id = `msg-${doc.$id}`;
  msgDiv.className = `chat-message ${type}`;

  msgDiv.addEventListener("click", (e) => {
    if(e.target.classList.contains("msg-act-btn") || e.target.classList.contains("emoji-btn") || e.target.classList.contains("reaction-badge")) return;
    document.querySelectorAll(".chat-message.actions-open").forEach(el => {
      if(el !== msgDiv) el.classList.remove("actions-open");
    });
    msgDiv.classList.toggle("actions-open");
  });

  const senderDiv = document.createElement("div");
  senderDiv.className = "chat-sender";
  
  const nameSpan = document.createElement("span");
  nameSpan.innerText = doc.sender;
  senderDiv.appendChild(nameSpan);

  if(doc.isEdited) {
    const editTag = document.createElement("span");
    editTag.className = "edited-tag";
    editTag.innerText = "(edited)";
    senderDiv.appendChild(editTag);
  }

  msgDiv.appendChild(senderDiv);

  if(doc.replyTo) {
    try {
      const replyData = typeof doc.replyTo === "string" ? JSON.parse(doc.replyTo) : doc.replyTo;
      const replyQuote = document.createElement("div");
      replyQuote.className = "reply-quote";
      replyQuote.innerText = `↪ ${replyData.sender}: ${replyData.text}`;
      replyQuote.onclick = (e) => {
        e.stopPropagation();
        const targetEl = document.getElementById(`msg-${replyData.id}`);
        if(targetEl) targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      msgDiv.appendChild(replyQuote);
    } catch(err) {}
  }

  const textDiv = document.createElement("div");
  textDiv.className = "msg-text-content";

  if (doc.text && doc.text.startsWith("[GIF]")) {
    const gifUrl = doc.text.replace("[GIF]", "");
    const img = document.createElement("img");
    img.src = gifUrl;
    img.alt = "GIF";
    img.className = "gif-msg-img";
    img.loading = "lazy";
    img.onclick = (e) => {
      e.stopPropagation();
      window.open(gifUrl, "_blank");
    };
    textDiv.appendChild(img);
  } else {
    textDiv.innerText = doc.text;
  }
  msgDiv.appendChild(textDiv);

  const reactionsBar = document.createElement("div");
  reactionsBar.className = "reactions-bar";
  reactionsBar.id = `reactions-${doc.$id}`;
  renderReactions(reactionsBar, doc.reactions, doc.$id);
  msgDiv.appendChild(reactionsBar);

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "msg-actions";

  const replyBtn = document.createElement("button");
  replyBtn.className = "msg-act-btn";
  replyBtn.innerText = "↩ Reply";
  replyBtn.onclick = (e) => { e.stopPropagation(); setReplyTo(doc); msgDiv.classList.remove("actions-open"); };
  actionsDiv.appendChild(replyBtn);

  const reactBtn = document.createElement("button");
  reactBtn.className = "msg-act-btn";
  reactBtn.innerText = "😊 React";
  reactBtn.onclick = (e) => { e.stopPropagation(); toggleEmojiPicker(doc.$id, msgDiv); };
  actionsDiv.appendChild(reactBtn);

  if(doc.sender === loggedInUser) {
    const editBtn = document.createElement("button");
    editBtn.className = "msg-act-btn";
    editBtn.innerText = "✏ Edit";
    editBtn.onclick = (e) => { e.stopPropagation(); editMessagePrompt(doc); msgDiv.classList.remove("actions-open"); };
    actionsDiv.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "msg-act-btn";
    delBtn.style.color = "#ff7798";
    delBtn.innerText = "🗑 Delete";
    delBtn.onclick = (e) => { e.stopPropagation(); deleteChatMessageDoc(doc.$id); };
    actionsDiv.appendChild(delBtn);
  }

  msgDiv.appendChild(actionsDiv);

  msgs.appendChild(msgDiv);
  msgs.scrollTop = msgs.scrollHeight;
}

function renderReactions(container, reactionsJson, msgId) {
  container.innerHTML = "";
  if(!reactionsJson) return;
  try {
    const reactions = typeof reactionsJson === "string" ? JSON.parse(reactionsJson) : reactionsJson;
    
    Object.keys(reactions).forEach(emoji => {
      const usersArray = reactions[emoji];
      if(usersArray && usersArray.length > 0) {
        const badge = document.createElement("div");
        badge.className = `reaction-badge ${usersArray.includes(loggedInUser) ? 'user-reacted' : ''}`;
        badge.innerText = `${emoji} ${usersArray.length}`;
        badge.onclick = (e) => {
          e.stopPropagation();
          toggleReaction(msgId, emoji);
        };
        container.appendChild(badge);
      }
    });
  } catch(e) {}
}

function toggleEmojiPicker(msgId, msgDiv) {
  let popover = msgDiv.querySelector(".emoji-picker-popover");
  if(popover) {
    popover.remove();
    return;
  }
  
  popover = document.createElement("div");
  popover.className = "emoji-picker-popover";

  POPULAR_EMOJIS.forEach(emoji => {
    const btn = document.createElement("span");
    btn.className = "emoji-btn";
    btn.innerText = emoji;
    btn.onclick = (e) => {
      e.stopPropagation();
      popover.remove();
      msgDiv.classList.remove("actions-open");
      toggleReaction(msgId, emoji);
    };
    popover.appendChild(btn);
  });

  msgDiv.appendChild(popover);
}

async function toggleReaction(msgId, emoji) {
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTION_MESSAGES, msgId);
    let reactions = {};
    if(doc.reactions) {
      reactions = typeof doc.reactions === "string" ? JSON.parse(doc.reactions) : doc.reactions;
    }

    if(!reactions[emoji]) reactions[emoji] = [];

    const index = reactions[emoji].indexOf(loggedInUser);
    if(index > -1) {
      reactions[emoji].splice(index, 1);
      if(reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji].push(loggedInUser);
    }

    await databases.updateDocument(
      DATABASE_ID,
      COLLECTION_MESSAGES,
      msgId,
      { reactions: JSON.stringify(reactions) }
    );
  } catch(e) {
    console.error("Reaction update failed:", e);
  }
}

async function editMessagePrompt(doc) {
  const newText = prompt("Edit your message:", doc.text);
  if(newText !== null && newText.trim() !== "" && newText !== doc.text) {
    try {
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTION_MESSAGES,
        doc.$id,
        { text: newText.trim(), isEdited: true }
      );
    } catch(e) {
      console.error("Edit failed:", e);
    }
  }
}

async function deleteChatMessageDoc(msgId) {
  if(!confirm("Delete this message?")) return;
  try {
    await databases.deleteDocument(DATABASE_ID, COLLECTION_MESSAGES, msgId);
    removeChatMessageDocUI(msgId);
  } catch(e) {
    console.error("Delete failed:", e);
  }
}

function updateChatMessageDocUI(doc) {
  const msgDiv = document.getElementById(`msg-${doc.$id}`);
  if(!msgDiv) return;

  const textContentEl = msgDiv.querySelector(".msg-text-content");
  if(textContentEl) {
    if (doc.text && doc.text.startsWith("[GIF]")) {
      const gifUrl = doc.text.replace("[GIF]", "");
      textContentEl.innerHTML = `<img src="${gifUrl}" alt="GIF" class="gif-msg-img" loading="lazy" onclick="event.stopPropagation();window.open('${gifUrl}','_blank')">`;
    } else {
      textContentEl.innerText = doc.text;
    }
  }

  const senderDiv = msgDiv.querySelector(".chat-sender");
  if(senderDiv && doc.isEdited && !senderDiv.querySelector(".edited-tag")) {
    const editTag = document.createElement("span");
    editTag.className = "edited-tag";
    editTag.innerText = "(edited)";
    senderDiv.appendChild(editTag);
  }

  const reactionsBar = document.getElementById(`reactions-${doc.$id}`);
  if(reactionsBar) {
    renderReactions(reactionsBar, doc.reactions, doc.$id);
  }
}

function removeChatMessageDocUI(msgId) {
  const msgDiv = document.getElementById(`msg-${msgId}`);
  if(msgDiv) msgDiv.remove();
}

async function clearAllChats() {
  if(!confirm("Are you sure you want to clear all chat history? This cannot be undone.")) return;
  try {
    const res = await databases.listDocuments(DATABASE_ID, COLLECTION_MESSAGES, [Query.limit(100)]);
    
    if (res.documents.length === 0) {
      alert("Chat pehle se khaali hai!");
      return;
    }

    const deletePromises = res.documents.map(doc => 
      databases.deleteDocument(DATABASE_ID, COLLECTION_MESSAGES, doc.$id)
    );
    await Promise.all(deletePromises);
    document.getElementById("chat-messages").innerHTML = "";
    alert("All chat messages have been cleared for everyone!");
  } catch(e) {
    console.error("Clear chat error:", e);
    alert("Failed to clear chats. Check Appwrite permissions.");
  }
}

async function trimChatToMax30() {
  try {
    const res = await databases.listDocuments(
      DATABASE_ID,
      COLLECTION_MESSAGES,
      [Query.orderAsc("$createdAt")]
    );
    if(res.documents.length > 30) {
      const deleteCount = res.documents.length - 30;
      for(let i = 0; i < deleteCount; i++) {
        await databases.deleteDocument(DATABASE_ID, COLLECTION_MESSAGES, res.documents[i].$id);
      }
    }
  } catch(e) {
    console.error("Trim chat error:", e);
  }
}
