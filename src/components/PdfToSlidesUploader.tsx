// src/components/PdfToSlidesUploader.tsx
import React, { useCallback, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { getBasePath } from "../utils/getBasePath";


/** ──────────────── Types ──────────────── */
type PdfJs = typeof import("pdfjs-dist/types/src/pdf");
type PDFDocumentProxy = import("pdfjs-dist/types/src/pdf").PDFDocumentProxy;
type PDFPageProxy = import("pdfjs-dist/types/src/pdf").PDFPageProxy;

/** ──────────────── pdf.js 안정 로더 ──────────────── */
async function loadPdfJsStable(): Promise<PdfJs> {
    // 1) v5 ESM (로컬 패키지)
    try {
        const pdf: any = await import("pdfjs-dist/build/pdf");
        const ver = pdf?.version ?? "5.x";
        // 워커는 쓰지 않지만, 혹시 내부에서 참조할 수 있으니 workerSrc만 안전 고정
        (pdf as any).GlobalWorkerOptions.workerSrc =
            `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.worker.min.js`;
        return pdf;
    } catch { /* pass */ }

    // 2) CDN 레거시 ESM 강제 폴백(로컬 legacy 경로 임포트 제거)
    const url = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/legacy/build/pdf.min.mjs";
    const pdf: any = await import(/* @vite-ignore */ url);
    (pdf as any).GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/legacy/build/pdf.worker.min.js";
    return pdf;
}

/** 타임아웃 유틸 */
function withTimeout<T>(p: Promise<T>, ms: number, tag = "timeout"): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(tag)), ms);
        p.then(v => { clearTimeout(t); resolve(v); })
            .catch(e => { clearTimeout(t); reject(e); });
    });
}

/** v5 → v5(+CMAP/Fonts) → v4.8.69(legacy CDN) 순차 재시도 */
// 상단 임포트에 추가
import { getBasePath } from "../utils/getBasePath";

