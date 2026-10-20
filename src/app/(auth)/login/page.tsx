"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await signIn.email({ email, password });
    setLoading(false);
    if (err) {
      setError(
        err.status === 429
          ? "Demasiados intentos. Espera unos minutos."
          : "Correo o contraseña incorrectos."
      );
      return;
    }
    // A la raíz, no a la Bandeja: ahí se decide si toca la guía de inicio
    // (#86) o la Bandeja de siempre.
    router.push("/");
    router.refresh();
  }

  return (
    <Card className="rounded-[22px] border-[#d8e3f1] bg-white text-[#101d3c] shadow-[0_24px_65px_-34px_rgba(16,29,60,0.36)] sm:rounded-[28px]">
      <CardHeader className="px-6 pb-5 pt-6 sm:px-12 sm:pb-8 sm:pt-10">
        <CardTitle className="text-[20px] sm:text-[26px]">Iniciar sesión</CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6 pt-0 sm:px-12 sm:pb-11">
        <form onSubmit={onSubmit} className="space-y-5 sm:space-y-8">
          <div className="space-y-2 sm:space-y-3">
            <Label htmlFor="email" className="text-[15px] text-[#263755] sm:text-[19px]">Correo</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 rounded-[14px] border-[#cfddec] bg-white px-4 text-[#101d3c] focus-visible:border-[#1265d8] focus-visible:ring-[#d7e7ff] sm:h-16 sm:rounded-[17px]"
            />
          </div>
          <div className="space-y-2 sm:space-y-3">
            <Label htmlFor="password" className="text-[15px] text-[#263755] sm:text-[19px]">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 rounded-[14px] border-[#cfddec] bg-white px-4 text-[#101d3c] focus-visible:border-[#1265d8] focus-visible:ring-[#d7e7ff] sm:h-16 sm:rounded-[17px]"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-[#b42318]">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="h-12 w-full rounded-full bg-[#1265d8] text-[15px] text-white shadow-[0_10px_22px_-12px_rgba(18,101,216,0.86)] hover:bg-[#0d54b8] focus-visible:ring-[#1265d8] focus-visible:ring-offset-white sm:h-16 sm:text-[17px]"
            disabled={loading}
          >
            {loading ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
