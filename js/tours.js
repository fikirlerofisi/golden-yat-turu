import { supabase } from './supabase.js';
import { currentUser } from './auth.js';

// ── Belirli tarihteki turları getir ───────────────────────────
export async function getToursByDate(dateStr) {
  const { data, error } = await supabase
    .from('tours')
    .select('*')
    .eq('tour_date', dateStr)
    .order('code');
  if (error) throw error;
  return data || [];
}

// ── Tur oluştur ───────────────────────────────────────────────
export async function createTour({ tourDate, code, departureTime = null, notes = '' }) {
  const { data, error } = await supabase
    .from('tours')
    .insert({
      tour_date: tourDate,
      code,
      departure_time: departureTime || null,
      notes,
      created_by: currentUser?.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Tur sil ───────────────────────────────────────────────────
export async function deleteTour(tourId) {
  const { error } = await supabase
    .from('tours')
    .delete()
    .eq('id', tourId);
  if (error) throw error;
}

// ── Tarih formatı: YYYY-MM-DD ─────────────────────────────────
export function toDateStr(date) {
  return date.toLocaleDateString('sv-SE'); // ISO-8601 date
}

// ── Bugünün tarihi ────────────────────────────────────────────
export function today() {
  return toDateStr(new Date());
}

// ── Türkçe tarih etiketi ──────────────────────────────────────
export function formatDateTR(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('tr-TR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}
