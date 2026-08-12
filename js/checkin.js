import { supabase } from './supabase.js';
import { currentUser } from './auth.js';

// ── Geliş durumunu değiştir ───────────────────────────────────
export async function toggleCheckin(bookingId, currentState) {
  const newState = !currentState;
  const patch = newState
    ? { checked_in: true,  checked_in_at: new Date().toISOString(), checked_in_by: currentUser?.id }
    : { checked_in: false, checked_in_at: null, checked_in_by: null, yacht: '' };

  const { data, error } = await supabase
    .from('bookings')
    .update(patch)
    .eq('id', bookingId)
    .select(`*, checked_in_by_profile:profiles!checked_in_by(full_name)`)
    .single();

  if (error) throw error;
  return data;
}
