// src/components/EditorThumbnailStrip.tsx  (workerless-safe + LRU cache 동일)
import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadPdfJs } from "../lib/pdfjs";

type ThumbItem = { id: string; page: number };
type Props = {
    fileUrl?: string | null;
    items: ThumbItem[];
    onReorder: (next: ThumbItem[]) => void;
    onSelect: (id: string) => void;
    onAdd: () => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    thumbWidth?: number;
    height?: number;
};

type PDFDoc = any;
type PDFPage = any;

// ---- 썸네일 LRU 캐시 ----
type CacheBucket = Map<number, string>; // page -> dataURL
const thumbCache = new Map<string, CacheBucket>();
const thumbOrder = new Map<string, number[]>(); // LRU order
const LRU_LIMIT = 100;

function cachePut(key: string, page: number, dataUrl: string) {
    let b = thumbCache.get(key); if (!b) { b = new Map(); thumbCache.set(key, b); }
    b.set(page, dataUrl);
    let ord = thumbOrder.get(key) || [];
    ord = ord.filter(p => p !== page); ord.push(page);
    if (ord.length > LRU_LIMIT) {
        const rm = ord.shift()!;
        b.delete(rm);
    }
    thumbOrder.set(key, ord);
}
function cacheGet(key: string, page: number) {
    const b = thumbCache.get(key); if (!b) return null;
    const u = b.get(page); if (!u) return null;
    // LRU touch
    let ord = thumbOrder.get(key) || [];
    ord = ord.filter(p => p !== page); ord.push(page);
    thumbOrder.set(key, ord);
    return u;
}

