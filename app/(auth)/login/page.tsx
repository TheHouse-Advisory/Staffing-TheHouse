"use client";

import { Suspense, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";

type Mode = "login" | "forgot";

/** Segundos de espera tras pedir un enlace, para no chocar con el límite de Supabase. */
const RESET_COOLDOWN = 60;

/** Formatea minutos de bloqueo en un texto legible (ej. "2 días", "48 horas", "15 minutos"). */
function formatearDuracion(minutos: number): string {
  if (minutos < 60) return `${minutos} minuto${minutos === 1 ? "" : "s"}`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${horas} hora${horas === 1 ? "" : "s"}`;
  const dias = Math.floor(horas / 24);
  const horasResto = horas % 24;
  return horasResto === 0
    ? `${dias} día${dias === 1 ? "" : "s"}`
    : `${dias} día${dias === 1 ? "" : "s"} y ${horasResto} hora${horasResto === 1 ? "" : "s"}`;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Valida que sea ruta interna — evita open redirect vía ?redirectTo=//evil.com
  const rawRedirect = searchParams.get("redirectTo") ?? "";
  const redirectTo = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/tablero";

  const errorMsg = searchParams.get("error");
  const errorMessages: Record<string, string> = {
    no_persona:
      "Tu correo no está registrado en el sistema. Contacta a un administrador.",
    sin_acceso:
      "Tu usuario no tiene acceso a la plataforma. Contacta a un administrador para que te asigne un rol.",
    acceso_suspendido:
      "Tu acceso al sistema fue suspendido. Contacta a un administrador.",
    auth_callback: "Error al completar el inicio de sesión. Intenta de nuevo.",
    enlace_expirado:
      "El enlace expiró o ya fue usado. Solicita uno nuevo con la opción de recuperar contraseña.",
  };

  // Cuenta regresiva del cooldown del botón de recuperación.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const emailNorm = email.trim().toLowerCase();
    const supabase = createClient();

    // Bloqueo por intentos fallidos: se revisa ANTES de intentar la contraseña.
    // as any: función nueva, aún no está en los tipos generados de Supabase.
    const { data: bloqueoData } = await (supabase as any).rpc("fn_verificar_bloqueo", { p_email: emailNorm });
    const bloqueo = bloqueoData?.[0];
    if (bloqueo?.bloqueado) {
      setError(`Demasiados intentos fallidos. Intenta de nuevo en ${formatearDuracion(bloqueo.minutos_restantes)}.`);
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: emailNorm,
      password,
    });

    if (authError) {
      const { data: intentoData } = await (supabase as any).rpc("fn_registrar_intento_fallido", { p_email: emailNorm });
      const intento = intentoData?.[0];
      // Mensaje genérico para no filtrar si el correo existe o no,
      // salvo que ya se haya activado el bloqueo.
      setError(
        intento?.bloqueado
          ? `Demasiados intentos fallidos. Tu cuenta quedó bloqueada por ${formatearDuracion(intento.minutos_restantes)}.`
          : "Email o contraseña incorrectos."
      );
      setLoading(false);
      return;
    }

    await (supabase as any).rpc("fn_login_exitoso", { p_email: emailNorm });

    // El middleware se encarga de redirigir; usamos location para forzar
    // que la sesión recién creada se aplique en la próxima request.
    window.location.assign(redirectTo);
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    if (cooldown > 0) return;
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

    setLoading(false);

    // resetPasswordForEmail NUNCA revela si el correo está registrado:
    // Supabase responde "ok" también para correos inexistentes. Por eso
    // cualquier error que llegue aquí es operativo (límite de envíos, red,
    // servidor) y SÍ debe mostrarse. Antes se ocultaban todos y la pantalla
    // decía "correo enviado" aunque nunca saliera — ese era el bug.
    if (resetErr) {
      const status = (resetErr as { status?: number }).status;
      const msg = resetErr.message ?? "";
      const isRateLimit =
        status === 429 ||
        /rate limit|too many|seconds|security purposes/i.test(msg);
      const isNetwork =
        resetErr.name === "AuthRetryableFetchError" ||
        /failed to fetch|network/i.test(msg);

      if (isRateLimit) {
        setError(
          "Se enviaron demasiadas solicitudes. Espera un momento y vuelve a intentarlo."
        );
        setCooldown(RESET_COOLDOWN);
      } else if (isNetwork) {
        setError(
          "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo."
        );
      } else {
        setError(
          "No se pudo enviar el enlace. Inténtalo de nuevo en unos minutos."
        );
      }
      return;
    }

    setResetSent(true);
    setCooldown(RESET_COOLDOWN);
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

                {error && <p className="text-sm text-red-600">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || !email || cooldown > 0}
                  className="w-full py-2.5 px-4 bg-[#4a90e2] text-white font-semibold rounded-lg text-sm hover:bg-[#3a7bd5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading
                    ? "Enviando..."
                    : cooldown > 0
                      ? `Reintentar en ${cooldown}s`
                      : "Enviar enlace"}
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
