require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

const databaseDir = path.join(__dirname, 'database');
const exportsDir = path.join(__dirname, 'exports');
const dbPath = path.join(databaseDir, 'attendance.db');

fs.mkdirSync(databaseDir, { recursive: true });
fs.mkdirSync(exportsDir, { recursive: true });

const db = new sqlite3.Database(dbPath);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const COLORS = [
  '#2563EB', '#16A34A', '#EA580C', '#DC2626', '#7C3AED', '#0891B2',
  '#DB2777', '#92400E', '#4338CA', '#65A30D', '#C2410C', '#BE123C',
  '#6D28D9', '#0F766E', '#C026D3', '#CA8A04', '#1D4ED8', '#15803D',
  '#D97706', '#B91C1C', '#5B21B6', '#0E7490', '#BE185D', '#475569',
  '#0B5CAD', '#00897B', '#F97316', '#E11D48', '#8B5CF6', '#0284C7',
  '#A21CAF', '#4D7C0F', '#A16207', '#9F1239', '#312E81', '#166534',
  '#9A3412', '#86198F', '#0369A1', '#115E59', '#6B7280', '#334155',
  '#F43F5E', '#14B8A6', '#6366F1', '#84CC16', '#F59E0B', '#D946EF'
];

const EVENT_TYPES = [
  { key: 'work_from_home', label: 'עבודה מהבית', privateDefault: 0 },
  { key: 'personal', label: 'סידור אישי', privateDefault: 1 },
  { key: 'vacation', label: 'חופשה', privateDefault: 0 },
  { key: 'sick', label: 'מחלה', privateDefault: 1 },
  { key: 'reserve', label: 'מילואים', privateDefault: 0 },
  { key: 'course', label: 'קורס / השתלמות', privateDefault: 0 },
  { key: 'other', label: 'אחר', privateDefault: 0 }
];

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    id_number TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('employee', 'staff')),
    color TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 1,
    start_time TEXT,
    end_time TEXT,
    note TEXT,
    is_private INTEGER NOT NULL DEFAULT 0,
    approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending', 'approved', 'rejected')),
    approval_note TEXT,
    approved_by INTEGER,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(approved_by) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS export_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    exported_by INTEGER,
    exported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    export_type TEXT NOT NULL DEFAULT 'manual'
  )`);

  await ensureEventTimeColumns();

  const count = await get('SELECT COUNT(*) AS count FROM users');
  if (!count || count.count === 0) {
    await run('INSERT INTO users (full_name, id_number, role, color) VALUES (?, ?, ?, ?)', [
      'משתמש מנהל ראשי', '000000000', 'staff', COLORS[0]
    ]);
  }
}

async function ensureEventTimeColumns() {
  const columns = await all('PRAGMA table_info(events)');
  const names = new Set(columns.map(c => c.name));
  if (!names.has('all_day')) await run('ALTER TABLE events ADD COLUMN all_day INTEGER NOT NULL DEFAULT 1');
  if (!names.has('start_time')) await run('ALTER TABLE events ADD COLUMN start_time TEXT');
  if (!names.has('end_time')) await run('ALTER TABLE events ADD COLUMN end_time TEXT');
}

function validTime(value) {
  return !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, full_name: user.full_name }, JWT_SECRET, { expiresIn: '12h' });
}

function auth(required = true) {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      if (!required) return next();
      return res.status(401).json({ error: 'לא מחובר' });
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await get('SELECT id, full_name, id_number, role, color, active FROM users WHERE id = ? AND active = 1', [decoded.id]);
      if (!user) return res.status(401).json({ error: 'משתמש לא פעיל' });
      req.user = user;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'חיבור לא תקין או שפג תוקפו' });
    }
  };
}

function staffOnly(req, res, next) {
  if (!req.user || req.user.role !== 'staff') return res.status(403).json({ error: 'נדרשת הרשאת מנהל' });
  next();
}

function normalizeIdNumber(value) {
  return String(value || '').replace(/\D/g, '').padStart(9, '0').slice(-9);
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function typeLabel(type) {
  const found = EVENT_TYPES.find(t => t.key === type);
  return found ? found.label : type;
}

async function createCsv(exportedBy = null, exportType = 'manual') {
  const rows = await all(`SELECT e.id, u.full_name, u.id_number, u.role, e.event_type, e.start_date, e.end_date, e.all_day, e.start_time, e.end_time,
      e.note, e.is_private, e.approval_status, e.approval_note, approver.full_name AS approved_by_name,
      e.approved_at, e.created_at, e.updated_at
    FROM events e
    JOIN users u ON u.id = e.user_id
    LEFT JOIN users approver ON approver.id = e.approved_by
    ORDER BY e.start_date DESC, u.full_name ASC`);

  const headers = ['event_id', 'employee_name', 'id_number', 'role', 'event_type', 'start_date', 'end_date', 'all_day', 'start_time', 'end_time', 'note', 'is_private', 'approval_status', 'approval_note', 'approved_by', 'approved_at', 'created_at', 'updated_at'];
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(h === 'event_type' ? typeLabel(row[h]) : row[h])).join(','));
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `attendance-export-${stamp}.csv`;
  const filePath = path.join(exportsDir, fileName);
  fs.writeFileSync(filePath, '\uFEFF' + lines.join('\n'), 'utf8');
  await run('INSERT INTO export_logs (file_name, exported_by, export_type) VALUES (?, ?, ?)', [fileName, exportedBy, exportType]);
  return fileName;
}

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/public/meta', (req, res) => res.json({ colors: COLORS }));

app.post('/api/register', async (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const idNumber = normalizeIdNumber(req.body.id_number);
  const color = String(req.body.color || '').trim();
  if (!fullName || idNumber.length !== 9 || !COLORS.includes(color)) {
    return res.status(400).json({ error: 'שם, תעודת זהות או צבע אינם תקינים' });
  }
  const existsColor = await get('SELECT full_name FROM users WHERE color = ? AND active = 1', [color]);
  if (existsColor) return res.status(400).json({ error: `הצבע כבר תפוס על ידי ${existsColor.full_name}` });
  try {
    const result = await run('INSERT INTO users (full_name, id_number, role, color) VALUES (?, ?, ?, ?)', [fullName, idNumber, 'employee', color]);
    const user = await get('SELECT id, full_name, id_number, role, color, active FROM users WHERE id = ?', [result.id]);
    res.json({ token: signToken(user), user });
  } catch (err) {
    res.status(400).json({ error: 'תעודת הזהות כבר קיימת במערכת' });
  }
});

app.post('/api/login', async (req, res) => {
  const idNumber = normalizeIdNumber(req.body.id_number);
  const user = await get('SELECT id, full_name, id_number, role, color, active FROM users WHERE id_number = ? AND active = 1', [idNumber]);
  if (!user) return res.status(401).json({ error: 'תעודת זהות לא קיימת במערכת' });
  res.json({ token: signToken(user), user });
});

app.get('/api/me', auth(), (req, res) => res.json({ user: req.user }));
app.get('/api/meta', auth(), (req, res) => res.json({ colors: COLORS, eventTypes: EVENT_TYPES }));

app.get('/api/users', auth(), async (req, res) => {
  const users = await all('SELECT id, full_name, id_number, role, color, active, created_at FROM users WHERE active = 1 ORDER BY full_name');
  res.json({ users });
});

app.post('/api/users', auth(), staffOnly, async (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const idNumber = normalizeIdNumber(req.body.id_number);
  const role = req.body.role === 'staff' ? 'staff' : 'employee';
  const color = String(req.body.color || '').trim();
  if (!fullName || idNumber.length !== 9 || !COLORS.includes(color)) return res.status(400).json({ error: 'פרטי משתמש לא תקינים' });
  const existsColor = await get('SELECT full_name FROM users WHERE color = ? AND active = 1', [color]);
  if (existsColor) return res.status(400).json({ error: `הצבע כבר תפוס על ידי ${existsColor.full_name}` });
  try {
    const result = await run('INSERT INTO users (full_name, id_number, role, color) VALUES (?, ?, ?, ?)', [fullName, idNumber, role, color]);
    const user = await get('SELECT id, full_name, id_number, role, color, active FROM users WHERE id = ?', [result.id]);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: 'תעודת הזהות כבר קיימת במערכת' });
  }
});

app.put('/api/users/:id', auth(), staffOnly, async (req, res) => {
  const id = Number(req.params.id);
  const user = await get('SELECT * FROM users WHERE id = ? AND active = 1', [id]);
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });

  const fullName = String(req.body.full_name || user.full_name).trim();
  const role = req.body.role === 'staff' ? 'staff' : 'employee';
  const color = String(req.body.color || user.color).trim();
  if (!fullName || !COLORS.includes(color)) return res.status(400).json({ error: 'פרטים לא תקינים' });
  const existsColor = await get('SELECT id, full_name FROM users WHERE color = ? AND active = 1 AND id != ?', [color, id]);
  if (existsColor) return res.status(400).json({ error: `הצבע כבר תפוס על ידי ${existsColor.full_name}` });

  await run('UPDATE users SET full_name = ?, role = ?, color = ? WHERE id = ?', [fullName, role, color, id]);
  const updated = await get('SELECT id, full_name, id_number, role, color, active FROM users WHERE id = ?', [id]);
  res.json({ user: updated });
});

app.delete('/api/users/:id', auth(), staffOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'לא ניתן למחוק את המשתמש המחובר' });
  await run('UPDATE users SET active = 0 WHERE id = ?', [id]);
  res.json({ ok: true });
});

app.get('/api/events', auth(), async (req, res) => {
  const scope = req.query.scope || 'department';
  const params = [];
  let where = 'u.active = 1';

  if (scope === 'mine') {
    // Personal calendar: show all of the user's events, including rejected events.
    where += ' AND e.user_id = ?';
    params.push(req.user.id);
  } else if (scope === 'approvals') {
    // Staff management screen: staff can see all events so they can approve, reject, or return to pending.
    if (req.user.role !== 'staff') return res.status(403).json({ error: 'נדרשת הרשאת מנהל' });
  } else {
    // Department calendar: show pending and approved events only. Rejected events stay private.
    where += " AND e.approval_status != 'rejected'";
  }

  const rows = await all(`SELECT e.*, u.full_name, u.color, approver.full_name AS approved_by_name
    FROM events e
    JOIN users u ON u.id = e.user_id
    LEFT JOIN users approver ON approver.id = e.approved_by
    WHERE ${where}
    ORDER BY e.start_date ASC, u.full_name ASC`, params);

  const events = rows.map(row => {
    const isMine = row.user_id === req.user.id;
    const isStaff = req.user.role === 'staff';
    const canSeePrivateText = isMine || isStaff || scope === 'mine';
    const safeNote = row.is_private && !canSeePrivateText ? '' : (row.note || '');
    return {
      id: row.id,
      user_id: row.user_id,
      employee: row.full_name,
      title: `${row.full_name} - ${typeLabel(row.event_type)}`,
      event_type: row.event_type,
      event_type_label: typeLabel(row.event_type),
      start_date: row.start_date,
      end_date: row.end_date,
      all_day: row.all_day !== 0,
      start_time: row.start_time || '',
      end_time: row.end_time || '',
      note: safeNote,
      private_note_hidden: Boolean(row.is_private && !canSeePrivateText),
      is_private: Boolean(row.is_private),
      color: row.color,
      approval_status: row.approval_status,
      approval_note: row.approval_note || '',
      approved_by_name: row.approved_by_name || '',
      approved_at: row.approved_at || '',
      can_edit: isMine || isStaff
    };
  });
  res.json({ events });
});

app.post('/api/events', auth(), async (req, res) => {
  const eventType = String(req.body.event_type || 'other');
  if (!EVENT_TYPES.some(t => t.key === eventType)) return res.status(400).json({ error: 'סוג אירוע לא תקין' });
  const startDate = String(req.body.start_date || '').slice(0, 10);
  const endDate = String(req.body.end_date || startDate).slice(0, 10);
  const allDay = req.body.all_day === false || req.body.all_day === 0 ? 0 : 1;
  const startTime = allDay ? '' : String(req.body.start_time || '').slice(0, 5);
  const endTime = allDay ? '' : String(req.body.end_time || '').slice(0, 5);
  const note = String(req.body.note || '').trim();
  const meta = EVENT_TYPES.find(t => t.key === eventType);
  const isPrivate = req.body.is_private === true || req.body.is_private === 1 || meta.privateDefault === 1 ? 1 : 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
    return res.status(400).json({ error: 'תאריכים לא תקינים' });
  }
  if (!allDay && startDate !== endDate) return res.status(400).json({ error: 'שעות אפשריות רק כאשר בוחרים תאריך אחד' });
  if (!allDay && (!validTime(startTime) || !validTime(endTime) || !startTime || !endTime || endTime <= startTime)) {
    return res.status(400).json({ error: 'שעות לא תקינות' });
  }
  const targetUserId = req.user.role === 'staff' && req.body.user_id ? Number(req.body.user_id) : req.user.id;
  const targetUser = await get('SELECT id FROM users WHERE id = ? AND active = 1', [targetUserId]);
  if (!targetUser) return res.status(400).json({ error: 'משתמש לא תקין' });
  const result = await run(`INSERT INTO events (user_id, event_type, start_date, end_date, all_day, start_time, end_time, note, is_private)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [targetUserId, eventType, startDate, endDate, allDay, startTime, endTime, note, isPrivate]);
  res.json({ id: result.id });
});

