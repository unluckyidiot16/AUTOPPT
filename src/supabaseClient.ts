// src/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY!;

// 전역 싱글톤 보관
const G = globalThis as any;
const INSTANCE_KEY = "__autoppt_supabase__";

export const supabase =
    G[INSTANCE_KEY] ??
    (G[INSTANCE_KEY] = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            storageKey: "autoppt.auth",   // 고유 키로 경합 방지
            autoRefreshToken: true,
            detectSessionInUrl: true,
        },
        realtime: {
            params: { eventsPerSecond: 10 }, // (완만한 기본치)
        },
    }));
