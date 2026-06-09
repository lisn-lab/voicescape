import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// PASTE the Project URL + anon key Bo provided (Task 2 Step 1).
// These are public-by-design: the anon key only grants access governed by
// RLS policies. Committing them is acceptable.
const SUPABASE_URL = 'https://zlypbrvapzihbzjiknlc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpseXBicnZhcHppaGJ6amlrbmxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTg5OTEsImV4cCI6MjA5NTU3NDk5MX0.9cFzeFSQA9gdrVE6ZpUyCw8jnAgsQ4UZlhaeoqEv0IY';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

export const supabase = client;

// Resolves to the anonymous UID. Other modules await this before any write.
const realReady = (async () => {
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return data.user.id;
})();

export const ready = realReady;

// Test seam: a smoke harness sets window.__supabaseStub after page load to
// capture inserts/uploads without a network call. Both getters read it lazily at
// call time, so a stub set after this module loaded is still picked up.
export function getClient() {
  return (typeof window !== 'undefined' && window.__supabaseStub) || client;
}
export function getReady() {
  if (typeof window !== 'undefined' && window.__supabaseStub) return Promise.resolve('stub-uid');
  return realReady;
}
