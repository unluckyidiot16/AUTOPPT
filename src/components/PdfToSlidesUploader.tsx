// src/components/PdfToSlidesUploader.tsx
import React, { useCallback, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { loadPdfJs } from "../lib/pdfjs"; // 워커 비활성화 로더

function slugify(s: string) {
    return (s || "")
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "untitled";
}
function shortId() { return Math.random().toString(36).slice(2, 7); }
async function canvasToBlob(canvas: HTMLCanvasElement, type = "image/webp", quality = 0.92): Promise<Blob> {
    return await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob failed")), type, quality));
}

// 슬라이드 변환 여부 마커
async function hasDoneMarker(slug: string) {
    const { data } = await supabase.storage.from("slides").list(`decks/${slug}`);
    if (!data) return false;
    return data.some(e => e.name === ".done.json") || data.some(e => e.name === "0.webp");
}
async function writeDoneMarker(slug: string, pages: number) {
    const blob = new Blob([JSON.stringify({ pages, ts: Date.now() })], { type: "application/json" });
    await supabase.storage.from("slides").upload(`decks/${slug}/.done.json`, blob, { upsert: true, contentType: "application/json" });
}

export default function PdfToSlidesUploader({ onFinished }: { onFinished?: (v: { deckId: string; pages: number; fileKey: string }) => void }) {
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [stage, setStage] = useState("");
    const [pct, setPct] = useState(0);
    const [log, setLog] = useState<string[]>([]);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const push = (m: string) => setLog(x => [...x, m].slice(-300));

    const handleUpload = useCallback(async () => {
        if (!file) return;
        setBusy(true); setStage("준비"); setPct(2); setLog([]);
        const t0 = performance.now();

        try {
            // 1) 메타
            const title = file.name.replace(/\.pdf$/i, "");
            const slug = `${slugify(title)}-${shortId()}`;
            const fileKey = `decks/${slug}/slides-${Date.now()}.pdf`;
            push(`파일명: ${file.name} (${(file.size/1024/1024).toFixed(2)} MB)`);

            // 2) 원본 PDF 업로드
            setStage("원본 업로드");
            const up = await supabase.storage.from("presentations")
                .upload(fileKey, file, { upsert: true, contentType: "application/pdf" });
            if (up.error) throw up.error;
            push(`원본 업로드 완료 → presentations/${fileKey}`);
            setPct(10);

            // 3) 덱 생성
            const ins = await supabase.from("decks").insert({ title, file_key: fileKey }).select("id").single();
            if (ins.error) throw ins.error;
            const deckId = ins.data.id as string;
            push(`decks 생성: ${deckId}`);
            setPct(15);

            // 4) 이미 변환돼 있으면 스킵
            if (await hasDoneMarker(slug)) {
                push("기존 슬라이드 감지 → 변환 생략");
                setPct(100);
                onFinished?.({ deckId, pages: 0, fileKey });
                return;
            }

            // 5) 변환 (클라이언트 1회 렌더)
            setStage("PDF 분석/렌더링");
            const pdfjs: any = await loadPdfJs();
            const ab = await file.arrayBuffer();
            const task = pdfjs.getDocument({ data: ab, disableWorker: true });
            const pdf = await task.promise;
            const total: number = pdf.numPages;
            push(`페이지 수: ${total}`);
            setPct(20);

            const canvas = canvasRef.current || document.createElement("canvas");
            const ctx = (canvas.getContext("2d") as CanvasRenderingContext2D);
            canvasRef.current = canvas;

            const base = 20, perPage = total ? 78 / total : 78;
            const maxW = 2048;
            let totalBytes = 0;

            for (let i = 1; i <= total; i++) {
                const page = await pdf.getPage(i);
                const vp = page.getViewport({ scale: 1 });
                const scale = Math.min(1, maxW / vp.width) * 2; // 고해상도 대비 2x
                const viewport = page.getViewport({ scale });

                canvas.width = Math.round(viewport.width);
                canvas.height = Math.round(viewport.height);
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                const tRender = performance.now();
                await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
                const tAfter = performance.now();

                const blob = await canvasToBlob(canvas, "image/webp", 0.92);
                totalBytes += blob.size;

                const path = `decks/${slug}/${i - 1}.webp`;
                const upImg = await supabase.storage.from("slides").upload(path, blob, { upsert: true, contentType: "image/webp" });
                if (upImg.error) throw upImg.error;

                const renderMs = (tAfter - tRender).toFixed(0);
                if (i === 1 || i === total || i % Math.max(1, Math.floor(total / 8)) === 0) {
                    push(`p${i}/${total} 렌더 ${renderMs}ms → 업로드 slides/${path} (${Math.round(blob.size/1024)} KB)`);
                }
                setPct(Math.min(98, Math.floor(base + perPage * i)));
            }

            await writeDoneMarker(slug, total);
            push(`완료 마커 기록: slides/decks/${slug}/.done.json`);
            // decks.file_pages 업데이트(목록/필터 가속)
            await supabase.from("decks").update({ file_pages: total }).eq("id", deckId).throwOnError();
            push(`decks.file_pages = ${total} 갱신`);

            const t1 = performance.now();
            push(`총 업로드 용량 ≈ ${(totalBytes/1024/1024).toFixed(2)} MB, 총 소요 ${(t1 - t0).toFixed(0)}ms`);
            setPct(100); setStage("완료");
            onFinished?.({ deckId, pages: total, fileKey });
        } catch (e: any) {
            push(`에러: ${e?.message || e}`);
            alert(e?.message || String(e));
        } finally {
            setBusy(false);
        }
    }, [file, onFinished]);

    return (
        <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>PDF 업로드 (1회 변환)</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <button className="btn" onClick={handleUpload} disabled={!file || busy}>
                    {busy ? "진행 중…" : "자료함으로 업로드"}
                </button>
                <span style={{ fontSize: 12, opacity: .7 }}>{file ? file.name : "PDF 선택"}</span>
            </div>

            {busy && (
                <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 12, opacity: .8 }}>{stage}</div>
                    <div style={{ height: 8, background: "rgba(148,163,184,.22)", borderRadius: 999 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "#4f46e5", transition: "width .25s ease" }} />
                    </div>
                </div>
            )}

            {!!log.length && (
                <div style={{
                    maxHeight: 220, overflow: "auto", background: "#0b1220", color: "#cbd5e1",
                    borderRadius: 8, padding: 8,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12
                }}>
                    {log.map((l, i) => <div key={i}>• {l}</div>)}
                </div>
            )}

            <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>
    );
}