async function openPdfWithFallback(
    pdfjs: any,
    data: ArrayBuffer,
    push: (m: string) => void,
) {
    const tryOpen = (lib: any, label: string, extra: Record<string, any> = {}, ms = 20000) =>
        withTimeout(
            lib.getDocument({
                data,
                disableWorker: true,
                isEvalSupported: false,
                stopAtErrors: true,
                enableXfa: false,
                disableFontFace: true,
                nativeImageDecoderSupport: "none",
                ...extra,
            }).promise,
            ms,
            label,
        );

    // 공통: workerSrc 보강
    (pdfjs as any).GlobalWorkerOptions.workerSrc ??=
        `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs?.version ?? "5"}/build/pdf.worker.min.js`;

    // A) v5 기본
    push("PDF 열기(A: v5 기본) …");
    try {
        return await tryOpen(pdfjs, "open-A");
    } catch (e: any) {
        push(`A 실패: ${e?.message ?? e}`);
    }

    // B) v5 + CDN 자산
    const v5 = pdfjs?.version ?? "5";
    const cdnV5 = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v5}`;
    push("PDF 열기(B: v5 + CMAP/Fonts CDN) …");
    try {
        return await tryOpen(pdfjs, "open-B", {
            cMapUrl: `${cdnV5}/cmaps/`,
            cMapPacked: true,
            standardFontDataUrl: `${cdnV5}/standard_fonts/`,
        });
    } catch (e: any) {
        push(`B 실패: ${e?.message ?? e}`);
    }

    // B2) v5 + 로컬 자산(동일 출처)
    const base = getBasePath()?.replace(/\/+$/, "") || "";
    const localBase = `${base}/pdfjs`;
    push("PDF 열기(B2: v5 + CMAP/Fonts 로컬) …");
    try {
        return await tryOpen(pdfjs, "open-B2", {
            cMapUrl: `${localBase}/cmaps/`,
            cMapPacked: true,
            standardFontDataUrl: `${localBase}/standard_fonts/`,
        });
    } catch (e: any) {
        push(`B2 실패: ${e?.message ?? e}`);
    }

    // C) legacy 4.8.69 + CDN
    push("PDF 열기(C: legacy 4.8.69 CDN) …");
    const legacy: any = await import(
        /* @vite-ignore */ "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/legacy/build/pdf.min.mjs"
        );
    const cdnV4 = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69";
    (legacy as any).GlobalWorkerOptions.workerSrc = `${cdnV4}/legacy/build/pdf.worker.min.js`;
    try {
        return await tryOpen(legacy, "open-C", {
            cMapUrl: `${cdnV4}/cmaps/`,
            cMapPacked: true,
            standardFontDataUrl: `${cdnV4}/standard_fonts/`,
        });
    } catch (e: any) {
        push(`C 실패: ${e?.message ?? e}`);
    }

    // C2) legacy 4.8.69 + 로컬
    push("PDF 열기(C2: legacy 4.8.69 로컬) …");
    (legacy as any).GlobalWorkerOptions.workerSrc = `${localBase}/legacy/pdf.worker.min.js`; // 없어도 문자열이면 OK
    return await tryOpen(legacy, "open-C2", {
        cMapUrl: `${localBase}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${localBase}/standard_fonts/`,
    });
}


/** 슬러그 */
function storageSafeSlug(basename: string) {
    const stem = basename.replace(/\.[^.]+$/, "");
    const ascii = stem.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    const suffix = Date.now().toString(36);
    return `${ascii || "deck"}-${suffix}`.slice(0, 80);
}

/** WebP 변환 */
function toWebpBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
    return new Promise((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/webp", quality),
    );
}

/** 버킷 쓰기 프루브 */
async function probeWrite(bucket: string, keyPrefix: string) {
    const b = supabase.storage.from(bucket);
    const probeKey = keyPrefix.replace(/\/+$/, "") + "/_probe.txt";
    const up = await b.upload(probeKey, new Blob([`ok:${Date.now()}`], { type: "text/plain" }), { upsert: true });
    if (up.error) throw up.error;
    await b.remove([probeKey]).catch(() => void 0);
}

/** ──────────────── Uploader ──────────────── */
export default function PdfToSlidesUploader({
                                                onDone,
                                            }: {
    /** 완료 후 콜백: pdfKey(presentations/*), slidesPrefix(slides/*), pages */
    onDone?: (info: { pdfKey: string; slidesPrefix: string; pages: number }) => void;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState<string[]>([]);
    const [progress, setProgress] = useState<number>(0);

    const push = (m: string) => setLog(L => [...L, m].slice(-400));
    const handlePick = useCallback(() => inputRef.current?.click(), []);

    const handleFile = useCallback(async (file: File) => {
        setBusy(true); setLog([]); setProgress(0);
        try {
            // 0) 세션 안내
            const { data: ses } = await supabase.auth.getSession();
            if (!ses?.session) push("경고: 로그인 세션이 없습니다. (RLS/정책에 따라 업로드가 거부될 수 있어요)");

            // 1) 원본 PDF 업로드
            const base = storageSafeSlug(file.name);
            const relPdfKey = `decks/${base}/slides-${Date.now()}.pdf`;
            const absPdfKey = `presentations/${relPdfKey}`;

            push(`원본 PDF 업로드: ${absPdfKey}`);
            const upPdf = await supabase.storage.from("presentations").upload(relPdfKey, file, {
                contentType: "application/pdf", upsert: true,
            });
            if (upPdf.error) throw upPdf.error;
            setProgress(5);

            // 2) slides 프루브
            const slidesPrefix = `decks/${base}`;
            push(`slides 쓰기 확인: slides/${slidesPrefix}/_probe.txt`);
            await probeWrite("slides", slidesPrefix);
            push(`slides 프루브 OK`);
            setProgress(8);

            // 3) pdf.js 로드
            push("pdf.js 로드 시도…");
            const pdfjs: any = await loadPdfJsStable();
            push(`pdf.js 로드 완료 (v${pdfjs?.version ?? "?"})`);
            setProgress(10);

            // 4) PDF 열기(타입 캐스팅 포함)
            const buf = await file.arrayBuffer();
            push("PDF 열기 시퀀스 시작…");
            const doc = await openPdfWithFallback(pdfjs, buf, push) as PDFDocumentProxy;

            const pages: number = doc.numPages;
            push(`변환 시작: 총 ${pages} 페이지`);

            // 5) 페이지 → WebP 업로드
            const viewportScale = 1.5;
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d")!;

            for (let i = 1; i <= pages; i++) {
                const page: PDFPageProxy = await doc.getPage(i);
                const vp = page.getViewport({ scale: viewportScale });

                canvas.width = Math.max(1, Math.floor(vp.width));
                canvas.height = Math.max(1, Math.floor(vp.height));
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                await page.render({ canvasContext: ctx as any, viewport: vp }).promise;

                let blob: Blob;
                try { blob = await toWebpBlob(canvas, 0.9); }
                catch {
                    blob = await new Promise<Blob>((resolve, reject) =>
                        canvas.toBlob(b => b ? resolve(b) : reject(new Error("jpeg toBlob failed")), "image/jpeg", 0.92),
                    );
                }

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
            const doneMeta = {
                pages,
                names: Array.from({ length: pages }, (_, k) => `${k}.webp`),
                ts: Date.now(),
                // 마지막 페이지 크기 메모(옵션)
                // w: canvas.width, h: canvas.height,
            };
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
        <div style={{ display: "grid", gap: 8 }}>
            <button
                onClick={handlePick}
                disabled={busy}
                style={{
                    padding: "10px 14px",
                    background: busy ? "#334155" : "#0ea5e9",
                    color: "white", borderRadius: 8, fontWeight: 700,
                    opacity: busy ? 0.8 : 1, cursor: busy ? "not-allowed" : "pointer",
                }}
            >
                {busy ? `업로드 중… ${progress}%` : "PDF 업로드"}
            </button>

            <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) handleFile(f); e.currentTarget.value = ""; }}
            />

            {log.length > 0 && (
                <pre
                    style={{
                        whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.4,
                        color: "#cbd5e1", background: "#0b1220",
                        padding: 8, borderRadius: 8, maxHeight: 240, overflow: "auto",
                    }}
                >
{log.join("\n")}
        </pre>
            )}
        </div>
    );
}
