import { supabase } from './supabase.js';

let bookingChannel = null;
let tourChannel    = null;

// ── Rezervasyon değişikliklerini dinle ────────────────────────
export function subscribeBookings(tourId, { onInsert, onUpdate, onDelete }) {
  unsubscribeBookings();
  bookingChannel = supabase
    .channel(`bookings:tour_id=eq.${tourId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bookings', filter: `tour_id=eq.${tourId}` },
      (payload) => onInsert?.(payload.new))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `tour_id=eq.${tourId}` },
      (payload) => onUpdate?.(payload.new))
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'bookings', filter: `tour_id=eq.${tourId}` },
      (payload) => onDelete?.(payload.old))
    .subscribe();
  return bookingChannel;
}

export function unsubscribeBookings() {
  if (bookingChannel) {
    supabase.removeChannel(bookingChannel);
    bookingChannel = null;
  }
}

// ── Tur değişikliklerini dinle (aynı tarih) ───────────────────
export function subscribeTours(dateStr, { onInsert, onUpdate, onDelete }) {
  unsubscribeTours();
  tourChannel = supabase
    .channel(`tours:tour_date=eq.${dateStr}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'tours', filter: `tour_date=eq.${dateStr}` },
      (payload) => onInsert?.(payload.new))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'tours', filter: `tour_date=eq.${dateStr}` },
      (payload) => onUpdate?.(payload.new))
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'tours', filter: `tour_date=eq.${dateStr}` },
      (payload) => onDelete?.(payload.old))
    .subscribe();
  return tourChannel;
}

export function unsubscribeTours() {
  if (tourChannel) {
    supabase.removeChannel(tourChannel);
    tourChannel = null;
  }
}
