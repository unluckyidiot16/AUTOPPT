// src/components/EditorThumbnailStrip.tsx
import React from "react";
import WebpThumb from "./WebpThumb";

type ThumbItem = { id: string; page: number };
type Props = {
    fileKey?: string | null;
    items: ThumbItem[];
    onReorder: (next: ThumbItem[]) => void;   // (추후 드래그 정렬용)
    onSelect: (id: string) => void;
    onAdd: () => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    thumbWidth?: number;
    height?: number;
    /** 상위에서 내려오는 캐시 버전(선택) */
    version?: number | string;
};

export default function EditorThumbnailStrip({
                                                 fileKey, items, onReorder, onSelect, onAdd, onDuplicate, onDelete, thumbWidth = 120, height = 120, version,
                                             }: Props) {
    const ver = String(version ?? "");
    return (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: 8 }}>
            {items.map((it) => (
                <div key={it.id} style={{ display: "grid", gap: 6, placeItems: "center" }}>
                    <div onClick={() => onSelect(it.id)} style={{ cursor: "pointer" }}>
                        {fileKey ? (
                            <WebpThumb key={`${fileKey}-${it.page}-${ver}`} fileKey={fileKey} page={it.page} width={thumbWidth} height={height} />
                        ) : (
                            <div style={{ width: thumbWidth, height, background: "#111827", borderRadius: 8 }} />
                        )}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn" onClick={() => onDuplicate(it.id)}>복제</button>
                        <button className="btn" onClick={() => onDelete(it.id)}>삭제</button>
                    </div>
                </div>
            ))}
            <button className="btn" onClick={onAdd}>+ 페이지</button>
        </div>
    );
}
