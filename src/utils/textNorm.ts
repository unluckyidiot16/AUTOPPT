// 아주 단순한 정규화(초기 버전): NFKC → 소문자 → 공백/기호 제거
export function norm(s: string): string {
    return (s ?? "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^\p{Letter}\p{Number}]/gu, "");
}

// 키워드 채점(클라)
export function gradeKeywords(answer: string, keywords: string[], threshold = 1) {
    const a = norm(answer);
    const kws = (keywords ?? []).map((k) => norm(k)).filter(Boolean);
    let hits = 0;
    const missing: string[] = [];
    for (const kw of kws) {
        if (kw && a.includes(kw)) hits++;
        else missing.push(kw);
    }
    return { passed: hits >= Math.max(1, threshold), hits, missing };
}
