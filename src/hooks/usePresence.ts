// src/hooks/usePresence.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

/** presence payload spec */
export type PresencePayload = {
    studentId?: string;
    role: "teacher" | "student";
    focused: boolean;
    ts: number; // epoch ms
    nick?: string;
};

type PresenceState = Record<string, PresencePayload[]>;

/** presence state → 최신 스냅샷 배열로 평탄화 */
function flattenPresence(state: PresenceState) {
    const out: PresencePayload[] = [];
    for (const key of Object.keys(state)) {
        const arr = state[key] ?? [];
        if (arr.length) {
            // 같은 key여도 여러 커넥션이 있을 수 있음 → 가장 최근 ts 사용
            const latest = arr.reduce((a, b) => (a.ts >= b.ts ? a : b));
            out.push(latest);
        }
    }
    return out;
}

export function usePresence(
    roomCode: string,
    role: "teacher" | "student",
    opts?: { studentId?: string; nickname?: string; heartbeatSec?: number }
) {
    const key = useMemo(() => opts?.studentId || role, [opts?.studentId, role]);
    const heartbeatSec = opts?.heartbeatSec ?? 10;
    const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    const [rawState, setRawState] = useState<PresenceState>({});
    const members = useMemo(() => flattenPresence(rawState), [rawState]);

    // teacher용 파생값: unfocused / stale(하트비트 끊김)
    const now = Date.now();
    const staleMs = (heartbeatSec + 6) * 1000; // 여유 6s
    const unfocused = members.filter(m => !m.focused || now - m.ts > staleMs);

    useEffect(() => {
        const ch = supabase.channel(`ppt-presence:${roomCode}`, {
            config: { presence: { key } },
        });
        chRef.current = ch;

        ch.on("presence", { event: "sync" }, () => {
            const s = ch.presenceState() as PresenceState;
            setRawState(s);
        });

        ch.subscribe(async (status) => {
            if (status === "SUBSCRIBED" && role === "student") {
                ch.track({
                    role,
                    studentId: opts?.studentId,
                    focused: true,
                    ts: Date.now(),
                    nick: opts?.nickname,
                } as PresencePayload);
            }
        });

        return () => {
            supabase.removeChannel(ch);
            chRef.current = null;
        };
    }, [roomCode, key, role, opts?.studentId, opts?.nickname]);

    // 하트비트
    useEffect(() => {
        if (role !== "student") return;
        const t = setInterval(() => {
            chRef.current?.track({
                role,
                studentId: opts?.studentId,
                focused: document.visibilityState === "visible",
                ts: Date.now(),
                nick: opts?.nickname,
            } as PresencePayload);
        }, heartbeatSec * 1000);
        return () => clearInterval(t);
    }, [role, opts?.studentId, opts?.nickname, heartbeatSec]);

    // 학생 전용: 포커스 이벤트 반영
    useEffect(() => {
        if (role !== "student") return;
        const onVis = () =>
            chRef.current?.track({
                role,
                studentId: opts?.studentId,
                focused: document.visibilityState === "visible",
                ts: Date.now(),
                nick: opts?.nickname,
            } as PresencePayload);
        const onFocus = () =>
            chRef.current?.track({ role, studentId: opts?.studentId, focused: true, ts: Date.now(), nick: opts?.nickname });
        const onBlur = () =>
            chRef.current?.track({ role, studentId: opts?.studentId, focused: false, ts: Date.now(), nick: opts?.nickname });
        const onOnline = onFocus;
        const onOffline = onBlur;

        window.addEventListener("visibilitychange", onVis);
        window.addEventListener("focus", onFocus);
        window.addEventListener("blur", onBlur);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            window.removeEventListener("visibilitychange", onVis);
            window.removeEventListener("focus", onFocus);
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, [role, opts?.studentId, opts?.nickname]);

    const track = useCallback((patch: Partial<PresencePayload>) => {
        const base: PresencePayload = {
            role,
            studentId: opts?.studentId,
            focused: document.visibilityState === "visible",
            ts: Date.now(),
            nick: opts?.nickname,
        };
        chRef.current?.track({ ...base, ...patch });
    }, [role, opts?.studentId, opts?.nickname]);

    return {
        /** 원본 presenceState() */
        state: rawState,
        /** 최신 스냅샷 배열 */
        members,
        /** 교사용: 이탈/오프라인 추정 목록 */
        unfocused,
        /** 임의 갱신 (학생측에서 닉네임 변경 등) */
        track,
    };
}