app.put('/api/events/:id', auth(), async (req, res) => {
  const id = Number(req.params.id);
  const event = await get('SELECT * FROM events WHERE id = ?', [id]);
  if (!event) return res.status(404).json({ error: 'אירוע לא נמצא' });
  if (req.user.role !== 'staff' && event.user_id !== req.user.id) return res.status(403).json({ error: 'אין הרשאה לערוך אירוע זה' });
  const eventType = String(req.body.event_type || event.event_type);
  if (!EVENT_TYPES.some(t => t.key === eventType)) return res.status(400).json({ error: 'סוג אירוע לא תקין' });
  const startDate = String(req.body.start_date || event.start_date).slice(0, 10);
  const endDate = String(req.body.end_date || event.end_date).slice(0, 10);
  const allDay = req.body.all_day === false || req.body.all_day === 0 ? 0 : 1;
  const startTime = allDay ? '' : String(req.body.start_time || '').slice(0, 5);
  const endTime = allDay ? '' : String(req.body.end_time || '').slice(0, 5);
  if (endDate < startDate) return res.status(400).json({ error: 'תאריך סיום לפני תאריך התחלה' });
  if (!allDay && startDate !== endDate) return res.status(400).json({ error: 'שעות אפשריות רק כאשר בוחרים תאריך אחד' });
  if (!allDay && (!validTime(startTime) || !validTime(endTime) || !startTime || !endTime || endTime <= startTime)) {
    return res.status(400).json({ error: 'שעות לא תקינות' });
  }
  const note = String(req.body.note ?? event.note ?? '').trim();
  const isPrivate = req.body.is_private === true || req.body.is_private === 1 ? 1 : 0;
  await run(`UPDATE events SET event_type = ?, start_date = ?, end_date = ?, all_day = ?, start_time = ?, end_time = ?, note = ?, is_private = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [eventType, startDate, endDate, allDay, startTime, endTime, note, isPrivate, id]);
  res.json({ ok: true });
});

app.delete('/api/events/:id', auth(), async (req, res) => {
  const id = Number(req.params.id);
  const event = await get('SELECT * FROM events WHERE id = ?', [id]);
  if (!event) return res.status(404).json({ error: 'אירוע לא נמצא' });
  if (req.user.role !== 'staff' && event.user_id !== req.user.id) return res.status(403).json({ error: 'אין הרשאה למחוק אירוע זה' });
  await run('DELETE FROM events WHERE id = ?', [id]);
  res.json({ ok: true });
});

app.put('/api/events/:id/approval', auth(), staffOnly, async (req, res) => {
  const id = Number(req.params.id);
  const status = ['pending', 'approved', 'rejected'].includes(req.body.approval_status) ? req.body.approval_status : 'pending';
  const note = String(req.body.approval_note || '').trim();
  const approvedAt = status === 'pending' ? null : new Date().toISOString();
  const approvedBy = status === 'pending' ? null : req.user.id;
  await run(`UPDATE events SET approval_status = ?, approval_note = ?, approved_by = ?, approved_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, note, approvedBy, approvedAt, id]);
  res.json({ ok: true });
});

app.post('/api/export', auth(), staffOnly, async (req, res) => {
  const fileName = await createCsv(req.user.id, 'manual');
  res.json({ fileName, url: `/exports/${fileName}` });
});

app.get('/api/exports', auth(), staffOnly, async (req, res) => {
  const rows = await all(`SELECT l.*, u.full_name AS exported_by_name FROM export_logs l LEFT JOIN users u ON u.id = l.exported_by ORDER BY l.exported_at DESC LIMIT 50`);
  res.json({ exports: rows });
});

app.use('/exports', auth(), staffOnly, express.static(exportsDir));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDb().then(() => {
  if (process.env.AUTO_EXPORT_ENABLED === 'true') {
    cron.schedule(process.env.AUTO_EXPORT_CRON || '0 1 * * *', async () => {
      try { await createCsv(null, 'auto'); } catch (err) { console.error('Auto export failed:', err); }
    });
  }
  app.listen(PORT, () => console.log(`Attendance system running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
