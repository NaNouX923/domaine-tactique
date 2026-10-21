'use strict';
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ZONES_FILE = path.join(DATA_DIR, 'zones.json');
const ZONE_TYPES = ['chateau', 'batiment', 'foret', 'plaine', 'lac', 'neutre'];
const PING_KINDS = ['ennemi', 'aide', 'objectif', 'regroup'];

fs.mkdirSync(DATA_DIR, { recursive: true });

let zones;
try {
  zones = JSON.parse(fs.readFileSync(ZONES_FILE, 'utf8'));
} catch {
  zones = JSON.parse(fs.readFileSync(path.join(__dirname, 'zones.default.json'), 'utf8'));
}
const saveZones = () => fs.writeFile(ZONES_FILE, JSON.stringify(zones, null, 2), () => {});

const clean = (s, n) => String(s ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
const num = (v) => (Number.isFinite(+v) ? +v : null);
const floorOk = (f) => Number.isInteger(f) && f >= -1 && f <= 3;

function validZone(z) {
  if (!z || typeof z !== 'object') return null;
  const type = ZONE_TYPES.includes(z.type) ? z.type : null;
  if (!type) return null;
  if (!Array.isArray(z.coords) || z.coords.length < 3 || z.coords.length > 200) return null;
  const coords = [];
  for (const c of z.coords) {
    const lat = num(c?.[0]), lng = num(c?.[1]);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    coords.push([+lat.toFixed(7), +lng.toFixed(7)]);
  }
  const floors = Array.isArray(z.floors) ? [...new Set(z.floors.filter(floorOk))].sort((a, b) => a - b) : [];
  return {
    id: clean(z.id, 40) || Math.random().toString(36).slice(2, 10),
    name: clean(z.name, 40) || 'Zone',
    type,
    floors: (type === 'chateau' || type === 'batiment') ? (floors.length ? floors : [0]) : [],
    coords,
  };
}

const app = express();
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
app.get('/api/zones', (_req, res) => res.json(zones));
app.get('/health', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

const rooms = new Map(); // room -> Map(socketId -> player)

io.on('connection', (sock) => {
  let room = null;

  function leave() {
    if (!room) return;
    const m = rooms.get(room);
    if (m) { m.delete(sock.id); if (!m.size) rooms.delete(room); }
    sock.to(room).emit('left', sock.id);
    sock.leave(room);
    room = null;
  }

  sock.on('join', (d = {}) => {
    const r = clean(d.room, 24).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'domaine';
    leave();
    room = r;
    sock.join(room);
    if (!rooms.has(room)) rooms.set(room, new Map());
    const p = {
      id: sock.id,
      name: clean(d.name, 20) || 'Joueur',
      color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#ff6b35',
      lat: null, lng: null, acc: null, floor: null, zone: null, ztype: null, manual: false,
      ts: Date.now(),
    };
    rooms.get(room).set(sock.id, p);
    sock.emit('init', { me: sock.id, room, players: [...rooms.get(room).values()], zones });
    sock.to(room).emit('player', p);
  });

  sock.on('pos', (d = {}) => {
    const p = room && rooms.get(room)?.get(sock.id);
    if (!p) return;
    const lat = num(d.lat), lng = num(d.lng);
    if (lat === null || lng === null) return;
    Object.assign(p, {
      lat, lng,
      acc: num(d.acc) === null ? null : Math.round(num(d.acc)),
      floor: floorOk(d.floor) ? d.floor : null,
      zone: clean(d.zone, 40) || null,
      ztype: ZONE_TYPES.includes(d.ztype) ? d.ztype : null,
      manual: !!d.manual,
      ts: Date.now(),
    });
    io.to(room).emit('player', p);
  });

  sock.on('ping', (d = {}) => {
    const p = room && rooms.get(room)?.get(sock.id);
    if (!p) return;
    const lat = num(d.lat), lng = num(d.lng);
    if (lat === null || lng === null) return;
    io.to(room).emit('ping', {
      id: sock.id, name: p.name, color: p.color, lat, lng,
      kind: PING_KINDS.includes(d.kind) ? d.kind : 'ennemi',
      floor: floorOk(d.floor) ? d.floor : null,
      ts: Date.now(),
    });
  });

  sock.on('zone:add', (z) => {
    const v = validZone(z);
    if (!v) return;
    v.id = Math.random().toString(36).slice(2, 10);
    zones.push(v);
    saveZones();
    io.emit('zones', zones);
  });

  sock.on('zone:delete', (id) => {
    const before = zones.length;
    zones = zones.filter((z) => z.id !== id);
    if (zones.length !== before) { saveZones(); io.emit('zones', zones); }
  });

  sock.on('zones:import', (list) => {
    if (!Array.isArray(list) || list.length > 300) return;
    const out = list.map(validZone).filter(Boolean);
    if (!out.length) return;
    zones = out;
    saveZones();
    io.emit('zones', zones);
  });

  sock.on('disconnect', leave);
});

server.listen(PORT, () => console.log(`Domaine Tactique en ligne sur http://localhost:${PORT}`));
