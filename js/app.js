import { supabase }                        from './supabase.js';
import { getSession, login, logout,
         onAuthChange }                    from './auth.js';
import { getToursByDate, today }           from './tours.js';
import { getBookingsByTours, createBooking,
         updateBooking, deleteBooking,
         calcStats }                       from './bookings.js';
import { toggleCheckin }                   from './checkin.js';
import { subscribeBookings, unsubscribeBookings,
         subscribeTours, unsubscribeTours } from './realtime.js';
import { OPTIONS }                         from './config.js';

// ── Uygulama durumu ────────────────────────────────────────────
const state = {
  date:      today(),
  tours:     [],
  tourId:    null,
  bookings:  [],
  crews:     {},   // { 'River': {tour_guide, staff}, ... }
  search:    '',
  editingId: null,
  view:            'dashboard', // 'dashboard' | 'tourlist' | 'unpaid' | 'alcohol'
  tourCodeFilter:  null,        // null | 'sunset' | 'TA' | 'TN' | 'PRV'
};
const selected = new Set();
const SUNSET_CODES = ['T1', 'TD', 'TB'];
const TOURCODE_META = {
  sunset: { label: '🌅 Sunset' },
  TA:     { label: 'TA' },
  TN:     { label: 'TN' },
  PRV:    { label: 'PRV — Private Tour' },
};

// ── DOM kısayolları ────────────────────────────────────────────
const el = (id) => document.getElementById(id);

// ── Başlangıç ──────────────────────────────────────────────────
async function init() {
  const session = await getSession();
  if (session) {
    await loadAppOptions();   // önce seçenekleri yükle
    fillFormSelects();        // sonra formları doldur
    await showApp();
  } else {
    showLogin();
  }

  onAuthChange(async (event, sess) => {
    if (sess) {
      // Supabase, token yenileme / sekme odaklanma gibi durumlarda da
      // bu olayı tetikler — uygulama zaten açıksa görünümü/veriyi
      // sıfırlama, sadece gerçek bir girişte (login ekranından
      // geliniyorsa) showApp() çalıştır.
      const alreadyIn = !el('app-screen').classList.contains('hidden');
      if (alreadyIn) return;
      await loadAppOptions();
      fillFormSelects();
      await showApp();
    } else {
      showLogin();
    }
  });

  // Login
  el('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('login-error').textContent = '';
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await login(el('login-email').value.trim(), el('login-password').value);
    } catch (err) {
      el('login-error').textContent = err.message || 'Login failed';
      btn.disabled = false;
    }
  });

  // Logout
  el('logout-btn').addEventListener('click', () => logout());

  // Sol menü (sidebar)
  document.querySelectorAll('.sidebar-link').forEach(btn => {
    btn.addEventListener('click', () => {
      showView(btn.dataset.view, btn.dataset.filter || null);
      closeSidebarMobile();
    });
  });
  el('sidebar-toggle').addEventListener('click', () => {
    el('sidebar').classList.toggle('open');
    el('sidebar-backdrop').classList.toggle('hidden');
  });
  el('sidebar-backdrop').addEventListener('click', closeSidebarMobile);

  // Tarih değişimi
  el('date-input').addEventListener('change', (e) => {
    state.date   = e.target.value;
    state.tourId = null;
    loadTours();
  });

  // New butonu → seçenek yönetimi modalı
  el('new-tour-btn').addEventListener('click', openOptModal);

  // Arama
  el('search-box').addEventListener('input', (e) => {
    state.search = e.target.value.toLowerCase();
    renderTable();
  });

  // Seçim aksiyon çubuğu
  el('btn-sel-apply').addEventListener('click', applySelection);
  el('btn-sel-clear').addEventListener('click', clearSelection);

  // Ekip (Crews) modalı
  el('crews-btn').addEventListener('click',    openCrewsModal);
  el('crews-close').addEventListener('click',  () => el('crews-modal').classList.add('hidden'));
  el('crews-cancel').addEventListener('click', () => el('crews-modal').classList.add('hidden'));

  // Rezervasyon ekle
  el('add-booking-btn').addEventListener('click', () => openBookingModal(null));

  // Rezervasyon modal
  el('modal-close').addEventListener('click',  closeBookingModal);
  el('modal-cancel').addEventListener('click', closeBookingModal);
  el('booking-form').addEventListener('submit', handleBookingSubmit);
  el('chk-all-arrived').addEventListener('change', toggleSelectArrived);
  el('booking-form').elements['transfer'].addEventListener('change', (e) => {
    el('f-transfer-note-wrap').classList.toggle('hidden', !e.target.checked);
    if (e.target.checked) el('booking-form').elements['transfer_note'].focus();
  });
  el('booking-form').elements['payment'].addEventListener('change', (e) => {
    el('f-unpaid-wrap').classList.toggle('hidden', e.target.value !== 'Unpaid');
  });
  el('booking-form').elements['tour_code'].addEventListener('change', (e) => {
    togglePrvFields(e.target.value === 'PRV');
  });

  // Opt modal kapat
  el('new-tour-close').addEventListener('click', closeOptModal);
}

