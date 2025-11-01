import React from "react";

type Props = {
    slide: number;
    step: number;
};

export default function SlideViewer({ slide, step }: Props) {
    return (
        <div
            style={{
                marginTop: 16,
                width: 640,
                height: 360,
                background: "#0f766e",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                gap: 8,
            }}
        >
            <div style={{ fontSize: 26, fontWeight: 700 }}>슬라이드 {slide}</div>
            <div style={{ fontSize: 16 }}>스텝 {step}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
                (여기에 나중에 PPTX 변환된 콘텐츠가 들어옵니다)
            </div>
        </div>
    );
}
