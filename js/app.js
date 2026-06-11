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
};
const selected = new Set();

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
      el('login-error').textContent = err.message || 'Giriş başarısız';
      btn.disabled = false;
    }
  });

  // Logout
  el('logout-btn').addEventListener('click', () => logout());

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
  el('sel-yacht').addEventListener('change', onSelYachtChange);

  // Ekipler modal
  el('crews-btn').addEventListener('click',    openCrewsModal);
  el('crews-close').addEventListener('click',  () => el('crews-modal').classList.add('hidden'));
  el('crews-cancel').addEventListener('click', () => el('crews-modal').classList.add('hidden'));

  // Rezervasyon ekle
  el('add-booking-btn').addEventListener('click', () => openBookingModal(null));

  // Rezervasyon modal
  el('modal-close').addEventListener('click',  closeBookingModal);
  el('modal-cancel').addEventListener('click', closeBookingModal);
  el('booking-form').addEventListener('submit', handleBookingSubmit);

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
  await loadTours();
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
  if (!state.search) return state.bookings;
  return state.bookings.filter(b =>
    b.name.toLowerCase().includes(state.search) ||
    (b.phone || '').toLowerCase().includes(state.search)
  );
}

function renderTable() {
  const tbody = el('tbody');
  const data  = filtered();

  if (!state.tourId) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="13">Tarih seçin ve tur oluşturun.</td></tr>`;
    el('tfoot').innerHTML = '';
    return;
  }
  if (data.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="13">Kayıt bulunamadı.</td></tr>`;
    el('tfoot').innerHTML = '';
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
                title="${b.checked_in ? 'Gelmedi olarak işaretle' : 'Geldi olarak işaretle'}">
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
      <td>${payBadge(b.payment)}</td>
      <td style="text-align:center">${b.transfer ? '<span class="tf-yes">✓</span>' : '<span class="tf-no">—</span>'}</td>
      <td>${esc(b.tour_guide)}</td>
      <td>${esc(b.staff)}</td>
      <td style="color:#6b7280;max-width:110px;overflow:hidden;text-overflow:ellipsis">${esc(b.remarks)}</td>
      <td>
        <button class="act-btn edit" data-edit="${b.id}" title="Düzenle">✎</button>
        <button class="act-btn del"  data-del="${b.id}"  title="Sil">✕</button>
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

  renderFooter(data);
}

function renderFooter(data) {
  // Kolon sırası: Check|Tour|Name|Pax|Source|Yacht|Phone|Payment|Transfer|Guide|Staff|Remarks|Actions
  const s = calcStats(data);
  el('tfoot').innerHTML = `<tr>
    <td class="col-chk"></td>
    <td></td>
    <td class="col-name">📊 ${data.length} kişi &nbsp; <span class="s-arrived">▲ ${s.arrival}</span> <span class="s-noshow">▼ ${s.noshow}</span></td>
    <td style="text-align:center;font-weight:700">${s.totalPax}</td>
    <td colspan="9"></td>
  </tr>`;
}

