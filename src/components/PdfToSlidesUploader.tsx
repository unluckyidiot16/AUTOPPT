// src/components/PdfToSlidesUploader.tsx
import React, { useCallback, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

/** pdf.js 로더: jsDelivr ESM + module worker 우선, 실패 시 classic 워커 폴백 */
async function loadPdfJs(): Promise<any> {
    // 1) ESM
    try {
        const pdfjs = await import("pdfjs-dist/build/pdf");
        try {
            // module worker (v4/v5 대응)
            const workerUrl = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjs as any).version}/build/pdf.worker.min.mjs`;
            const worker = new Worker(workerUrl, { type: "module" as any });
            (pdfjs as any).GlobalWorkerOptions.workerPort = worker as any;
        } catch {
            // classic worker src 폴백
            (pdfjs as any).GlobalWorkerOptions.workerSrc =
                `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjs as any).version}/build/pdf.worker.min.js`;
        }
        return pdfjs;
    } catch {
        // 2) CDN ESM 직로딩 폴백
        const pdfjs = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs");
        (pdfjs as any).GlobalWorkerOptions.workerSrc =
            "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.js";
        return pdfjs;
    }
}

function slugify(basename: string) {
    return basename
        .replace(/\.[^.]+$/, "")
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || ("deck-" + Date.now());
}

async function toWebpBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/webp", quality);
    });
}

export default function PdfToSlidesUploader({
                                                onDone,
                                            }: {
    /** 업로드 완료 후 호출: pdfKey(presentations/*), slidesPrefix(slides/*), pages */
    onDone?: (info: { pdfKey: string; slidesPrefix: string; pages: number }) => void;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState<string[]>([]);
    const [progress, setProgress] = useState<number>(0);

    const push = (m: string) => setLog((L) => [...L, m].slice(-300));

    const handlePick = useCallback(() => inputRef.current?.click(), []);
    const handleFile = useCallback(async (file: File) => {
        setBusy(true); setLog([]); setProgress(0);
        try {
            const base = slugify(file.name);
            const pdfKey = `presentations/decks/${base}/slides-${Date.now()}.pdf`;
            push(`원본 PDF 업로드: ${pdfKey}`);
            const upPdf = await supabase.storage.from("presentations").upload(pdfKey, file, {
                contentType: "application/pdf", upsert: true,
            });
            if (upPdf.error) throw upPdf.error;

            const pdfjs = await loadPdfJs();
            const buf = await file.arrayBuffer();
            const doc = await (pdfjs as any).getDocument({ data: buf }).promise;
            const pages = doc.numPages;
            push(`변환 시작: ${pages} 페이지`);

            const slidesPrefix = `decks/${base}`; // slides 버킷 내부 경로(원본)
            const pageNames: string[] = [];
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d")!;

            for (let i = 1; i <= pages; i++) {
                const p = await doc.getPage(i);
                // 가로 기준 1920px로 스케일 (세로는 비율 유지)
                const viewport = p.getViewport({ scale: 1 });
                const targetW = 1920;
                const scale = targetW / viewport.width;
                const vp = p.getViewport({ scale });
                canvas.width = Math.round(vp.width);
                canvas.height = Math.round(vp.height);
                // @ts-ignore
                await p.render({ canvasContext: ctx, viewport: vp }).promise;
                const blob = await toWebpBlob(canvas, 0.92);
                const name = `${i - 1}.webp`; // 0-base
                const full = `${slidesPrefix}/${name}`;
                pageNames.push(name);

                const up = await supabase.storage.from("slides").upload(full, blob, {
                    contentType: "image/webp", upsert: true,
                });
                if (up.error) throw up.error;

                setProgress(Math.floor((i / pages) * 95));
                push(`업로드 완료: slides/${full}`);
            }

            // 변환 메타 저장(.done.json) → 빠른 복사용
            const doneJson = {
                pages,
                names: pageNames,
                ts: Date.now(),
                w: canvas.width,
                h: canvas.height,
            };
            await supabase.storage.from("slides").upload(
                `${slidesPrefix}/.done.json`,
                new Blob([JSON.stringify(doneJson)], { type: "application/json" }),
                { upsert: true, contentType: "application/json" },
            );
            push(`메타 저장: slides/${slidesPrefix}/.done.json`);

            setProgress(100);
            push("완료!");
            onDone?.({ pdfKey, slidesPrefix, pages });
        } catch (e: any) {
            push(`에러: ${e?.message ?? String(e)}`);
        } finally {
            setBusy(false);
        }
    }, [onDone]);

    return (
        <div className="panel" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={handlePick} disabled={busy}>자료함으로 업로드</button>
                {busy && <div style={{ alignSelf: "center" }}>{progress}%</div>}
            </div>
            <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                style={{ display: "none" }}
                onChange={(e) => {
                    const f = e.currentTarget.files?.[0]; if (f) handleFile(f);
                    e.currentTarget.value = "";
                }}
            />
            {log.length > 0 && (
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.9, background: "#0b1220", padding: 8, borderRadius: 8 }}>
{log.join("\n")}
        </pre>
            )}
        </div>
    );
}
