// src/components/PdfToSlidesUploader.tsx
import React, { useCallback, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

/** ========== pdf.js 로더: jsDelivr 우선 + 다단계 폴백 ========== */
/** ========== pdf.js 로더: 워커 비활성화(안전모드) ========== */
async function loadPdfJs() {
    // 레거시 빌드가 브라우저/번들러 호환성이 가장 높습니다.
    try {
        const pdf = await import("pdfjs-dist/legacy/build/pdf");
        try {
            // 혹시 남아있는 이전 설정을 무효화
            (pdf as any).GlobalWorkerOptions.workerSrc = undefined;
            (pdf as any).GlobalWorkerOptions.workerPort = undefined as any;
        } catch {}
        return pdf;
    } catch {
        // 최후: v5 빌드. 그래도 워커는 쓰지 않습니다.
        const pdf = await import("pdfjs-dist/build/pdf");
        try {
            (pdf as any).GlobalWorkerOptions.workerSrc = undefined;
            (pdf as any).GlobalWorkerOptions.workerPort = undefined as any;
        } catch {}
        return pdf;
    }
}


/** ========== 유틸 ========== */
async function fileToArrayBuffer(f: File): Promise<ArrayBuffer> { return await f.arrayBuffer(); }
async function canvasToBlob(canvas: HTMLCanvasElement, type = "image/webp", quality = 0.92): Promise<Blob> {
    return await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality);
    });
}
function slugify(s: string) { return (s || "").toLowerCase().replace(/\.[^/.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled"; }
function shortId() { return Math.random().toString(36).slice(2, 7); }

/** ========== 컴포넌트 ========== */
export default function PdfToSlidesUploader({ onFinished }: { onFinished?: (x:{ materialId:string; pageCount:number; deckId?:string })=>void }) {
    const [file, setFile] = useState<File | null>(null);

    const [busy, setBusy] = useState(false);
    const [stage, setStage] = useState<string>("");
    const [progress, setProgress] = useState<number>(0);
    const [pageInfo, setPageInfo] = useState<{ cur: number; total: number } | null>(null);
    const [log, setLog] = useState<string[]>([]);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const cancelRef = useRef(false);

    const pushLog = (s: string) => setLog((prev) => [s, ...prev].slice(0, 200));
    const pct = (n: number) => setProgress(Math.max(0, Math.min(100, Math.round(n))));

    const handleUpload = useCallback(async () => {
        try {
            if (!file) return;
            setBusy(true);
            cancelRef.current = false;
            setLog([]);
            setStage("준비 중");
            pct(1);

            // 로그인 확인
            const { data: u } = await supabase.auth.getUser();
            const uid = u.user?.id;
            if (!uid) throw new Error("로그인이 필요합니다.");

            // 1) materials
            const title = file.name.replace(/\.[Pp][Dd][Ff]$/, "");
            setStage("기록 생성");
            const { data: mat, error: em } = await supabase
                .from("materials")
                .insert({ owner_id: uid, title: title || "PDF Material", source_type: "pdf" })
                .select()
                .single();
            if (em) throw em;
            const materialId: string = String(mat.id).toLowerCase();
            pushLog(`materials 생성: ${materialId}`);
            pct(5);

            // 2) 원본 PDF 업로드 + decks 생성
            setStage("원본 업로드");
            const baseFolder = `decks/${slugify(title)}-${shortId()}`;
            const pdfKey = `${baseFolder}/slides-${Date.now()}.pdf`;

            const up = await supabase.storage.from("presentations")
                .upload(pdfKey, file, { upsert: true, contentType: "application/pdf", cacheControl: "3600" });
            if (up.error) throw up.error;
            pushLog(`원본 PDF 업로드: ${pdfKey}`);
            pct(12);

            const insDeck = await supabase.from("decks")
                .insert({ title, file_key: pdfKey, owner_id: uid })
                .select("id")
                .single();
            if (insDeck.error) throw insDeck.error;
            const deckId: string = insDeck.data.id;
            pushLog(`decks 생성: ${deckId}`);
            pct(16);

            // 3) pdf.js 로드 + 분석 (워커 실패시 메인스레드 모드)
            setStage("PDF 분석");
            const pdfjs: any = await loadPdfJs();
            pushLog("pdf.js 로드: workerless-safe");
            const ab = await fileToArrayBuffer(file);
            const loadingTask = pdfjs.getDocument({ data: ab, disableWorker: true }); // ✅ 항상 워커 비활성화
            
            const pdf = await loadingTask.promise;
            const total = pdf.numPages;
            setPageInfo({ cur: 0, total });
            pushLog(`PDF 페이지 수: ${total}`);
            pct(25);

            // 4) 페이지 변환/업로드
            setStage("페이지 변환/업로드");
            const canvas = canvasRef.current || document.createElement("canvas");
            canvasRef.current = canvas;
            const ctx = canvas.getContext("2d")!;
            const maxW = 2048;
            const base = 25;
            const perPage = total ? 70 / total : 70;

            for (let i = 1; i <= total; i++) {
                if (cancelRef.current) { pushLog("사용자 취소"); break; }

                const page = await pdf.getPage(i);
                const vp1 = page.getViewport({ scale: 1 });
                const scale = Math.min(1, maxW / vp1.width) * 2;
                const viewport = page.getViewport({ scale });

                canvas.width = Math.round(viewport.width);
                canvas.height = Math.round(viewport.height);
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;

                const blob = await canvasToBlob(canvas, "image/webp", 0.92);
                const path = `${materialId}/pages/${i - 1}.webp`;

                const upImg = await supabase.storage.from("slides")
                    .upload(path, blob, { upsert: true, contentType: "image/webp", cacheControl: "3600" });
                if (upImg.error) throw upImg.error;

                const upRow = await supabase.from("material_pages").upsert(
                    {
                        material_id: materialId,
                        page_index: i - 1,
                        image_key: path,
                        width: canvas.width,
                        height: canvas.height,
                        thumb_key: null,
                        ocr_json_key: null,
                    },
                    { onConflict: "material_id,page_index" }
                );
                if (upRow.error) throw upRow.error;

                setPageInfo({ cur: i, total });
                pct(base + perPage * i);
                pushLog(`업로드 완료: ${path}`);
                try { page.cleanup?.(); } catch {}
            }

            setStage("정리 중");
            pct(99);
            pushLog("모든 페이지 업로드 완료");

            onFinished?.({ materialId, pageCount: total, deckId });
            setStage("완료");
            pct(100);
        } catch (e: any) {
            pushLog(`에러: ${e?.message ?? String(e)}`);
            alert(e?.message ?? String(e));
        } finally {
            setBusy(false);
        }
    }, [file, onFinished]);

    const cancel = () => { if (busy) cancelRef.current = true; };

    return (
        <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>PDF → 이미지 업로더 (자료함)</div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <button className="btn" onClick={handleUpload} disabled={!file || busy}>
                    {busy ? "변환/업로드 중…" : "자료함으로 업로드"}
                </button>
                {busy && (
                    <button className="btn" onClick={cancel} style={{ background: "rgba(239,68,68,.12)", borderColor: "rgba(239,68,68,.45)" }}>
                        취소
                    </button>
                )}
                <span style={{ fontSize: 12, opacity: .7, minWidth: 160 }}>{file ? file.name : "PDF 선택"}</span>
            </div>

            {busy && (
                <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 12, opacity: .8 }}>
                        {stage}{pageInfo ? ` · ${pageInfo.cur}/${pageInfo.total}` : ""}
                    </div>
                    <div style={{ position: "relative", height: 10, borderRadius: 999, background: "rgba(148,163,184,.22)", overflow: "hidden", border: "1px solid rgba(148,163,184,.35)" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progress}%`, transition: "width .2s ease",
                            background:"repeating-linear-gradient(45deg, rgba(99,102,241,.9), rgba(99,102,241,.9) 12px, rgba(99,102,241,.75) 12px, rgba(99,102,241,.75) 24px)" }} />
                    </div>
                    <div style={{ fontSize: 11, opacity: .65 }}>{progress}%</div>
                </div>
            )}

            {!!log.length && (
                <div style={{ maxHeight: 200, overflow: "auto", background: "#0b1220", color: "#cbd5e1", borderRadius: 8, padding: 8,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
                    {log.map((l, i) => <div key={i}>• {l}</div>)}
                </div>
            )}

            <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>
    );
}
