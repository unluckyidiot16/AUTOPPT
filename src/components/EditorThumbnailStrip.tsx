// src/components/EditorThumbnailStrip.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
// Vite 호환 워커 (PdfViewer와 동일 정책)
// 중복 바인딩을 피하기 위해 한번만 설정
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

type ThumbItem = { id: string; page: number };

type Props = {
    /** PDF 파일 URL(써머네일 렌더용). 없으면 숫자타일로 폴백 */
    fileUrl?: string | null;
    /** PAGE 아이템들 (id/page) */
    items: ThumbItem[];
    /** DnD 완료 시 새 순서 */
    onReorder: (next: ThumbItem[]) => void;
    /** 썸네일 클릭→메인 카드로 스크롤 */
    onSelect: (id: string) => void;
    /** 버튼 조작 */
    onAdd: () => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;

    /** 옵션 */
    thumbWidth?: number; // px
    height?: number;     // 컨테이너 높이
};

type PDFDoc = any;
type PDFPage = any;

let WORKER_BOUND = false;
function ensureWorker() {
    if (!WORKER_BOUND) {
        const w = new PdfJsWorker();
        GlobalWorkerOptions.workerPort = w;
        // @ts-ignore
        (globalThis as any).__autoppt_pdf_worker = w;
        WORKER_BOUND = true;
    }
}

export default function EditorThumbnailStrip({
                                                 fileUrl,
                                                 items,
                                                 onReorder,
                                                 onSelect,
                                                 onAdd,
                                                 onDuplicate,
                                                 onDelete,
                                                 thumbWidth = 120,
                                                 height = 120,
                                             }: Props) {
    const [doc, setDoc] = useState<PDFDoc | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const stripRef = useRef<HTMLDivElement | null>(null);

    // ---- PDF 로딩 (있을 때만) ----
    useEffect(() => {
        let cancelled = false;
        if (!fileUrl) { setDoc(null); setErr(null); return; }

        ensureWorker();
        setDoc(null);
        setErr(null);

        const task = getDocument({ url: fileUrl, withCredentials: false });
        (async () => {
            try {
                const pdf = await task.promise;
                if (cancelled) { await pdf.destroy?.(); return; }
                setDoc(pdf);
            } catch {
                if (!cancelled) setErr("썸네일 로드 실패");
            }
        })();

        return () => { cancelled = true; task?.destroy?.(); };
    }, [fileUrl]);

    // ---- 네이티브 DnD ----
    const dragSrcId = useRef<string | null>(null);
    const onDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
        dragSrcId.current = id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
    };
    const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault(); // drop 허용
        e.dataTransfer.dropEffect = "move";
    };
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
        <div
            ref={stripRef}
            style={{
                borderTop: "1px solid rgba(148,163,184,0.25)",
                paddingTop: 8,
                marginTop: 8,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="badge">페이지 썸네일</span>
                <button className="btn" onClick={onAdd}>+ 추가</button>
                {err && <span style={{ color: "#ef4444", fontSize: 12 }}>{err}</span>}
                {!fileUrl && <span style={{ opacity: .6, fontSize: 12 }}>파일 URL 없음 → 숫자 타일 표시</span>}
            </div>

            <div
                style={{
                    display: "flex",
                    gap: 8,
                    overflowX: "auto",
                    height,
                    alignItems: "center",
                    paddingBottom: 6,
                }}
            >
                {items.map((it) => (
                    <Thumb
                        key={it.id}
                        id={it.id}
                        pageNumber={it.page}
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

/** 개별 썸네일 */
function Thumb({
                   id,
                   pageNumber,
                   pdf,
                   width,
                   onSelect,
                   onDuplicate,
                   onDelete,
                   onDragStart,
                   onDragOver,
                   onDrop,
               }: {
    id: string;
    pageNumber: number;
    pdf: PDFDoc | null;
    width: number;
    onSelect: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, id: string) => void;
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (e: React.DragEvent<HTMLDivElement>, overId: string) => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [loading, setLoading] = useState<boolean>(!!pdf);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (!pdf) { setLoading(false); setErr(null); return; }

        setLoading(true);
        setErr(null);

        (async () => {
            try {
                const page: PDFPage = await pdf.getPage(pageNumber);
                if (cancelled) { page?.cleanup?.(); return; }

                const baseVp = page.getViewport({ scale: 1 });
                const scale = Math.max(0.15, Math.min(0.6, (width - 10) / baseVp.width)); // 작은 스케일
                const vp = page.getViewport({ scale });

                const canvas = canvasRef.current;
                if (!canvas) return;
                const ctx = canvas.getContext("2d", { alpha: false });
                if (!ctx) return;

                canvas.width = Math.floor(vp.width);
                canvas.height = Math.floor(vp.height);
                canvas.style.width = `${Math.floor(vp.width)}px`;
                canvas.style.height = `${Math.floor(vp.height)}px`;

                const task = page.render({ canvasContext: ctx, viewport: vp, intent: "print" });
                await task.promise;
            } catch {
                if (!cancelled) setErr("!");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [pdf, pageNumber, width]);

    return (
        <div
            draggable
            onDragStart={(e) => onDragStart(e, id)}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, id)}
            title={`p.${pageNumber}`}
            style={{
                minWidth: width,
                maxWidth: width,
                border: "1px solid #334155",
                borderRadius: 10,
                padding: 6,
                background: "#0b1220",
                display: "grid",
                gridTemplateRows: "auto auto",
                gap: 6,
                cursor: "grab",
            }}
        >
            <div style={{ fontSize: 12, opacity: 0.7 }}>p.{pageNumber}</div>

            <div
                onClick={onSelect}
                style={{
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 8,
                    background: "rgba(15,23,42,.6)",
                    overflow: "hidden",
                    position: "relative",
                    aspectRatio: "3 / 4",
                }}
            >
                {/* fileUrl 없으면 숫자타일 */}
                {!pdf ? (
                    <div style={{ fontSize: 24, opacity: 0.8 }}>{pageNumber}</div>
                ) : (
                    <>
                        <canvas ref={canvasRef} />
                        {loading && (
                            <div style={{
                                position: "absolute", inset: 0, display: "grid", placeItems: "center",
                                color: "#94a3b8", fontSize: 12, backdropFilter: "blur(1px)",
                            }}>…</div>
                        )}
                        {err && (
                            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#ef4444" }}>!</div>
                        )}
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
