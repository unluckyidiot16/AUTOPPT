import { useEffect, useRef } from 'react';
import { createClient, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_ANON_KEY!,
);

// onChange: (ev) => { ev.eventType: 'INSERT'|'UPDATE'|'DELETE', ev.new, ev.old }
export function useRoomDecksSubscription(
    roomId: string | null | undefined,
    onChange: (ev: RealtimePostgresChangesPayload<any>) => void,
) {
    const handlerRef = useRef(onChange);
    handlerRef.current = onChange;

    useEffect(() => {
        if (!roomId) return;
        const channel = supabase
            .channel(`room-decks:${roomId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'room_decks',
                filter: `room_id=eq.${roomId}`,
            }, (payload) => handlerRef.current(payload))
            .subscribe((status) => {
                // 필요시 상태 로깅: 'SUBSCRIBED' 등
                // console.debug('room_decks subscribe:', status);
            });

        // 탭 전환/네트워크 복구 시 자동 재구독은 supabase v2가 처리
        return () => { supabase.removeChannel(channel); };
    }, [roomId]);
}
