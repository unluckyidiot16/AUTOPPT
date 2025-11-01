// src/slideMeta.ts
// src/slideMeta.ts
export type StepMeta =
    | { kind: "show" }
    | { kind: "quiz"; answer: string; auto?: boolean }; // auto=true면 자동채점

export const SLIDE_META: Record<number, { steps: StepMeta[] }> = {
    1: {
        steps: [
            { kind: "show" },
            { kind: "quiz", answer: "반지름", auto: true },
        ],
    },
    2: {
        steps: [{ kind: "show" }],
    },
};