// ── Ekran geçişleri ────────────────────────────────────────────
function showLogin() {
  el('login-screen').classList.remove('hidden');
  el('app-screen').classList.add('hidden');
}

async function showApp() {
  el('login-screen').classList.add('hidden');
  el('app-screen').classList.remove('hidden');
  const { currentProfile } = await import('./auth.js');
  el('user-name').textContent = currentProfile?.full_name || '';
  el('date-input').value = state.date;
  showView('dashboard');
  await loadTours();
}

// ── Sol menü / sayfa geçişi ────────────────────────────────────
function showView(view, filter = null) {
  state.view = view;
  state.tourCodeFilter = view === 'tourlist' ? filter : null;

  document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
  el('view-' + view).classList.remove('hidden');

  document.querySelectorAll('.sidebar-link').forEach(btn => {
    const btnFilter = btn.dataset.filter || null;
    btn.classList.toggle('active', btn.dataset.view === view && btnFilter === state.tourCodeFilter);
  });

  const banner = el('tourcode-banner');
  if (view === 'tourlist' && filter) {
    banner.textContent = TOURCODE_META[filter]?.label || filter;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  if (view === 'tourlist') { renderTable(); renderStats(); }
}

function closeSidebarMobile() {
  el('sidebar').classList.remove('open');
  el('sidebar-backdrop').classList.add('hidden');
}

// ── Turlar ─────────────────────────────────────────────────────
// Her tarih tek bir tur kaydıyla temsil edilir (yoksa otomatik
// oluşturulur). Eski tarihlerde birden fazla tur kaydı varsa
// hepsinin rezervasyonları tek listede gösterilir; yeni kayıtlar
// ilk tura eklenir.
async function loadTours() {
  unsubscribeBookings();
  unsubscribeTours();
  try { state.tours = await getToursByDate(state.date); }
  catch { state.tours = []; }
  clearSelection();

  if (state.tours.length === 0) {
    // Tarih için tur yoksa otomatik oluştur
    await autoCreateTour();
    try { state.tours = await getToursByDate(state.date); } catch { state.tours = []; }
  }

  subscribeTours(state.date, {
    onInsert: (t) => {
      if (state.tours.some(x => x.id === t.id)) return;
      state.tours.push(t);
      if (!state.tourId) state.tourId = t.id;
      loadBookings();
    },
    onDelete: (t) => {
      state.tours = state.tours.filter(x => x.id !== t.id);
      if (state.tourId === t.id) state.tourId = state.tours[0]?.id || null;
      loadBookings();
    },
  });

  state.tourId = state.tours[0]?.id || null;
  el('add-booking-btn').disabled = !state.tourId;
  el('crews-btn').disabled = !state.tourId;
  await loadBookings();
}

// ── Rezervasyonlar ─────────────────────────────────────────────
async function loadBookings() {
  unsubscribeBookings();
  const tourIds = state.tours.map(t => t.id);
  if (tourIds.length === 0) { state.bookings = []; state.crews = {}; clearSelection(); renderTable(); renderStats(); return; }
  try { state.bookings = await getBookingsByTours(tourIds); }
  catch { state.bookings = []; }
  await loadCrews();
  clearSelection();
  renderTable(); renderStats();

  subscribeBookings(tourIds, {
    onInsert: async (b) => {
      if (state.bookings.some(x => x.id === b.id)) return; // zaten eklendi
      const full = await fetchOne(b.id);
      if (full) state.bookings.push(full);
      renderTable(); renderStats();
    },
    onUpdate: async (b) => {
      const full = await fetchOne(b.id);
      const i = state.bookings.findIndex(x => x.id === b.id);
      if (i >= 0 && full) state.bookings[i] = full;
      else if (full) state.bookings.push(full);
      renderTable(); renderStats();
    },
    onDelete: (b) => {
      state.bookings = state.bookings.filter(x => x.id !== b.id);
      renderTable(); renderStats();
    },
  });
}

async function fetchOne(id) {
  const { data } = await supabase
    .from('bookings')
    .select('*, checked_in_by_profile:profiles!checked_in_by(full_name)')
    .eq('id', id).single();
  return data;
}

// ── Tablo render ───────────────────────────────────────────────
function filtered() {
  let data = state.bookings;
  if (state.tourCodeFilter === 'sunset') {
    data = data.filter(b => SUNSET_CODES.includes(b.tour_code));
  } else if (state.tourCodeFilter) {
    data = data.filter(b => b.tour_code === state.tourCodeFilter);
  }
  if (state.search) {
    data = data.filter(b =>
      b.name.toLowerCase().includes(state.search) ||
      (b.phone || '').toLowerCase().includes(state.search)
    );
  }
  return data;
}

function renderTable() {
  const tbody = el('tbody');
  const data  = filtered();

  const resetChkAll = () => {
    const c = el('chk-all-arrived');
    if (c) { c.disabled = true; c.checked = false; c.indeterminate = false; }
  };
  if (!state.tourId) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="13">Select a date and create a tour.</td></tr>`;
    el('tfoot').innerHTML = '';
    resetChkAll();
    return;
  }
  if (data.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="13">No records found.</td></tr>`;
    el('tfoot').innerHTML = '';
    resetChkAll();
    return;
  }

  // Geldi olanlar üste, gelmeyenler alta
  const sorted = [...data].sort((a, b) => {
    if (a.checked_in === b.checked_in) return 0;
    return a.checked_in ? -1 : 1;
  });

  tbody.innerHTML = sorted.map(b => {
    const rc = (b.checked_in ? 'row-arrived' : '') + (selected.has(b.id) ? ' row-selected' : '');
    return `<tr class="${rc}">
      <td class="col-chk">
        <button class="chk-btn ${b.checked_in ? 'on' : ''}"
                data-id="${b.id}"
                title="${b.checked_in ? 'Mark as absent' : 'Mark as here'}">
          ${b.checked_in ? '✓' : '○'}
        </button>
      </td>
      <td style="font-weight:600">${esc(b.tour_code || '')}</td>
      <td class="col-name">
        <div class="name-cell">
          <input type="checkbox" class="row-chk" data-sel="${b.id}" ${selected.has(b.id) ? 'checked' : ''}/>
          ${esc(b.name)}
        </div>
      </td>
      <td style="text-align:center;font-weight:600">${b.pax}</td>
      <td>${esc(b.source)}</td>
      <td class="col-yacht">${yachtBadge(b.yacht)}</td>
      <td style="color:#374151;font-size:.75rem">${esc(b.phone)}</td>
      <td>${payBadge(b.payment)}${b.payment === 'Unpaid' && b.unpaid_amount ? ` <span class="unpaid-amt">${b.unpaid_amount} ${esc(b.unpaid_currency || 'EUR')}</span>` : ''}</td>
      <td style="text-align:center">${b.transfer ? (b.transfer_note ? `<span class="tf-yes">${esc(b.transfer_note)}</span>` : '<span class="tf-yes">✓</span>') : '<span class="tf-no">—</span>'}</td>
      <td>${esc(state.crews[b.yacht]?.tour_guide || '')}</td>
      <td>${esc((state.crews[b.yacht]?.staff || []).join(', '))}</td>
      <td style="color:#6b7280;max-width:110px;overflow:hidden;text-overflow:ellipsis">${esc(b.remarks)}</td>
      <td>
        <button class="act-btn edit" data-edit="${b.id}" title="Edit">✎</button>
        <button class="act-btn del"  data-del="${b.id}"  title="Delete">✕</button>
      </td>
    </tr>`;
  }).join('');

  // Event delegation
  tbody.querySelectorAll('.chk-btn').forEach(btn =>
    btn.addEventListener('click', handleCheckin)
  );
  tbody.querySelectorAll('.row-chk').forEach(chk =>
    chk.addEventListener('change', (e) => toggleSel(chk.dataset.sel, e.target.checked))
  );
  tbody.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => openBookingModal(btn.dataset.edit))
  );
  tbody.querySelectorAll('[data-del]').forEach(btn =>
    btn.addEventListener('click', () => handleDelete(btn.dataset.del))
  );

  // "Gelenleri seç" başlık kutusunun durumu
  const arr = arrivedUnassignedIds(data);
  const chkAll = el('chk-all-arrived');
  if (chkAll) {
    const allSel = arr.length > 0 && arr.every(id => selected.has(id));
    chkAll.disabled = arr.length === 0;
    chkAll.checked = allSel;
    chkAll.indeterminate = !allSel && arr.some(id => selected.has(id));
  }

  renderFooter(data);
}

