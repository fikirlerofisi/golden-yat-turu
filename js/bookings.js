import { supabase } from './supabase.js';
import { currentUser } from './auth.js';

// ── Turlara ait rezervasyonları getir ─────────────────────────
export async function getBookingsByTours(tourIds) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*, checked_in_by_profile:profiles!checked_in_by(full_name)')
    .in('tour_id', tourIds)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

// ── Rezervasyon ekle ──────────────────────────────────────────
export async function createBooking(tourId, fields) {
  const { data, error } = await supabase
    .from('bookings')
    .insert({ tour_id: tourId, ...sanitize(fields), created_by: currentUser?.id })
    .select('*, checked_in_by_profile:profiles!checked_in_by(full_name)')
    .single();
  if (error) throw error;
  return data;
}

// ── Rezervasyon güncelle (tam form veya kısmi patch) ─────────
export async function updateBooking(bookingId, fields) {
  // Tüm alanlar varsa sanitize et, sadece birkaç alan varsa olduğu gibi gönder
  const isFullForm = 'name' in fields;
  const patch = isFullForm ? sanitize(fields) : fields;
  const { data, error } = await supabase
    .from('bookings')
    .update(patch)
    .eq('id', bookingId)
    .select('*, checked_in_by_profile:profiles!checked_in_by(full_name)')
    .single();
  if (error) throw error;
  return data;
}

// ── Rezervasyon sil ───────────────────────────────────────────
export async function deleteBooking(bookingId) {
  const { error } = await supabase.from('bookings').delete().eq('id', bookingId);
  if (error) throw error;
}

// ── İstatistik ────────────────────────────────────────────────
export function calcStats(bookings) {
  let arrival = 0, noshow = 0, totalPax = 0, totalBaby = 0;
  for (const b of bookings) {
    totalPax  += b.pax  || 0;
    totalBaby += b.baby || 0;
    if (b.checked_in) arrival += b.pax || 0;
    else              noshow  += b.pax || 0;
  }
  return { arrival, noshow, totalPax, totalBaby, count: bookings.length };
}

// ── Temizleyici ───────────────────────────────────────────────
function sanitize(f) {
  return {
    yacht:      f.yacht      ?? '',
    name:       f.name       ?? '',
    pax:        parseInt(f.pax)  || 1,
    baby:       parseInt(f.baby) || 0,
    phone:      f.phone      ?? '',
    source:     f.source     ?? '',
    tour_guide: f.tour_guide ?? '',
    payment:    f.payment    ?? '',
    staff:      f.staff      ?? '',
    remarks:    f.remarks    ?? '',
    transfer:   !!f.transfer,
    tour_code:  f.tour_code  ?? '',
  };
}
