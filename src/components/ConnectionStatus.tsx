import React from "react";

export default function ConnectionStatus({ connected }: { connected: boolean }) {
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
            }}
        >
      <span
          style={{
              width: 10,
              height: 10,
              borderRadius: "9999px",
              background: connected ? "#22c55e" : "#ef4444",
          }}
      />
            {connected ? "연결됨" : "연결 안 됨"}
    </span>
    );
}