function renderFooter(data) {
  // Kolon sırası: Check|Tour|Name|Pax|Source|Yacht|Phone|Payment|Transfer|Guide|Staff|Remarks|Actions
  const s = calcStats(data);

  // Tekne başına toplam pax
  const byYacht = {};
  for (const b of data) {
    if (!b.yacht) continue;
    byYacht[b.yacht] = (byYacht[b.yacht] || 0) + (b.pax || 0);
  }
  const yachtSummary = Object.entries(byYacht)
    .map(([y, p]) => `${yachtBadge(y)} = <b>${p}</b>`)
    .join('&nbsp;&nbsp;&nbsp;');

  el('tfoot').innerHTML = `<tr class="tfoot-stats">
    <td class="col-chk"></td>
    <td></td>
    <td class="col-name">📊 ${s.totalPax} pax &nbsp; <span class="s-arrived">▲ ${s.arrival}</span> <span class="s-noshow">▼ ${s.noshow}</span> &nbsp; 👶 ${s.totalBaby} baby</td>
    <td></td>
    <td colspan="9"></td>
  </tr>` + (yachtSummary ? `<tr class="tfoot-yachts"><td colspan="13">⛵ ${yachtSummary}</td></tr>` : '');
}

// ── İstatistik çubuğu ──────────────────────────────────────────
function renderStats() {
  const s = calcStats(state.bookings);
  el('stats-bar').innerHTML = `
    <div class="stat-item arrived"><span class="stat-num">${s.arrival}</span><span class="stat-lbl">Here</span></div>
    <div class="stat-item noshow"><span class="stat-num">${s.noshow}</span><span class="stat-lbl">Absent</span></div>
    <div class="stat-item total"><span class="stat-num">${s.totalPax}</span><span class="stat-lbl">Total Pax</span></div>
  `;
}

