const express = require('express');
const path    = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bajajgo2026';
const API_ORIGIN = process.env.API_ORIGIN || 'https://bajajgo-api-production.up.railway.app';

// ── PostgreSQL ────────────────────────────────────────────────────
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function dbReady() {
  if (!pool) return false;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS driver_waitlist (
        id          BIGSERIAL PRIMARY KEY,
        first_name  VARCHAR(100) NOT NULL,
        last_name   VARCHAR(100) NOT NULL,
        phone       VARCHAR(20)  UNIQUE NOT NULL,
        city        VARCHAR(60),
        plate       VARCHAR(30),
        experience  VARCHAR(20),
        ownership   VARCHAR(20),
        smartphone  VARCHAR(20),
        status      VARCHAR(20)  NOT NULL DEFAULT 'pending',
        notes       TEXT         NOT NULL DEFAULT '',
        joined_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    return true;
  } catch { return false; }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Proxy /api/v1/* and WebSocket to the API server ──────────────
app.use('/api/v1', createProxyMiddleware({
  target: API_ORIGIN,
  changeOrigin: true,
  ws: true,
}));

// ── Auth middleware ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  const pw = req.headers['x-admin-password'] || req.query.pw;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── GET /api/waitlist/count ───────────────────────────────────────
app.get('/api/waitlist/count', async (req, res) => {
  try {
    if (pool) {
      const { rows } = await pool.query('SELECT COUNT(*) FROM driver_waitlist');
      return res.json({ count: parseInt(rows[0].count) });
    }
    res.json({ count: 0 });
  } catch { res.json({ count: 0 }); }
});

// ── POST /api/waitlist/join ───────────────────────────────────────
app.post('/api/waitlist/join', async (req, res) => {
  const { firstName, lastName, phone, city, plate, experience, ownership, smartphone } = req.body;

  if (!firstName || !lastName || !phone || !city) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }

  const phoneClean = ('+251' + phone.replace(/^\+251/, '').replace(/\s/g, ''));
  if (!/^\+251[79]\d{8}$/.test(phoneClean)) {
    return res.status(400).json({ error: 'Please enter a valid Ethiopian phone number.' });
  }

  if (!pool) return res.status(503).json({ error: 'Database not configured.' });

  try {
    const dup = await pool.query('SELECT id FROM driver_waitlist WHERE phone = $1', [phoneClean]);
    if (dup.rows.length > 0) {
      const pos = await pool.query('SELECT COUNT(*) FROM driver_waitlist WHERE id <= $1', [dup.rows[0].id]);
      const total = await pool.query('SELECT COUNT(*) FROM driver_waitlist');
      return res.status(409).json({
        error: 'This phone number is already on the waitlist.',
        position: parseInt(pos.rows[0].count),
        totalCount: parseInt(total.rows[0].count),
      });
    }

    await pool.query(
      `INSERT INTO driver_waitlist (first_name, last_name, phone, city, plate, experience, ownership, smartphone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [firstName, lastName, phoneClean, city, plate || '', experience || '', ownership || '', smartphone || '']
    );

    const { rows } = await pool.query('SELECT COUNT(*) FROM driver_waitlist');
    const totalCount = parseInt(rows[0].count);
    res.json({ position: totalCount, totalCount });
  } catch (err) {
    console.error('waitlist/join error:', err.message);
    res.status(500).json({ error: 'Could not save your info. Please try again.' });
  }
});

// ── GET /api/admin/stats ──────────────────────────────────────────
app.get('/api/admin/stats', requireAuth, async (req, res) => {
  if (!pool) return res.json({ total: 0, todayCount: 0, weekCount: 0, byCity: [], byOwnership: {}, bySmartphone: {}, byExperience: {}, byStatus: {}, dailyCounts: {} });
  try {
    const { rows: all } = await pool.query('SELECT * FROM driver_waitlist ORDER BY joined_at');
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);

    const dailyCounts = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      dailyCounts[d.toISOString().slice(0, 10)] = 0;
    }
    const byCityMap = {}, byExpMap = {};
    const byOwnership = { owner: 0, renter: 0, unknown: 0 };
    const bySmartphone = { android: 0, ios: 0, feature: 0 };
    const byStatus = { pending: 0, approved: 0, rejected: 0 };

    all.forEach(d => {
      const day = d.joined_at.toISOString().slice(0, 10);
      if (dailyCounts[day] !== undefined) dailyCounts[day]++;
      byCityMap[d.city] = (byCityMap[d.city] || 0) + 1;
      byExpMap[d.experience || 'Unknown'] = (byExpMap[d.experience || 'Unknown'] || 0) + 1;
      if (d.ownership === 'owner') byOwnership.owner++;
      else if (d.ownership === 'renter') byOwnership.renter++;
      else byOwnership.unknown++;
      if (d.smartphone === 'yes') bySmartphone.android++;
      else if (d.smartphone === 'ios') bySmartphone.ios++;
      else if (d.smartphone === 'no') bySmartphone.feature++;
      byStatus[d.status] = (byStatus[d.status] || 0) + 1;
    });

    res.json({
      total: all.length,
      todayCount: all.filter(d => d.joined_at.toISOString().slice(0, 10) === todayStr).length,
      weekCount:  all.filter(d => new Date(d.joined_at) >= weekAgo).length,
      byCity: Object.entries(byCityMap).sort((a, b) => b[1] - a[1]),
      byOwnership, bySmartphone, byExperience: byExpMap, byStatus, dailyCounts,
    });
  } catch (err) {
    console.error('admin/stats error:', err.message);
    res.json({ total: 0, todayCount: 0, weekCount: 0, byCity: [], byOwnership: {}, bySmartphone: {}, byExperience: {}, byStatus: {}, dailyCounts: {} });
  }
});

// ── GET /api/admin/drivers ────────────────────────────────────────
app.get('/api/admin/drivers', requireAuth, async (req, res) => {
  if (!pool) return res.json({ drivers: [], total: 0, page: 1, pages: 0 });
  try {
    const { search, city, status, ownership, page = 1, limit = 20 } = req.query;
    let where = 'WHERE 1=1'; const params = [];
    if (search) { params.push(`%${search.toLowerCase()}%`); where += ` AND (LOWER(first_name||' '||last_name) LIKE $${params.length} OR phone LIKE $${params.length} OR LOWER(plate) LIKE $${params.length})`; }
    if (city)      { params.push(city);      where += ` AND city = $${params.length}`; }
    if (status)    { params.push(status);    where += ` AND status = $${params.length}`; }
    if (ownership) { params.push(ownership); where += ` AND ownership = $${params.length}`; }

    const countRes = await pool.query(`SELECT COUNT(*) FROM driver_waitlist ${where}`, params);
    const total = parseInt(countRes.rows[0].count);
    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);
    const { rows } = await pool.query(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", phone, city, plate, experience, ownership, smartphone, status, notes, joined_at AS "joinedAt"
       FROM driver_waitlist ${where} ORDER BY joined_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ drivers: rows, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error('admin/drivers error:', err.message);
    res.json({ drivers: [], total: 0, page: 1, pages: 0 });
  }
});

// ── PATCH /api/admin/drivers/:id ──────────────────────────────────
app.patch('/api/admin/drivers/:id', requireAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database' });
  try {
    const { status, notes } = req.body;
    const sets = []; const params = [];
    if (status !== undefined) { params.push(status); sets.push(`status = $${params.length}`); }
    if (notes  !== undefined) { params.push(notes);  sets.push(`notes = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE driver_waitlist SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/admin/drivers/:id ────────────────────────────────
app.delete('/api/admin/drivers/:id', requireAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database' });
  try {
    await pool.query('DELETE FROM driver_waitlist WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/waitlist/export ──────────────────────────────────────
app.get('/api/waitlist/export', requireAuth, async (req, res) => {
  if (!pool) return res.status(503).send('No database');
  try {
    const { rows } = await pool.query('SELECT * FROM driver_waitlist ORDER BY joined_at');
    const csv = [
      ['#','First Name','Last Name','Phone','City','Plate','Experience','Ownership','Smartphone','Status','Notes','Joined At'],
      ...rows.map((d, i) => [i+1, d.first_name, d.last_name, d.phone, d.city, d.plate, d.experience, d.ownership, d.smartphone, d.status, `"${d.notes||''}"`, d.joined_at.toISOString()])
    ].map(r => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bajajgo-waitlist.csv"');
    res.send(csv);
  } catch (err) { res.status(500).send('Export failed'); }
});

// ── Pages ─────────────────────────────────────────────────────────
app.get('/',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/drivers',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'drivers.html')));
app.get('/admin',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/dashboard',(req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/design',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'design.html')));

dbReady().then(ok => {
  if (ok) console.log('[DB] Waitlist table ready');
  else    console.warn('[DB] No DATABASE_URL — waitlist will return empty data');
});

app.listen(PORT, () => console.log(`BajajGo running on port ${PORT}`));
