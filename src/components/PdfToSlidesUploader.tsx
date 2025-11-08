// src/components/PdfToSlidesUploader.tsx
import React, { useCallback, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf";


/** pdf.js 로더: v4/v5 공용, module worker 대신 workerSrc 고정(안정) */
async function loadPdfJs(): Promise<any> {
    try {
        const pdfjs = await import("pdfjs-dist/build/pdf");
        const ver = (pdfjs as any).version || "4.8.69";
        (pdfjs as any).GlobalWorkerOptions.workerSrc =
            `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.worker.min.js`;
        return pdfjs;
    } catch {
        const pdfjs = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs");
        (pdfjs as any).GlobalWorkerOptions.workerSrc =
            "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.js";
        return pdfjs;
    }
}

/** Storage용 ASCII-only 슬러그 */
function storageSafeSlug(basename: string) {
    const stem = basename.replace(/\.[^.]+$/, "");
    const ascii = stem
        .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
    const suffix = Date.now().toString(36);
    return `${ascii || "deck"}-${suffix}`.slice(0, 80);
}

async function toWebpBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
    return new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/webp", quality),
    );
}

/** 버킷 쓰기 프루브: 업로드 가능 여부를 즉시 확인 */
async function probeWrite(bucket: string, key: string) {
    const b = supabase.storage.from(bucket);
    const probeKey = key.replace(/\/+$/, "") + "/_probe.txt";
    const up = await b.upload(probeKey, new Blob([`ok:${Date.now()}`], { type: "text/plain" }), { upsert: true });
    if (up.error) throw up.error;
    await b.remove([probeKey]).catch(() => void 0);
}

export default function PdfToSlidesUploader({
                                                onDone,
                                            }: {
    /** 완료 후: pdfKey(presentations/*), slidesPrefix(slides/*), pages */
    onDone?: (info: { pdfKey: string; slidesPrefix: string; pages: number }) => void;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState<string[]>([]);
    const [progress, setProgress] = useState<number>(0);

    const push = (m: string) => setLog((L) => [...L, m].slice(-400));

    const handlePick = useCallback(() => inputRef.current?.click(), []);
    const handleFile = useCallback(async (file: File) => {
        setBusy(true); setLog([]); setProgress(0);
        try {
            // 0) 세션 확인(익명 업로드 경고)
            const { data: ses } = await supabase.auth.getSession();
            if (!ses?.session) push("경고: 로그인 세션이 없습니다. (정책에 따라 업로드가 거부될 수 있어요)");

            // 1) 원본 PDF 업로드 (Storage 호출은 '상대키', 로그/콜백은 '절대키')
            const base = storageSafeSlug(file.name);
            const relPdfKey = `decks/${base}/slides-${Date.now()}.pdf`;   // ✅ 상대키
            const absPdfKey = `presentations/${relPdfKey}`;               // ✅ 절대키(표시/DB용)

            push(`원본 PDF 업로드: ${absPdfKey}`);
            const upPdf = await supabase.storage.from("presentations").upload(relPdfKey, file, {
                contentType: "application/pdf", upsert: true,
            });
            if (upPdf.error) throw upPdf.error;
            setProgress(5);

            // 2) slides 버킷 쓰기 프루브
            const slidesPrefix = `decks/${base}`;
            push(`slides 쓰기 확인: slides/${slidesPrefix}/_probe.txt`);
            await probeWrite("slides", slidesPrefix);
            push(`slides 프루브 OK`);
            setProgress(8);

            // 3) pdf.js 로드
            push("pdf.js (legacy) 준비…");
            // workerless로 열 것이므로 workerSrc는 건드리지 않습니다.
            setProgress(10);

            // 4) PDF 열기 (workerless 모드)
            const buf = await file.arrayBuffer();
            const doc = await (pdfjs as any).getDocument({
                data: buf,
                disableWorker: true,     // ✅ 워커 완전 비활성
                isEvalSupported: false,  // ✅ Safari 등에서 안전
            }).promise;

            const pages = doc.numPages;
            push(`변환 시작: 총 ${pages} 페이지`);

            // 5) 페이지 렌더 → WebP 업로드 (0-base)
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d")!;
            const targetW = 1600; // 필요 시 1920
            for (let i = 1; i <= pages; i++) {
                const p = await doc.getPage(i);
                const vp1 = p.getViewport({ scale: 1 });
                const scale = targetW / vp1.width;
                const vp = p.getViewport({ scale });
                canvas.width = Math.round(vp.width);
                canvas.height = Math.round(vp.height);
                // @ts-ignore
                await p.render({ canvasContext: ctx, viewport: vp }).promise;
                const blob = await toWebpBlob(canvas, 0.9);
                const name = `${i - 1}.webp`;
                const full = `${slidesPrefix}/${name}`;

                const up = await supabase.storage.from("slides").upload(full, blob, {
                    contentType: "image/webp", upsert: true,
                });
                if (up.error) throw up.error;

                const pct = Math.min(95, Math.floor(10 + (i / pages) * 85));
                setProgress(pct);
                push(`업로드 완료: slides/${full}`);
            }

            // 6) .done.json 저장
            const doneMeta = { pages, names: Array.from({ length: pages }, (_, k) => `${k}.webp`), ts: Date.now(), w: canvas.width, h: canvas.height };
            const metaUp = await supabase.storage.from("slides").upload(
                `${slidesPrefix}/.done.json`,
                new Blob([JSON.stringify(doneMeta)], { type: "application/json" }),
                { upsert: true, contentType: "application/json" },
            );
            if (metaUp.error) throw metaUp.error;
            push(`메타 저장: slides/${slidesPrefix}/.done.json`);

            setProgress(100);
            push("완료!");
            onDone?.({ pdfKey: absPdfKey, slidesPrefix, pages });
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
                onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) handleFile(f); e.currentTarget.value = ""; }}
            />
            {log.length > 0 && (
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.9, background: "#0b1220", padding: 8, borderRadius: 8 }}>
{log.join("\n")}
        </pre>
            )}
        </div>
    );
}
