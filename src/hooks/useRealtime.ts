// src/hooks/useRealtime.ts
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

/** ✅ 확장형 동기화 메시지 (slot/step 추가, hello에도 선택적으로 포함) */
export type SyncMessage =
    | { type: "hello"; role: "teacher" | "student"; slot?: number; page?: number }
    | { type: "goto"; page: number; slot?: number; step?: number };

function isSyncMessage(x: any): x is SyncMessage {
    if (!x || typeof x !== "object" || typeof x.type !== "string") return false;
    if (x.type === "hello") {
        if (x.role !== "teacher" && x.role !== "student") return false;
        if (x.page != null && typeof x.page !== "number") return false;
        if (x.slot != null && typeof x.slot !== "number") return false;
        return true;
    }
    if (x.type === "goto") {
        if (typeof x.page !== "number") return false;
        if (x.slot != null && typeof x.slot !== "number") return false;
        if (x.step != null && typeof x.step !== "number") return false;
        return true;
    }
    return false;
}

export function useRealtime(roomId: string, role: "teacher" | "student") {
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const [connected, setConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<SyncMessage | null>(null);

    useEffect(() => {
        if (!roomId) return;
        const ch = supabase.channel(`ppt-sync:${roomId}`, {
            config: { broadcast: { self: false } },
        });
        channelRef.current = ch;

        ch.on("broadcast", { event: "sync" }, (payload) => {
            const data = payload.payload as unknown;
            if (isSyncMessage(data)) setLastMessage(data);
            // else: 무시 (타 클라이언트의 실험적 페이로드 방지)
        });

        ch.subscribe((status) => {
            if (status === "SUBSCRIBED") {
                setConnected(true);
                // 최초 인사(선택: page/slot 동봉 가능)
                ch.send({
                    type: "broadcast",
                    event: "sync",
                    payload: { type: "hello", role } satisfies SyncMessage,
                });
            }
        });

        return () => {
            ch.unsubscribe();
            if (channelRef.current === ch) channelRef.current = null;
            setConnected(false);
        };
    }, [roomId, role]);

    /** 범용 전송 (타입 안전) */
    const send = useCallback((msg: SyncMessage) => {
        const ch = channelRef.current;
        if (!ch) return;
        ch.send({ type: "broadcast", event: "sync", payload: msg });
    }, []);

    /** 편의 함수: 페이지 이동 방송 */
    const sendGoto = useCallback(
        (page: number, slot?: number, step?: number) => {
            send({ type: "goto", page, ...(slot != null ? { slot } : {}), ...(step != null ? { step } : {}) });
        },
        [send]
    );

    return { connected, lastMessage, send, sendGoto };
}
