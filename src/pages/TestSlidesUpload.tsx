// src/components/TestSlidesUpload.tsx
import React, { useState } from "react";
import { supabase } from "../supabaseClient";

export default function TestSlidesUpload() {
    const [pageIndex, setPageIndex] = useState(0);
    const [creating, setCreating] = useState(false);
    const [materialId, setMaterialId] = useState<string | null>(null);
    const [pathOut, setPathOut] = useState<string>("");
    const [publicUrl, setPublicUrl] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    async function handleUpload() {
        try {
            setCreating(true);
            setErr(null);
            setPublicUrl(null);
            setPathOut("");
            setMaterialId(null);

            // 1) 현재 로그인 사용자 확인
            const { data: userData, error: eu } = await supabase.auth.getUser();
            if (eu) throw eu;
            const uid = userData.user?.id;
            if (!uid) throw new Error("로그인이 필요합니다.");

            // 2) materials 자동 생성
            const title = `AutoMat ${new Date().toISOString()}`;
            const { data: mat, error: em } = await supabase
                .from("materials")
                .insert({ owner_id: uid, title, source_type: "pdf" })
                .select()
                .single();
            if (em) throw em;

            const id = (mat.id as string).toLowerCase();
            setMaterialId(id);

            // 3) 업로드 경로 (⚠️ 앞에 슬래시 금지, 버킷명 포함 금지)
            const path = `${id}/pages/${pageIndex}.webp`;
            setPathOut(path);

            // 4) 더미 파일(정책/경로 테스트용)
            const blob = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], {
                type: "image/webp",
            });

            // 5) slides 버킷 업로드
            const up = await supabase.storage.from("slides").upload(path, blob, {
                upsert: true,
                cacheControl: "3600",
                contentType: "image/webp",
            });
            if (up.error) throw up.error;

            // 6) material_pages upsert(선택이지만 권장 — 뷰/에디터 테스트용)
            await supabase
                .from("material_pages")
                .upsert(
                    {
                        material_id: mat.id,
                        page_index: pageIndex,
                        image_key: up.data.path, // e.g. `${id}/pages/${pageIndex}.webp`
                        width: 16,
                        height: 16,
                        thumb_key: null,
                        ocr_json_key: null,
                    },
                    { onConflict: "material_id,page_index" }
                );

            // 7) 공개 URL 확인
            const { data } = supabase.storage.from("slides").getPublicUrl(path);
            setPublicUrl(data.publicUrl);
        } catch (e: any) {
            setErr(e?.message ?? String(e));
        } finally {
            setCreating(false);
        }
    }

    return (
        <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
            <div style={{ fontWeight: 700 }}>Slides 업로드 자동 테스트</div>

            <label>
                pageIndex:
                <input
                    type="number"
                    value={pageIndex}
                    onChange={(e) => setPageIndex(parseInt(e.target.value || "0", 10))}
                    min={0}
                    step={1}
                />
            </label>

            <button onClick={handleUpload} disabled={creating}>
                {creating ? "업로드 중..." : "새 material 생성 + slides 업로드"}
            </button>

            {materialId && (
                <div>
                    생성된 materialId: <code>{materialId}</code>
                </div>
            )}
            {pathOut && (
                <div>
                    업로드 경로: <code>{pathOut}</code>
                </div>
            )}
            {publicUrl && (
                <div>
                    공개 URL:&nbsp;
                    <a href={publicUrl} target="_blank" rel="noreferrer">
                        {publicUrl}
                    </a>
                </div>
            )}
            {err && <div style={{ color: "tomato" }}>에러: {err}</div>}

            <small style={{ opacity: 0.8 }}>
                ⚠️ 경로는 반드시 <code>{`{materialId}/pages/{i}.webp`}</code> 형식이어야 하며,
                앞에 슬래시나 버킷명을 붙이지 마세요.
            </small>
        </div>
    );
}
