// src/components/EditorThumbnailStrip.tsx
import React, { useMemo } from "react";
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
    /** 상위에서 내려오는 캐시 버전(선택) — URL 키에 반영해 캐시 무효화 */
    version?: number | string;
};

export default function EditorThumbnailStrip({
                                                 fileKey,
                                                 items,
                                                 onReorder,
                                                 onSelect,
                                                 onAdd,
                                                 onDuplicate,
                                                 onDelete,
                                                 thumbWidth = 120,
                                                 height = 120,
                                                 version,
                                             }: Props) {
    const ver = useMemo(() => String(version ?? ""), [version]);

    return (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: 8 }}>
            {items.map((it) => {
                const isBlank =
                    !fileKey ||
                    typeof it.page !== "number" ||
                    !Number.isFinite(it.page) ||
                    it.page <= 0;

                return (
                    <div
                        key={it.id}
                        style={{ display: "grid", gap: 6, placeItems: "center" }}
                    >
                        <div
                            onClick={() => onSelect(it.id)}
                            role="button"
                            tabIndex={0}
                            aria-label={`페이지 선택: ${isBlank ? "빈 페이지" : `p.${it.page}`}`}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") onSelect(it.id);
                            }}
                            style={{ cursor: "pointer", outline: "none" }}
                        >
                            {isBlank ? (
                                <div
                                    style={{
                                        width: thumbWidth,
                                        height,
                                        background: "#111827",
                                        borderRadius: 8,
                                        display: "grid",
                                        placeItems: "center",
                                        fontSize: 12,
                                        opacity: 0.7,
                                        userSelect: "none",
                                    }}
                                    aria-hidden
                                >
                                    0
                                </div>
                            ) : (
                                <WebpThumb
                                    key={`${fileKey}-${it.page}-${ver}`}
                                    fileKey={fileKey!}
                                    page={it.page}
                                    width={thumbWidth}
                                    height={height}
                                />
                            )}
                        </div>

                        <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn" onClick={() => onDuplicate(it.id)}>
                                복제
                            </button>
                            <button className="btn" onClick={() => onDelete(it.id)}>
                                삭제
                            </button>
                        </div>
                    </div>
                );
            })}

            {/* + 페이지 버튼 */}
            <button className="btn" onClick={onAdd} aria-label="페이지 추가">
                + 페이지
            </button>
        </div>
    );
}
