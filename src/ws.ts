// src/ws.ts
let socket: WebSocket | null = null;

export type WSMessage =
    | { type: "hello"; role: "teacher" | "student" }
    | { type: "goto"; slide: number; step: number }
    | { type: "pong" }
// 앞으로 여기다 unlock-request 등 추가
    ;

type Listener = (msg: WSMessage) => void;
const listeners = new Set<Listener>();

export function connectWS(role: "teacher" | "student") {
    if (socket && socket.readyState === WebSocket.OPEN) return socket;

    socket = new WebSocket("ws://localhost:3001");
    socket.addEventListener("open", () => {
        const hello: WSMessage = { type: "hello", role };
        socket?.send(JSON.stringify(hello));
    });
    socket.addEventListener("message", (event) => {
        try {
            const data = JSON.parse(event.data);
            listeners.forEach((fn) => fn(data));
        } catch (e) {
            console.warn("WS parse error", e);
        }
    });
    return socket;
}

export function sendWS(msg: WSMessage) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
    } else {
        console.warn("WS not connected yet");
    }
}

export function onWSMessage(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
