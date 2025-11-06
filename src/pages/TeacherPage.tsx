// src/pages/TeacherPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useRoomId } from "../hooks/useRoomId";
import { useRealtime } from "../hooks/useRealtime";
import { useRoomDecksSubscription } from "../hooks/useRoomDecksSubscription";
import PdfViewer from "../components/PdfViewer";
import { getBasePath } from "../utils/getBasePath";
import { getManifestByRoom } from "../api/overrides";
import type { ManifestItem, ManifestPageItem, ManifestQuizItem } from "../types/manifest";
import QuizOverlay from "../components/QuizOverlay";
import { usePresence } from "../hooks/usePresence";
import PresenceSidebar from "../components/PresenceSidebar";
import { useArrowNav } from "../hooks/useArrowNav";
import { RoomQR } from "../components/RoomQR";

type DeckSlot = { slot: number; deck_id: string | null; title?: string | null; file_key?: string | null };

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

/** 안전 페이지 이동(goto_page → goto_slide → rooms.state 폴백) */
async function gotoPageSafe(roomCode: string, nextPage: number): Promise<"ok" | "fallback-slide" | "local-only" | "fail"> {
    const p = Math.max(1, nextPage);
    try { await rpc("goto_page", { p_code: roomCode, p_page: p }); return "ok"; }
    catch (e1) { DBG.err("goto_page failed", e1); }

    try { await rpc("goto_slide", { p_code: roomCode, p_slide: p, p_step: 0 }); return "fallback-slide"; }
    catch (e2) { DBG.err("goto_slide fallback failed", e2); }

    try {
        const { data: r } = await supabase.from("rooms").select("id,state").eq("code", roomCode).maybeSingle();
        if (r?.id) {
            const nextState = { ...(r.state ?? {}), page: p };
            const { error: uerr } = await supabase.from("rooms").update({ state: nextState }).eq("id", r.id);
            if (!uerr) return "local-only";
        }
    } catch (e3) { DBG.err("rooms.state direct update failed", e3); }
    return "fail";
}

