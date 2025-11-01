// src/supabaseClient.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

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
