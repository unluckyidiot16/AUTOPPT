// src/pages/TeacherPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { usePresence } from "../hooks/usePresence";
import PresenceSidebar from "../components/PresenceSidebar";
import { useArrowNav } from "../hooks/useArrowNav";
import { getBasePath } from "../utils/getBasePath";
import { RoomQR } from "../components/RoomQR";
import SlideStage, { type Overlay } from "../components/SlideStage";
import PdfToSlidesUploader from "../components/PdfToSlidesUploader";

type RpcOverlay = { id: string; z: number; type: string; payload: any };
type RpcSlide = {
    index: number;
    kind: string;
    material_id: string | null;
    page_index: number | null;
    image_key: string | null;
    overlays: RpcOverlay[];
};
type RpcSlot = { slot: number; lesson_id: string; current_index: number; slides: RpcSlide[]; };
type RpcManifest = { room_code: string; slots: RpcSlot[]; error?: string };

const DEBUG = true;
const DBG = {
    info: (...a: any[]) => DEBUG && console.log("%c[AUTOPPT]", "color:#2563eb", ...a),
    ok:   (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:OK]", "color:#16a34a", ...a),
    err:  (...a: any[]) => DEBUG && console.log("%c[AUTOPPT:ERR]", "color:#dc2626", ...a),
};

async function rpc<T = any>(fn: string, args?: Record<string, any>) {
    const { data, error } = await supabase.rpc(fn, args ?? {});
    if (error) { DBG.err("rpc error:", fn, error.message || error); throw error; }
    return data as T;
}

/** 쿼리스트링 */
function useQS() {
    const { search } = useLocation();
    return useMemo(() => new URLSearchParams(search), [search]);
}

/** 토스트 */
function useToast(ms = 2400) {
    const [open, setOpen] = useState(false);
    const [msg, setMsg] = useState("");
    const show = (m: string) => { setMsg(m); setOpen(true); setTimeout(() => setOpen(false), ms); };
    const node = open ? (
        <div style={{
            position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
            background: "rgba(17,24,39,0.98)", color: "#fff", border: "1px solid rgba(148,163,184,0.25)",
            borderRadius: 12, padding: "10px 14px", boxShadow: "0 10px 24px rgba(0,0,0,0.35)", zIndex: 60
        }}>{msg}</div>
    ) : null;
    return { show, node };
}

