// supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL!;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY!;

declare global {
    interface Window { __autoppt_sb?: ReturnType<typeof createClient> }
}

export const supabase =
    window.__autoppt_sb ??
    (window.__autoppt_sb = createClient(url, key, {
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            storageKey: "autoppt-auth", // 고유 키
        },
    }));
