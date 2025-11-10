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

    /** 썸네일 가로/세로 크기 */
    thumbWidth?: number;
    height?: number;

    /** 캐시 버전(선택) */
    version?: number | string;

    /** 썸네일 스트립 방향: 기본 가로(하단), 필요시 세로(사이드바) */
    orientation?: "horizontal" | "vertical";

    /** (세로 모드일 때) 최대 높이, (가로 모드일 때) 고정 높이 */
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
                                                 height = 120,
                                                 version,
                                                 orientation = "horizontal",
                                                 maxExtent,
                                             }: Props) {
    const ver = useMemo(() => String(version ?? ""), [version]);
    const isH = orientation === "horizontal";

    // 스크롤 컨테이너(바깥) — 뷰포트 폭/높이를 절대 늘리지 않도록 고정
    const outerStyle: React.CSSProperties = isH
        ? {
            width: "100%",
            maxWidth: "100%",
            overflowX: "auto",
            overflowY: "hidden",
            padding: "8px",
            borderTop: "1px solid rgba(148,163,184,.15)",
            // 하단 고정 높이(필요시 조절)
            height: (maxExtent ?? height + 48) + "px",
            boxSizing: "border-box",
        }
        : {
            width: "100%",
            maxWidth: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            padding: "8px",
            borderLeft: "1px solid rgba(148,163,184,.15)",
            height: (maxExtent ?? 420) + "px",
            boxSizing: "border-box",
        };

    // 실제 트랙(안쪽) — 가로는 inline-flex로 트랙 폭이 컨텐츠만큼만 커지게
    const trackStyle: React.CSSProperties = isH
        ? { display: "inline-flex", gap: 8, alignItems: "flex-start" }
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

                            {/* 조작 버튼을 컴팩트하게 유지 */}
                            <div style={{ display: "flex", gap: 6 }}>
                                <button className="btn" onClick={() => onDuplicate(it.id)}>복제</button>
                                <button className="btn" onClick={() => onDelete(it.id)}>삭제</button>
                            </div>
                        </div>
                    );
                })}

                {/* + 페이지 버튼 */}
                <button className="btn" onClick={onAdd} aria-label="페이지 추가" style={{ alignSelf: "center" }}>
                    + 페이지
                </button>
            </div>
        </div>
    );
}
