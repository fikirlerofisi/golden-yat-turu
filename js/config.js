// ============================================================
// config.js — Supabase bağlantısı + dropdown seçenekleri
// GoldenList projesi — otomatik dolduruldu
// ============================================================

export const SUPABASE_URL      = 'https://ixsxstvlthkvossovwse.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4c3hzdHZsdGhrdm9zc292d3NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzOTk0ODcsImV4cCI6MjA5NTk3NTQ4N30.vtE7P2pzRJTPzD0Owk1v2WdR_c6n-A9w19ruMZ-KM0w';

// ── Dropdown seçenekleri ──────────────────────────────────────
export const OPTIONS = {
  yachts:         ['River', 'River Mega', 'River Storm'],
  tourCodes:      ['T1', 'T2', 'T3'],
  departureTimes: ['15:45','16:00','16:15','16:30','16:45','17:00','17:15','17:30','17:45','18:00','18:15','18:30','18:45','19:00'],
  agencies:       ['', 'Rixos', 'Ramada', 'Çırağan'],
  sources:        ['', 'GYG', 'Klook', 'Viator', 'V2', 'Site - G', 'Site - T', 'Site - B'],
  tourGuides:     ['', 'Doğancan', 'Metin', 'Ayşe'],
  payments:       ['', 'Received', 'Card', 'Cash'],
  staffList:      ['', 'Betül', 'Nurşah', 'Aleyna'],
};