// ── Check-in toggle ────────────────────────────────────────────
async function handleCheckin(e) {
  const btn = e.currentTarget;
  const id  = btn.dataset.id;
  const bk  = state.bookings.find(x => x.id === id);
  if (!bk) return;
  btn.disabled = true;
  try {
    const updated = await toggleCheckin(id, bk.checked_in);
    const i = state.bookings.findIndex(x => x.id === id);
    if (i >= 0) state.bookings[i] = updated;
    renderTable(); renderStats();
  } catch (err) { console.error(err); }
  finally { btn.disabled = false; }
}

// ── Silme ──────────────────────────────────────────────────────
async function handleDelete(id) {
  if (!confirm('Are you sure you want to delete this booking?')) return;
  try {
    await deleteBooking(id);
    state.bookings = state.bookings.filter(x => x.id !== id);
    renderTable(); renderStats();
  } catch (err) { alert('Error: ' + (err.message || err)); }
}

// ── Rezervasyon modalı ─────────────────────────────────────────
function openBookingModal(bookingId) {
  state.editingId = bookingId;
  const b = bookingId ? state.bookings.find(x => x.id === bookingId) : null;
  el('modal-title').textContent = b ? 'Edit Booking' : 'Booking';
  const f = el('booking-form');
  f.elements['booking_date'].value = state.date;
  f.elements['name'].value       = b?.name      || '';
  f.elements['pax'].value        = b?.pax       || 1;
  f.elements['baby'].value       = b?.baby      || 0;
  f.elements['phone'].value      = b?.phone     || '';
  f.elements['tour_code'].value  = b?.tour_code || 'T1';
  f.elements['source'].value     = b?.source    || '';
  f.elements['payment'].value    = b?.payment   || '';
  f.elements['remarks'].value    = b?.remarks   || '';
  f.elements['transfer'].checked = b?.transfer  || false;
  f.elements['transfer_note'].value = b?.transfer_note || '';
  f.elements['unpaid_amount'].value   = b?.unpaid_amount ?? '';
  f.elements['unpaid_currency'].value = b?.unpaid_currency || 'EUR';
  f.elements['prv_extras_currency'].value = b?.prv_extras_currency || 'EUR';
  f.elements['prv_start_time'].value      = b?.prv_start_time      || '';
  f.elements['prv_duration_hours'].value  = b?.prv_duration_hours  ?? '';
  f.querySelectorAll('.prv-extra-input').forEach(inp => {
    inp.value = b?.prv_extras?.[inp.dataset.item] ?? '';
  });
  el('f-transfer-note-wrap').classList.toggle('hidden', !f.elements['transfer'].checked);
  el('f-unpaid-wrap').classList.toggle('hidden', f.elements['payment'].value !== 'Unpaid');
  togglePrvFields(f.elements['tour_code'].value === 'PRV');
  el('booking-modal').classList.remove('hidden');
  setTimeout(() => f.elements['name'].focus(), 60);
}

