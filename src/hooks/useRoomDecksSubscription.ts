// src/hooks/useRoomDecksSubscription.ts
import { useEffect, useRef } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";

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
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "room_decks", filter: `room_id=eq.${roomId}` },
                (payload) => handlerRef.current(payload),
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [roomId]);
}
