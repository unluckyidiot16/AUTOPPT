// src/components/RoomQR.tsx
import React from "react";
import { QRCodeCanvas } from "qrcode.react";

type Props = {
    url: string;
    size?: number; // 외부 컨테이너에 맞춰 조절
};

export function RoomQR({ url, size = 156 }: Props) {
    return (
        <div
            style={{
                width: size,
                height: size,
                overflow: "hidden",
                display: "grid",
                placeItems: "center",
            }}
        >
            <QRCodeCanvas
                value={url}
                size={size}
                includeMargin
                style={{ display: "block", maxWidth: "100%", height: "auto" }}
            />
        </div>
    );
}
