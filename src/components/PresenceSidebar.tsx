// src/components/PresenceSidebar.tsx
import React, { useMemo, useState } from "react";
import type { PresencePayload } from "../hooks/usePresence";

type Props = {
    members: PresencePayload[];
    unfocused: PresencePayload[];
    /** 위치/크기 커스터마이즈 옵션 */
    top?: number; right?: number; width?: number;
};

export default function PresenceSidebar({
                                            members, unfocused, top = 84, right = 14, width = 260,
                                        }: Props) {
    const [collapsed, setCollapsed] = useState(false);

    const heartbeatSec = 10;             // 학생 하트비트 주기(훅 기본값)
    const offlinePadMs = 6000;           // 여유
    const offlineMs = heartbeatSec * 1000 + offlinePadMs;

    const byId = (x: PresencePayload) => x.studentId || x.nick || "unknown";
    const now = Date.now();

    const list = useMemo(() => {
        // unfocused 배열을 표시용으로 정리
        return unfocused
            .map((m) => {
                const offline = now - m.ts > offlineMs;
                const label = m.nick || m.studentId || "unknown";
                return { key: byId(m), label, offline, ts: m.ts, focused: m.focused };
            })
            // 같은 사람이 여러 연결일 수 있어 key 기준 최신만 남기기
            .reduce<Record<string, {key:string;label:string;offline:boolean;ts:number;focused:boolean}>>((acc, v) => {
                const cur = acc[v.key];
                if (!cur || v.ts > cur.ts) acc[v.key] = v;
                return acc;
            }, {});
    }, [unfocused, offlineMs, now]);

    const items = Object.values(list).sort((a, b) => a.label.localeCompare(b.label));

    const formatAgo = (msDiff: number) => {
        if (msDiff < 60_000) return `${Math.floor(msDiff / 1000)}s`;
        const m = Math.floor(msDiff / 60000);
        const s = Math.floor((msDiff % 60000) / 1000);
        return `${m}:${s.toString().padStart(2, "0")}m`;
    };

    return (
        <aside
            style={{
                position: "fixed", top, right, width,
                zIndex: 55,
            }}
            aria-label="이탈 상태 패널"
        >
            <div className="panel" style={{ padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 700 }}>이탈 목록</div>
                    <span className="badge">이탈 {items.length}</span>
                    <span className="badge">전체 {members.length}</span>
                    <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setCollapsed(!collapsed)}>
                        {collapsed ? "펼치기" : "접기"}
                    </button>
                </div>

                {!collapsed && (
                    <div style={{ marginTop: 8 }}>
                        {items.length === 0 ? (
                            <div style={{ opacity: 0.6, padding: 6 }}>현재 이탈한 학생이 없습니다.</div>
                        ) : (
                            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                                {items.map((it) => {
                                    const ms = now - it.ts;
                                    const status = it.offline ? "오프라인·끊김" : (it.focused ? "활성" : "탭 이탈");
                                    const dot = it.offline ? "#ef4444" : (it.focused ? "#10b981" : "#f59e0b");
                                    return (
                                        <li key={it.key} style={{
                                            display: "grid",
                                            gridTemplateColumns: "12px 1fr auto",
                                            alignItems: "center",
                                            gap: 8,
                                            border: "1px solid rgba(148,163,184,0.25)",
                                            borderRadius: 10,
                                            padding: "6px 8px",
                                        }}>
                                            <span style={{ width: 10, height: 10, borderRadius: 999, background: dot }} />
                                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {it.label}
                                                <span style={{ opacity: 0.65, marginLeft: 6, fontSize: 12 }}>· {status}</span>
                                            </div>
                                            <div style={{ opacity: 0.6, fontSize: 12 }}>{formatAgo(ms)}</div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                )}
            </div>
        </aside>
    );
}