export default function EditorThumbnailStrip({
                                                 fileUrl, items, onReorder, onSelect, onAdd, onDuplicate, onDelete, thumbWidth = 120, height = 120,
                                             }: Props) {
    const [doc, setDoc] = useState<PDFDoc | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const cacheKey = useMemo(() => (fileUrl ? String(fileUrl) : "nofile"), [fileUrl]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                if (!fileUrl) { setDoc(null); setErr(null); return; }
                const pdfjs: any = await loadPdfJs();
                const task = pdfjs.getDocument({ url: fileUrl, withCredentials: false, disableWorker: true });
                const pdf = await task.promise;
                if (cancelled) { await pdf?.destroy?.(); return; }
                setDoc(pdf);
            } catch {
                if (!cancelled) setErr("썸네일 로드 실패");
            }
        })();
        return () => { cancelled = true; };
    }, [fileUrl]);

    const dragSrcId = useRef<string | null>(null);
    const onDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => { dragSrcId.current = id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); };
    const onDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
    const onDrop = (e: React.DragEvent<HTMLDivElement>, overId: string) => {
        e.preventDefault();
        const srcId = dragSrcId.current || e.dataTransfer.getData("text/plain");
        if (!srcId || srcId === overId) return;
        const srcIdx = items.findIndex(i => i.id === srcId);
        const dstIdx = items.findIndex(i => i.id === overId);
        if (srcIdx < 0 || dstIdx < 0) return;
        const next = items.slice();
        const [moved] = next.splice(srcIdx, 1);
        next.splice(dstIdx, 0, moved);
        onReorder(next);
    };

    return (
        <div style={{ borderTop: "1px solid rgba(148,163,184,0.25)", paddingTop: 8, marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="badge">페이지 썸네일</span>
                <button className="btn" onClick={onAdd}>+ 추가</button>
                {err && <span style={{ color: "#ef4444", fontSize: 12 }}>{err}</span>}
                {!fileUrl && <span style={{ opacity: .6, fontSize: 12 }}>파일 URL 없음 → 숫자 타일 표시</span>}
            </div>

            <div style={{ display: "flex", gap: 8, overflowX: "auto", height, alignItems: "center", paddingBottom: 6 }}>
                {items.map((it) => (
                    <Thumb
                        key={it.id}
                        id={it.id}
                        pageNumber={it.page}
                        cacheKey={cacheKey}
                        pdf={doc}
                        width={thumbWidth}
                        onSelect={() => onSelect(it.id)}
                        onDuplicate={() => onDuplicate(it.id)}
                        onDelete={() => onDelete(it.id)}
                        onDragStart={onDragStart}
                        onDragOver={onDragOver}
                        onDrop={onDrop}
                    />
                ))}
            </div>
        </div>
    );
}

function Thumb({
                   id, pageNumber, pdf, width, cacheKey,
                   onSelect, onDuplicate, onDelete, onDragStart, onDragOver, onDrop,
               }: {
    id: string; pageNumber: number; pdf: PDFDoc | null; width: number; cacheKey: string;
    onSelect: () => void; onDuplicate: () => void; onDelete: () => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, id: string) => void;
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (e: React.DragEvent<HTMLDivElement>, overId: string) => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState<boolean>(!!pdf);
    const [err, setErr] = useState<string | null>(null);
    const isBlank = pageNumber === 0;

    // 가시 영역(Render on visible)
    useEffect(() => {
        const host = hostRef.current; if (!host) return;
        const io = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) setVisible(true); }, { rootMargin: "200px" });
        io.observe(host);
        return () => io.disconnect();
    }, []);

    // 렌더(캐시 선조회)
    useEffect(() => {
        let cancelled = false;
        if (!pdf || !visible || isBlank) { setLoading(false); setErr(null); return; }

        const hit = cacheGet(cacheKey, pageNumber);
        if (hit && imgRef.current) {
            imgRef.current.src = hit;
            setLoading(false); setErr(null);
            return;
        }

        setLoading(true); setErr(null);
        (async () => {
            let page: PDFPage | null = null;
            let task: any = null;
            try {
                page = await pdf.getPage(pageNumber);
                const baseVp = page.getViewport({ scale: 1 });
                const scale = Math.max(0.15, Math.min(0.6, (width - 10) / baseVp.width));
                const vp = page.getViewport({ scale });

                const canvas = canvasRef.current;
                const img = imgRef.current;
                if (!canvas || !img) return;

                canvas.width = Math.floor(vp.width);
                canvas.height = Math.floor(vp.height);
                canvas.style.width = `${Math.floor(vp.width)}px`;
                canvas.style.height = `${Math.floor(vp.height)}px`;

                const ctx = canvas.getContext("2d", { alpha: false });
                if (!ctx) return;
                task = page.render({ canvasContext: ctx, viewport: vp, intent: "print" });
                await task.promise;

                const url = canvas.toDataURL("image/png");
                cachePut(cacheKey, pageNumber, url);
                img.src = url;
            } catch { if (!cancelled) setErr("!"); }
            finally {
                try { task?.cancel?.(); } catch {}
                try { page?.cleanup?.(); } catch {}
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [pdf, pageNumber, width, visible, cacheKey, isBlank]);

    return (
        <div
            ref={hostRef}
            draggable
            onDragStart={(e) => onDragStart(e, id)}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, id)}
            title={isBlank ? "빈" : `p.${pageNumber}`}
            style={{
                minWidth: width, maxWidth: width,
                border: "1px solid #334155", borderRadius: 10, padding: 6,
                background: "#0b1220", display: "grid", gridTemplateRows: "auto auto", gap: 6, cursor: "grab",
            }}
        >
            <div style={{ fontSize: 12, opacity: 0.7 }}>{isBlank ? "빈" : `p.${pageNumber}`}</div>
            <div onClick={onSelect} style={{ display: "grid", placeItems: "center", borderRadius: 8, background: "rgba(15,23,42,.6)",
                overflow: "hidden", position: "relative", aspectRatio: "3 / 4" }}>
                {isBlank ? (
                    <div style={{ fontSize: 24, opacity: 0.8 }}>0</div>
                ) : (
                    <>
                        <canvas ref={canvasRef} style={{ display: "none" }} />
                        <img ref={imgRef} alt="" />
                        {loading && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#94a3b8", fontSize: 12, backdropFilter: "blur(1px)" }}>…</div>}
                        {err && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#ef4444" }}>!</div>}
                    </>
                )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
                <button className="btn" onClick={onDuplicate}>복제</button>
                <button className="btn" onClick={onDelete}>삭제</button>
            </div>
        </div>
    );
}
