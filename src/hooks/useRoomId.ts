// src/hooks/useRoomId.ts
import { useLocation } from "react-router-dom";

export function useRoomId(defaultRoom = "class-1") {
    const { search } = useLocation();
    const params = new URLSearchParams(search);
    const room = params.get("room");
    // 앞뒤 공백 제거 + 대문자 통일
    const norm = room?.trim();
    return (norm ? norm.toUpperCase() : defaultRoom.toUpperCase());
}
