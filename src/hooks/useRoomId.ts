// src/hooks/useRoomId.ts
import { useLocation } from "react-router-dom";

export function useRoomId(defaultRoom = "class-1") {
    const { search } = useLocation();
    const params = new URLSearchParams(search);
    const room = params.get("room");
    return room || defaultRoom;
}
