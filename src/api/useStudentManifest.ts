// src/hooks/useStudentManifest.ts
import { useEffect, useState } from "react";
import { fetchStudentManifest, type StudentManifest } from "../api/manifest";

export function useStudentManifest(roomCode: string | null) {
    const [manifest, setManifest] = useState<StudentManifest | null>(null);
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState<string | null>(null);

    useEffect(() => {
        if (!roomCode) return;
        setLoading(true);
        setError(null);
        fetchStudentManifest(roomCode)
            .then(setManifest)
            .catch((e) => setError(e?.message ?? String(e)))
            .finally(() => setLoading(false));
    }, [roomCode]);

    return { manifest, loading, error };
}
