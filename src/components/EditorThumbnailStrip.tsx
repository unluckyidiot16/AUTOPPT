// src/components/EditorThumbnailStrip.tsx
import React from "react";
import WebpThumb from "./WebpThumb";

type ThumbItem = { id: string; page: number; blank?: boolean };

type Props = {
    fileKey?: string | null;
    items: ThumbItem[];
    onReorder: (next: ThumbItem[]) => void;
    onSelect: (id: string) => void;
    onAdd: () => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    orientation?: "horizontal" | "vertical";
    thumbWidth?: number;
    thumbHeight?: number;
    maxExtent?: number;
    version?: string | number;
};

export default function EditorThumbnailStrip({
                                                 fileKey,
                                                 items,
                                                 onReorder,
                                                 onSelect,
                                                 onAdd,
                                                 onDuplicate,
                                                 onDelete,
                                                 orientation = "horizontal",
                                                 thumbWidth = 120,
                                                 thumbHeight = 80,
                                                 maxExtent = 240,
                                                 version,
                                             }: Props) {
    const outerStyle: React.CSSProperties =
        orientation === "vertical"
            ? { width: 164 }
            : { width: "100%" };

    const trackStyle: React.CSSProperties =
        orientation === "vertical"
            ? { display: "grid", gap: 8, maxHeight: maxExtent, overflow: "auto" }
            : { display: "flex", gap: 8, overflowX: "auto" };

    return (
        <div style={outerStyle}>
            <div style={trackStyle}>
                {items.map((it) => {
                    const isBlank = !!it.blank || !fileKey || !Number.isFinite(it.page) || it.page <= 0;

                    const thumb = isBlank ? (
                        <div
                            style={{
                                width: thumbWidth,
                                height: thumbHeight,
                                borderRadius: 8,
                                background: "#ffffff",
                                display: "grid",
                                placeItems: "center",
                                color: "#111827",
                                fontSize: 12,
                                userSelect: "none",
                                border: "1px solid rgba(0,0,0,.1)",
                            }}
                            aria-hidden
                        >
                            BLANK
                        </div>
                    ) : (
                        <WebpThumb
                            key={`${fileKey}-${it.page}-${version ?? ""}`}
                            fileKey={fileKey!}
                            page={it.page}
                            width={thumbWidth}
                            height={thumbHeight}
                            title={`p.${it.page}`}
                        />
                    );

                    return (
                        <div key={it.id} style={{ display: "grid", gap: 6, placeItems: "center" }}>
                            <div
                                onClick={() => onSelect(it.id)}
                                role="button"
                                tabIndex={0}
                                aria-label={isBlank ? "빈 페이지" : `페이지 ${it.page}`}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") onSelect(it.id);
                                }}
                                style={{ cursor: "pointer" }}
                            >
                                {thumb}
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                                <button className="btn" onClick={() => onDuplicate(it.id)}>복제</button>
                                <button className="btn" onClick={() => onDelete(it.id)}>삭제</button>
                            </div>
                        </div>
                    );
                })}

                <button className="btn" onClick={onAdd} aria-label="페이지 추가" style={{ alignSelf: "center" }}>
                    + 페이지
                </button>
            </div>
        </div>
    );
}