function closeBookingModal() {
  el('booking-modal').classList.add('hidden');
  state.editingId = null;
}

async function handleBookingSubmit(e) {
  e.preventDefault();
  if (!state.tourId) { alert('Select a tour first.'); return; }
  const f   = e.target;
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;

  const bookingDate = f.elements['booking_date'].value;
  const fields = {
    name:      f.elements['name'].value.trim(),
    pax:       parseInt(f.elements['pax'].value)  || 1,
    baby:      parseInt(f.elements['baby'].value) || 0,
    phone:     f.elements['phone'].value.trim(),
    tour_code: f.elements['tour_code'].value,
    source:    f.elements['source'].value,
    payment:   f.elements['payment'].value,
    remarks:   f.elements['remarks'].value.trim(),
    transfer:  f.elements['transfer'].checked,
    transfer_note: f.elements['transfer'].checked ? f.elements['transfer_note'].value.trim() : '',
    unpaid_amount:   f.elements['payment'].value === 'Unpaid' ? (parseFloat(f.elements['unpaid_amount'].value) || null) : null,
    unpaid_currency: f.elements['payment'].value === 'Unpaid' ? f.elements['unpaid_currency'].value : null,
    prv_extras:          f.elements['tour_code'].value === 'PRV' ? collectPrvExtras(f) : {},
    prv_extras_currency: f.elements['tour_code'].value === 'PRV' ? f.elements['prv_extras_currency'].value : 'EUR',
    prv_start_time:     f.elements['tour_code'].value === 'PRV' ? (f.elements['prv_start_time'].value || null) : null,
    prv_duration_hours: f.elements['tour_code'].value === 'PRV' ? (parseFloat(f.elements['prv_duration_hours'].value) || null) : null,
  };

  if (!bookingDate)    { alert('Date is required.');  btn.disabled = false; return; }
  if (!fields.name || !fields.phone || !fields.source || !fields.payment) {
    alert('You must fill in the required fields.');
    btn.disabled = false;
    return;
  }

  try {
    const dateChanged = bookingDate !== state.date;
    let targetTourId = state.tourId;
    if (dateChanged) {
      const tour = await getOrCreateTourForDate(bookingDate);
      targetTourId = tour.id;
    }

    if (state.editingId) {
      if (dateChanged) fields.tour_id = targetTourId;
      const updated = await updateBooking(state.editingId, fields);
      if (dateChanged) {
        // Farklı bir tarihe taşındı — mevcut görünümden kaldır
        state.bookings = state.bookings.filter(x => x.id !== state.editingId);
        alert(`Booking moved to ${bookingDate}.`);
      } else {
        const i = state.bookings.findIndex(x => x.id === state.editingId);
        if (i >= 0) state.bookings[i] = updated;
      }
    } else {
      const created = await createBooking(targetTourId, fields);
      if (dateChanged) alert(`Booking created on ${bookingDate}.`);
      else             state.bookings.push(created);
    }
    closeBookingModal();
    renderTable(); renderStats();
  } catch (err) {
    alert('Error: ' + (err.message || err));
  } finally {
    btn.disabled = false;
  }
}