// ── İstatistik çubuğu ──────────────────────────────────────────
function renderStats() {
  const s = calcStats(state.bookings);
  el('stats-bar').innerHTML = `
    <div class="stat-item arrived"><span class="stat-num">${s.arrival}</span><span class="stat-lbl">Geldi</span></div>
    <div class="stat-item noshow"><span class="stat-num">${s.noshow}</span><span class="stat-lbl">Gelmedi</span></div>
    <div class="stat-item total"><span class="stat-num">${s.totalPax}</span><span class="stat-lbl">Toplam Pax</span></div>
    <div class="stat-item baby"><span class="stat-num">${s.totalBaby}</span><span class="stat-lbl">Bebek</span></div>
    <div class="stat-item cnt"><span class="stat-num">${s.count}</span><span class="stat-lbl">Rezervasyon</span></div>
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
  if (!confirm('Bu rezervasyonu silmek istediğinizden emin misiniz?')) return;
  try {
    await deleteBooking(id);
    state.bookings = state.bookings.filter(x => x.id !== id);
    renderTable(); renderStats();
  } catch (err) { alert('Hata: ' + (err.message || err)); }
}

// ── Rezervasyon modalı ─────────────────────────────────────────
function openBookingModal(bookingId) {
  state.editingId = bookingId;
  const b = bookingId ? state.bookings.find(x => x.id === bookingId) : null;
  el('modal-title').textContent = b ? 'Rezervasyonu Düzenle' : 'Yeni Rezervasyon';
  const f = el('booking-form');
  f.elements['name'].value       = b?.name      || '';
  f.elements['pax'].value        = b?.pax       || 1;
  f.elements['baby'].value       = b?.baby      || 0;
  f.elements['phone'].value      = b?.phone     || '';
  f.elements['tour_code'].value  = b?.tour_code || 'T1';
  f.elements['source'].value     = b?.source    || '';
  f.elements['payment'].value    = b?.payment   || '';
  f.elements['remarks'].value    = b?.remarks   || '';
  f.elements['transfer'].checked = b?.transfer  || false;
  el('booking-modal').classList.remove('hidden');
  setTimeout(() => f.elements['name'].focus(), 60);
}

function closeBookingModal() {
  el('booking-modal').classList.add('hidden');
  state.editingId = null;
}

async function handleBookingSubmit(e) {
  e.preventDefault();
  if (!state.tourId) { alert('Önce bir tur seçin.'); return; }
  const f   = e.target;
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;

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
  };

  if (!fields.name) { alert('İsim gereklidir.'); btn.disabled = false; return; }

  try {
    if (state.editingId) {
      const updated = await updateBooking(state.editingId, fields);
      const i = state.bookings.findIndex(x => x.id === state.editingId);
      if (i >= 0) state.bookings[i] = updated;
    } else {
      const created = await createBooking(state.tourId, fields);
      state.bookings.push(created);
    }
    closeBookingModal();
    renderTable(); renderStats();
  } catch (err) {
    alert('Hata: ' + (err.message || err));
  } finally {
    btn.disabled = false;
  }
}

// ── Otomatik tur oluştur (tarih seçilince arka planda) ───────────
async function autoCreateTour() {
  try {
    const { currentUser } = await import('./auth.js');
    await supabase.from('tours').insert({
      tour_date: state.date,
      code:      state.date,
      created_by: currentUser?.id,
    });
  } catch { /* unique constraint: zaten var, sorun değil */ }
}

// ── Seçenek yönetimi (New modal) ──────────────────────────────
let optCat = null; // aktif kategori

const OPT_META = {
  yacht:      { label: '⛵ Yacht',      key: 'yachts',     defaults: [] },
  tour_guide: { label: '🧭 Tour Guide', key: 'tourGuides', defaults: [] },
  tour_code:  { label: '📋 Tour',       key: 'tourCodes',  defaults: [] },
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
  } catch {}
}

function openOptModal() {
  optCat = null;
  el('opt-step1').classList.remove('hidden');
  el('opt-step2').classList.add('hidden');
  el('opt-modal-title').textContent = 'Ne eklemek istiyorsunuz?';
  el('new-tour-modal').classList.remove('hidden');

  // Kategori butonlarına listener
  el('new-tour-modal').querySelectorAll('.opt-cat-btn').forEach(btn => {
    btn.onclick = () => openOptStep2(btn.dataset.cat);
  });
  el('opt-back-btn').onclick = () => {
    el('opt-step2').classList.add('hidden');
    el('opt-step1').classList.remove('hidden');
    el('opt-modal-title').textContent = 'Ne eklemek istiyorsunuz?';
  };
  el('opt-add-btn').onclick = addOpt;
  el('opt-new-val').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addOpt(); } };
}

function openOptStep2(cat) {
  optCat = cat;
  const meta = OPT_META[cat];
  el('opt-modal-title').textContent = meta.label + ' listesi';
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
      <button class="opt-chip-del" data-val="${esc(v)}" title="Sil">✕</button>
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
  } catch (err) { alert('Hata: ' + err.message); }
}

async function removeOpt(val) {
  const meta = OPT_META[optCat];
  try {
    await supabase.from('app_options').delete().eq('category', optCat).eq('value', val);
    OPTIONS[meta.key] = OPTIONS[meta.key].filter(x => x !== val);
    fillFormSelects();
    renderOptChips();
  } catch (err) { alert('Hata: ' + err.message); }
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
    sel.innerHTML = `<option value="">— Seçin —</option>` +
      opts.filter(x => x).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    if (cur) sel.value = cur;
  };
  refillSel('sel-yacht',  OPTIONS.yachts);
  refillSel('sel-guide',  OPTIONS.tourGuides);
}

// ── Yardımcılar ────────────────────────────────────────────────
function yachtBadge(y) {
  if (y === 'River')       return `<span class="yd yd-river">River</span>`;
  if (y === 'River Mega')  return `<span class="yd yd-mega">Mega</span>`;
  if (y === 'River Storm') return `<span class="yd yd-storm">Storm</span>`;
  return y ? `<span class="yd" style="background:#ccc;color:#555">${esc(y)}</span>` : '<span style="color:#bbb">—</span>';
}

function payBadge(p) {
  if (!p) return '—';
  const cls = p === 'Received' ? 'pay-received' : p === 'Card' ? 'pay-card' : p === 'Cash' ? 'pay-cash' : '';
  return `<span class="pay ${cls}">${esc(p)}</span>`;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Seçim fonksiyonları ────────────────────────────────────────
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
  el('sel-count').textContent = n + ' seçildi';
  el('btn-sel-apply').disabled = n === 0;
  if (n > 0) bar.classList.remove('hidden');
  else       bar.classList.add('hidden');
}

// ── Yacht seçilince ekibi otomatik getir ──────────────────────
async function onSelYachtChange() {
  const yacht = el('sel-yacht').value;
  const guideField = el('sel-guide-field');
  const staffField = el('sel-staff-field');
  const lockedMsg  = el('sel-crew-locked');
  const guideEl    = el('sel-guide');
  const staffEl    = el('sel-staff');

  if (!yacht) {
    guideEl.disabled = false; staffEl.disabled = false;
    guideEl.value = ''; staffEl.value = '';
    guideField.classList.remove('hidden');
    staffField.classList.remove('hidden');
    lockedMsg.classList.add('hidden');
    return;
  }

  const crew = state.crews[yacht];
  if (crew) {
    // Ekip mevcut — otomatik doldur ve kilitle
    guideEl.value = crew.tour_guide;
    staffEl.value = crew.staff;
    guideEl.disabled = true;
    staffEl.disabled = true;
    lockedMsg.textContent = `🔒 ${yacht}: ${crew.tour_guide || '—'} · ${crew.staff || '—'}`;
    lockedMsg.classList.remove('hidden');
    guideField.classList.add('hidden');
    staffField.classList.add('hidden');
  } else {
    // Ekip yok — kullanıcı seçer
    guideEl.disabled = false; staffEl.disabled = false;
    guideEl.value = ''; staffEl.value = '';
    guideField.classList.remove('hidden');
    staffField.classList.remove('hidden');
    lockedMsg.classList.add('hidden');
  }
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

// ── Toplu atama uygula ─────────────────────────────────────────
async function applySelection() {
  const yacht = el('sel-yacht').value;
  const guide = el('sel-guide').value;
  const staff = el('sel-staff').value;
  if (!yacht) { alert('Lütfen Yacht seçin.'); return; }

  const btn = el('btn-sel-apply');
  btn.disabled = true;

  // Ekip güncelleme/oluşturma (upsert)
  const crewGuide = el('sel-guide').disabled ? state.crews[yacht]?.tour_guide : guide;
  const crewStaff = el('sel-staff').disabled ? state.crews[yacht]?.staff      : staff;

  try {
    // 1) yacht_crews upsert
    await supabase.from('yacht_crews').upsert(
      { tour_id: state.tourId, yacht, tour_guide: crewGuide || '', staff: crewStaff || '' },
      { onConflict: 'tour_id,yacht' }
    );
    state.crews[yacht] = { tour_guide: crewGuide || '', staff: crewStaff || '' };

    // 2) Seçili bookings'leri güncelle
    const ids = [...selected];
    for (const id of ids) {
      const patch = { yacht, tour_guide: crewGuide || '', staff: crewStaff || '' };
      await updateBooking(id, patch);
      const i = state.bookings.findIndex(x => x.id === id);
      if (i >= 0) state.bookings[i] = { ...state.bookings[i], ...patch };
    }

    // 3) Aynı turdaki mevcut tüm aynı-yat bookings'lerini de güncelle (tutarlılık)
    const sameYacht = state.bookings.filter(b => b.yacht === yacht && !ids.includes(b.id));
    for (const b of sameYacht) {
      const patch = { tour_guide: crewGuide || '', staff: crewStaff || '' };
      await updateBooking(b.id, patch);
      const i = state.bookings.findIndex(x => x.id === b.id);
      if (i >= 0) state.bookings[i] = { ...state.bookings[i], ...patch };
    }

    clearSelection();
    el('sel-yacht').value = '';
    el('sel-guide').value = ''; el('sel-guide').disabled = false;
    el('sel-staff').value = ''; el('sel-staff').disabled = false;
    el('sel-guide-field').classList.remove('hidden');
    el('sel-staff-field').classList.remove('hidden');
    el('sel-crew-locked').classList.add('hidden');
    renderTable(); renderStats();
  } catch (err) {
    alert('Hata: ' + (err.message || err));
    btn.disabled = false;
  }
}

// ── Ekipler modalı ─────────────────────────────────────────────
async function openCrewsModal() {
  await loadCrews();
  const yachts = OPTIONS.yachts;
  const guides = ['', ...OPTIONS.tourGuides.filter(x => x)];
  const staffs = ['', ...OPTIONS.staffList.filter(x => x)];

  const mkOpts = (arr, val) => arr.map(o =>
    `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${o || '—'}</option>`
  ).join('');

  el('crews-body').innerHTML = yachts.map(y => {
    const c = state.crews[y] || {};
    return `<div class="crew-row">
      <span class="crew-yacht-label">${yachtBadge(y)}</span>
      <select class="crew-guide-sel" data-yacht="${esc(y)}">${mkOpts(guides, c.tour_guide || '')}</select>
      <select class="crew-staff-sel" data-yacht="${esc(y)}">${mkOpts(staffs, c.staff || '')}</select>
      <button class="btn-crew-save" data-yacht="${esc(y)}" onclick="saveCrew('${esc(y)}',this)">Kaydet</button>
    </div>`;
  }).join('') + `<p style="font-size:.73rem;color:var(--gray4);margin-top:12px">
    Kaydetmek, o yata atanmış tüm mevcut rezervasyonları da günceller.</p>`;

  el('crews-modal').classList.remove('hidden');
}

async function saveCrew(yacht, btn) {
  const row = btn.closest('.crew-row');
  const guide = row.querySelector('.crew-guide-sel').value;
  const staff = row.querySelector('.crew-staff-sel').value;
  btn.disabled = true;
  try {
    await supabase.from('yacht_crews').upsert(
      { tour_id: state.tourId, yacht, tour_guide: guide, staff },
      { onConflict: 'tour_id,yacht' }
    );
    state.crews[yacht] = { tour_guide: guide, staff };

    // Mevcut bookings'leri de güncelle
    const same = state.bookings.filter(b => b.yacht === yacht);
    for (const b of same) {
      const patch = { tour_guide: guide, staff };
      await updateBooking(b.id, patch);
      const i = state.bookings.findIndex(x => x.id === b.id);
      if (i >= 0) state.bookings[i] = { ...state.bookings[i], ...patch };
    }
    renderTable(); renderStats();
    btn.textContent = '✓ Kaydedildi';
    btn.style.background = 'var(--green)';
    btn.style.color = '#fff';
    setTimeout(() => { btn.textContent = 'Kaydet'; btn.style = ''; btn.disabled = false; }, 1800);
  } catch (err) {
    alert('Hata: ' + err.message);
    btn.disabled = false;
  }
}

init();
