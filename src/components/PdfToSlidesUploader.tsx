// src/components/PdfToSlidesUploader.tsx
import React, { useCallback, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

// v5 / v3 모두 대응: v5는 module worker, v3는 workerSrc로 처리
async function loadPdfJs() {
    // v5는 "pdfjs-dist/build/pdf" 가 ESM, v3는 legacy도 존재
    const pdfjs: any = await import("pdfjs-dist/build/pdf");

    const ver: string = String(pdfjs.version || "");
    const isV5 = ver.startsWith("5.");

    try {
        if (isV5) {
            // v5: module worker (CDN)
            const workerUrl = `https://unpkg.com/pdfjs-dist@${ver}/build/pdf.worker.min.mjs`;
            // cross-origin module worker 허용
            const worker = new Worker(workerUrl, { type: "module" as any });
            pdfjs.GlobalWorkerOptions.workerPort = worker;
        } else {
            // v3계열: classic workerSrc
            const workerSrc = `https://unpkg.com/pdfjs-dist@${ver || "3.11.174"}/build/pdf.worker.min.js`;
            pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        }
    } catch (e) {
        // 최후의 안전장치: 현재 버전에 맞춰 classic worker 경로로 재시도
        const fallback = `https://unpkg.com/pdfjs-dist@${ver || "3.11.174"}/build/pdf.worker.min.js`;
        try { pdfjs.GlobalWorkerOptions.workerSrc = fallback; } catch {}
    }

    return pdfjs;
}

async function fileToArrayBuffer(f: File): Promise<ArrayBuffer> {
    return await f.arrayBuffer();
}

async function canvasToBlob(canvas: HTMLCanvasElement, type = "image/webp", quality = 0.92): Promise<Blob> {
    return await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality);
    });
}

export default function PdfToSlidesUploader({
                                                onFinished,
                                            }: {
    onFinished?: (payload: { materialId: string; pageCount: number }) => void;
}) {
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState<string[]>([]);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const pushLog = (s: string) => setLog((prev) => [s, ...prev].slice(0, 200));

    const handleUpload = useCallback(async () => {
        try {
            if (!file) return;
            setBusy(true);
            setLog([]);

            const { data: u } = await supabase.auth.getUser();
            const uid = u.user?.id;
            if (!uid) throw new Error("로그인이 필요합니다.");

            // 1) materials 생성
            const title = file.name.replace(/\.[Pp][Dd][Ff]$/, "");
            const { data: mat, error: em } = await supabase
                .from("materials")
                .insert({ owner_id: uid, title: title || "PDF Material", source_type: "pdf" })
                .select()
                .single();
            if (em) throw em;
            const materialId: string = String(mat.id).toLowerCase();
            pushLog(`materials 생성: ${materialId}`);

            // 2) pdf.js 로드 + 렌더
            const pdfjs: any = await loadPdfJs();
            const ab = await fileToArrayBuffer(file);
            const loadingTask = pdfjs.getDocument({ data: ab });
            const pdf = await loadingTask.promise;
            pushLog(`PDF 페이지 수: ${pdf.numPages}`);

            const canvas = canvasRef.current || document.createElement("canvas");
            canvasRef.current = canvas;
            const ctx = canvas.getContext("2d")!;

            const maxW = 2048; // 페이지당 최대 너비(px)

            for (let i = 1; i <= pdf.numPages; i++) {
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

                const { error: eu } = await supabase.storage.from("slides")
                    .upload(path, blob, { upsert: true, contentType: "image/webp", cacheControl: "3600" });
                if (eu) throw eu;

                await supabase.from("material_pages").upsert(
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

                pushLog(`업로드 완료: ${path}`);
            }

            pushLog("모든 페이지 업로드 완료");
            onFinished?.({ materialId, pageCount: pdf.numPages });
        } catch (e: any) {
            pushLog(`에러: ${e?.message ?? String(e)}`);
            alert(e?.message ?? String(e));
        } finally {
            setBusy(false);
        }
    }, [file, onFinished]);

    return (
        <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>PDF → 이미지 업로더 (자료함)</div>
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn" onClick={handleUpload} disabled={!file || busy}>
                    {busy ? "변환/업로드 중…" : "자료함으로 업로드"}
                </button>
                <span style={{ fontSize: 12, opacity: .7 }}>{file ? file.name : "PDF 선택"}</span>
            </div>
            {!!log.length && (
                <div
                    style={{
                        maxHeight: 200, overflow: "auto", background: "#0b1220", color: "#cbd5e1",
                        borderRadius: 8, padding: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12
                    }}
                >
                    {log.map((l, i) => <div key={i}>• {l}</div>)}
                </div>
            )}
            <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>
    );
}