/** 전체화면 토글 훅 */
function useFullscreenTarget(selector: string) {
    const [isFS, setIsFS] = useState(false);
    useEffect(() => {
        const h = () => setIsFS(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", h);
        return () => document.removeEventListener("fullscreenchange", h);
    }, []);
    const toggle = useCallback(() => {
        const el = (document.querySelector(selector) as HTMLElement) || document.documentElement;
        const doc: any = document;
        if (!doc.fullscreenElement) el.requestFullscreen?.();
        else doc.exitFullscreen?.();
    }, [selector]);
    return { isFS, toggle };
}

export default function TeacherPage() {
    const nav = useNavigate();
    const qs = useQS();
    const toast = useToast();

    // ---- Room ----
    const defaultCode = useMemo(() => "CLASS-" + Math.random().toString(36).slice(2, 8).toUpperCase(), []);
    const roomCode = useRoomId(defaultCode);
    const [roomId, setRoomId] = useState<string | null>(null);
    const [page, setPage] = useState<number>(1);
    const viewMode: "present" | "setup" = qs.get("mode") === "setup" ? "setup" : "present";

    const presence = usePresence(roomCode, "teacher");
    const { isFS, toggle: toggleFS } = useFullscreenTarget(".slide-stage");

    // URL 정리
    useEffect(() => {
        const url = new URLSearchParams(qs.toString());
        if (!url.get("room") && roomCode) {
            url.set("room", roomCode);
            if (!url.get("mode")) url.set("mode", "present");
            nav(`/teacher?${url.toString()}`, { replace: true });
        }
    }, [roomCode, qs, nav]);

    // Room row(page) 초기화
    const refreshRoomState = useCallback(async () => {
        if (!roomCode) return;
        const { data, error } = await supabase
            .from("rooms")
            .select("id, state")
            .eq("code", roomCode)
            .maybeSingle();
        if (error) return;
        if (data) {
            setRoomId(data.id);
        }
    }, [roomCode]);
    useEffect(() => { refreshRoomState(); }, [refreshRoomState]);

    // manifest
    const [manifest, setManifest] = useState<RpcManifest | null>(null);
    const [activeSlot, setActiveSlot] = useState<number>(1);

    const refreshManifest = useCallback(async () => {
        if (!roomCode) return setManifest(null);
        try {
            const data = await rpc<RpcManifest>("get_student_manifest_by_code", { p_room_code: roomCode });
            setManifest(data);
        } catch (e) {
            DBG.err("manifest rpc", e);
            setManifest(null);
        }
    }, [roomCode]);
    useEffect(() => { refreshManifest(); }, [refreshManifest]);

    // activeSlot 변경 시 해당 교시의 current_index를 페이지에 반영
    const syncPageFromSlot = useCallback(async (slot: number) => {
        if (!roomId) return;
        const { data } = await supabase
            .from("room_lessons")
            .select("current_index")
            .eq("room_id", roomId)
            .eq("slot", slot)
            .maybeSingle();
        const idx = Number(data?.current_index ?? 0);
        setPage(idx + 1);
    }, [roomId]);

    useEffect(() => {
        syncPageFromSlot(activeSlot);
    }, [activeSlot, syncPageFromSlot]);

    const totalPages = useMemo(() => {
        const slot = manifest?.slots?.find(s => s.slot === activeSlot) ?? manifest?.slots?.[0];
        return slot?.slides?.length ?? 0;
    }, [manifest, activeSlot]);

    function currentSlide(): RpcSlide | null {
        const slot = manifest?.slots?.find(s => s.slot === activeSlot) ?? manifest?.slots?.[0];
        if (!slot) return null;
        const idx = Math.max(0, page - 1);
        return slot.slides[idx] ?? null;
    }

    const active = useMemo(() => {
        const s = currentSlide();
        if (!s) return null;
        const bgUrl = s.image_key ? supabase.storage.from("slides").getPublicUrl(s.image_key).data.publicUrl : null;
        const overlays: Overlay[] = (s.overlays || []).map(o => ({ id: String(o.id), z: o.z, type: o.type, payload: o.payload }));
        return { bgUrl, overlays };
    }, [manifest, page, activeSlot]);

    // Realtime: 학생 새로 들어오면 현재 페이지 브로드캐스트
    const { lastMessage, send } = useRealtime(roomCode, "teacher");
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "hello") {
            send({ type: "goto", page, slot: activeSlot });
        }
    }, [lastMessage, page, activeSlot, send]);

    // Controls — 교시별 current_index 업데이트
    const gotoPageForSlot = useCallback(async (slot: number, nextPage: number) => {
        const p = Math.max(1, nextPage);
        if (!roomId) return;
        // room_lessons.current_index 업데이트 (교시별 진도 저장)
        const { error } = await supabase
            .from("room_lessons")
            .update({ current_index: p - 1 })
            .eq("room_id", roomId)
            .eq("slot", slot);
        if (error) DBG.err("room_lessons.update", error);
        setPage(p);
        send({ type: "goto", page: p, slot });
    }, [roomId, send]);

    const next = useCallback(async () => {
        if (totalPages && page >= totalPages) return;
        await gotoPageForSlot(activeSlot, page + 1);
    }, [page, totalPages, activeSlot, gotoPageForSlot]);

    const prev = useCallback(async () => {
        if (page <= 1) return;
        await gotoPageForSlot(activeSlot, page - 1);
    }, [page, activeSlot, gotoPageForSlot]);

    useArrowNav(prev, next);

    // 학생 링크(현재 교시 포함)
    const studentUrl = useMemo(() => {
        const base = getBasePath();
        return `${location.origin}${base}/#/student?room=${roomCode}&slot=${activeSlot}`;
    }, [roomCode, activeSlot]);

    // 최근 제출
    const [answers, setAnswers] = useState<any[]>([]);
    useEffect(() => {
        (async () => {
            if (!roomId) return;
            const { data } = await supabase
                .from("answers_v2")
                .select("student_id, answer, slide, step, created_at")
                .eq("room_id", roomId)
                .order("created_at", { ascending: false })
                .limit(50);
            setAnswers(data || []);
        })();
    }, [roomId, page]);

    // ====== 자료함(내 자료) 리스트 + 배정 ======
    const [library, setLibrary] = useState<any[]>([]);
    const refreshLibrary = useCallback(async () => {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) return setLibrary([]);
        const { data, error } = await supabase
            .from("materials")
            .select("id, title, created_at")
            .eq("owner_id", uid)
            .order("created_at", { ascending: false })
            .limit(30);
        if (error) DBG.err("materials list", error);
        setLibrary(data || []);
    }, []);
    useEffect(() => { refreshLibrary(); }, [refreshLibrary]);

    const createLessonFromMaterial = useCallback(async (materialId: string) => {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) throw new Error("로그인이 필요합니다.");

        // lesson 생성
        const { data: lesson, error: el } = await supabase
            .from("lessons")
            .insert({ owner_id: uid, title: `Lesson of ${materialId}` })
            .select()
            .single();
        if (el) throw el;
        const lessonId: string = lesson.id;

        // material_pages 조회 → lesson_slides 생성
        const { data: pages, error: ep } = await supabase
            .from("material_pages")
            .select("page_index")
            .eq("material_id", materialId)
            .order("page_index");
        if (ep) throw ep;

        const rows = (pages || []).map((p: any) => ({
            lesson_id: lessonId,
            sort_index: p.page_index,
            kind: "material",
            material_id: materialId,
            page_index: p.page_index,
        }));
        if (rows.length) {
            const { error: es } = await supabase.from("lesson_slides").insert(rows);
            if (es) throw es;
        }
        return lessonId;
    }, []);

    const assignMaterialToSlot = useCallback(async (materialId: string, slot: number) => {
        if (!roomId) throw new Error("roomId 없음");
        // 기존 lesson 확인: 같은 material 기반 lesson이 여러 개일 수 있으므로, 여기서는 새로 생성
        const lessonId = await createLessonFromMaterial(materialId);
        // room_lessons 배정
        const { error: erl } = await supabase
            .from("room_lessons")
            .upsert(
                { room_id: roomId, slot, lesson_id: lessonId, current_index: 0 },
                { onConflict: "room_id,slot" }
            );
        if (erl) throw erl;

        await refreshManifest();
        setActiveSlot(slot);
        await gotoPageForSlot(slot, 1);
        toast.show("배정 완료");
    }, [roomId, createLessonFromMaterial, refreshManifest, gotoPageForSlot, toast]);

    // ===================== UI =====================

    const StageBlock = (
        <div className="panel" style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {activeSlot}교시 · 페이지 {page}{totalPages ? ` / ${totalPages}` : ""}
                </div>
                <a className="btn" href={studentUrl} target="_blank" rel="noreferrer">학생 접속 링크</a>
                <button className="btn" onClick={toggleFS}>{isFS ? "전체화면 해제" : "전체화면"}</button>
            </div>
            <div className="slide-stage" style={{ width: "100%", height: "72vh", display: "grid", placeItems: "center", background: isFS ? "#000" : "transparent" }}>
                <SlideStage
                    bgUrl={active?.bgUrl ?? null}
                    overlays={active?.overlays ?? []}
                    mode="teacher"
                />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                <button className="btn" onClick={prev} disabled={page <= 1}>◀ 이전</button>
                <button className="btn" onClick={() => gotoPageForSlot(activeSlot, page)}>🔓 현재 페이지 재전송</button>
                <button className="btn" onClick={next} disabled={!!totalPages && page >= totalPages}>다음 ▶</button>
            </div>
        </div>
    );

    const SetupRight = (
        <div className="panel" style={{ display: "grid", gap: 16 }}>
            {/* 교시 전환 */}
            <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>교시 전환</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button className="btn" onClick={() => setActiveSlot(s => Math.max(1, s - 1))}>◀</button>
                    <div className="badge">{activeSlot}교시</div>
                    <button className="btn" onClick={() => setActiveSlot(s => Math.min(6, s + 1))}>▶</button>
                    <span style={{ fontSize: 12, opacity: .7 }}>교시를 바꾸면 해당 교시의 진도(current_index)를 불러옵니다.</span>
                </div>
            </div>

            {/* PDF 업로더(자료함) */}
            <div>
                <PdfToSlidesUploader onFinished={({ materialId }) => {
                    toast.show("자료함 업로드 완료");
                    refreshLibrary();
                }} />
            </div>

            {/* 자료함 목록 → 배정 */}
            <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>내 자료(최근 30)</div>
                <div style={{ display: "grid", gap: 8, maxHeight: 280, overflow: "auto" }}>
                    {library.length === 0 ? (
                        <div style={{ opacity: 0.6 }}>자료가 없습니다. 위의 업로더로 추가하세요.</div>
                    ) : (
                        library.map((m) => (
                            <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    <strong>{m.title || m.id}</strong>
                                    <span style={{ fontSize: 12, opacity: .7, marginLeft: 8 }}>{new Date(m.created_at).toLocaleString()}</span>
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button className="btn" onClick={() => assignMaterialToSlot(m.id, activeSlot)}>
                                        {activeSlot}교시에 배정
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* 학생 접속 */}
            <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>학생 접속</div>
                <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, alignItems: "center" }}>
                    <div style={{ background: "#fff", borderRadius: 12, padding: 12, width: 180, height: 180, overflow: "hidden", display: "grid", placeItems: "center" }}>
                        <RoomQR url={studentUrl} size={156} />
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                        <a className="btn" href={studentUrl} target="_blank" rel="noreferrer">링크 열기</a>
                        <span style={{ fontSize: 12, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {studentUrl}
            </span>
                        <button className="btn" onClick={() => { navigator.clipboard?.writeText(studentUrl); }} title="주소 복사">복사</button>
                    </div>
                </div>
            </div>

            {/* 최근 제출 */}
            <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>최근 제출(50)</div>
                {answers.length === 0 ? (
                    <div style={{ opacity: 0.6 }}>최근 제출이 없습니다.</div>
                ) : (
                    <div style={{ display: "grid", gap: 6, maxHeight: 260, overflow: "auto" }}>
                        {answers.map((a, i) => (
                            <div key={i} style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 8, fontSize: 13 }}>
                                <span className="badge">{a.student_id}</span>
                                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.answer}</span>
                                <span style={{ opacity: 0.7 }}>{new Date(a.created_at).toLocaleTimeString()}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="app-shell" style={{ maxWidth: 980 }}>
            <div className="topbar" style={{ marginBottom: 12 }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>교사 화면</h1>
                <span className="badge">room: {roomCode}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=present`)} aria-pressed={viewMode === "present"}>발표</button>
                    <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=setup`)} aria-pressed={viewMode === "setup"}>설정</button>
                    <button className="btn" onClick={() => nav(`/library?room=${roomCode}`)}>자료함</button>
                </div>
            </div>

            {viewMode === "present" ? (
                <div className="panel" style={{ padding: 12 }}>
                    {StageBlock}
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: 16 }}>
                    <div className="panel">
                        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                            {activeSlot}교시 · 페이지 {page}{totalPages ? ` / ${totalPages}` : ""}
                        </div>
                        <div className="slide-stage" style={{ width: "100%", height: 500, display: "grid", placeItems: "center" }}>
                            <SlideStage
                                bgUrl={active?.bgUrl ?? null}
                                overlays={active?.overlays ?? []}
                                mode="teacher"
                            />
                        </div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                            <button className="btn" onClick={prev} disabled={page <= 1}>◀ 이전</button>
                            <button className="btn" onClick={() => gotoPageForSlot(activeSlot, page)}>🔓 현재 페이지 재전송</button>
                            <button className="btn" onClick={next} disabled={!!totalPages && page >= totalPages}>다음 ▶</button>
                        </div>
                    </div>
                    {SetupRight}
                </div>
            )}

            <PresenceSidebar members={presence.members} unfocused={presence.unfocused} />
            {toast.node}
        </div>
    );
}
