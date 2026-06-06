const state = {
  token: localStorage.getItem('token') || '',
  user: null,
  users: [],
  eventTypes: [],
  colors: [],
  mineEvents: [],
  deptEvents: [],
  approvalEvents: [],
  mineMonth: new Date(),
  deptMonth: new Date(),
  mineView: 'month',
  deptView: 'month',
  activeTab: 'mine'
};

const $ = (id) => document.getElementById(id);

function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(path, { ...options, headers }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'שגיאה כללית');
    return data;
  });
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(date) {
  return new Date(date + 'T00:00:00').toLocaleDateString('he-IL');
}

function approvalText(status) {
  if (status === 'approved') return 'אושר';
  if (status === 'rejected') return 'לא אושר';
  return 'ממתין לאישור';
}

function approvalClass(status) {
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  return 'pending';
}

function eventTypeLabel(key) {
  return (state.eventTypes.find(t => t.key === key) || {}).label || key;
}

function showApp() {
  $('loginScreen').classList.add('hidden');
  $('appScreen').classList.remove('hidden');
  $('currentUserText').textContent = `${state.user.full_name} | ${state.user.role === 'staff' ? 'מנהל' : 'עובד'}`;
  $('adminTabBtn').classList.toggle('hidden', state.user.role !== 'staff');
  $('staffUserField').classList.toggle('hidden', state.user.role !== 'staff');
}

function showLogin() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('token');
  $('loginScreen').classList.remove('hidden');
  $('appScreen').classList.add('hidden');
}

async function init() {
  bindEvents();
  if (!state.token) return showLogin();
  try {
    const me = await api('/api/me');
    state.user = me.user;
    await loadBaseData();
    showApp();
    await refreshAll();
  } catch (err) {
    showLogin();
  }
}

function bindEvents() {
  $('loginForm').addEventListener('submit', login);
  $('signupForm').addEventListener('submit', signup);
  $('showLoginBtn').addEventListener('click', () => setAuthMode('login'));
  $('showSignupBtn').addEventListener('click', () => setAuthMode('signup'));
  $('logoutBtn').addEventListener('click', showLogin);
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  $('eventForm').addEventListener('submit', saveEvent);
  $('resetEventForm').addEventListener('click', resetEventForm);
  $('userForm').addEventListener('submit', saveUser);
  $('resetUserForm').addEventListener('click', resetUserForm);
  $('exportBtn').addEventListener('click', exportCsv);
  $('minePrev').addEventListener('click', () => changePeriod('mine', -1));
  $('mineNext').addEventListener('click', () => changePeriod('mine', 1));
  $('deptPrev').addEventListener('click', () => changePeriod('dept', -1));
  $('deptNext').addEventListener('click', () => changePeriod('dept', 1));
  $('mineView').addEventListener('change', () => { state.mineView = $('mineView').value; renderCalendars(); });
  $('deptView').addEventListener('change', () => { state.deptView = $('deptView').value; renderCalendars(); });
  $('eventType').addEventListener('change', applyPrivateDefault);
  $('allDayMode').addEventListener('change', () => setTimeMode(true));
  $('hoursMode').addEventListener('change', () => setTimeMode(false));
  $('startDate').addEventListener('change', syncDateAndTimeMode);
  $('endDate').addEventListener('change', syncDateAndTimeMode);
}


function setAuthMode(mode) {
  const signup = mode === 'signup';
  $('loginForm').classList.toggle('hidden', signup);
  $('signupForm').classList.toggle('hidden', !signup);
  $('showLoginBtn').classList.toggle('active', !signup);
  $('showSignupBtn').classList.toggle('active', signup);
  if (signup && state.colors.length) renderSignupColorPalette();
}

async function loadPublicMeta() {
  try {
    const meta = await api('/api/public/meta');
    state.colors = meta.colors;
    renderSignupColorPalette();
  } catch (err) {
    // The login screen can still work even if public metadata failed.
  }
}

async function signup(e) {
  e.preventDefault();
  const payload = {
    full_name: $('signupFullName').value,
    id_number: $('signupId').value,
    color: $('signupColor').value
  };
  try {
    const data = await api('/api/register', { method: 'POST', body: JSON.stringify(payload) });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', state.token);
    await loadBaseData();
    showApp();
    await refreshAll();
    toast('המשתמש נוצר בהצלחה');
  } catch (err) {
    toast(err.message);
  }
}

