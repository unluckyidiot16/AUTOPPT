// src/utils/supaRpc.ts
import { supabase } from "../supabaseClient";

export async function safeRpc<T = any>(
    fn: string,
    args?: Record<string, any>
): Promise<T | null> {
    try {
        const { data, error, status } = await supabase.rpc(fn, args as any);
        if (error) {
            // PostgREST 404 → 엔드포인트 없음
            if ((status === 404) || /not found/i.test(String(error.message))) return null;
            // 함수는 있는데 에러 → 로딩을 막을 필요는 없으니 null 반환
            console.warn(`[RPC:${fn}] error`, error);
            return null;
        }
        return (data as T) ?? null;
    } catch (e: any) {
        // 네트워크 레벨 404 등도 여기서 흡수
        if (e?.status === 404) return null;
        console.warn(`[RPC:${fn}] throw`, e);
        return null;
    }
}

// 기다리지 않고 백그라운드 처리
export function fireAndForget(p: Promise<any>) {
    p.catch(() => {});
}
