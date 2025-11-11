// src/pages/StudentPage.tsx (링크 배너 수신 + 배너 클릭 즉시 오픈)
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { usePresence } from "../hooks/usePresence";
import SlideStage, { type Overlay } from "../components/SlideStage";
import { slidesPrefixOfAny, signedSlidesUrl, normalizeSlidesKey } from "../utils/supaFiles";

type RpcOverlay = { id: string; z: number; type: string; payload: any };
type RpcSlide = {
    index: number;
    kind: string;
    material_id: string | null;
    page_index: number | null;       // 0-base
    image_key: string | null;        // slides/* 내부 키 (있으면 우선)
    overlays: RpcOverlay[];
};
type RpcSlot = { slot: number; lesson_id: string | null; current_index: number; slides: RpcSlide[] };
type RpcManifest = { room_code: string; slots: RpcSlot[]; error?: string };

const DEBUG = true;
const DBG = {
    info: (...a: any[]) => DEBUG && console.log("%c[AUTOPPT]", "color:#2563eb", ...a),
    ok:   (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:OK]", "color:#16a34a", ...a),
    err:  (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:ERR]", "color:#dc2626", ...a),
};

function uid() { return Math.random().toString(36).slice(2); }
function getOrSetStudentId() {
    let v = localStorage.getItem("autoppt:student-id");
    if (!v) { v = `stu-${uid()}`; localStorage.setItem("autoppt:student-id", v); }
    return v;
}
function getNickname() { return localStorage.getItem("autoppt:nickname") || ""; }
function setNicknameLS(v: string) { localStorage.setItem("autoppt:nickname", v); }

// URL 파서: hash라우팅/쿼리 모두 지원
function useQuery() {
    const s = new URLSearchParams(location.hash.split("?")[1] ?? location.search);
    return { room: s.get("room"), slot: Number(s.get("slot") ?? 1) };
}

// 캐시 버스터: 분 단위
function addCacheBuster(u: string | null | undefined): string | null {
    if (!u) return null;
    try {
        const url = new URL(u);
        url.hash = `v=${Math.floor(Date.now() / 60000)}`;
        return url.toString();
    } catch {
        return `${u}#v=${Math.floor(Date.now() / 60000)}`;
    }
}

