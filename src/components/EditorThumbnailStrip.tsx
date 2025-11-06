import React from "react";
import { DndContext, DragEndEvent, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

type PageItem = { id: string; page: number; label?: string };

type Props = {
    items: PageItem[];
    onReorder: (next: PageItem[]) => void;
    onSelect: (id: string)=>void;
    onAdd: ()=>void;
    onDuplicate: (id: string)=>void;
    onDelete: (id: string)=>void;
};

export default function EditorThumbnailStrip({ items, onReorder, onSelect, onAdd, onDuplicate, onDelete }: Props) {
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 5 }}),
        useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 }}),
        useSensor(KeyboardSensor)
    );

    const onDragEnd = (e: DragEndEvent) => {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const cur = items.findIndex(i => i.id === active.id);
        const dst = items.findIndex(i => i.id === over.id);
        onReorder(arrayMove(items, cur, dst));
    };

    return (
        <div style={{ borderTop:"1px solid rgba(148,163,184,0.25)", paddingTop:8 }}>
            <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:8 }}>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={items.map(i=>i.id)} strategy={verticalListSortingStrategy}>
                        {items.map(it => (
                            <div key={it.id} id={it.id}
                                 style={{ minWidth:100, minHeight:70, border:"1px solid #334155", borderRadius:10, padding:6 }}>
                                <div style={{ fontSize:12, opacity:0.7, marginBottom:4 }}>p.{it.page}</div>
                                <div style={{ display:"flex", gap:6 }}>
                                    <button className="btn" onClick={()=>onSelect(it.id)}>보기</button>
                                    <button className="btn" onClick={()=>onDuplicate(it.id)}>복제</button>
                                    <button className="btn" onClick={()=>onDelete(it.id)}>삭제</button>
                                </div>
                            </div>
                        ))}
                    </SortableContext>
                </DndContext>

                <button className="btn" onClick={onAdd}>+ 추가</button>
            </div>
        </div>
    );
}
