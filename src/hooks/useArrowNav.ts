// src/hooks/useArrowNav.ts
import { useEffect, useRef } from "react";

export function useArrowNav(onPrev: ()=>void, onNext: ()=>void) {
    const lock = useRef(false);
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === "input" || tag === "textarea" || (e.target as HTMLElement)?.isContentEditable) return;
            if (lock.current) return;
            if (e.key === "ArrowLeft") { lock.current = true; onPrev(); setTimeout(()=>lock.current=false, 120); }
            if (e.key === "ArrowRight") { lock.current = true; onNext(); setTimeout(()=>lock.current=false, 120); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onPrev, onNext]);
}
