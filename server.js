const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bajajgo2026';
const DATA_FILE = path.join(__dirname, 'data', 'waitlist.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    id: Date.now(),
    firstName,
    lastName,
    phone: phoneClean,
    city,
    plate: plate || '',
    experience: experience || '',
    ownership: ownership || '',
    smartphone: smartphone || '',
    joinedAt: new Date().toISOString(),
  };

  list.push(entry);
  saveWaitlist(list);

  res.json({ position: list.length, totalCount: list.length });
});

// GET /admin — simple password-protected signup list
app.get('/admin', (req, res) => {
  const { pw } = req.query;
  if (pw !== ADMIN_PASSWORD) {
    return res.send(`
      <html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#F0F2F5">
        <form style="background:#fff;padding:32px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:center">
          <div style="font-size:32px;margin-bottom:8px">🛺</div>
          <h2 style="margin-bottom:16px">BajajGo Admin</h2>
          <input name="pw" type="password" placeholder="Password"
            style="padding:10px 14px;border:2px solid #E0E6EF;border-radius:10px;font-size:15px;width:200px;display:block;margin:0 auto 12px"/>
          <button type="submit"
            style="padding:10px 24px;background:#F5A623;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer">
            Enter
          </button>
        </form>
      </body></html>
    `);
  }

  const list = readWaitlist();
  const rows = list.map((d, i) => `
    <tr style="border-bottom:1px solid #E0E6EF">
      <td style="padding:10px 12px">${i + 1}</td>
      <td style="padding:10px 12px;font-weight:600">${d.firstName} ${d.lastName}</td>
      <td style="padding:10px 12px">${d.phone}</td>
      <td style="padding:10px 12px">${d.city}</td>
      <td style="padding:10px 12px">${d.plate || '—'}</td>
      <td style="padding:10px 12px">${d.ownership || '—'}</td>
      <td style="padding:10px 12px">${d.smartphone || '—'}</td>
      <td style="padding:10px 12px;color:#8E9DB4;font-size:12px">${new Date(d.joinedAt).toLocaleString()}</td>
    </tr>
  `).join('');

  const cities = list.reduce((acc, d) => { acc[d.city] = (acc[d.city] || 0) + 1; return acc; }, {});
  const cityRows = Object.entries(cities).sort((a, b) => b[1] - a[1])
    .map(([city, count]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E0E6EF"><span>${city}</span><strong>${count}</strong></div>`)
    .join('');

  res.send(`
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"/><title>BajajGo Admin</title></head>
    <body style="font-family:sans-serif;background:#F0F2F5;margin:0;padding:24px">
      <div style="max-width:1100px;margin:0 auto">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <div style="font-size:28px">🛺</div>
          <div>
            <h1 style="margin:0;font-size:22px">BajajGo Driver Waitlist</h1>
            <div style="color:#8E9DB4;font-size:13px">Admin Dashboard</div>
          </div>
          <div style="margin-left:auto;background:#F5A623;color:#fff;padding:10px 20px;border-radius:12px;font-size:22px;font-weight:900">
            ${list.length} Drivers
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 280px;gap:20px">
          <div>
            <div style="background:#fff;border-radius:16px;overflow:auto;box-shadow:0 2px 10px rgba(0,0,0,0.06)">
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <thead>
                  <tr style="background:#1A1A2E;color:#fff">
                    <th style="padding:12px;text-align:left">#</th>
                    <th style="padding:12px;text-align:left">Name</th>
                    <th style="padding:12px;text-align:left">Phone</th>
                    <th style="padding:12px;text-align:left">City</th>
                    <th style="padding:12px;text-align:left">Plate</th>
                    <th style="padding:12px;text-align:left">Ownership</th>
                    <th style="padding:12px;text-align:left">Phone Type</th>
                    <th style="padding:12px;text-align:left">Joined</th>
                  </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="8" style="padding:24px;text-align:center;color:#8E9DB4">No signups yet</td></tr>'}</tbody>
              </table>
            </div>
            <div style="margin-top:12px;text-align:right">
              <a href="/api/waitlist/export?pw=${ADMIN_PASSWORD}"
                style="background:#1A1A2E;color:#fff;padding:8px 18px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:600">
                ⬇ Export CSV
              </a>
            </div>
          </div>

          <div>
            <div style="background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,0.06);margin-bottom:16px">
              <div style="font-weight:700;margin-bottom:12px">Signups by City</div>
              ${cityRows || '<div style="color:#8E9DB4;font-size:13px">No data yet</div>'}
            </div>
            <div style="background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,0.06)">
              <div style="font-weight:700;margin-bottom:12px">Smartphone Type</div>
              ${['yes','ios','no'].map(type => {
                const count = list.filter(d => d.smartphone === type).length;
                const label = type === 'yes' ? 'Android' : type === 'ios' ? 'iPhone' : 'Feature phone';
                return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E0E6EF"><span>${label}</span><strong>${count}</strong></div>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    </body></html>
  `);
});

// GET /api/waitlist/export — CSV download
app.get('/api/waitlist/export', (req, res) => {
  if (req.query.pw !== ADMIN_PASSWORD) return res.status(403).send('Forbidden');
  const list = readWaitlist();
  const csv = [
    ['#', 'First Name', 'Last Name', 'Phone', 'City', 'Plate', 'Experience', 'Ownership', 'Smartphone', 'Joined At'],
    ...list.map((d, i) => [
      i + 1, d.firstName, d.lastName, d.phone, d.city,
      d.plate, d.experience, d.ownership, d.smartphone, d.joinedAt
    ])
  ].map(r => r.join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bajajgo-waitlist.csv"');
  res.send(csv);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/drivers', (req, res) => res.sendFile(path.join(__dirname, 'public', 'drivers.html')));

app.listen(PORT, () => console.log(`BajajGo running on port ${PORT}`));
