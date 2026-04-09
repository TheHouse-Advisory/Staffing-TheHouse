"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = searchParams.get("redirectTo") ?? "/tablero";

  const errorMsg = searchParams.get("error");
  const errorMessages: Record<string, string> = {
    no_persona:
      "Tu cuenta no está vinculada a ninguna persona del equipo. Contacta a un administrador.",
    auth_callback: "Error al completar el inicio de sesión. Intenta de nuevo.",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f5f7] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-[#1a1a1a]">
            Staffing<span className="text-[#4a90e2]">Hub</span>
          </h1>
          <p className="text-sm text-[#888] mt-1">The House</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#e8e8e8] p-8">
          {errorMsg && errorMessages[errorMsg] && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMessages[errorMsg]}
            </div>
          )}

          {!sent ? (
            <>
              <h2 className="text-[17px] font-bold mb-1">Iniciar sesión</h2>
              <p className="text-sm text-[#888] mb-6">
                Te enviaremos un enlace mágico a tu correo.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-[#333] mb-1.5"
                  >
                    Correo electrónico
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@thehouse.cl"
                    required
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full py-2.5 px-4 bg-[#4a90e2] text-white font-semibold rounded-lg text-sm hover:bg-[#3a7bd5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? "Enviando..." : "Enviar enlace de acceso"}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-[#dcf5e7] flex items-center justify-center mx-auto mb-4 text-2xl">
                ✉️
              </div>
              <h2 className="text-[17px] font-bold mb-2">
                Revisa tu correo
              </h2>
              <p className="text-sm text-[#888]">
                Enviamos un enlace de acceso a{" "}
                <strong className="text-[#1a1a1a]">{email}</strong>.
                <br />
                El enlace expira en 10 minutos.
              </p>
              <button
                onClick={() => setSent(false)}
                className="mt-4 text-sm text-[#4a90e2] hover:underline"
              >
                Usar otro correo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
