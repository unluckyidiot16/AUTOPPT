// src/hooks/useRealtime.ts
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

export type SyncMessage =
    | { type: "hello"; role: "teacher" | "student" | "neutral"; slot?: number; page?: number }
    | { type: "goto"; page: number; slot?: number; step?: number }
    | { type: "refresh"; scope: "manifest" | "overlays" };

function isMsg(x: any): x is SyncMessage {
    if (!x || typeof x !== "object") return false;
    if (x.type === "hello") return x.role === "teacher" || x.role === "student" || x.role === "neutral";
    if (x.type === "goto") return typeof x.page === "number";
    if (x.type === "refresh") return x.scope === "manifest" || x.scope === "overlays";
    return false;
}

/**
 * Flexible realtime hook:
 * - (roomKey) 혹은 (roomKey, role) 둘 다 허용. roomKey는 room_code든 room_id든 상관 없이 "안정된 문자열"이면 됨.
 * - 채널 네이밍: ppt-sync:${roomKey}
 */
export function useRealtime(roomKey: string | null | undefined, role: "teacher" | "student" | "neutral" = "neutral") {
    const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const [connected, setConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<SyncMessage | null>(null);

    useEffect(() => {
        if (!roomKey) return;
        const ch = supabase.channel(`ppt-sync:${roomKey}`, { config: { broadcast: { self: false } } });
        chRef.current = ch;

        ch.on("broadcast", { event: "sync" }, (payload) => {
            const data = payload.payload as unknown;
            if (isMsg(data)) setLastMessage(data);
        });

        ch.subscribe((st) => {
            if (st === "SUBSCRIBED") {
                setConnected(true);
                ch.send({ type: "broadcast", event: "sync", payload: { type: "hello", role } });
            }
        });

        return () => {
            ch.unsubscribe();
            chRef.current = null;
            setConnected(false);
        };
    }, [roomKey, role]);

    const send = useCallback((msg: SyncMessage) => {
        const ch = chRef.current; if (!ch) return;
        ch.send({ type: "broadcast", event: "sync", payload: msg });
    }, []);

    const sendGoto = useCallback((page: number, slot?: number, step?: number) => {
        send({ type: "goto", page, ...(slot != null ? { slot } : {}), ...(step != null ? { step } : {}) });
    }, [send]);

    const sendRefresh = useCallback((scope: "manifest" | "overlays") => {
        send({ type: "refresh", scope });
    }, [send]);

    return { connected, lastMessage, send, sendGoto, sendRefresh };
}
