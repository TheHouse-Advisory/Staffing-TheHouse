"use client";

import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";

type Mode = "login" | "forgot";

function LoginForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = searchParams.get("redirectTo") ?? "/tablero";

  const errorMsg = searchParams.get("error");
  const errorMessages: Record<string, string> = {
    no_persona:
      "Tu correo no está registrado en el sistema. Contacta a un administrador.",
    sin_acceso:
      "Tu usuario no tiene acceso a la plataforma. Contacta a un administrador para que te asigne un rol.",
    auth_callback: "Error al completar el inicio de sesión. Intenta de nuevo.",
  };

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (authError) {
      // Mensaje genérico para no filtrar si el correo existe o no.
      setError("Email o contraseña incorrectos.");
      setLoading(false);
      return;
    }

    // El middleware se encarga de redirigir; usamos location para forzar
    // que la sesión recién creada se aplique en la próxima request.
    window.location.assign(redirectTo);
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          "/auth/set-password"
        )}`,
      }
    );

    // Respondemos siempre como si hubiera funcionado para no filtrar
    // qué correos están registrados.
    if (resetErr) {
      // Solo errores de red/red local los mostramos.
      console.error(resetErr);
    }
    setResetSent(true);
    setLoading(false);
  }

  function backToLogin() {
    setMode("login");
    setResetSent(false);
    setError(null);
    setPassword("");
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
          {errorMsg && errorMessages[errorMsg] && mode === "login" && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {errorMessages[errorMsg]}
            </div>
          )}

          {mode === "login" && (
            <>
              <h2 className="text-[17px] font-bold mb-1">Iniciar sesión</h2>
              <p className="text-sm text-[#888] mb-6">
                Accede con tu correo y contraseña.
              </p>

              <form onSubmit={handleLogin} className="space-y-4">
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
                    autoComplete="email"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="password"
                      className="block text-sm font-medium text-[#333]"
                    >
                      Contraseña
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("forgot");
                        setError(null);
                      }}
                      className="text-xs text-[#4a90e2] hover:underline"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !email || !password}
                  className="w-full py-2.5 px-4 bg-[#4a90e2] text-white font-semibold rounded-lg text-sm hover:bg-[#3a7bd5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? "Ingresando..." : "Iniciar sesión"}
                </button>
              </form>
            </>
          )}

          {mode === "forgot" && !resetSent && (
            <>
              <h2 className="text-[17px] font-bold mb-1">
                Recuperar contraseña
              </h2>
              <p className="text-sm text-[#888] mb-6">
                Te enviaremos un enlace para restablecerla.
              </p>

              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <label
                    htmlFor="email-forgot"
                    className="block text-sm font-medium text-[#333] mb-1.5"
                  >
                    Correo electrónico
                  </label>
                  <input
                    id="email-forgot"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@thehouse.cl"
                    required
                    autoComplete="email"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full py-2.5 px-4 bg-[#4a90e2] text-white font-semibold rounded-lg text-sm hover:bg-[#3a7bd5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? "Enviando..." : "Enviar enlace"}
                </button>

                <button
                  type="button"
                  onClick={backToLogin}
                  className="block w-full text-center text-sm text-[#4a90e2] hover:underline"
                >
                  Volver a iniciar sesión
                </button>
              </form>
            </>
          )}

          {mode === "forgot" && resetSent && (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-[#dcf5e7] flex items-center justify-center mx-auto mb-4 text-2xl">
                ✉️
              </div>
              <h2 className="text-[17px] font-bold mb-2">Revisa tu correo</h2>
              <p className="text-sm text-[#888]">
                Si <strong className="text-[#1a1a1a]">{email}</strong> está
                registrado, recibirás un enlace para definir una nueva
                contraseña. El enlace expira en 1 hora.
              </p>
              <button
                onClick={backToLogin}
                className="mt-4 text-sm text-[#4a90e2] hover:underline"
              >
                Volver a iniciar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
