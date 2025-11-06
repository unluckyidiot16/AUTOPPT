import React, { useRef, useState } from "react";

type Props = {
    value: string[];               // 현재 키워드 배열
    onChange: (next: string[]) => void;
    placeholder?: string;
};

export default function KeywordListInput({ value, onChange, placeholder }: Props) {
    const [text, setText] = useState("");
    const ref = useRef<HTMLInputElement>(null);

    const add = (raw: string) => {
        const parts = raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
        if (!parts.length) return;
        const uniq = Array.from(new Set([...value, ...parts]));
        onChange(uniq);
        setText("");
        ref.current?.focus();
    };

    return (
        <div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
                {value.map(k => (
                    <span key={k} className="badge" style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
            {k}
                        <button className="btn" onClick={()=>onChange(value.filter(v=>v!==k))}>×</button>
          </span>
                ))}
            </div>
            <input
                ref={ref}
                className="input"
                value={text}
                onChange={(e)=>setText(e.target.value)}
                onKeyDown={(e)=>{ if(e.key==="Enter"){ e.preventDefault(); add(text); } }}
                placeholder={placeholder ?? "쉼표/엔터로 추가"}
            />
            <button className="btn" style={{ marginLeft:6 }} onClick={()=>add(text)}>추가</button>
        </div>
    );
}
