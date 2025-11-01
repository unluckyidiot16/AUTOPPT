// src/components/RoomQR.tsx
import React from "react";
import { QRCodeCanvas } from "qrcode.react";

type RoomQRProps = {
    url: string;
};

export function RoomQR({ url }: RoomQRProps) {
    return (
        <div className="panel" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, marginBottom: 6, opacity: 0.8 }}>
                QR로 접속하기
            </div>
            <QRCodeCanvas value={url} size={160} includeMargin />
            <div style={{ fontSize: 11, marginTop: 6, wordBreak: "break-all", opacity: 0.6 }}>
                {url}
            </div>
        </div>
    );
}
