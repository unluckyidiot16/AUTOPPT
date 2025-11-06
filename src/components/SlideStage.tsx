// src/components/SlideStage.tsx
import React from "react";

export type Overlay = { id: string; z?: number; type: string; payload?: any };

export default function SlideStage({
                                       bgUrl,
                                       overlays = [],
                                       mode, // "student" | "teacher" | "editor"
                                       onSubmit,
                                   }: {
    bgUrl: string | null;
    overlays?: Overlay[];
    mode: "student" | "teacher" | "editor";
    onSubmit?: (val: any) => void;
}) {
    return (
        <div className="relative w-full h-full overflow-hidden bg-black rounded-lg">
            {bgUrl ? (
                <img
                    src={bgUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-contain select-none"
                    draggable={false}
                />
            ) : (
                <div className="absolute inset-0 grid place-items-center text-sm text-white/70">
                    배경 이미지가 없습니다.
                </div>
            )}

            {/* 간단 오버레이 샘플: text, quiz_short */}
            {overlays
                .slice()
                .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
                .map((ov) => {
                    if (ov.type === "text") {
                        const x = ov.payload?.x ?? 40;
                        const y = ov.payload?.y ?? 40;
                        return (
                            <div
                                key={ov.id}
                                className="absolute"
                                style={{ left: x, top: y }}
                            >
                                <div className="bg-white/85 px-2 py-1 rounded shadow text-[13px]">
                                    {ov.payload?.text ?? ""}
                                </div>
                            </div>
                        );
                    }
                    if (ov.type === "quiz_short") {
                        const placeholder = ov.payload?.placeholder ?? "Your answer";
                        const x = ov.payload?.x ?? "50%";
                        const y = ov.payload?.y ?? undefined;
                        const bottom = y == null ? 24 : undefined;
                        return (
                            <div
                                key={ov.id}
                                className="absolute"
                                style={{
                                    left: typeof x === "number" ? x : x,
                                    top: y,
                                    bottom,
                                    transform:
                                        typeof x === "string" && x.includes("%")
                                            ? "translateX(-50%)"
                                            : undefined,
                                }}
                            >
                                <div className="bg-white/95 rounded px-3 py-2 shadow flex gap-2">
                                    <input
                                        disabled={mode === "teacher"}
                                        placeholder={placeholder}
                                        className="border px-2 py-1 rounded text-sm"
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" && onSubmit) {
                                                onSubmit({
                                                    type: "short",
                                                    value: (e.target as HTMLInputElement).value,
                                                });
                                            }
                                        }}
                                    />
                                    {mode !== "teacher" && (
                                        <button
                                            className="border px-2 rounded text-sm"
                                            onClick={(e) => {
                                                const input = (e.currentTarget
                                                    .previousSibling as HTMLInputElement)!;
                                                onSubmit?.({ type: "short", value: input.value });
                                            }}
                                        >
                                            제출
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    }
                    return null;
                })}
        </div>
    );
}
