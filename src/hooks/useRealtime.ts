// src/hooks/useRealtime.ts
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

export type SyncMessage =
    | { type: "hello"; role: "teacher" | "student" }
    | { type: "goto"; slide: number; step: number };

export function useRealtime(roomId: string, role: "teacher" | "student") {
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const [connected, setConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<SyncMessage | null>(null);

    useEffect(() => {
        const ch = supabase.channel(`ppt-sync:${roomId}`, {
            config: { broadcast: { self: false } },
        });
        channelRef.current = ch;

        ch.on("broadcast", { event: "sync" }, (payload) => {
            const data = payload.payload as SyncMessage;
            setLastMessage(data);
        });

        ch.subscribe((status) => {
            if (status === "SUBSCRIBED") {
                setConnected(true);
                // 입장 알림
                ch.send({
                    type: "broadcast",
                    event: "sync",
                    payload: { type: "hello", role },
                });
            }
        });

        return () => {
            ch.unsubscribe();
            setConnected(false);
        };
    }, [roomId, role]);

    const send = useCallback((msg: SyncMessage) => {
        const ch = channelRef.current;
        if (!ch) return;
        ch.send({
            type: "broadcast",
            event: "sync",
            payload: msg,
        });
    }, []);

    return { connected, lastMessage, send };
}
