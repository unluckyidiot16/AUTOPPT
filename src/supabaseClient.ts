// src/supabaseClient.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl =
    import.meta.env.VITE_SUPABASE_URL ?? "https://infhrqalyvybktiibtty.supabase.co";
const supabaseAnonKey =
    import.meta.env.VITE_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluZmhycWFseXZ5Ymt0aWlidHR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE4OTgzMjIsImV4cCI6MjA3NzQ3NDMyMn0.Skq7wnJBG5EqRVblo-wArAUYjT-3AQbVTRNZJmwWt_E";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
let supabase: SupabaseClient;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
        "[supabase] 환경변수가 없습니다. .env.local 에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 넣어주세요."
    );
    // 개발 편의용 dummy client
    supabase = createClient("https://example.supabase.co", "ey.fake.fake.fake");
} else {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export { supabase };
