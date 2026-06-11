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
// Kullanıcı adı alır; e-postaya çeviriyi veritabanındaki
// email_for_username() fonksiyonu yapar. '@' içeren girdi
// doğrudan e-posta kabul edilir (yedek yol).
export async function login(username, password) {
  let email = username;
  if (!email.includes('@')) {
    const { data: found, error: rpcError } = await supabase.rpc('email_for_username', { p_username: username });
    if (rpcError || !found) throw new Error('Incorrect username or password');
    email = found;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error('Incorrect username or password');
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
