// src/components/TestSlidesUpload.tsx
import React, { useState } from "react";
import { supabase } from "../supabaseClient";

export default function TestSlidesUpload() {
    const [materialId, setMaterialId] = useState("");
    const [pageIndex, setPageIndex] = useState(0);
    const [publicUrl, setPublicUrl] = useState<string | null>(null);
    const [pathOut, setPathOut] = useState<string>("");
    const [err, setErr] = useState<string | null>(null);

    async function handleUpload() {
        try {
            setErr(null);
            setPublicUrl(null);

            if (!materialId) throw new Error("materialId를 입력하세요.");
            const id = materialId.trim().toLowerCase();

            // ✅ 경로는 반드시 "{uuid}/..." 로 시작 (앞에 슬래시 X, 버킷명 X)
            const path = `${id}/pages/${pageIndex}.webp`;
            setPathOut(path);

            // 더미 웹프 이미지(실제 포맷은 중요치 않음 — 권한/경로 테스트용)
            const blob = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: "image/webp" });

            const { error } = await supabase.storage.from("slides").upload(path, blob, {
                upsert: true,
                contentType: "image/webp",
                cacheControl: "3600",
            });
            if (error) throw error;

            const { data } = supabase.storage.from("slides").getPublicUrl(path);
            setPublicUrl(data.publicUrl);
        } catch (e: any) {
            setErr(e?.message ?? String(e));
        }
    }

    return (
        <div style={{ display: "grid", gap: 8 }}>
            <label>
                materialId (소문자 UUID 권장):
                <input value={materialId} onChange={(e) => setMaterialId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </label>
            <label>
                pageIndex:
                <input type="number" value={pageIndex} onChange={(e) => setPageIndex(parseInt(e.target.value || "0", 10))} />
            </label>
            <button onClick={handleUpload}>slides 업로드 테스트</button>

            {pathOut && <div>업로드 경로: <code>{pathOut}</code></div>}
            {publicUrl && (
                <div>
                    공개 URL: <a href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a>
                </div>
            )}
            {err && <div style={{ color: "tomato" }}>에러: {err}</div>}
        </div>
    );
}
