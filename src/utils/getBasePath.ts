// src/utils/getBasePath.ts
export function getBasePath() {
    // Vite의 base (예: "/AUTOPPT/") 사용
    const base = import.meta.env.BASE_URL || "/";
    return base.endsWith("/") ? base.slice(0, -1) : base; // "/AUTOPPT"
}
