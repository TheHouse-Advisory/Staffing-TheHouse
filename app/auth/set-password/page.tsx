"use client";

/**
 * Página /auth/set-password
 *
 * Destino al que llega el usuario después del callback de Supabase:
 *  - Invitación inicial (admin → inviteUserByEmail): el usuario aún no tiene
 *    contraseña y define la primera.
 *  - Recuperación (resetPasswordForEmail): el usuario reemplaza la contraseña
 *    existente.
 *
 * En ambos casos el callback ya intercambió el code por una sesión, por lo
 * que aquí simplemente llamamos a supabase.auth.updateUser({ password }).
 *
 * Si alguien llega sin sesión válida (link expirado / abierto en otro
 * navegador), lo enviamos de vuelta a /login.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmarCuenta } from "@/lib/auth/actions";

const MIN_LENGTH = 8;

export default function SetPasswordPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setHasSession(true);
        setEmail(data.user.email ?? null);
      }
      setCheckingSession(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updErr } = await supabase.auth.updateUser({ password });

    if (updErr) {
      setError(updErr.message);
      setLoading(false);
      return;
    }

    // Marca la cuenta como activa (best-effort: no bloquea el ingreso).
    await confirmarCuenta().catch(() => {});

    setDone(true);
    setLoading(false);

    // Pequeño delay para que el usuario vea la confirmación.
    setTimeout(() => {
      window.location.assign("/tablero");
    }, 1200);
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#f4f5f7] flex items-center justify-center p-4">
        <p className="text-sm text-[#888]">Cargando...</p>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="min-h-screen bg-[#f4f5f7] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[#e8e8e8] p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4 text-2xl">
            ⚠️
          </div>
          <h2 className="text-[17px] font-bold mb-2">Enlace inválido</h2>
          <p className="text-sm text-[#888] mb-5">
            El enlace expiró o se abrió desde un navegador distinto al que lo
            recibió. Pide a un administrador que te reenvíe la invitación o
            usa la opción de recuperar contraseña.
          </p>
          <button
            onClick={() => router.push("/login")}
            className="w-full py-2.5 px-4 bg-[#4a90e2] text-white font-semibold rounded-lg text-sm hover:bg-[#3a7bd5] transition-colors"
          >
            Ir a iniciar sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f5f7] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-[#1a1a1a]">
            Staffing<span className="text-[#4a90e2]">Hub</span>
          </h1>
          <p className="text-sm text-[#888] mt-1">The House</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-[#e8e8e8] p-8">
          {done ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-[#dcf5e7] flex items-center justify-center mx-auto mb-4 text-2xl">
                ✓
              </div>
              <h2 className="text-[17px] font-bold mb-2">Contraseña guardada</h2>
              <p className="text-sm text-[#888]">Redirigiendo...</p>
            </div>
          ) : (
            <>
              <h2 className="text-[17px] font-bold mb-1">Define tu contraseña</h2>
              <p className="text-sm text-[#888] mb-6">
                {email ? (
                  <>
                    Para la cuenta <strong className="text-[#1a1a1a]">{email}</strong>.
                  </>
                ) : (
                  "Elige una contraseña para acceder al sistema."
                )}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-[#333] mb-1.5"
                  >
                    Nueva contraseña
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={MIN_LENGTH}
                    autoComplete="new-password"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors"
                  />
                  <p className="text-xs text-[#aaa] mt-1">
                    Mínimo {MIN_LENGTH} caracteres.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="confirm"
                    className="block text-sm font-medium text-[#333] mb-1.5"
                  >
                    Confirmar contraseña
                  </label>
                  <input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={MIN_LENGTH}
                    autoComplete="new-password"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors"
                  />
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || !password || !confirm}
                  className="w-full py-2.5 px-4 bg-[#4a90e2] text-white font-semibold rounded-lg text-sm hover:bg-[#3a7bd5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? "Guardando..." : "Guardar y entrar"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