function renderSignupColorPalette() {
  if (!$('signupColorPalette') || !state.colors.length) return;
  const selected = $('signupColor').value;
  $('signupColorPalette').innerHTML = state.colors.map(color => {
    const used = state.users.find(u => u.color === color);
    return `<div title="${used ? 'תפוס: ' + used.full_name : color}" class="color-choice ${used ? 'used' : ''} ${selected === color ? 'selected' : ''}" style="background:${color}" onclick="selectSignupColor('${color}', ${used ? 'true' : 'false'})"></div>`;
  }).join('');
}

window.selectSignupColor = function(color, used) {
  if (used) return toast('הצבע כבר תפוס על ידי משתמש אחר');
  $('signupColor').value = color;
  renderSignupColorPalette();
};

async function login(e) {
  e.preventDefault();
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ id_number: $('loginId').value }) });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', state.token);
    await loadBaseData();
    showApp();
    await refreshAll();
  } catch (err) {
    toast(err.message);
  }
}

async function loadBaseData() {
  const meta = await api('/api/meta');
  state.colors = meta.colors;
  state.eventTypes = meta.eventTypes;
  renderEventTypes();
  renderSignupColorPalette();
  await loadUsers();
}

async function loadUsers() {
  const data = await api('/api/users');
  state.users = data.users;
  renderUsersSelect();
  renderUsersList();
  renderColorPalette();
  renderSignupColorPalette();
}

async function refreshAll() {
  const requests = [
    api('/api/events?scope=mine'),
    api('/api/events?scope=department')
  ];
  if (state.user && state.user.role === 'staff') {
    requests.push(api('/api/events?scope=approvals'));
  }

  const results = await Promise.all(requests);
  state.mineEvents = results[0].events;
  state.deptEvents = results[1].events;
  state.approvalEvents = results[2] ? results[2].events : [];
  renderCalendars();
  renderEventLists();
  if (state.user.role === 'staff') await loadExports();
}

function setTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('mineTab').classList.toggle('hidden', tab !== 'mine');
  $('departmentTab').classList.toggle('hidden', tab !== 'department');
  $('adminTab').classList.toggle('hidden', tab !== 'admin');

  // The add-event form belongs only to the personal calendar.
  // Department calendar and manager/admin screens stay focused on viewing and management only.
  const eventPanel = $('eventPanel');
  if (eventPanel) eventPanel.classList.toggle('hidden', tab !== 'mine');
}

function renderEventTypes() {
  $('eventType').innerHTML = state.eventTypes.map(t => `<option value="${t.key}">${t.label}</option>`).join('');
}

function renderUsersSelect() {
  $('eventUser').innerHTML = state.users.map(u => `<option value="${u.id}" ${u.id === state.user.id ? 'selected' : ''}>${u.full_name}</option>`).join('');
}

function applyPrivateDefault() {
  const meta = state.eventTypes.find(t => t.key === $('eventType').value);
  $('isPrivate').checked = Boolean(meta && meta.privateDefault);
}

function setTimeMode(isAllDay) {
  $('allDay').checked = isAllDay;
  $('allDayMode').checked = isAllDay;
  $('hoursMode').checked = !isAllDay;
  updateTimeMode();
}

function updateTimeMode() {
  const singleDay = $('startDate').value && $('startDate').value === $('endDate').value;
  if (!singleDay) {
    $('allDay').checked = true;
    $('allDayMode').checked = true;
    $('hoursMode').checked = false;
    $('hoursMode').disabled = true;
    $('hoursOption').classList.add('disabled');
    $('timeModeHint').textContent = 'בחירת שעות זמינה רק כאשר מתאריך ועד תאריך הם אותו יום.';
    $('startTime').value = '';
    $('endTime').value = '';
  } else {
    $('hoursMode').disabled = false;
    $('hoursOption').classList.remove('disabled');
    $('timeModeHint').textContent = 'אפשר לסמן יום שלם, או לבחור שעות לאירוע באותו תאריך.';
  }
  const allowHours = singleDay && !$('allDay').checked;
  $('timeFields').classList.toggle('hidden', !allowHours);
  $('startTime').disabled = !allowHours;
  $('endTime').disabled = !allowHours;
  $('startTime').required = allowHours;
  $('endTime').required = allowHours;
  $('allDayOption').classList.toggle('active', $('allDay').checked);
  $('hoursOption').classList.toggle('active', allowHours);
}