// 파일 상단 근처에 추가
async function getReadablePdfUrlFromKey(key: string): Promise<string> {
    // 1) signed url 우선
    try {
        const { data, error } = await supabase
            .storage.from("presentations")
            .createSignedUrl(key, 60); // 60초
        if (!error && data?.signedUrl) {
            const u = new URL(data.signedUrl);
            u.searchParams.set("v", String(Math.floor(Date.now() / 60000)));
            return u.toString();
        }
    } catch {}
    // 2) public URL 폴백
    const raw = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
    const u = new URL(raw);
    u.searchParams.set("v", String(Math.floor(Date.now() / 60000)));
    return u.toString();
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

    const { search } = useLocation();

    const qs = useMemo(() => new URLSearchParams(search), [search]);
    const deckFromQS = qs.get("deck");
    const toast = useToast();

    // ---- Room ----
    const defaultCode = useMemo(() => "CLASS-" + Math.random().toString(36).slice(2, 8).toUpperCase(), []);
    const roomCode = useRoomId(defaultCode);
    const [roomId, setRoomId] = useState<string | null>(null);
    const [page, setPage] = useState<number>(1);
    const [currentDeckId, setCurrentDeckId] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState<number | null>(null);
    const viewMode: "present" | "setup" = qs.get("mode") === "setup" ? "setup" : "present";

    const presence = usePresence(roomCode, "teacher");
    const [answers, setAnswers] = useState<any[]>([]);

    const { isFS, toggle: toggleFS } = useFullscreenTarget(".pdf-stage");

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
    }, [roomId]);

    // 이탈 알림(간단)
    const [lastUnfocusedKeys, setLastUnfocusedKeys] = useState<string>("");
    useEffect(() => {
        const keys = presence.unfocused.map(m => m.nick || m.studentId || "unknown").sort().join(",");
        if (keys !== lastUnfocusedKeys) {
            setLastUnfocusedKeys(keys);
            if (presence.unfocused.length > 0) {
                const names = presence.unfocused.map(m => m.nick || m.studentId).join(", ");
                toast.show(`이탈/부재 감지: ${names}`);
            }
        }
    }, [presence.unfocused, lastUnfocusedKeys]);

    // URL 정리
    useEffect(() => {
        const url = new URLSearchParams(qs.toString());
        if (!url.get("room") && roomCode) {
            url.set("room", roomCode);
            if (!url.get("mode")) url.set("mode", "present");
            nav(`/teacher?${url.toString()}`, { replace: true });
        }
    }, [roomCode, qs, nav]);


    // manifest
    const [manifest, setManifest] = useState<ManifestItem[] | null>(null);
    useEffect(() => {
        let cancel = false;
        (async () => {
            if (!roomCode || !currentDeckId) { setManifest(null); return; }
            try { const m = await getManifestByRoom(roomCode); if (!cancel) setManifest(m); }
            catch { if (!cancel) setManifest(null); }
        })();
        return () => { cancel = true; };
    }, [roomCode, currentDeckId]);

    function currentItem(): ManifestItem | null {
        if (!manifest || !manifest.length) return null;
        const idx = Math.max(0, page - 1);
        return manifest[idx] ?? null;
    }

    const manifestKey = useMemo(() => {
        const it = currentItem();
        if (!it) return `none-${page}`;
        return it.type === "page"
            ? `p-${(it as ManifestPageItem).srcPage}`
            : `q-${(it as ManifestQuizItem).keywords.length}-${(it as ManifestQuizItem).prompt?.length ?? 0}`;
    }, [manifest, page]);

    // ---- Room row ----
    const refreshRoomState = useCallback(async () => {
        if (!roomCode) return;
        const { data, error } = await supabase
            .from("rooms")
            .select("id, current_deck_id, state")
            .eq("code", roomCode)
            .maybeSingle();
        if (error) return;
        if (data) {
            setRoomId(data.id);
            setCurrentDeckId(data.current_deck_id ?? null);
            const pg = Number(data.state?.page ?? 1);
            setPage(pg > 0 ? pg : 1);
        }
    }, [roomCode]);
    useEffect(() => { refreshRoomState(); }, [refreshRoomState]);

    useEffect(() => {
        (async () => {
            if (!roomCode) return;
            try {
                await rpc("claim_room_auth", { p_code: roomCode });
                await refreshRoomState();
            } catch (e) { DBG.err("claim_room_auth failed", e); }
        })();
    }, [roomCode, refreshRoomState]);

    // ---- Slots ----
    const [slots, setSlots] = useState<DeckSlot[]>(() => Array.from({ length: 6 }, (_, i) => ({ slot: i + 1, deck_id: null })));
    useEffect(() => {
        (async () => {
            if (!roomId) return;
            const { data } = await supabase
                .from("room_decks")
                .select("slot, deck_id, decks(title,file_key)")
                .eq("room_id", roomId)
                .order("slot", { ascending: true });
            if (!data) return;
            setSlots(Array.from({ length: 6 }, (_, i) => {
                const found: any = data.find((d: any) => d.slot === i + 1) ?? {};
                return {
                    slot: i + 1,
                    deck_id: found.deck_id ?? null,
                    title: found?.decks?.title ?? null,
                    file_key: found?.decks?.file_key ?? null,
                };
            }));
        })();
    }, [roomId]);

    useRoomDecksSubscription(roomId, () => { refreshRoomState(); });

    // ---- Realtime ----
    const { lastMessage, send } = useRealtime(roomCode, "teacher");
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "hello") {
            send({ type: "goto", page });
        }
    }, [lastMessage, page, send]);

    // ---- Student URL ----
    const studentUrl = useMemo(() => {
        const base = getBasePath(); // 배포 BasePath (예: /AUTOPPT)
        return `${location.origin}${base}/#/student?room=${roomCode}`;
        }, [roomCode]);

    // ---- Current deck file url + total pages ----
    const [deckFileUrl, setDeckFileUrl] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!roomCode || !currentDeckId) { setDeckFileUrl(null); setTotalPages(null); return; }

            try {
                const key = await rpc<string | null>("get_current_deck_file_key", { p_code: roomCode });
                if (cancelled) return;
                if (key) {
                    // 공개 URL
                    const finalUrl = await getReadablePdfUrlFromKey(key);
                    setDeckFileUrl(finalUrl);
                } else {
                    setDeckFileUrl(null);
                }
            } catch (e) { DBG.err("get_current_deck_file_key", e); setDeckFileUrl(null); }

            try {
                const { data } = await supabase.from("decks").select("file_pages").eq("id", currentDeckId).maybeSingle();
                setTotalPages(Number(data?.file_pages) || null);
            } catch { setTotalPages(null); }
        })();
        return () => { cancelled = true; };
    }, [roomCode, currentDeckId]);

    // ---- Controls ----
    const gotoPage = useCallback(async (nextPage: number) => {
        const p = Math.max(1, nextPage);
        const mode = await gotoPageSafe(roomCode, p);
        if (mode === "fail") toast.show("서버 갱신 실패: 임시 동기화로 진행합니다");
        setPage(p);
        send({ type: "goto", page: p });
    }, [roomCode, send]);

    const next = useCallback(async () => {
        const limit = totalPages ?? Infinity;
        if (page >= limit) return;
        await gotoPage(page + 1);
    }, [page, totalPages, gotoPage]);

    const prev = useCallback(async () => {
        if (page <= 1) return;
        await gotoPage(page - 1);
    }, [page, gotoPage]);

    useArrowNav(prev, next);

    // ---- 업로드 다이얼로그(기존 로직 보강) ----
    const [uploading, setUploading] = useState<{ open: boolean; name?: string; pct?: number; previewUrl?: string | null; msg?: string }>({
        open: false, name: "", pct: 0, previewUrl: null, msg: ""
    });
    const openUploadDlg = (name: string) => setUploading({ open: true, name, pct: 0, previewUrl: null, msg: "업로드 중..." });
    const setPct = (pct: number, msg?: string) => setUploading(u => ({ ...u, pct: Math.max(0, Math.min(100, pct)), msg: msg ?? u.msg }));
    const closeUpload = () => setUploading({ open: false, name: "", pct: 0, previewUrl: null, msg: "" });

    async function uploadPdfForSlot(slot: number) {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "application/pdf";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            openUploadDlg(file.name);
            let pct = 0;
            const timer = window.setInterval(() => { pct = Math.min(90, pct + 1); setPct(pct, "업로드 중..."); }, 120);

            try {
                await rpc("claim_room_auth", { p_code: roomCode });

                let ensuredRoomId = roomId;
                if (!ensuredRoomId) {
                    const { data } = await supabase.from("rooms").select("id").eq("code", roomCode).maybeSingle();
                    ensuredRoomId = data?.id ?? null;
                    setRoomId(ensuredRoomId);
                }
                if (!ensuredRoomId) throw new Error("room id missing");

                const { data: rd } = await supabase
                    .from("room_decks")
                    .select("deck_id")
                    .eq("room_id", ensuredRoomId)
                    .eq("slot", slot)
                    .maybeSingle();
                let deckId: string | null = rd?.deck_id ?? null;
                if (!deckId) {
                    const fallbackExt = `deck-${Date.now().toString(36)}`;
                    await rpc("assign_room_deck_by_ext", { p_code: roomCode, p_slot: slot, p_ext_id: fallbackExt, p_title: file.name.replace(/\.pdf$/i, "") });
                    const { data: rd2 } = await supabase.from("room_decks").select("deck_id").eq("room_id", ensuredRoomId).eq("slot", slot).maybeSingle();
                    deckId = rd2?.deck_id ?? null;
                    if (!deckId) throw new Error("deck create failed");
                }

                const key = `rooms/${ensuredRoomId}/decks/${deckId}/slides-${Date.now()}.pdf`;
                const up = await supabase.storage.from("presentations").upload(key, file, { upsert: true, contentType: "application/pdf" });
                if (up.error) throw up.error;
                setPct(92, "파일 링크 갱신 중...");

                try { await rpc("upsert_deck_file_by_slot", { p_room_code: roomCode, p_slot: slot, p_file_key: key }); }
                catch { try { await rpc("upsert_deck_file", { p_deck_id: deckId, p_file_key: key }); } catch {} }

                await rpc("set_room_deck", { p_code: roomCode, p_slot: slot });
                await refreshRoomState();

                const publicUrl = supabase.storage.from("presentations").getPublicUrl(key).data.publicUrl;
                setUploading(u => ({ ...u, previewUrl: publicUrl }));
                setPct(100, "완료");
                window.clearInterval(timer);
                toast.show("업로드 완료");
            } catch (e) {
                console.error(e);
                window.clearInterval(timer);
                setPct(100, "실패");
                toast.show("업로드 실패");
            }
        };
        input.click();
    }

    // ---- 파생 UI ----
    const Badge: React.FC<React.PropsWithChildren<{ muted?: boolean }>> = ({ children, muted }) => (
        <span style={{ border: "1px solid rgba(148,163,184,0.25)", borderRadius: 999, padding: "2px 8px", fontSize: 12, color: muted ? "#94a3b8" : "#e5e7eb" }}>
      {children}
    </span>
    );

    const PresentView = (
        <div className="panel" style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>페이지 {page}{totalPages ? ` / ${totalPages}` : ""}</div>
                <a className="btn" href={studentUrl} target="_blank" rel="noreferrer">학생 접속 링크</a>
                <button className="btn" onClick={toggleFS}>{isFS ? "전체화면 해제" : "전체화면"}</button>
            </div>
            <div style={{ display: "grid", placeItems: "center" }}>
                {deckFileUrl ? (
                    <div className="pdf-stage" style={{ width: "100%", display: "grid", placeItems: "center", background: isFS ? "#000" : "transparent" }}>
                        {(() => {
                            const item = currentItem();
                            if (item && item.type === "quiz") {
                                return (
                                    <div style={{ display: "grid", placeItems: "center", minHeight: 300 }}>
                                        <QuizOverlay key={`present|${manifestKey}`} item={item as ManifestQuizItem} mode="teacher" />
                                    </div>
                                );
                            }
                            const p = (item && item.type === "page") ? (item as ManifestPageItem).srcPage : page;
                            const viewerUrl = `${deckFileUrl}?v=${currentDeckId || "none"}-${p}`; // 캐시버스터
                            return (
                                <PdfViewer
                                    key={`${deckFileUrl}|${currentDeckId}|p-${p}|present|${manifestKey}`}
                                    fileUrl={viewerUrl}
                                    page={p}
                                />
                            );
                        })()}
                    </div>
                ) : (
                    <div style={{ opacity: 0.6 }}>자료가 없습니다.</div>
                )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                <button className="btn" onClick={prev} disabled={page <= 1}>◀ 이전</button>
                <button className="btn" onClick={() => gotoPage(page)}>🔓 현재 페이지 재전송</button>
                <button className="btn" onClick={next} disabled={totalPages != null && page >= totalPages}>다음 ▶</button>
            </div>
        </div>
    );

    const SetupView = (
        <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: 16 }}>
            <div className="panel">
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                    현재 교시: {currentDeckId ? "선택됨" : "미선택"} · 페이지 {page}{totalPages ? ` / ${totalPages}` : ""}
                </div>
                {deckFileUrl ? (
                    <div className="pdf-stage" style={{ display: "grid", placeItems: "center" }}>
                        {(() => {
                            const item = currentItem();
                            if (item && item.type === "quiz") {
                                return (
                                    <div style={{ display: "grid", placeItems: "center", minHeight: 240 }}>
                                        <QuizOverlay key={`setup|${manifestKey}`} item={item as ManifestQuizItem} mode="teacher" />
                                    </div>
                                );
                            }
                            const p = (item && item.type === "page") ? (item as ManifestPageItem).srcPage : page;
                            const viewerUrl = `${deckFileUrl}?v=${currentDeckId || "none"}-${p}`; // 캐시버스터
                            return (
                                <PdfViewer
                                    key={`${deckFileUrl}|${currentDeckId}|p-${p}|setup|${manifestKey}`}
                                    fileUrl={viewerUrl}
                                    page={p}
                                    maxHeight="500px"
                                />
                            );
                        })()}
                    </div>
                ) : (
                    <div style={{ opacity: 0.6 }}>자료가 없습니다.</div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                    <button className="btn" onClick={prev} disabled={page <= 1}>◀ 이전</button>
                    <button className="btn" onClick={() => gotoPage(page)}>🔓 현재 페이지 재전송</button>
                    <button className="btn" onClick={next} disabled={totalPages != null && page >= totalPages}>다음 ▶</button>
                </div>
            </div>

            <div className="panel" style={{ display: "grid", gap: 12 }}>
                {/* 슬롯 패널 */}
                <div>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 8 }}>
                        <div style={{ fontWeight: 700 }}>슬롯</div>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                        {slots.map(s => (
                            <div key={s.slot} style={{ display: "grid", gridTemplateColumns: "36px 1fr auto", gap: 10, alignItems: "center" }}>
                                <Badge muted>{s.slot}교시</Badge>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {s.deck_id ? (s.title || s.deck_id) : <span style={{ opacity: 0.6 }}>비어 있음</span>}
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button className="btn" onClick={() => uploadPdfForSlot(s.slot)}>업로드</button>
                                    <button
                                        className="btn"
                                        disabled={!s.deck_id}
                                        onClick={async () => {
                                            if (!s.deck_id) return;
                                            await rpc("set_room_deck", { p_code: roomCode, p_slot: s.slot });
                                            let restored = 1;
                                            if (roomId) {
                                                const { data: rd } = await supabase
                                                    .from("room_decks")
                                                    .select("current_page")
                                                    .eq("room_id", roomId)
                                                    .eq("slot", s.slot)
                                                    .maybeSingle();
                                                restored = Number(rd?.current_page ?? 1) || 1;
                                            }
                                            await gotoPageSafe(roomCode, restored);
                                            setPage(restored);
                                            send({ type: "goto", page: restored });
                                            await refreshRoomState();
                                        }}
                                    >
                                        불러오기
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 학생 링크 & QR */}
                <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>학생 접속</div>
                    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, alignItems: "center" }}>
                        <div style={{ background: "#fff", borderRadius: 12, padding: 12, width: 180, height: 180, overflow: "hidden", display: "grid", placeItems: "center" }}>
                            {/* QR은 박스보다 작게(여백 포함) */}
                            <RoomQR url={studentUrl} size={156} />
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                            <a className="btn" href={studentUrl} target="_blank" rel="noreferrer">링크 열기</a>
                            <span style={{ fontSize: 12, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {studentUrl}
      </span>
                            <button
                                className="btn"
                                onClick={() => { navigator.clipboard?.writeText(studentUrl); }}
                                title="주소 복사"
                            >복사</button>
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
        </div>
    );

    return (
        <div className="app-shell" style={{ maxWidth: 940 }}>
            <div className="topbar" style={{ marginBottom: 12 }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>교사 화면</h1>
                <span className="badge">room: {roomCode}</span>
                <span className="badge">{currentDeckId ? "교시 선택됨" : "교시 미선택"}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=present`)} aria-pressed={viewMode === "present"}>발표</button>
                    <button className="btn" onClick={() => nav(`/teacher?room=${roomCode}&mode=setup`)} aria-pressed={viewMode === "setup"}>설정</button>
                    <button className="btn" onClick={() => nav(`/library?room=${roomCode}`)}>자료함</button>
                </div>
            </div>

            {viewMode === "present" ? PresentView : SetupView}

            <PresenceSidebar members={presence.members} unfocused={presence.unfocused} />

            {/* 업로드 모달 */}
            {uploading.open && (
                <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.5)", zIndex: 70 }}>
                    <div className="panel" style={{ width: "min(92vw, 720px)", maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span className="badge">
                이탈 {presence.unfocused.length} / 전체 {presence.members.length}
              </span>
                            <div style={{ fontWeight: 700 }}>PDF 업로드</div>
                            <button className="btn" onClick={closeUpload}>×</button>
                        </div>
                        <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>{uploading.name}</div>
                        <div style={{ height: 8, background: "#111827", borderRadius: 6, overflow: "hidden" }}>
                            <div style={{ width: `${uploading.pct ?? 0}%`, height: "100%" }} />
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>{uploading.msg}</div>

                        {uploading.previewUrl && (
                            <div style={{ marginTop: 12 }}>
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>미리보기 (1페이지)</div>
                                <div className="pdf-stage" style={{ maxHeight: "300px", overflow: "auto" }}>
                                    <PdfViewer fileUrl={uploading.previewUrl} page={1} maxHeight="280px" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {toast.node}
        </div>
    );
}
