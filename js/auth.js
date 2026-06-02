import { supabase } from './supabase.js';

// ── Mevcut oturum / profil ────────────────────────────────────
export let currentUser = null;
export let currentProfile = null;

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    currentProfile = await fetchProfile(session.user.id);
  }
  return session;
}

async function fetchProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return data;
}

// ── Login ─────────────────────────────────────────────────────
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentUser = data.user;
  currentProfile = await fetchProfile(data.user.id);
  return currentProfile;
}

// ── Logout ────────────────────────────────────────────────────
export async function logout() {
  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
}

// ── Auth durum değişikliği dinleyicisi ────────────────────────
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      currentUser = session.user;
      currentProfile = await fetchProfile(session.user.id);
    } else {
      currentUser = null;
      currentProfile = null;
    }
    callback(event, session, currentProfile);
  });
}
