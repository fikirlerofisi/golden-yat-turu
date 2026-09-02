import { supabase } from './supabase.js';
import { currentUser } from './auth.js';

// ── Turlara ait alkol satışlarını getir ───────────────────────
export async function getAlcoholSales(tourIds) {
  const { data, error } = await supabase
    .from('alcohol_sales')
    .select('*, sold_by_profile:profiles!sold_by(full_name), paid_by_profile:profiles!paid_by(full_name)')
    .in('tour_id', tourIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── Satış ekle ─────────────────────────────────────────────────
export async function createAlcoholSale(tourId, fields) {
  const { data, error } = await supabase
    .from('alcohol_sales')
    .insert({ tour_id: tourId, ...sanitize(fields), sold_by: currentUser?.id })
    .select('*, sold_by_profile:profiles!sold_by(full_name), paid_by_profile:profiles!paid_by(full_name)')
    .single();
  if (error) throw error;
  return data;
}

// ── Satış güncelle (Pay kaydı — kısmi patch) ─────────────────
export async function updateAlcoholSale(saleId, fields) {
  const { data, error } = await supabase
    .from('alcohol_sales')
    .update(fields)
    .eq('id', saleId)
    .select('*, sold_by_profile:profiles!sold_by(full_name), paid_by_profile:profiles!paid_by(full_name)')
    .single();
  if (error) throw error;
  return data;
}

// ── Temizleyici ───────────────────────────────────────────────
function sanitize(f) {
  return {
    tour_code: f.tour_code ?? '',
    yacht:     f.yacht     ?? '',
    items:     f.items     ?? [],
    currency:  f.currency  ?? 'TRY',
    amount:    f.amount    ?? 0,
    remarks:   f.remarks   ?? '',
  };
}
