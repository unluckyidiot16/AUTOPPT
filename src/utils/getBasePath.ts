// src/utils/getBasePath.ts
export function getBasePath() {
    // 예시 1: /AUTOPPT/teacher → /AUTOPPT
    // 예시 2: /teacher → ""
    const path = window.location.pathname;

    // 프로젝트 페이지처럼 /AUTOPPT/... 로 시작하면 그걸 베이스로 사용
    const m = path.match(/^\/([^/]+)\/(teacher|student)/);
    if (m) {
        // m[1] = 'AUTOPPT'
        return `/${m[1]}`;
    }

    // 루트에 바로 /teacher 로 붙어 있는 경우
    return "";
}