// ── PRV'ye özel alanları göster/gizle ──────────────────────────
function togglePrvFields(isPrv) {
  document.querySelectorAll('.prv-only').forEach(el => el.classList.toggle('hidden', !isPrv));
}

// ── PRV ekstra hizmet formundan doldurulmuş kalemleri topla ────
function collectPrvExtras(f) {
  const extras = {};
  f.querySelectorAll('.prv-extra-input').forEach(inp => {
    const val = inp.value.trim();
    if (val !== '') extras[inp.dataset.item] = parseFloat(val);
  });
  return extras;
}

// ── Belirli bir tarih için tur bul, yoksa oluştur ─────────────
async function getOrCreateTourForDate(dateStr) {
  let tours = await getToursByDate(dateStr);
  if (tours.length > 0) return tours[0];
  try {
    const { currentUser } = await import('./auth.js');
    await supabase.from('tours').insert({
      tour_date: dateStr,
      code:      dateStr,
      created_by: currentUser?.id,
    });
  } catch { /* unique constraint: zaten var, sorun değil */ }
  tours = await getToursByDate(dateStr);
  return tours[0];
}

// ── Otomatik tur oluştur (tarih seçilince arka planda) ───────────
async function autoCreateTour() {
  await getOrCreateTourForDate(state.date);
}

// ── Seçenek yönetimi (New modal) ──────────────────────────────
let optCat = null; // aktif kategori

const OPT_META = {
  yacht:      { label: '⛵ Yacht',      key: 'yachts',     defaults: [] },
  tour_guide: { label: '🧭 Tour Guide', key: 'tourGuides', defaults: [] },
  tour_code:  { label: '📋 Tour',       key: 'tourCodes',  defaults: [] },
  source:     { label: '🌐 Source',     key: 'sources',    defaults: [] },
};

async function loadAppOptions() {
  try {
    const { data } = await supabase.from('app_options').select('*').order('created_at');
    (data || []).forEach(o => {
      const meta = OPT_META[o.category];
      if (!meta) return;
      if (!OPTIONS[meta.key].includes(o.value)) OPTIONS[meta.key].push(o.value);
    });
    // Varsayılanları meta'ya kaydet
    OPT_META.yacht.defaults      = [...OPTIONS.yachts];
    OPT_META.tour_guide.defaults = OPTIONS.tourGuides.filter(x => x);
    OPT_META.tour_code.defaults  = [...OPTIONS.tourCodes];
    OPT_META.source.defaults     = OPTIONS.sources.filter(x => x);
  } catch {}
}

function openOptModal() {
  optCat = null;
  el('opt-step1').classList.remove('hidden');
  el('opt-step2').classList.add('hidden');
  el('opt-modal-title').textContent = 'What would you like to add?';
  el('new-tour-modal').classList.remove('hidden');

  // Kategori butonlarına listener
  el('new-tour-modal').querySelectorAll('.opt-cat-btn').forEach(btn => {
    btn.onclick = () => openOptStep2(btn.dataset.cat);
  });
  el('opt-back-btn').onclick = () => {
    el('opt-step2').classList.add('hidden');
    el('opt-step1').classList.remove('hidden');
    el('opt-modal-title').textContent = 'What would you like to add?';
  };
  el('opt-add-btn').onclick = addOpt;
  el('opt-new-val').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addOpt(); } };
}

function openOptStep2(cat) {
  optCat = cat;
  const meta = OPT_META[cat];
  el('opt-modal-title').textContent = meta.label + ' list';
  el('opt-step1').classList.add('hidden');
  el('opt-step2').classList.remove('hidden');
  el('opt-new-val').value = '';
  renderOptChips();
  setTimeout(() => el('opt-new-val').focus(), 80);
}

