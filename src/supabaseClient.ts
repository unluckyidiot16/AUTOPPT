// src/supabaseClient.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _sb: SupabaseClient | null = null;

/** 교사용 앱: 싱글턴 Supabase 클라이언트 */
export const supabase = (() => {
    if (_sb) return _sb;
    _sb = createClient(
        import.meta.env.VITE_SUPABASE_URL!,
        import.meta.env.VITE_SUPABASE_ANON_KEY!,
        {
            auth: {
                persistSession: true,
                // 학생 앱과 스토리지 키를 분리하면 세션 충돌이 없습니다.
                storageKey: "autoppt-teacher",
            },
        }
    );
    return _sb;
})();
