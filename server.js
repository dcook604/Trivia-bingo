// Trivia Bingo server: host console + player cards over WebSocket.
// Single-file state, persisted to state.json so a container restart mid-game recovers.
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST_KEY = process.env.HOST_KEY || 'bingo-host';
const DATA_FILE = path.join(__dirname, 'data.json');
const STATE_FILE = path.join(__dirname, 'state.json');

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const TERMS = data.terms.map(t => t.term || t);
const FREE = 'FREE';

// ---- game state ----
let state = { players: {}, called: [], winners: [] };
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (saved && typeof saved === 'object') state = saved;
} catch (e) { /* fresh game */ }

function save() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) { console.error('save failed', e.message); }
}

const LINES = [];
for (let r = 0; r < 5; r++) LINES.push([0, 1, 2, 3, 4].map(c => r * 5 + c));
for (let c = 0; c < 5; c++) LINES.push([0, 1, 2, 3, 4].map(r => r * 5 + c));
LINES.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
const LINE_NAMES = [
  'Row 1', 'Row 2', 'Row 3', 'Row 4', 'Row 5',
  'Column 1', 'Column 2', 'Column 3', 'Column 4', 'Column 5',
  'Diagonal ↘', 'Diagonal ↙'
];

function makeCard() {
  const pool = [...TERMS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const card = pool.slice(0, 24);
  card.splice(12, 0, FREE);
  return card;
}

function checkBingo(card) {
  const calledSet = new Set(state.called);
  for (let i = 0; i < LINES.length; i++) {
    if (LINES[i].every(idx => card[idx] === FREE || calledSet.has(card[idx]))) {
      return LINE_NAMES[i];
    }
  }
  return null;
}

// ---- http + ws ----
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcast(msg, filter) {
  const text = JSON.stringify(msg);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN && (!filter || filter(c))) wssSend(c, text);
  });
}
function wssSend(ws, text) { try { ws.send(text); } catch (e) {} }
function send(ws, msg) { wssSend(ws, JSON.stringify(msg)); }

function hostSnapshot() {
  return {
    type: 'host_state', called: state.called,
    players: Object.values(state.players).map(p => p.name),
    winners: state.winners, questions: data.questions
  };
}

wss.on('connection', ws => {
  ws.meta = {};
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === 'join') {
      const name = String(msg.name || '').trim().slice(0, 40) || 'Player';
      const token = crypto.randomBytes(16).toString('hex');
      const card = makeCard();
      state.players[token] = { name, card, joined: Date.now() };
      save();
      ws.meta.token = token;
      send(ws, { type: 'card', token, name, card, called: state.called, winners: state.winners });
      broadcast(hostSnapshot(), c => c.meta.isHost);
      return;
    }

    if (msg.type === 'rejoin') {
      const p = state.players[msg.token];
      if (p) {
        ws.meta.token = msg.token;
        send(ws, { type: 'card', token: msg.token, name: p.name, card: p.card, called: state.called, winners: state.winners });
      } else {
        send(ws, { type: 'rejoin_failed' });
      }
      return;
    }

    if (msg.type === 'bingo') {
      const p = state.players[ws.meta.token || msg.token];
      if (!p) { send(ws, { type: 'bingo_result', ok: false, reason: 'unknown player' }); return; }
      if (state.winners.some(w => w.token === (ws.meta.token || msg.token))) {
        send(ws, { type: 'bingo_result', ok: true, already: true }); return;
      }
      const line = checkBingo(p.card);
      if (line) {
        const entry = { name: p.name, token: ws.meta.token || msg.token, line, at: new Date().toISOString() };
        state.winners.push(entry); save();
        send(ws, { type: 'bingo_result', ok: true, line });
        broadcast({ type: 'winners', winners: state.winners });
        broadcast(hostSnapshot(), c => c.meta.isHost);
      } else {
        send(ws, { type: 'bingo_result', ok: false });
      }
      return;
    }

    if (msg.type === 'host_auth') {
      if (msg.key === HOST_KEY) { ws.meta.isHost = true; send(ws, hostSnapshot()); }
      else send(ws, { type: 'host_denied' });
      return;
    }
    if (!ws.meta.isHost) return;

    if (msg.type === 'call_word') {
      const word = String(msg.word || '').trim();
      if (word && !state.called.includes(word)) {
        state.called.push(word); save();
        broadcast({ type: 'called', word, called: state.called });
        broadcast(hostSnapshot(), c => c.meta.isHost);
      }
      return;
    }
    if (msg.type === 'reset') {
      state = { players: {}, called: [], winners: [] };
      save();
      broadcast({ type: 'reset' });
      broadcast(hostSnapshot(), c => c.meta.isHost);
      return;
    }
  });
});

server.listen(PORT, () => console.log(`Trivia bingo listening on :${PORT}`));