function renderOptChips() {
  const meta = OPT_META[optCat];
  const vals = OPTIONS[meta.key].filter(x => x); // boş stringleri çıkar
  el('opt-chips-wrap').innerHTML = vals.map(v => {
    const isDef = meta.defaults.includes(v);
    return `<span class="opt-chip ${isDef ? 'default-opt' : ''}">
      ${esc(v)}
      <button class="opt-chip-del" data-val="${esc(v)}" title="Delete">✕</button>
    </span>`;
  }).join('');
  el('opt-chips-wrap').querySelectorAll('.opt-chip-del').forEach(btn => {
    btn.onclick = () => removeOpt(btn.dataset.val);
  });
}

async function addOpt() {
  const val = el('opt-new-val').value.trim();
  if (!val) return;
  const meta = OPT_META[optCat];
  if (OPTIONS[meta.key].includes(val)) { el('opt-new-val').value = ''; return; }
  try {
    await supabase.from('app_options').insert({ category: optCat, value: val });
    OPTIONS[meta.key].push(val);
    fillFormSelects();
    el('opt-new-val').value = '';
    renderOptChips();
  } catch (err) { alert('Error: ' + err.message); }
}

async function removeOpt(val) {
  const meta = OPT_META[optCat];
  try {
    await supabase.from('app_options').delete().eq('category', optCat).eq('value', val);
    OPTIONS[meta.key] = OPTIONS[meta.key].filter(x => x !== val);
    fillFormSelects();
    renderOptChips();
  } catch (err) { alert('Error: ' + err.message); }
}

function closeOptModal() {
  el('new-tour-modal').classList.add('hidden');
  optCat = null;
}

