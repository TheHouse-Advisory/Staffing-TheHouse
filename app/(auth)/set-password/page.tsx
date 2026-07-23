"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const REQUISITOS_TEXTO = "Mínimo 8 caracteres, con al menos una mayúscula, una minúscula y un número.";
// Debe coincidir con la política configurada en Supabase (Authentication → Sign In → Password requirements).
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export default function SetPasswordPage() {
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!PASSWORD_REGEX.test(password)) {
      setError(REQUISITOS_TEXTO);
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError("No se pudo guardar la contraseña. El enlace puede haber expirado.");
      return;
    }

    // Sesión activa — redirigir al dashboard
    window.location.assign("/inicio");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7]">
      <div className="bg-white rounded-2xl shadow-sm border border-[#e8e8e8] p-8 w-full max-w-sm">
        <h1 className="text-lg font-bold text-[#1a1a2e] mb-1">Crear contraseña</h1>
        <p className="text-sm text-[#888] mb-6">Elige una contraseña para activar tu cuenta.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-[#555]">Nueva contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña"
              required
              className="border border-[#e8e8e8] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a1a2e]/20"
            />
            <p className="text-[11px] text-[#aaa]">{REQUISITOS_TEXTO}</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-[#555]">Confirmar contraseña</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repite la contraseña"
              required
              className="border border-[#e8e8e8] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a1a2e]/20"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-[#2d2d4e] transition-colors disabled:opacity-50"
          >
            {loading ? "Guardando…" : "Guardar contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}
