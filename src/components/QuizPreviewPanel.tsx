import React from "react";
import type { QuizQuestion } from "../types/manifest";

export default function QuizPreviewPanel({ questions }: { questions: QuizQuestion[] }) {
    return (
        <div className="panel" style={{ display:"grid", gap:8 }}>
            {questions.map(q => (
                <div key={q.id} style={{ border:"1px solid rgba(148,163,184,0.25)", borderRadius:10, padding:8 }}>
                    <div style={{ fontWeight:700, marginBottom:4 }}>{q.prompt}</div>
                    <div style={{ fontSize:12, opacity:0.7 }}>
                        키워드: {q.keywords.join(", ")}
                    </div>
                </div>
            ))}
        </div>
    );
}