// ── Form selectleri doldur ─────────────────────────────────────
function fillFormSelects() {
  const fill = (id, opts, hasBlank = true) => {
    const sel = el(id);
    if (!sel) return;
    const items = hasBlank ? ['', ...opts.filter(x => x)] : opts;
    sel.innerHTML = items.map(o =>
      `<option value="${esc(o)}">${esc(o) || '—'}</option>`
    ).join('');
  };
  fill('f-source',  OPTIONS.sources);
  fill('f-payment', OPTIONS.payments);
  fill('f-tour',    OPTIONS.tourCodes, false);
  // sel-bar seçicilerini de yenile
  const refillSel = (id, opts) => {
    const sel = el(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">— Select —</option>` +
      opts.filter(x => x).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    if (cur) sel.value = cur;
  };
  refillSel('sel-yacht',  OPTIONS.yachts);
}

// ── Yardımcılar ────────────────────────────────────────────────
function yachtBadge(y) {
  if (y === 'River')       return `<span class="yd yd-river">River</span>`;
  if (y === 'River M')     return `<span class="yd yd-mega">River M</span>`;
  if (y === 'River Storm') return `<span class="yd yd-storm">Storm</span>`;
  return y ? `<span class="yd" style="background:#ccc;color:#555">${esc(y)}</span>` : '<span style="color:#bbb">—</span>';
}

function payBadge(p) {
  if (!p) return '—';
  const cls = p === 'Received' ? 'pay-received' : p === 'Unpaid' ? 'pay-unpaid' : '';
  return `<span class="pay ${cls}">${esc(p)}</span>`;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Seçim fonksiyonları ────────────────────────────────────────
// Gelmiş (check'li) ama henüz bir yata atanmamış kayıtların id'leri
function arrivedUnassignedIds(data) {
  return data.filter(b => b.checked_in && !b.yacht).map(b => b.id);
}

function toggleSelectArrived(e) {
  const ids = arrivedUnassignedIds(filtered());
  if (e.target.checked) ids.forEach(id => selected.add(id));
  else                  ids.forEach(id => selected.delete(id));
  renderTable();
  updateSelBar();
}

function toggleSel(id, checked) {
  if (checked) selected.add(id);
  else         selected.delete(id);
  updateSelBar();
  // Sadece bu satırın görünümünü güncelle
  const tr = el('tbody').querySelector(`tr:has([data-sel="${id}"])`);
  if (tr) tr.classList.toggle('row-selected', checked);
}

function clearSelection() {
  selected.clear();
  updateSelBar();
  el('tbody').querySelectorAll('.row-chk').forEach(c => c.checked = false);
  el('tbody').querySelectorAll('.row-selected').forEach(r => r.classList.remove('row-selected'));
}

function updateSelBar() {
  const bar = el('sel-bar');
  const n   = selected.size;
  el('sel-count').textContent = n + ' selected';
  el('btn-sel-apply').disabled = n === 0;
  if (n > 0) bar.classList.remove('hidden');
  else       bar.classList.add('hidden');
}

// ── Ekipleri yükle ─────────────────────────────────────────────
async function loadCrews() {
  if (!state.tourId) { state.crews = {}; return; }
  try {
    const { data } = await supabase
      .from('yacht_crews')
      .select('*')
      .eq('tour_id', state.tourId);
    state.crews = {};
    (data || []).forEach(c => { state.crews[c.yacht] = c; });
  } catch { state.crews = {}; }
}

// ── Toplu yat ataması (sadece yat) ─────────────────────────────
async function applySelection() {
  const yacht = el('sel-yacht').value;
  if (!yacht) { alert('Please select a Yacht.'); return; }

  const btn = el('btn-sel-apply');
  btn.disabled = true;

  try {
    const ids = [...selected];
    for (const id of ids) {
      await updateBooking(id, { yacht });
      const i = state.bookings.findIndex(x => x.id === id);
      if (i >= 0) state.bookings[i] = { ...state.bookings[i], yacht };
    }
    clearSelection();
    el('sel-yacht').value = '';
    renderTable(); renderStats();
  } catch (err) {
    alert('Error: ' + (err.message || err));
    btn.disabled = false;
  }
}

// ── Bugün rezervasyonlara atanmış (veya daha önce ekip kaydedilmiş) yatlar ──
function usedYachtsToday() {
  const fromBookings = state.bookings.map(b => b.yacht).filter(Boolean);
  const fromCrews     = Object.keys(state.crews);
  return [...new Set([...fromBookings, ...fromCrews])].sort();
}

// ── Ekip (Crews) modalı ────────────────────────────────────────
function openCrewsModal() {
  const guides = ['', ...OPTIONS.tourGuides.filter(x => x)];
  const staffList = OPTIONS.staffList.filter(x => x);
  const yachts = usedYachtsToday();

  const guideOpts = (sel) => guides.map(g =>
    `<option value="${esc(g)}" ${g === sel ? 'selected' : ''}>${g || '—'}</option>`
  ).join('');

  if (yachts.length === 0) {
    el('crews-body').innerHTML = `<p style="color:var(--gray3);text-align:center;padding:20px 0">No yacht assigned yet — assign a yacht to a booking first.</p>`;
    el('crews-modal').classList.remove('hidden');
    return;
  }

  el('crews-body').innerHTML = yachts.map(y => {
    const crew  = state.crews[y] || {};
    const staff = crew.staff || [];
    const boxes = staffList.map(s =>
      `<label><input type="checkbox" value="${esc(s)}" ${staff.includes(s) ? 'checked' : ''}/> ${esc(s)}</label>`
    ).join('');
    return `<div class="crew-row" data-yacht="${esc(y)}">
      <div class="crew-yacht-label">${yachtBadge(y)}</div>
      <div class="crew-controls">
        <select class="crew-guide-sel">${guideOpts(crew.tour_guide || '')}</select>
        <div class="crew-staff-group">${boxes || '<span style="color:var(--gray3)">No staff</span>'}</div>
      </div>
      <button class="btn-crew-save" data-yacht="${esc(y)}">Save</button>
    </div>`;
  }).join('');

  el('crews-body').querySelectorAll('.btn-crew-save').forEach(btn =>
    btn.addEventListener('click', () => saveCrew(btn.dataset.yacht, btn))
  );

  el('crews-modal').classList.remove('hidden');
}

async function saveCrew(yacht, btn) {
  const row   = btn.closest('.crew-row');
  const guide = row.querySelector('.crew-guide-sel').value;
  const staff = [...row.querySelectorAll('.crew-staff-group input:checked')].map(i => i.value);
  btn.disabled = true;
  try {
    await supabase.from('yacht_crews').upsert(
      { tour_id: state.tourId, yacht, tour_guide: guide, staff },
      { onConflict: 'tour_id,yacht' }
    );
    state.crews[yacht] = { tour_guide: guide, staff };
    renderTable();
    const old = btn.textContent;
    btn.textContent = '✓ Saved';
    btn.classList.add('saved');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('saved'); btn.disabled = false; }, 1500);
  } catch (err) {
    alert('Error: ' + (err.message || err));
    btn.disabled = false;
  }
}

init();