function syncDateAndTimeMode() {
  if ($('startDate').value && (!$('endDate').value || $('endDate').value < $('startDate').value)) {
    $('endDate').value = $('startDate').value;
  }
  updateTimeMode();
}

async function saveEvent(e) {
  e.preventDefault();
  const id = $('eventId').value;
  const payload = {
    user_id: $('eventUser').value,
    event_type: $('eventType').value,
    start_date: $('startDate').value,
    end_date: $('endDate').value,
    all_day: $('allDay').checked,
    start_time: $('startTime').value,
    end_time: $('endTime').value,
    note: $('eventNote').value,
    is_private: $('isPrivate').checked
  };
  if (!payload.all_day) {
    if (payload.start_date !== payload.end_date) return toast('בחירת שעות אפשרית רק כאשר בוחרים תאריך אחד');
    if (!payload.start_time || !payload.end_time || payload.end_time <= payload.start_time) return toast('נא לבחור שעת התחלה ושעת סיום תקינות');
  }
  try {
    if (id) await api(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/events', { method: 'POST', body: JSON.stringify(payload) });
    toast('האירוע נשמר');
    resetEventForm();
    await refreshAll();
  } catch (err) {
    toast(err.message);
  }
}

function resetEventForm() {
  $('eventId').value = '';
  $('eventType').value = state.eventTypes[0]?.key || 'work_from_home';
  $('startDate').value = todayIso();
  $('endDate').value = todayIso();
  setTimeMode(true);
  $('startTime').value = '';
  $('endTime').value = '';
  $('eventNote').value = '';
  if (state.user) $('eventUser').value = state.user.id;
  applyPrivateDefault();
  updateTimeMode();
}

function editEvent(event) {
  $('eventId').value = event.id;
  $('eventType').value = event.event_type;
  $('startDate').value = event.start_date;
  $('endDate').value = event.end_date;
  $('startTime').value = event.start_time || '';
  $('endTime').value = event.end_time || '';
  setTimeMode(event.all_day !== false);
  $('eventNote').value = event.note || '';
  $('isPrivate').checked = event.is_private;
  if (state.user.role === 'staff') $('eventUser').value = event.user_id;
  syncDateAndTimeMode();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteEvent(id) {
  if (!confirm('למחוק את האירוע?')) return;
  try {
    await api(`/api/events/${id}`, { method: 'DELETE' });
    toast('האירוע נמחק');
    await refreshAll();
  } catch (err) {
    toast(err.message);
  }
}

async function setApproval(id, status) {
  const approval_note = prompt('הערת מנהל:', '') || '';
  try {
    await api(`/api/events/${id}/approval`, { method: 'PUT', body: JSON.stringify({ approval_status: status, approval_note }) });
    toast('האישור עודכן');
    await refreshAll();
  } catch (err) {
    toast(err.message);
  }
}

function changePeriod(kind, delta) {
  const key = kind === 'mine' ? 'mineMonth' : 'deptMonth';
  const view = kind === 'mine' ? state.mineView : state.deptView;
  const current = state[key];
  const next = new Date(current);
  if (view === 'month') next.setMonth(current.getMonth() + delta, 1);
  if (view === 'week') next.setDate(current.getDate() + (delta * 7));
  if (view === 'day') next.setDate(current.getDate() + delta);
  state[key] = next;
  renderCalendars();
}

function renderCalendars() {
  renderCalendar('mineCalendar', 'mineTitle', state.mineMonth, state.mineEvents, true, state.mineView);
  renderCalendar('deptCalendar', 'deptTitle', state.deptMonth, state.deptEvents, false, state.deptView);
}

function addDays(date, count) {
  const d = new Date(date);
  d.setDate(d.getDate() + count);
  return d;
}

function isoDate(date) {
  // Use local date parts instead of toISOString().
  // toISOString() converts to UTC and can move the date one day back on Mac/Israel time,
  // which caused week/day views to miss events.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function eventTimeText(ev) {
  if (ev.all_day !== false) return 'יום שלם';
  return `${ev.start_time || ''}${ev.end_time ? ' - ' + ev.end_time : ''}`.trim();
}

function eventTitleText(ev, isMine) {
  const approved = ev.approval_status === 'approved' ? '✓ ' : '';
  const time = ev.all_day === false && ev.start_time ? `${ev.start_time} ` : '';
  return `${approved}${time}${isMine ? ev.event_type_label : ev.title}`;
}

function renderCalendar(elId, titleId, currentDate, events, isMine, view = 'month') {
  const holder = $(elId);
  holder.className = `calendar view-${view}`;

  let start;
  let daysCount;
  let title;
  let month = currentDate.getMonth();
  if (view === 'day') {
    start = new Date(currentDate);
    daysCount = 1;
    title = currentDate.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } else if (view === 'week') {
    start = getWeekStart(currentDate);
    daysCount = 7;
    title = `${fmtDate(isoDate(start))} - ${fmtDate(isoDate(addDays(start, 6)))}`;
  } else {
    const first = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    start = getWeekStart(first);
    daysCount = 42;
    title = currentDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  }

  $(titleId).textContent = title;
  const names = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  let html = names.map(n => `<div class="day-name">${n}</div>`).join('');

  for (let i = 0; i < daysCount; i++) {
    const d = addDays(start, i);
    const iso = isoDate(d);
    const outside = view === 'month' && d.getMonth() !== month;
    const today = iso === todayIso();
    const dayEvents = events.filter(ev => ev.start_date <= iso && ev.end_date >= iso)
      .sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
    const dayLabel = d.toLocaleDateString('he-IL', view === 'month' ? { day: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'numeric' });
    html += `<div class="day ${outside ? 'outside' : ''} ${today ? 'today' : ''} ${dayEvents.length ? 'has-events' : 'no-events'}">
      <div class="day-number">${dayLabel}</div>
      <div class="day-events">
        ${dayEvents.length ? dayEvents.map(ev => `<span class="event-pill" style="background:${ev.color}" onclick="openEventFromCalendar(${ev.id}, ${isMine})"><span>${eventTitleText(ev, isMine)}</span><small>${eventTimeText(ev)}</small></span>`).join('') : '<small class="empty-day">אין אירועים</small>'}
      </div>
    </div>`;
  }
  holder.innerHTML = html;
}

window.openEventFromCalendar = function(id, mine) {
  const source = mine ? state.mineEvents : state.deptEvents;
  const event = source.find(e => e.id === id);
  if (event) alert(`${event.title}\n${fmtDate(event.start_date)} - ${fmtDate(event.end_date)}\n${eventTimeText(event)}\n${event.note || (event.private_note_hidden ? 'הפירוט מוסתר' : '')}\n${approvalText(event.approval_status)}${event.approved_by_name ? ' על ידי ' + event.approved_by_name : ''}`);
};

function renderEventLists() {
  $('mineList').innerHTML = state.mineEvents.length ? state.mineEvents.map(eventCard).join('') : '<p>אין אירועים להצגה.</p>';
  $('departmentList').innerHTML = state.deptEvents.length ? state.deptEvents.map(eventCard).join('') : '<p>אין אירועים להצגה.</p>';
  const approvals = state.user && state.user.role === 'staff' ? state.approvalEvents : [];
  $('approvalList').innerHTML = approvals.length ? approvals.map(eventCard).join('') : '<p>אין אירועים לאישור.</p>';
}

function eventCard(ev) {
  const hiddenNote = ev.private_note_hidden ? 'הפירוט מוסתר ביומן המדורי' : (ev.note || 'אין הערה');
  const approval = ev.approved_by_name ? `${approvalText(ev.approval_status)} על ידי ${ev.approved_by_name}` : approvalText(ev.approval_status);
  return `<article class="event-card">
    <header>
      <strong><span class="dot" style="background:${ev.color}"></span> ${ev.approval_status === 'approved' ? '✓ ' : ''}${ev.title}</strong>
      <span class="badge ${approvalClass(ev.approval_status)}">${approvalText(ev.approval_status)}</span>
    </header>
    <p>${fmtDate(ev.start_date)} - ${fmtDate(ev.end_date)} | ${eventTimeText(ev)}</p>
    <p>${hiddenNote}</p>
    <p><strong>אישור מנהל:</strong> ${approval}${ev.approval_note ? ' | ' + ev.approval_note : ''}</p>
    <div class="card-actions">
      ${ev.can_edit ? `<button class="secondary" onclick='editEventById(${ev.id})'>עריכה</button><button class="danger" onclick="deleteEvent(${ev.id})">מחיקה</button>` : ''}
      ${state.user.role === 'staff' ? `<button class="ok" onclick="setApproval(${ev.id}, 'approved')">אשר</button><button class="danger" onclick="setApproval(${ev.id}, 'rejected')">לא מאשר</button><button class="secondary" onclick="setApproval(${ev.id}, 'pending')">ממתין</button>` : ''}
    </div>
  </article>`;
}

window.editEventById = function(id) {
  const event = [...state.mineEvents, ...state.deptEvents, ...state.approvalEvents].find(e => e.id === id);
  if (event) editEvent(event);
};
window.deleteEvent = deleteEvent;
window.setApproval = setApproval;

function renderColorPalette() {
  const selected = $('userColor').value;
  const editingId = Number($('userId').value || 0);
  $('colorPalette').innerHTML = state.colors.map(color => {
    const used = state.users.find(u => u.color === color && u.id !== editingId);
    return `<div title="${used ? 'תפוס: ' + used.full_name : color}" class="color-choice ${used ? 'used' : ''} ${selected === color ? 'selected' : ''}" style="background:${color}" onclick="selectColor('${color}', ${used ? 'true' : 'false'})"></div>`;
  }).join('');
}

window.selectColor = function(color, used) {
  if (used) return toast('הצבע כבר תפוס על ידי משתמש אחר');
  $('userColor').value = color;
  renderColorPalette();
};

async function saveUser(e) {
  e.preventDefault();
  const id = $('userId').value;
  const payload = {
    full_name: $('fullName').value,
    id_number: $('idNumber').value,
    role: $('role').value,
    color: $('userColor').value
  };
  try {
    if (id) await api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    toast('המשתמש נשמר');
    resetUserForm();
    await loadUsers();
    await refreshAll();
  } catch (err) {
    toast(err.message);
  }
}

function renderUsersList() {
  if (!state.user || state.user.role !== 'staff') return;
  $('usersList').innerHTML = state.users.map(u => `<article class="user-card">
    <header><strong><span class="dot" style="background:${u.color}"></span> ${u.full_name}</strong><span class="badge">${u.role === 'staff' ? 'מנהל' : 'עובד'}</span></header>
    <p>ת.ז: ${u.id_number}</p>
    <div class="card-actions">
      <button class="secondary" onclick="editUser(${u.id})">עריכת פרטים / הרשאה / צבע</button>
      ${u.id !== state.user.id ? `<button class="danger" onclick="deleteUser(${u.id})">מחיקה</button>` : ''}
    </div>
  </article>`).join('');
}

window.editUser = function(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  $('userId').value = u.id;
  $('fullName').value = u.full_name;
  $('idNumber').value = u.id_number;
  $('idNumber').disabled = true;
  $('role').value = u.role;
  $('userColor').value = u.color;
  renderColorPalette();
};

window.deleteUser = async function(id) {
  if (!confirm('למחוק משתמש? האירועים ההיסטוריים יישארו במסד הנתונים אך המשתמש לא יהיה פעיל.')) return;
  try {
    await api(`/api/users/${id}`, { method: 'DELETE' });
    toast('המשתמש נמחק');
    await loadUsers();
    await refreshAll();
  } catch (err) {
    toast(err.message);
  }
};

function resetUserForm() {
  $('userId').value = '';
  $('fullName').value = '';
  $('idNumber').value = '';
  $('idNumber').disabled = false;
  $('role').value = 'employee';
  $('userColor').value = '';
  renderColorPalette();
}

async function downloadFile(url, fileName) {
  const res = await fetch(url, {
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {}
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'לא ניתן להוריד את הקובץ');
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

async function exportCsv() {
  try {
    const data = await api('/api/export', { method: 'POST', body: JSON.stringify({}) });
    toast('קובץ CSV נוצר ומורד למחשב');
    await loadExports();
    await downloadFile(data.url, data.fileName);
  } catch (err) {
    toast(err.message);
  }
}

async function loadExports() {
  if (!state.user || state.user.role !== 'staff') return;
  const data = await api('/api/exports');
  $('exportsList').innerHTML = data.exports.map(x => `
    <article class="export-card">
      <strong>${x.file_name}</strong><br>
      <small>${x.exported_at} | ${x.export_type}</small><br>
      <button class="small-btn" onclick="downloadFile('/exports/${x.file_name}', '${x.file_name}').catch(err => toast(err.message))">הורדה</button>
    </article>
  `).join('') || '<p>אין ייצואים עדיין.</p>';
}

resetEventForm();
loadPublicMeta();
init();
