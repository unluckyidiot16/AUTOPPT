// src/hooks/useTeacherNotify.ts
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

export type TeacherEvent =
    | {
    type: "unlock-request";
    roomId: string;
    slide: number;
    step: number;
    answer: string;
    studentId?: string;
};

export function useTeacherNotify(roomId: string) {
    const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const [connected, setConnected] = useState(false);
    const [lastEvent, setLastEvent] = useState<TeacherEvent | null>(null);

    useEffect(() => {
        const ch = supabase.channel(`ppt-sync:${roomId}:teacher`, {
            config: { broadcast: { self: false } },
        });
        chRef.current = ch;

        ch.on("broadcast", { event: "teacher" }, (payload) => {
            const data = payload.payload as TeacherEvent;
            setLastEvent(data);
        });

        ch.subscribe((status) => {
            if (status === "SUBSCRIBED") {
                setConnected(true);
            }
        });

        return () => {
            ch.unsubscribe();
            setConnected(false);
        };
    }, [roomId]);

    const send = useCallback((evt: TeacherEvent) => {
        const ch = chRef.current;
        if (!ch) return;
        ch.send({
            type: "broadcast",
            event: "teacher",
            payload: evt,
        });
    }, []);

    return { connected, lastEvent, send };
}
