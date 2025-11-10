// src/components/EditorThumbnailStrip.tsx
import React, { useMemo } from "react";
import WebpThumb from "./WebpThumb";

type ThumbItem = { id: string; page: number };

type Props = {
    fileKey?: string | null;
    items: ThumbItem[];
    onReorder: (next: ThumbItem[]) => void;   // (향후 드래그 정렬용)
    onSelect: (id: string) => void;
    onAdd: () => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;

    /** 썸네일 크기 */
    thumbWidth?: number;
    thumbHeight?: number;

    /** 캐시 버전(선택) */
    version?: number | string;

    /** 스트립 방향 */
    orientation?: "horizontal" | "vertical";

    /** (세로 모드) 최대 높이, (가로 모드) 고정 높이 */
    maxExtent?: number; // px
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
                                                 thumbHeight = 120,
                                                 version,
                                                 orientation = "horizontal",
                                                 maxExtent,
                                             }: Props) {
    const ver = useMemo(() => String(version ?? ""), [version]);
    const isH = orientation === "horizontal";

    // 바깥 스크롤 컨테이너: 레이아웃을 늘리지 않고 자기 영역에만 스크롤
    const outerStyle: React.CSSProperties = isH
        ? {
            width: "100%",
            maxWidth: "100%",
            overflowX: "auto",
            overflowY: "hidden",
            padding: 8,
            borderTop: "1px solid rgba(148,163,184,.15)",
            height: `${maxExtent ?? thumbHeight + 48}px`, // ← 숫자 보장
            boxSizing: "border-box",
        }
        : {
            width: "100%",
            maxWidth: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            padding: 8,
            borderRight: "1px solid rgba(148,163,184,.15)",
            height: `${maxExtent ?? 420}px`,
            boxSizing: "border-box",
        };

    const trackStyle: React.CSSProperties = isH
            ? {
                display: "flex",
                flexWrap: "nowrap",     // 줄바꿈 방지
                gap: 8,
                alignItems: "flex-start",
            width: "max-content",   // 내용 폭만큼 확장 → 바깥 컨테이너에서 overflow-x 작동
            minWidth: "max-content"
    }
    : { display: "grid", gap: 8, alignContent: "start" };

    return (
        <div style={outerStyle}>
            <div style={trackStyle}>
                {items.map((it) => {
                    const isBlank =
                        !fileKey ||
                        typeof it.page !== "number" ||
                        !Number.isFinite(it.page) ||
                        it.page <= 0;

                    const thumb = isBlank ? (
                        <div
                            style={{
                                width: thumbWidth,
                                height: thumbHeight,
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
                                style={{ cursor: "pointer", outline: "none" }}
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
