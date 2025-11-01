// src/slideMeta.ts
export type StepMeta =
    | { kind: "show" }
    | { kind: "quiz"; answer: string };

export const SLIDE_META: Record<number, { steps: StepMeta[] }> = {
    1: {
        steps: [
            { kind: "show" },
            { kind: "quiz", answer: "반지름" }
        ],
    },
    2: {
        steps: [{ kind: "show" }],
    },
};
