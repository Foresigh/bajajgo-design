const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bajajgo2026';
const DATA_FILE = path.join(__dirname, 'data', 'waitlist.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Data helpers ──────────────────────────────────────────────
function readWaitlist() {
  try {
    if (!fs.existsSync(path.dirname(DATA_FILE))) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveWaitlist(list) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

// ── Auth middleware ───────────────────────────────────────────
function requireAuth(req, res, next) {
  const pw = req.headers['x-admin-password'] || req.query.pw;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Public endpoints ──────────────────────────────────────────

// GET /api/waitlist/count
app.get('/api/waitlist/count', (req, res) => {
  const list = readWaitlist();
  res.json({ count: list.length });
});

// POST /api/waitlist/join
app.post('/api/waitlist/join', (req, res) => {
  const { firstName, lastName, phone, city, plate, experience, ownership, smartphone } = req.body;

  if (!firstName || !lastName || !phone || !city) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }

  const phoneClean = phone.replace(/\s/g, '');
  if (!/^\+251[79]\d{8}$/.test(phoneClean)) {
    return res.status(400).json({ error: 'Please enter a valid Ethiopian phone number.' });
  }

  const list = readWaitlist();
  const duplicate = list.find(d => d.phone === phoneClean);
  if (duplicate) {
    return res.status(409).json({
      error: 'This phone number is already on the waitlist.',
      position: list.indexOf(duplicate) + 1,
      totalCount: list.length,
    });
  }

  const entry = {
    id: Date.now().toString(),
    firstName,
    lastName,
    phone: phoneClean,
    city,
    plate: plate || '',
    experience: experience || '',
    ownership: ownership || '',
    smartphone: smartphone || '',
    status: 'pending',
    notes: '',
    joinedAt: new Date().toISOString(),
  };

  list.push(entry);
  saveWaitlist(list);
  res.json({ position: list.length, totalCount: list.length });
});

// ── Admin API endpoints ───────────────────────────────────────

// GET /api/admin/stats
app.get('/api/admin/stats', requireAuth, (req, res) => {
  const list = readWaitlist();
  const now = new Date();

  // Signups per day for last 30 days
  const dailyCounts = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dailyCounts[d.toISOString().slice(0, 10)] = 0;
  }
  list.forEach(d => {
    const day = d.joinedAt.slice(0, 10);
    if (dailyCounts[day] !== undefined) dailyCounts[day]++;
  });

  // By city
  const byCityMap = {};
  list.forEach(d => { byCityMap[d.city] = (byCityMap[d.city] || 0) + 1; });
  const byCity = Object.entries(byCityMap).sort((a, b) => b[1] - a[1]);

  // By ownership
  const byOwnership = {
    owner: list.filter(d => d.ownership === 'owner').length,
    renter: list.filter(d => d.ownership === 'renter').length,
    unknown: list.filter(d => !d.ownership).length,
  };

  // By smartphone
  const bySmartphone = {
    android: list.filter(d => d.smartphone === 'yes').length,
    ios: list.filter(d => d.smartphone === 'ios').length,
    feature: list.filter(d => d.smartphone === 'no').length,
  };

  // By experience
  const byExp = {};
  list.forEach(d => {
    const k = d.experience || 'Unknown';
    byExp[k] = (byExp[k] || 0) + 1;
  });

  // By status
  const byStatus = {
    pending:  list.filter(d => d.status === 'pending').length,
    approved: list.filter(d => d.status === 'approved').length,
    rejected: list.filter(d => d.status === 'rejected').length,
  };

  // Today & this week
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  const todayCount = list.filter(d => d.joinedAt.slice(0, 10) === todayStr).length;
  const weekCount  = list.filter(d => new Date(d.joinedAt) >= weekAgo).length;

  res.json({
    total: list.length,
    todayCount,
    weekCount,
    byCity,
    byOwnership,
    bySmartphone,
    byExperience: byExp,
    byStatus,
    dailyCounts,
  });
});

// GET /api/admin/drivers — list with search, filter, pagination
app.get('/api/admin/drivers', requireAuth, (req, res) => {
  let list = readWaitlist();
  const { search, city, status, ownership, page = 1, limit = 20 } = req.query;

  if (search) {
    const q = search.toLowerCase();
    list = list.filter(d =>
      `${d.firstName} ${d.lastName}`.toLowerCase().includes(q) ||
      d.phone.includes(q) ||
      (d.plate && d.plate.toLowerCase().includes(q))
    );
  }
  if (city)      list = list.filter(d => d.city === city);
  if (status)    list = list.filter(d => d.status === status);
  if (ownership) list = list.filter(d => d.ownership === ownership);

  const total = list.length;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const paginated = list
    .slice()
    .reverse()
    .slice((pageNum - 1) * limitNum, pageNum * limitNum);

  res.json({ drivers: paginated, total, page: pageNum, pages: Math.ceil(total / limitNum) });
});

// PATCH /api/admin/drivers/:id — update status or notes
app.patch('/api/admin/drivers/:id', requireAuth, (req, res) => {
  const list = readWaitlist();
  const idx = list.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Driver not found' });

  const { status, notes } = req.body;
  if (status) list[idx].status = status;
  if (notes !== undefined) list[idx].notes = notes;
  saveWaitlist(list);
  res.json(list[idx]);
});

// DELETE /api/admin/drivers/:id
app.delete('/api/admin/drivers/:id', requireAuth, (req, res) => {
  const list = readWaitlist();
  const idx = list.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Driver not found' });
  list.splice(idx, 1);
  saveWaitlist(list);
  res.json({ ok: true });
});

// GET /api/waitlist/export — CSV
app.get('/api/waitlist/export', requireAuth, (req, res) => {
  const list = readWaitlist();
  const csv = [
    ['#', 'First Name', 'Last Name', 'Phone', 'City', 'Plate', 'Experience', 'Ownership', 'Smartphone', 'Status', 'Notes', 'Joined At'],
    ...list.map((d, i) => [
      i + 1, d.firstName, d.lastName, d.phone, d.city,
      d.plate, d.experience, d.ownership, d.smartphone, d.status, `"${d.notes || ''}"`, d.joinedAt
    ])
  ].map(r => r.join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bajajgo-waitlist.csv"');
  res.send(csv);
});

// ── Pages ─────────────────────────────────────────────────────
app.get('/',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/drivers',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'drivers.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/design',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'design.html')));

app.listen(PORT, () => console.log(`BajajGo running on port ${PORT}`));