// 버킷 상대 경로로 정규화: "presentations/…" 접두사 제거
function stripBucketPrefix(key: string | null | undefined) {
    if (!key) return null;
    return key.replace(/^presentations\//i, "");
}

export default function StudentPage() {
    const { slot } = useQuery();
    const roomCode = useRoomId("CLASS-XXXXXX");

    // room_id (slides 경로 계산용)
    const [roomId, setRoomId] = useState<string | null>(null);
    useEffect(() => {
        let off = false;
        (async () => {
            if (!roomCode) { if (!off) setRoomId(null); return; }
            const { data, error } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
            if (!off) setRoomId(error ? null : (data?.id ?? null));
        })();
        return () => { off = true; };
    }, [roomCode]);

    const studentId = useMemo(() => getOrSetStudentId(), []);
    const [nickname, setNicknameState] = useState(getNickname());
    const [editNick, setEditNick] = useState(false);
    const [nickInput, setNickInput] = useState(nickname);

    const [activeSlot, setActiveSlot] = useState<number>(slot > 0 ? slot : 1);

    // 페이지(1-base)
    const [pageRaw, setPageRaw] = useState<number | null>(null);
    const page = Number(pageRaw ?? 1) > 0 ? Number(pageRaw ?? 1) : 1;

    // Presence / RT (roomCode 기준)
    const presence = usePresence(roomCode, "student");
    const { lastMessage } = useRealtime(roomCode, "student");

    // 최초 로드 시 닉네임 presence push
    useEffect(() => { if (nickname) presence.track?.({ nick: nickname }); }, [nickname, presence]);

    // Manifest
    const [manifest, setManifest] = useState<RpcManifest | null>(null);

    /** RPC 실패 시 폴백 manifest 조립 */
    const buildManifestFallback = useCallback(async (roomCodeStr: string): Promise<RpcManifest | null> => {
        try {
            const { data: roomRow } = await supabase.from("rooms").select("id").eq("code", roomCodeStr).maybeSingle();
            const rid = roomRow?.id as string | undefined;
            if (!rid) return null;

            // A) 두 테이블 모두 조회
            const { data: lessons } = await supabase
                .from("room_lessons")
                .select("slot,current_index")
                .eq("room_id", rid)
                .order("slot", { ascending: true });

            const { data: maps } = await supabase
                .from("room_decks")
                .select("slot,deck_id")
                .eq("room_id", rid);

            // B) 슬롯 집합(lessons ∪ maps)
            const slotNums = Array.from(new Set([
                ...(lessons ?? []).map((L: any) => Number(L.slot)),
                ...(maps ?? []).map((m: any) => Number(m.slot)),
            ].filter((n) => Number.isFinite(n)))).sort((a,b)=>a-b);

            // C) 필요한 deck 메타 한번에 가져오기
            const deckIds = Array.from(new Set((maps ?? []).map((m: any) => m.deck_id).filter(Boolean)));
            const decks: Record<string, { file_key: string | null; file_pages: number | null }> = {};
            if (deckIds.length) {
                const { data: ds } = await supabase.from("decks").select("id,file_key,file_pages").in("id", deckIds);
                for (const d of ds ?? []) decks[d.id as string] = { file_key: d.file_key ?? null, file_pages: d.file_pages ?? null };
            }

            // D) 슬롯별 슬라이드 합성
            const slots: RpcSlot[] = slotNums.map((slot) => {
                const cur = (lessons ?? []).find((L: any) => Number(L.slot) === slot);
                const map = (maps ?? []).find((m: any) => Number(m.slot) === slot);
                const deckId = map?.deck_id ?? null;
                const meta = deckId ? decks[deckId] : null;
                const pages = Math.max(0, Number(meta?.file_pages ?? 0));

                const slides: RpcSlide[] = Array.from({ length: pages }, (_, i) => ({
                    index: i,
                    kind: "image",
                    material_id: deckId,
                    page_index: i,      // 0-base
                    image_key: null,    // rooms/* 또는 decks/* 로 자동 유도
                    overlays: [],
                }));

                return {
                    slot,
                    lesson_id: null,
                    current_index: Number(cur?.current_index ?? 0),
                    slides,
                };
            });

            return { room_code: roomCodeStr, slots };
        } catch (e) {
            DBG.err("fallback manifest error", e);
            return null;
        }
    }, []);

    /** 기존 RPC → 실패 시 폴백 */
    const loadManifest = useCallback(async () => {
        if (!roomCode) { setManifest(null); return; }
        try {
            const { data, error } = await supabase.rpc("get_student_manifest_by_code", { p_room_code: roomCode });
            if (error) throw error;

            // 서버가 빈 배열을 주는 케이스 보완
            if (data && Array.isArray(data.slots) && data.slots.length === 0) {
                DBG.info("rpc manifest empty → building from room_decks fallback");
                const fb = await buildManifestFallback(roomCode);
                setManifest(fb);
                return;
            }

            setManifest(data ?? null);
            DBG.ok("rpc:get_student_manifest_by_code", data);
        } catch (e) {
            DBG.err("rpc failed → fallback", e);
            const fb = await buildManifestFallback(roomCode);
            setManifest(fb);
            DBG.ok("fallback manifest", fb);
        }
    }, [roomCode, buildManifestFallback]);

    useEffect(() => { loadManifest(); }, [loadManifest]);

    // manifest 적용: 현재 슬롯의 페이지 설정
    useEffect(() => {
        if (!manifest) return;
        let slotBundle = manifest.slots.find(s => s.slot === activeSlot);

        // activeSlot이 없으면 첫 슬롯으로
        if (!slotBundle && manifest.slots.length > 0) {
            const first = manifest.slots[0];
            setActiveSlot(first.slot);
            setPageRaw(Number(first.current_index ?? 0) + 1);
            return;
        }

        if (slotBundle) setPageRaw(Number(slotBundle.current_index ?? 0) + 1);
    }, [manifest, activeSlot]);

    // 실시간 메시지 수신
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "goto") {
            if (typeof lastMessage.slot === "number") setActiveSlot(lastMessage.slot);
            if (typeof lastMessage.page === "number") setPageRaw(Math.max(1, Number(lastMessage.page)));
            return;
        }
        if (lastMessage.type === "refresh" && lastMessage.scope === "manifest") {
            loadManifest();
            return;
        }
    }, [lastMessage, loadManifest]);

    const totalPages = useMemo(() => {
        const s = manifest?.slots?.find(v => v.slot === activeSlot);
        return s?.slides?.length ?? 0;
    }, [manifest, activeSlot]);

    const deckPrefixCache = useRef(new Map<string, string>()); // deckId -> slidesPrefix
    const [activeBgUrl, setActiveBgUrl] = useState<string | null>(null);
    const [activeOverlays, setActiveOverlays] = useState<Overlay[]>([]);

    /** 주어진 slide에 대해 가능한 모든 이미지 키 후보(0-base / 1-base 모두) 생성 */
    const buildKeyCandidates = useCallback(async (slide: RpcSlide, idx0: number): Promise<string[]> => {
        const out: string[] = [];
        const page0 = Math.max(0, Number(slide.page_index ?? idx0));
        const page1 = page0 + 1;

        // A) image_key → 정규화 + 1-base까지 시도
        if (slide.image_key) {
            const direct = normalizeSlidesKey(slide.image_key)!;
            out.push(direct);
            out.push(direct.replace(/\/(\d+)(\.webp)$/i, (_m, p, ext) => `/${Number(p) + 1}${ext}`)); // 0->1 폴백
        }

        // B) rooms/<roomId>/decks/<deckId>/{0,1}.webp
        if (roomId && slide.material_id) {
            out.push(`rooms/${roomId}/decks/${slide.material_id}/${page0}.webp`);
            out.push(`rooms/${roomId}/decks/${slide.material_id}/${page1}.webp`);
        }

        // C) decks/<slug>/{0,1}.webp (원본 프리픽스)
        if (slide.material_id) {
            let prefix = deckPrefixCache.current.get(slide.material_id);
            if (!prefix) {
                const { data } = await supabase.from("decks").select("file_key").eq("id", slide.material_id).maybeSingle();
                const p = slidesPrefixOfAny(data?.file_key ?? null) || "";
                if (p) { prefix = p; deckPrefixCache.current.set(slide.material_id, p); }
            }
            if (prefix) {
                out.push(`${prefix}/${page0}.webp`);
                out.push(`${prefix}/${page1}.webp`);
            }
        }

        // 중복 제거
        return Array.from(new Set(out.filter(Boolean)));
    }, [roomId]);

    // 현재 페이지의 배경 이미지 / 오버레이 계산
    useEffect(() => {
        let off = false;

        (async () => {
            const s = manifest?.slots?.find(v => v.slot === activeSlot);
            if (!s) { if (!off) { setActiveBgUrl(null); setActiveOverlays([]); } return; }

            const idx = Math.max(0, page - 1);
            const slide = s.slides[idx] as RpcSlide | undefined;
            if (!slide) { if (!off) { setActiveBgUrl(null); setActiveOverlays([]); } return; }

            // overlays
            if (!off) {
                setActiveOverlays((slide.overlays || []).map(o => ({
                    id: String(o.id), z: o.z, type: o.type, payload: o.payload
                })));
            }

            // 후보 키들 생성
            const candidates = await buildKeyCandidates(slide, idx);
            DBG.info("page", page, "candidates", candidates);

            // 절대 URL(https) 후보는 바로 사용
            for (const k of candidates) {
                if (/^https?:\/\//i.test(k)) {
                    if (!off) setActiveBgUrl(addCacheBuster(k));
                    return;
                }
            }

            // 서명 URL 순차 시도 (첫 성공 키 사용)
            for (const k of candidates) {
                try {
                    const signed = await signedSlidesUrl(k, 1800);
                    if (signed) { if (!off) setActiveBgUrl(addCacheBuster(signed)); return; }
                } catch {
                    /* 다음 후보 시도 */
                }
            }

            // 모두 실패
            if (!off) setActiveBgUrl(null);
        })();

        return () => { off = true; };
    }, [manifest, activeSlot, page, buildKeyCandidates]);

    const submitAnswer = async (val: any) => {
        try {
            const payload = {
                p_room_code: roomCode,
                p_slide: page,
                p_step: 0,
                p_student_id: studentId,
                p_answer: typeof (val as any)?.value === "string" ? (val as any).value : JSON.stringify(val),
            };
            await supabase.rpc("submit_answer_v2", payload);
            DBG.ok("rpc:submit_answer_v2", payload);
        } catch (e: any) {
            DBG.err("submit_answer_v2 error", e);
            alert(e?.message ?? String(e));
        }
    };

    const saveNick = () => {
        const v = nickInput.trim();
        if (!v) { alert("닉네임을 입력하세요."); return; }
        setNicknameLS(v); setNicknameState(v); setEditNick(false);
        presence.track?.({ nick: v });
    };

    // ── 교사 → 학생 "간단 링크" 수신 배너 ───────────────────────────────
    const [incomingLink, setIncomingLink] = useState<string | null>(null);
    const [linkChan, setLinkChan] = useState<ReturnType<typeof supabase.channel> | null>(null);

    useEffect(() => {
        if (!roomCode) return;
        const ch = supabase.channel(`link:${roomCode}`, { config: { broadcast: { self: false } } });
        ch.on("broadcast", { event: "link" }, (msg: any) => {
            const url = (msg?.payload?.url || "").trim();
            if (url) setIncomingLink(url);
        });
        ch.subscribe();
        setLinkChan(ch);
        return () => { supabase.removeChannel(ch); };
    }, [roomCode]);

    const openIncoming = useCallback(() => {
        if (!incomingLink) return;
        try {
            window.open(incomingLink, "_blank", "noopener,noreferrer");
        } catch {
            location.href = incomingLink; // 팝업 차단 환경 대비
        }
    }, [incomingLink]);

    return (
        <div className="app-shell" style={{ maxWidth: 1080 }}>
            <div className="topbar" style={{ marginBottom: 14 }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>학생 화면</h1>
                <span className="badge">room: {roomCode}</span>
                <span className="badge">내 ID: {studentId}</span>
                <span className="badge">교시: {activeSlot}</span>
                <span className="badge">페이지: {page}{totalPages ? ` / ${totalPages}` : ""}</span>
                {nickname ? <span className="badge">닉네임: {nickname}</span> : <span className="badge">닉네임: 설정 안 됨</span>}
                <button className="btn" style={{ marginLeft: 8 }}
                        onClick={() => { setEditNick(v => !v); setNickInput(nickname); }}>
                    닉네임
                </button>
            </div>

            {/* 교사가 보낸 링크 배너 (배너 클릭 시 자동 오픈) */}
            {incomingLink && (
                <div
                    className="panel"
                    onClick={openIncoming}
                    style={{
                        marginTop: 0, marginBottom: 12, display: "flex", gap: 8, alignItems: "center",
                        cursor: "pointer", border: "2px solid #2563eb", background: "rgba(37,99,235,.06)"
                    }}
                    title="클릭하면 링크가 열립니다"
                >
                    <div style={{ fontSize: 13, flex: 1, wordBreak: "break-all" }}>
                        📎 선생님이 링크를 보냈어요:&nbsp;
                        <u>{incomingLink}</u>
                    </div>
                    <button
                        className="btn"
                        onClick={(e) => { e.stopPropagation(); setIncomingLink(null); }}
                    >
                        닫기
                    </button>
                </div>
            )}

            <div className="panel" style={{ padding: 12 }}>
                <div className="slide-stage" style={{ width: "100%", height: "72vh", display: "grid", placeItems: "center" }}>
                    <SlideStage bgUrl={activeBgUrl} overlays={activeOverlays} mode="student" onSubmit={submitAnswer} />
                </div>
            </div>

            {editNick && (
                <div className="panel" style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                    <input className="input" value={nickInput} onChange={e => setNickInput(e.target.value)} placeholder="닉네임" />
                    <button className="btn" onClick={saveNick}>저장</button>
                </div>
            )}
        </div>
    );
}
