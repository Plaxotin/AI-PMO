import { useEffect } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";

export default function Home() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (user) window.location.replace("/workspace.html");
  }, [user]);

  if (isLoading) {
    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>Проверяем доступ…</main>;
  }
  if (user) {
    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>Открываем Project Audit…</main>;
  }
  return <Navigate to="/login" replace />;
}
