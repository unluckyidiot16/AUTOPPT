// src/utils/koNormalize.ts
type BuildOpts = {
    synonyms?: Record<string, string[]>; // {"에어컨":["냉방기","에컨"], ...}
    minLen?: number;                      // 부분일치 최소 글자 수(기본 2)
    enableSubstr?: boolean;               // 부분일치 허용
};

// 한글/영문/숫자만 남기되, 자모 분해 후 결합기호 제거
export function koNorm(s?: string) {
    return (s ?? "")
        .normalize("NFD")
        .replace(/\p{Diacritic}+/gu, "")
        .replace(/[^\p{Letter}\p{Number}]+/gu, "") // 공백·문장부호 제거
        .toLowerCase();
}

// 약어(초성) 간단 대응: “ㅂㅅㅈ”처럼 자음 연속을 허용
export function seemsAbbrev(s: string) {
    return /^[\u3131-\u314e]+$/u.test(s); // 초성만
}

// 키워드 빌더: 동의어/약어 포함 매처 생성
export function buildMatcher(keywords: string[], opts: BuildOpts = {}) {
    const minLen = Math.max(2, opts.minLen ?? 2);
    const base = new Set<string>();
    const expand = (w: string) => {
        base.add(koNorm(w));
        const syns = opts.synonyms?.[w] || [];
        syns.forEach(sw => base.add(koNorm(sw)));
    };
    keywords.forEach(expand);

    return (input: string) => {
        const x = koNorm(input);
        for (const k of base) {
            if (!k) continue;
            if (k === x) return true;
            if (opts.enableSubstr && k.length >= minLen && x.includes(k)) return true;
            // 약어(초성) 단순 대응: 각 음절 첫 글자 비교 (간이판)
            if (seemsAbbrev(k)) {
                const initials = x.replace(/([가-힣])/g, (ch)=>getInitial(ch));
                if (initials.includes(k)) return true;
            }
        }
        return false;
    };
}

// 초성 추출(간이)
const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function getInitial(ch: string) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return ch;
    const cho = Math.floor(code / (21 * 28));
    return CHO[cho] || ch;
}

// 편의: 입력 하나가 여러 키워드 중 하나와 매칭되는지
export function matchKeywords(input: string, kws: string[], opts?: BuildOpts) {
    return buildMatcher(kws, opts)(input);
}
